// Server-side population of the LadderMap ScreenGui (Top Table Phase 4b,
// redesigned 2026-07-22) and its session-end CHAMPIONS reuse (Phase 5). Same
// contract as footballMatch.showRoundSummary: React owns the static shell
// (components/LadderMapGui.tsx), this module builds the per-viewer children
// imperatively and toggles Enabled — no remotes.
//
// ART DIRECTION: the ladder is a stylised 1:1 map of the REAL pitch line.
// PitchManager lays the world's pitches out in a horizontal line (gold slot 0
// first, mud last, muckabout beyond), and the ladder mirrors it with the TOP
// table on the RIGHT: a horizontal strip of big LANDSCAPE pitch cards inside
// the fixed-16:9 Stage — 🏆 gold rightmost, descending leftward to the 💩
// bottom table, muckabout further left still. (The 3D rise shot uses a +Z up
// vector so the world's pitch line reads in the same direction.) Each card
// holds two sharp-cornered team plates (name + member headshots) on its
// halves and a centre badge (🏆 top table, numbers between, 💩 bottom). All
// geometry lives in Stage-scale "world" coordinates on the single World frame,
// which acts as the 2D camera: focusPositionFor(slot, scale) converts a target
// pitch into the World Position that centres it on screen, and every camera
// move (focus / follow / pan-to-top) is a tween of World's Position/Size.
//
// Choreography (showLadderMap blocks for the sum, ~11 s):
//   1. cam  — the 3D camera rises 10→500 studs above the viewer's own pitch
//             while the whole UI (Canvas CanvasGroup) fades in from the
//             halfway point, World pre-focused on that pitch's ladder slot.
//   2. move — every plate tweens to its NEW ladder position while World
//             follows the viewer's team to its new pitch.
//   3. pan  — World pans across the whole ladder to the 🏆 pitch, zooming out
//             a little, so the viewer reads where they sit and what the goal
//             is. Then hide.
//
// Animation contract: this module only STAGES the animation — plates carry
// CB_ToX/CB_ToY targets, World carries CB_Move*/CB_Pan* targets, the gui
// carries CB_CamCenter (Vector3 above the viewer's pitch), and the gui-level
// CB_Anim attribute ("cam:<dur>:<seq>" / "move:<dur>:<seq>" /
// "pan:<dur>:<seq>") tells src/client/ladderMap.client.ts to run the tweens
// locally (smooth, unlike server-side TweenService whose property writes
// replicate at network rate and stutter). The server still owns the timeline:
// it waits out each phase and then SNAPS the final property values so state
// is correct even for a client that missed the trigger.

import TeamRegistry from "../Modules/TeamRegistry";
import type { MovementEntry } from "../Modules/MatchDirector";

const Players = game.GetService("Players");

// Phase timings (seconds).
const CAM_TIME = 3; // 3D rise; the UI fade covers its second half
const SETTLE_TIME = 1.1; // plates sit at their OLD slots
const MOVE_TIME = 1.5; // plates tween to their NEW slots, camera follows
const MOVED_HOLD = 0.9;
const PAN_TIME = 2.2; // camera pans the whole ladder to the 🏆 pitch
const TOP_HOLD = 1.6;
const CHAMPIONS_TIME = 8;

// ---- ladder geometry (all Stage-scale; Stage is a fixed 16:9 letterbox) ---
//
// World-space X runs RIGHT-TO-LEFT down the ladder: slot 0 (gold/top table)
// rightmost, one SLOT_W further left per table, muckabout past the bottom
// table on the far left. Coordinates go negative — the camera pans.

const STAGE_ASPECT = 16 / 9;
const CARD_ASPECT = 1.75; // landscape pitch card, w/h in PIXELS
const PITCH_W = 0.52; // card width in world scale
const CARD_H = (PITCH_W * STAGE_ASPECT) / CARD_ASPECT; // ≈0.53 — pixel aspect holds because Stage is 16:9
const PITCH_GAP = 0.1; // gap between neighbouring pitches
const SLOT_W = PITCH_W + PITCH_GAP;
const ROW_Y = 0.5;

// Camera scales: focused (your pitch fills most of the screen) and the
// panned-out ladder overview.
const FOCUS_SCALE = 1.5;
const PAN_SCALE = 0.95;

// Team plates (world scale) — one per team, parented to World so they can
// tween BETWEEN pitches.
const PLATE_W = 0.2;
const PLATE_H = 0.145;
const PLATE_DX = 0.15; // half-centre offset from the card centre
const MAX_PLATE_ICONS = 4;

const GOLD_TINT = Color3.fromRGB(201, 162, 39); // #C9A227
const MUD_TINT = Color3.fromRGB(139, 94, 60); // #8B5E3C
const GREEN_TINT = Color3.fromRGB(61, 139, 87); // #3D8B57
const MUCK_TINT = Color3.fromRGB(52, 63, 74); // neutral slate — not a real table
const TITLE_GOLD = Color3.fromRGB(255, 200, 60);
const PITCH_IMAGE = "rbxassetid://137005280957670"; // landscape pitch lines
const BLACK = new Color3(0, 0, 0);
const WHITE = new Color3(1, 1, 1);
const SHADOW_TRANSPARENCY = 0.4;

const TITLE_FONT = new Font(
	"rbxasset://fonts/families/FredokaOne.json",
	Enum.FontWeight.Regular,
	Enum.FontStyle.Normal,
);
const PLATE_FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

interface LadderCanvasShape extends CanvasGroup {
	Backdrop: Frame;
	Stage: Frame & { World: Frame };
	Title: TextLabel;
	PositionLabel: TextLabel;
	Rows: Frame;
}

interface LadderGuiShape extends ScreenGui {
	Canvas: LadderCanvasShape;
}

function ladderGuiOf(player: Player): LadderGuiShape | undefined {
	const playerGui = player.FindFirstChild("PlayerGui");
	const gui = playerGui && playerGui.FindFirstChild("LadderMap");
	if (!gui || !gui.IsA("ScreenGui")) {
		return undefined;
	}
	const canvas = gui.FindFirstChild("Canvas");
	if (
		canvas &&
		canvas.IsA("CanvasGroup") &&
		canvas.FindFirstChild("Title") &&
		canvas.FindFirstChild("PositionLabel") &&
		canvas.FindFirstChild("Rows") &&
		canvas.FindFirstChild("Stage") &&
		canvas.FindFirstChild("Stage")!.FindFirstChild("World")
	) {
		return gui as LadderGuiShape;
	}
	return undefined;
}

function clearRows(rows: Frame) {
	for (const child of rows.GetChildren()) {
		if (child.IsA("Frame")) {
			child.Destroy();
		}
	}
}

function resetWorld(world: Frame) {
	world.ClearAllChildren();
	world.Size = new UDim2(1, 0, 1, 0);
	world.Position = new UDim2(0.5, 0, 0.5, 0);
	world.SetAttribute("CB_MoveX", undefined);
	world.SetAttribute("CB_MoveY", undefined);
	world.SetAttribute("CB_PanScale", undefined);
	world.SetAttribute("CB_PanX", undefined);
	world.SetAttribute("CB_PanY", undefined);
}

function hideAll() {
	for (const player of Players.GetPlayers()) {
		pcall(() => {
			const gui = ladderGuiOf(player);
			if (gui) {
				gui.Enabled = false;
			}
		});
	}
}

// Monotonic sequence baked into CB_Anim so consecutive triggers with the same
// phase+duration still fire GetAttributeChangedSignal on the client.
let animSeq = 0;

// ---- world-coordinate helpers --------------------------------------------

interface LadderLayout {
	teamCount: number;
	realTables: number;
	hasMuckabout: boolean;
	slotCount: number;
}

function computeLayout(teamCount: number): LadderLayout {
	const realTables = math.max(1, math.floor(teamCount / 2));
	const hasMuckabout = teamCount > 1 && teamCount % 2 === 1;
	return { teamCount, realTables, hasMuckabout, slotCount: realTables + (hasMuckabout ? 1 : 0) };
}

/** World-space X centre of a ladder slot (0 = gold table, RIGHTMOST; higher
 * slots step leftward so the ladder descends right-to-left). */
function slotCenterX(slotIndex: number): number {
	return PITCH_W / 2 - slotIndex * SLOT_W;
}

/** THE 2D-camera function: the World Position that centres `slotIndex`'s
 * pitch on screen at zoom `scale` (World is anchored 0.5,0.5 inside Stage). */
function focusPositionFor(slotIndex: number, scale: number): UDim2 {
	return new UDim2(0.5 - (slotCenterX(slotIndex) - 0.5) * scale, 0, 0.5 - (ROW_Y - 0.5) * scale, 0);
}

/** Ladder slot a position lives on: consecutive pairing (2t, 2t+1 → table t),
 * odd leftover → the muckabout slot past the last real table. */
function slotForPosition(layout: LadderLayout, position: number): number {
	if (layout.hasMuckabout && position === layout.teamCount - 1) {
		return layout.realTables;
	}
	return math.min(layout.realTables - 1, math.max(0, math.floor(position / 2)));
}

/** Plate centre for a ladder position: left half for the even (upper) seat,
 * right half for the odd seat; muckabout team sits alone at its card centre. */
function plateCenterFor(layout: LadderLayout, position: number): Vector2 {
	const slot = slotForPosition(layout, position);
	if (layout.hasMuckabout && position === layout.teamCount - 1) {
		return new Vector2(slotCenterX(slot), ROW_Y);
	}
	const dx = position % 2 === 0 ? -PLATE_DX : PLATE_DX;
	return new Vector2(slotCenterX(slot) + dx, ROW_Y);
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
// per show — never inside the per-viewer build loop).
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

// ---- ladder builders ------------------------------------------------------

/** Sharp-cornered drop shadow behind a container's Body (containers are
 * transparent because children always render above the parent's own fill). */
function addShadow(container: GuiObject, offsetX: number, offsetY: number) {
	const shadow = new Instance("Frame");
	shadow.Name = "Shadow";
	shadow.AnchorPoint = new Vector2(0.5, 0.5);
	shadow.Position = new UDim2(0.5 + offsetX, 0, 0.5 + offsetY, 0);
	shadow.Size = new UDim2(1, 0, 1, 0);
	shadow.BackgroundColor3 = BLACK;
	shadow.BackgroundTransparency = SHADOW_TRANSPARENCY;
	shadow.BorderSizePixel = 0;
	shadow.ZIndex = 1;
	shadow.Parent = container;
}

/** Centre badge text: 🏆 for the top table, 💩 for the bottom slot, plain
 * table numbers between. */
function badgeTextFor(layout: LadderLayout, slotIndex: number): string {
	if (slotIndex === 0) {
		return "🏆";
	}
	if (slotIndex === layout.slotCount - 1) {
		return "💩";
	}
	return tostring(slotIndex + 1);
}

function buildCard(world: Frame, layout: LadderLayout, slotIndex: number, muckabout: boolean) {
	const isBottomReal = slotIndex === layout.realTables - 1 && layout.realTables > 1;
	const tint = muckabout ? MUCK_TINT : slotIndex === 0 ? GOLD_TINT : isBottomReal ? MUD_TINT : GREEN_TINT;

	const card = new Instance("Frame");
	card.Name = `Card${slotIndex}`;
	card.AnchorPoint = new Vector2(0.5, 0.5);
	card.Position = new UDim2(slotCenterX(slotIndex), 0, ROW_Y, 0);
	card.Size = new UDim2(PITCH_W, 0, CARD_H, 0);
	card.BackgroundTransparency = 1;
	card.ZIndex = 2;

	addShadow(card, 0.03, 0.045);

	const body = new Instance("Frame");
	body.Name = "Body";
	body.AnchorPoint = new Vector2(0.5, 0.5);
	body.Position = new UDim2(0.5, 0, 0.5, 0);
	body.Size = new UDim2(1, 0, 1, 0);
	body.BackgroundColor3 = tint.Lerp(BLACK, 0.35);
	body.BorderSizePixel = 0;
	body.ZIndex = 2;

	// Landscape pitch-lines image, natural orientation (goals left/right) —
	// the card IS pitch-shaped so it stretches exactly.
	const pitch = new Instance("ImageLabel");
	pitch.Name = "Pitch";
	pitch.AnchorPoint = new Vector2(0.5, 0.5);
	pitch.Position = new UDim2(0.5, 0, 0.5, 0);
	pitch.Size = new UDim2(1, 0, 1, 0);
	pitch.BackgroundTransparency = 1;
	pitch.BorderSizePixel = 0;
	pitch.Image = PITCH_IMAGE;
	pitch.ImageColor3 = WHITE;
	pitch.ScaleType = Enum.ScaleType.Stretch;
	pitch.ZIndex = 3;
	pitch.Parent = body;

	// Centre position badge. The muckabout card's single plate sits at the
	// card centre, so its badge moves to the top edge instead.
	const badge = new Instance("TextLabel");
	badge.Name = "Badge";
	badge.AnchorPoint = new Vector2(0.5, 0.5);
	badge.Position = muckabout ? new UDim2(0.5, 0, 0.14, 0) : new UDim2(0.5, 0, 0.5, 0);
	badge.Size = new UDim2(0.18, 0, 0.34, 0);
	badge.BackgroundTransparency = 1;
	badge.FontFace = TITLE_FONT;
	badge.TextScaled = true;
	badge.TextColor3 = WHITE;
	badge.TextStrokeColor3 = BLACK;
	badge.TextStrokeTransparency = 0.35;
	badge.Text = badgeTextFor(layout, slotIndex);
	badge.ZIndex = 4;
	badge.Parent = body;

	body.Parent = card;
	card.Parent = world;
}

function buildCards(world: Frame, layout: LadderLayout) {
	for (let slot = 0; slot < layout.realTables; slot++) {
		buildCard(world, layout, slot, false);
	}
	if (layout.hasMuckabout) {
		buildCard(world, layout, layout.realTables, true);
	}
}

function ordinal(position: number): string {
	const lastTwo = position % 100;
	if (lastTwo >= 11 && lastTwo <= 13) {
		return `${position}th`;
	}
	const last = position % 10;
	return `${position}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

/** Team plate: sharp-cornered drop-shadow box with the team name over a row
 * of member headshots, team-coloured. The returned frame is the tween target:
 * the client driver reads its CB_ToX/CB_ToY attributes. The viewer's own
 * plate gets a white outline so it reads instantly. */
function buildPlate(
	world: Frame,
	entry: MovementEntry,
	images: string[],
	isViewer: boolean,
	at: Vector2,
	to: Vector2,
): Frame {
	const plate = new Instance("Frame");
	plate.Name = `Plate_${entry.teamId}`;
	plate.AnchorPoint = new Vector2(0.5, 0.5);
	plate.Position = new UDim2(at.X, 0, at.Y, 0);
	plate.Size = new UDim2(PLATE_W, 0, PLATE_H, 0);
	plate.BackgroundTransparency = 1;
	plate.ZIndex = isViewer ? 6 : 5;
	plate.SetAttribute("CB_ToX", to.X);
	plate.SetAttribute("CB_ToY", to.Y);

	addShadow(plate, 0.045, 0.07);

	const body = new Instance("Frame");
	body.Name = "Body";
	body.AnchorPoint = new Vector2(0.5, 0.5);
	body.Position = new UDim2(0.5, 0, 0.5, 0);
	body.Size = new UDim2(1, 0, 1, 0);
	// Darkened team colour so the white name always reads.
	body.BackgroundColor3 = entry.color.Lerp(BLACK, 0.4);
	body.BorderSizePixel = 0;
	body.ZIndex = 2;
	const stroke = new Instance("UIStroke");
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
	stroke.Color = isViewer ? WHITE : BLACK;
	stroke.Thickness = isViewer ? 3 : 1.5;
	stroke.Transparency = isViewer ? 0 : 0.25;
	stroke.Parent = body;

	const label = new Instance("TextLabel");
	label.Name = "TeamName";
	label.BackgroundTransparency = 1;
	label.Position = new UDim2(0.05, 0, 0.07, 0);
	label.Size = new UDim2(0.9, 0, 0.36, 0);
	label.FontFace = PLATE_FONT;
	label.TextScaled = true;
	label.TextColor3 = WHITE;
	label.TextStrokeColor3 = BLACK;
	label.TextStrokeTransparency = 0.6;
	label.Text = entry.name;
	label.ZIndex = 3;
	label.Parent = body;

	const icons = new Instance("Frame");
	icons.Name = "Icons";
	icons.BackgroundTransparency = 1;
	icons.Position = new UDim2(0.05, 0, 0.48, 0);
	icons.Size = new UDim2(0.9, 0, 0.44, 0);
	icons.ZIndex = 3;
	const iconLayout = new Instance("UIListLayout");
	iconLayout.FillDirection = Enum.FillDirection.Horizontal;
	iconLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center;
	iconLayout.VerticalAlignment = Enum.VerticalAlignment.Center;
	iconLayout.Padding = new UDim(0.03, 0);
	iconLayout.SortOrder = Enum.SortOrder.LayoutOrder;
	iconLayout.Parent = icons;
	for (let i = 0; i < images.size(); i++) {
		const icon = new Instance("ImageLabel");
		icon.Name = "MemberIcon";
		icon.LayoutOrder = i;
		icon.Size = new UDim2(1, 0, 1, 0);
		icon.BackgroundColor3 = entry.color.Lerp(BLACK, 0.65);
		icon.BorderSizePixel = 0;
		icon.Image = images[i];
		icon.ZIndex = 3;
		const aspect = new Instance("UIAspectRatioConstraint");
		aspect.AspectRatio = 1;
		aspect.AspectType = Enum.AspectType.FitWithinMaxSize;
		aspect.Parent = icon;
		icon.Parent = icons;
	}
	icons.Parent = body;

	body.Parent = plate;
	plate.Parent = world;
	return plate;
}

const LadderMapScreen = {
	/**
	 * Full-screen animated ladder map — see the header comment for the full
	 * choreography. Blocks ~11 s; the client runs the tweens, this stages the
	 * board per viewer, fires the CB_Anim phases and snaps final state.
	 */
	showLadderMap(entries: MovementEntry[]) {
		if (entries.size() === 0) {
			return;
		}
		const layout = computeLayout(entries.size());

		// Prefetch every team's member headshots (yielding web call) BEFORE the
		// per-viewer builds so those stay instant.
		const imagesByTeam = new Map<string, string[]>();
		for (const entry of entries) {
			imagesByTeam.set(entry.teamId, teamMemberImages(entry.teamId));
		}

		interface PlayerBuild {
			gui: LadderGuiShape;
			world: Frame;
			plateSnaps: { plate: Frame; to: Vector2 }[];
			finalLabel?: string;
			movePosition: UDim2;
			panPosition: UDim2;
		}
		const builds: PlayerBuild[] = [];

		for (const player of Players.GetPlayers()) {
			pcall(() => {
				const gui = ladderGuiOf(player);
				if (!gui) {
					return;
				}
				const canvas = gui.Canvas;
				const world = canvas.Stage.World;
				const viewerTeamId = player.GetAttribute("CB_TeamId");
				canvas.Title.Text = "THE LADDER";
				canvas.Title.TextColor3 = TITLE_GOLD;
				canvas.PositionLabel.Visible = false;
				canvas.PositionLabel.Text = "";
				clearRows(canvas.Rows);
				resetWorld(world);
				// Invisible until the client fade — even if a stale show left it 0.
				canvas.GroupTransparency = 1;
				buildCards(world, layout);

				let viewerEntry: MovementEntry | undefined;
				const plateSnaps: { plate: Frame; to: Vector2 }[] = [];
				for (const entry of entries) {
					const isViewer = entry.teamId === viewerTeamId;
					if (isViewer) {
						viewerEntry = entry;
					}
					const fromAt = plateCenterFor(layout, entry.fromPosition);
					const toAt = plateCenterFor(layout, entry.toPosition);
					const plate = buildPlate(
						world,
						entry,
						imagesByTeam.get(entry.teamId) ?? [],
						isViewer,
						fromAt,
						toAt,
					);
					plateSnaps.push({ plate, to: toAt });
				}

				// 2D camera staging: viewers with a team start FOCUSED on their
				// old pitch (matching the 3D pitch they rise away from) and follow
				// their team during the move; spectators just get the overview.
				const fromSlot = viewerEntry ? slotForPosition(layout, viewerEntry.fromPosition) : 0;
				const toSlot = viewerEntry ? slotForPosition(layout, viewerEntry.toPosition) : 0;
				const startScale = viewerEntry ? FOCUS_SCALE : PAN_SCALE;
				world.Size = new UDim2(startScale, 0, startScale, 0);
				world.Position = focusPositionFor(fromSlot, startScale);
				const movePosition = focusPositionFor(toSlot, startScale);
				world.SetAttribute("CB_MoveX", movePosition.X.Scale);
				world.SetAttribute("CB_MoveY", movePosition.Y.Scale);
				const panPosition = focusPositionFor(0, PAN_SCALE);
				world.SetAttribute("CB_PanScale", PAN_SCALE);
				world.SetAttribute("CB_PanX", panPosition.X.Scale);
				world.SetAttribute("CB_PanY", panPosition.Y.Scale);

				// 3D rise anchor — only when the viewer is still on a pitch
				// (showLadderMap runs before footballMatch.stop() clears
				// CB_PitchId). Absent → the client skips the camera and just fades.
				gui.SetAttribute("CB_CamCenter", pitchWorldCenter(player));

				let finalLabel: string | undefined = undefined;
				if (viewerEntry) {
					canvas.PositionLabel.Visible = true;
					canvas.PositionLabel.Text = `YOU ARE ${ordinal(viewerEntry.fromPosition + 1)} OF ${layout.teamCount}`;
					finalLabel = `YOU ARE NOW ${ordinal(viewerEntry.toPosition + 1)} OF ${layout.teamCount}`;
				}
				gui.Enabled = true;
				builds.push({ gui, world, plateSnaps, finalLabel, movePosition, panPosition });
			});
		}

		// Phase 1: 3D rise over the viewer's pitch, UI fades in from halfway.
		animSeq += 1;
		for (const build of builds) {
			pcall(() => build.gui.SetAttribute("CB_Anim", `cam:${CAM_TIME}:${animSeq}`));
		}
		task.wait(CAM_TIME);
		for (const build of builds) {
			pcall(() => {
				build.gui.Canvas.GroupTransparency = 0;
			});
		}
		task.wait(SETTLE_TIME);

		// Phase 2: plates to their NEW slots, camera follows the viewer's team.
		animSeq += 1;
		for (const build of builds) {
			pcall(() => build.gui.SetAttribute("CB_Anim", `move:${MOVE_TIME}:${animSeq}`));
		}
		task.wait(MOVE_TIME + MOVED_HOLD);

		// Snap the authoritative end state (a client that missed the trigger
		// lands here via replication), then start the pan to the top.
		animSeq += 1;
		for (const build of builds) {
			pcall(() => {
				for (const snap of build.plateSnaps) {
					snap.plate.Position = new UDim2(snap.to.X, 0, snap.to.Y, 0);
				}
				build.world.Position = build.movePosition;
				if (build.finalLabel !== undefined) {
					build.gui.Canvas.PositionLabel.Text = build.finalLabel;
				}
				build.gui.SetAttribute("CB_Anim", `pan:${PAN_TIME}:${animSeq}`);
			});
		}
		task.wait(PAN_TIME + TOP_HOLD);
		for (const build of builds) {
			pcall(() => {
				build.world.Size = new UDim2(PAN_SCALE, 0, PAN_SCALE, 0);
				build.world.Position = build.panPosition;
			});
		}
		hideAll();
	},

	/** Session-end CHAMPIONS screen (Phase 5): gold panel with the top-table
	 * team + its members, shown to everyone. Blocks ~8 s. */
	showChampions(teamName: string, memberNames: string[], rewardEach: number) {
		for (const player of Players.GetPlayers()) {
			pcall(() => {
				const gui = ladderGuiOf(player);
				if (!gui) {
					return;
				}
				const canvas = gui.Canvas;
				canvas.Title.Text = "TOP TABLE CHAMPIONS";
				canvas.Title.TextColor3 = Color3.fromRGB(255, 215, 90);
				// The ladder show that just ran left its board on World — clear it
				// so only the champions panel shows, and force the canvas visible
				// (the ladder staged it transparent for the fade-in).
				resetWorld(canvas.Stage.World);
				clearRows(canvas.Rows);
				canvas.PositionLabel.Visible = false;
				canvas.GroupTransparency = 0;

				const container = new Instance("Frame");
				container.Name = "ChampionsPanel";
				container.LayoutOrder = 0;
				container.BackgroundTransparency = 1;
				container.Size = new UDim2(0.55, 0, 0.7, 0);
				addShadow(container, 0.015, 0.012);

				const panel = new Instance("Frame");
				panel.Name = "Body";
				panel.AnchorPoint = new Vector2(0.5, 0.5);
				panel.Position = new UDim2(0.5, 0, 0.5, 0);
				panel.Size = new UDim2(1, 0, 1, 0);
				panel.BackgroundColor3 = GOLD_TINT;
				panel.BackgroundTransparency = 0;
				panel.BorderSizePixel = 0;
				panel.ZIndex = 2;
				const stroke = new Instance("UIStroke");
				stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
				stroke.Color = Color3.fromRGB(255, 235, 160);
				stroke.Thickness = 3;
				stroke.Parent = panel;
				const layout = new Instance("UIListLayout");
				layout.FillDirection = Enum.FillDirection.Vertical;
				layout.HorizontalAlignment = Enum.HorizontalAlignment.Center;
				layout.VerticalAlignment = Enum.VerticalAlignment.Center;
				layout.Padding = new UDim(0.03, 0);
				layout.SortOrder = Enum.SortOrder.LayoutOrder;
				layout.Parent = panel;

				const nameLabel = new Instance("TextLabel");
				nameLabel.Name = "TeamName";
				nameLabel.LayoutOrder = 0;
				nameLabel.BackgroundTransparency = 1;
				nameLabel.FontFace = TITLE_FONT;
				nameLabel.TextScaled = true;
				nameLabel.TextColor3 = WHITE;
				nameLabel.TextStrokeColor3 = BLACK;
				nameLabel.TextStrokeTransparency = 0.3;
				nameLabel.Text = teamName;
				nameLabel.Size = new UDim2(0.9, 0, 0.22, 0);
				nameLabel.ZIndex = 3;
				nameLabel.Parent = panel;

				for (let i = 0; i < memberNames.size(); i++) {
					const member = new Instance("TextLabel");
					member.Name = "Member";
					member.LayoutOrder = i + 1;
					member.BackgroundTransparency = 1;
					member.FontFace = PLATE_FONT;
					member.TextScaled = true;
					member.TextColor3 = Color3.fromRGB(30, 24, 8);
					member.Text = memberNames[i];
					member.Size = new UDim2(0.8, 0, 0.12, 0);
					member.ZIndex = 3;
					member.Parent = panel;
				}

				const reward = new Instance("TextLabel");
				reward.Name = "Reward";
				reward.LayoutOrder = memberNames.size() + 1;
				reward.BackgroundTransparency = 1;
				reward.FontFace = PLATE_FONT;
				reward.TextScaled = true;
				reward.TextColor3 = Color3.fromRGB(20, 90, 40);
				reward.Text = `+$${rewardEach} each!`;
				reward.Size = new UDim2(0.8, 0, 0.12, 0);
				reward.ZIndex = 3;
				reward.Parent = panel;

				panel.Parent = container;
				container.Parent = canvas.Rows;
				gui.Enabled = true;
			});
		}
		task.wait(CHAMPIONS_TIME);
		hideAll();
	},
};

export default LadderMapScreen;
