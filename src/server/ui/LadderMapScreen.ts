// LadderMap scene coordinator (Top Table Phase 4b, redesigned 2026-07-22;
// session-end CHAMPIONS reuse in Phase 5; DOM construction moved CLIENT-side
// in migration Phase 7).
//
// The LadderMap ScreenGui is CLIENT-mounted now (bootstrap.client.ts), so this
// module no longer builds cards/plates into PlayerGui. It still owns the
// BLOCKING scene timeline exactly as before — the round flow (roundHandler.
// endRound) depends on these waits — and stages the animation through
// replicated state instead of instance writes:
//
//   * CB_LadderData (per-player attribute, JSON) — published at scene start,
//     cleared at scene end. Carries everything the client card/plate builder
//     needs (entries with positions/colors/member headshots, plus the
//     per-viewer 3D camera anchor). src/client/ladderMap.client.ts builds the
//     board synchronously on the attribute change and derives LadderMap.Enabled
//     from the attribute's presence (matchHud's ladderMapCovering check keeps
//     working). The champions screen is the same attribute with a different
//     payload kind.
//   * CB_LadderAnim (ReplicatedStorage attribute) — the phase triggers
//     ("cam:<dur>:<seq>" / "move:<dur>:<seq>" / "pan:<dur>:<seq>"), published
//     AFTER CB_LadderData so the client build always precedes the first tween
//     (the client additionally ignores triggers until its board is built, and
//     re-checks the current trigger right after building — a late joiner
//     mid-scene snaps forward instead of missing the scene).
//
// The old server-side "snap final property values after each phase" now lives
// in the client's phase handlers (each phase starts by snapping the previous
// phase's end state), since the server can no longer see the instances.

import TeamRegistry from "../Modules/TeamRegistry";
import type { MovementEntry } from "../Modules/MatchDirector";
import UiState from "./UiState";

const Players = game.GetService("Players");
const HttpService = game.GetService("HttpService");

// Phase timings (seconds) — the server-owned timeline.
const CAM_TIME = 3; // 3D rise; the UI fade covers its second half
const SETTLE_TIME = 1.1; // plates sit at their OLD slots
const MOVE_TIME = 1.5; // plates tween to their NEW slots, camera follows
const MOVED_HOLD = 0.9;
const PAN_TIME = 2.2; // camera pans the whole ladder to the 🏆 pitch
const TOP_HOLD = 1.6;
const CHAMPIONS_TIME = 8;

const MAX_PLATE_ICONS = 4;

// Monotonic sequence baked into CB_LadderAnim so consecutive triggers with the
// same phase+duration still fire GetAttributeChangedSignal on the client.
let animSeq = 0;

// ---- payload shapes (mirrored in src/client/ladderMap.client.ts) -----------

interface LadderEntryPayload {
	teamId: string;
	name: string;
	/** Color3 components (0–1). */
	color: [number, number, number];
	from: number;
	to: number;
	/** Member headshot content urls (server-prefetched, ≤ MAX_PLATE_ICONS). */
	images: string[];
}

interface LadderDataPayload {
	kind: "ladder";
	teamCount: number;
	entries: LadderEntryPayload[];
	/** 3D rise anchor above the viewer's own pitch; absent for menu
	 * spectators (the client then fades without touching the camera). */
	camCenter?: [number, number, number];
}

interface ChampionsPayload {
	kind: "champions";
	teamName: string;
	memberNames: string[];
	rewardEach: number;
}

// ---- world lookups --------------------------------------------------------

/** World-space point just above the viewer's pitch floor — the 3D rise
 * anchor. undefined when the viewer isn't on a pitch (menu spectators). */
function pitchWorldCenter(player: Player): Vector3 | undefined {
	const pitchId = player.GetAttribute("CB_PitchId");
	if (!typeIs(pitchId, "string")) {
		return undefined;
	}
	const mapFolder = game.Workspace.FindFirstChild("Map");
	const pitch = mapFolder && mapFolder.FindFirstChild(pitchId);
	if (!pitch) {
		return undefined;
	}
	const ground = pitch.FindFirstChild("groundPart", true);
	if (ground && ground.IsA("BasePart")) {
		return ground.Position.add(new Vector3(0, ground.Size.Y / 2, 0));
	}
	// Fallback: bounding centre of the pitch's parts.
	let minBound: Vector3 | undefined;
	let maxBound: Vector3 | undefined;
	for (const descendant of pitch.GetDescendants()) {
		if (!descendant.IsA("BasePart")) {
			continue;
		}
		const half = descendant.Size.div(2);
		const lo = descendant.Position.sub(half);
		const hi = descendant.Position.add(half);
		minBound =
			minBound === undefined
				? lo
				: new Vector3(math.min(minBound.X, lo.X), math.min(minBound.Y, lo.Y), math.min(minBound.Z, lo.Z));
		maxBound =
			maxBound === undefined
				? hi
				: new Vector3(math.max(maxBound.X, hi.X), math.max(maxBound.Y, hi.Y), math.max(maxBound.Z, hi.Z));
	}
	if (minBound === undefined || maxBound === undefined) {
		return undefined;
	}
	const center = minBound.add(maxBound).div(2);
	return new Vector3(center.X, maxBound.Y, center.Z);
}

// Member headshots, cached across rounds (yielding fetch, so prefetched once
// per show — never inside the per-viewer publish loop).
const thumbnailCache = new Map<number, string>();

function teamMemberImages(teamId: string): string[] {
	const images: string[] = [];
	for (const team of TeamRegistry.getTeams()) {
		if (team.id !== teamId) {
			continue;
		}
		for (const member of team.members) {
			if (images.size() >= MAX_PLATE_ICONS) {
				break;
			}
			let image = thumbnailCache.get(member.UserId);
			if (image === undefined) {
				const [ok, content] = pcall(() => {
					const [thumb] = Players.GetUserThumbnailAsync(
						member.UserId,
						Enum.ThumbnailType.HeadShot,
						Enum.ThumbnailSize.Size100x100,
					);
					return thumb;
				});
				if (ok && typeIs(content, "string")) {
					image = content;
					thumbnailCache.set(member.UserId, content);
				}
			}
			if (image !== undefined) {
				images.push(image);
			}
		}
		break;
	}
	return images;
}

// ---- staging helpers ------------------------------------------------------

function fireAnim(phase: "cam" | "move" | "pan", duration: number) {
	animSeq += 1;
	UiState.setReplicatedAttr("CB_LadderAnim", `${phase}:${duration}:${animSeq}`);
}

function hideAll() {
	// Clearing the data attribute is what disables the client-rendered gui.
	UiState.setReplicatedAttr("CB_LadderAnim", undefined);
	for (const player of Players.GetPlayers()) {
		pcall(() => {
			UiState.setPlayerAttr(player, "CB_LadderData", undefined);
		});
	}
}

const LadderMapScreen = {
	/**
	 * Full-screen animated ladder map — see the header comment for the
	 * choreography (cam rise → plate move → pan to the 🏆 pitch). Blocks ~11 s
	 * exactly as before; the client builds the board from CB_LadderData and
	 * runs the tweens from the CB_LadderAnim triggers.
	 */
	showLadderMap(entries: MovementEntry[]) {
		if (entries.size() === 0) {
			return;
		}

		// Prefetch every team's member headshots (yielding web call) BEFORE the
		// per-viewer publishes so those stay instant.
		const entryPayloads: LadderEntryPayload[] = [];
		for (const entry of entries) {
			entryPayloads.push({
				teamId: entry.teamId,
				name: entry.name,
				color: [entry.color.R, entry.color.G, entry.color.B],
				from: entry.fromPosition,
				to: entry.toPosition,
				images: teamMemberImages(entry.teamId),
			});
		}

		// Publish the board BEFORE the first anim trigger: the client build
		// must complete first (it builds synchronously on the attribute change).
		for (const player of Players.GetPlayers()) {
			pcall(() => {
				const payload: LadderDataPayload = {
					kind: "ladder",
					teamCount: entries.size(),
					entries: entryPayloads,
				};
				// Only when the viewer is still on a pitch (showLadderMap runs
				// before footballMatch.stop() clears CB_PitchId). Absent → the
				// client skips the camera and just fades.
				const center = pitchWorldCenter(player);
				if (center !== undefined) {
					payload.camCenter = [center.X, center.Y, center.Z];
				}
				UiState.setPlayerAttr(player, "CB_LadderData", HttpService.JSONEncode(payload));
			});
		}

		// Phase 1: 3D rise over the viewer's pitch, UI fades in from halfway.
		fireAnim("cam", CAM_TIME);
		task.wait(CAM_TIME);
		// (The client snaps GroupTransparency=0 itself — its fade tween ends
		// here, and the move-phase handler re-snaps it for stragglers.)
		task.wait(SETTLE_TIME);

		// Phase 2: plates to their NEW slots, camera follows the viewer's team.
		fireAnim("move", MOVE_TIME);
		task.wait(MOVE_TIME + MOVED_HOLD);

		// Phase 3: pan across the whole ladder to the 🏆 pitch. The client's
		// pan handler first SNAPS the move phase's end state (plates at their
		// targets, camera on the viewer's new pitch, final position label) —
		// the authoritative-snap job the server used to do.
		fireAnim("pan", PAN_TIME);
		task.wait(PAN_TIME + TOP_HOLD);
		hideAll();
	},

	/** Session-end CHAMPIONS screen (Phase 5): gold panel with the top-table
	 * team + its members, shown to everyone. Blocks ~8 s. */
	showChampions(teamName: string, memberNames: string[], rewardEach: number) {
		const payload: ChampionsPayload = {
			kind: "champions",
			teamName,
			memberNames,
			rewardEach,
		};
		const encoded = HttpService.JSONEncode(payload);
		for (const player of Players.GetPlayers()) {
			pcall(() => {
				UiState.setPlayerAttr(player, "CB_LadderData", encoded);
			});
		}
		task.wait(CHAMPIONS_TIME);
		hideAll();
	},
};

export default LadderMapScreen;
