// Pitch placement (TOP_TABLE design §6 — Phase 3a).
//
// Clones pitch variants from ServerStorage.Maps and lines them up
// horizontally with a one-pitch-wide gap (centers 2× the gold pitch's width
// apart — resolved decision D4). Variant rule per pitch count: 1 real pitch →
// GoldPitch only; 2 → gold + mud; 3+ → greens between. The muckabout pitch
// (odd team out) is always a FreePlayPitch parked past the mud end.
//
// Maps are FOLDERS (no PivotTo): placement translates every BasePart by the
// same offset, so variants must be authored with the same orientation.

import { mapHasGoalParts } from "./goalParts";

const ServerStorage = game.GetService("ServerStorage");

export const VARIANT_GOLD = "GoldPitch";
export const VARIANT_GREEN = "GreenPitch";
export const VARIANT_MUD = "MudPitch";
export const VARIANT_FREEPLAY = "FreePlayPitch";

export interface Pitch {
	index: number;
	variantName: string;
	folder: Instance;
	muckabout: boolean;
}

let pitches: Pitch[] = [];
// Line geometry captured by buildPitches so addPitch can append mid-round:
// slot i's center = lineAnchor + i * lineSlotWidth along +X.
let lineAnchor: Vector3 | undefined;
let lineSlotWidth = 0;
let nextSlot = 0;
let nextStablePitchId = 1;

function variantNameFor(index: number, realCount: number): string {
	if (index === 0) {
		return VARIANT_GOLD;
	}
	if (index === realCount - 1) {
		return VARIANT_MUD;
	}
	return VARIANT_GREEN;
}

function findVariant(name: string): Instance | undefined {
	const mapsFolder = (ServerStorage as unknown as { Maps: Folder }).Maps;
	const exact = mapsFolder.FindFirstChild(name);
	if (exact) {
		return exact;
	}
	// Fallbacks keep the game bootable while variants are being built in
	// Studio: any map with a goal pair, else any map at all.
	for (const child of mapsFolder.GetChildren()) {
		if (mapHasGoalParts(child)) {
			warn(`[PitchManager] variant ${name} missing — substituting ${child.Name}`);
			return child;
		}
	}
	const any = mapsFolder.GetChildren()[0];
	if (any) {
		warn(`[PitchManager] variant ${name} missing (no goal-pair map either) — substituting ${any.Name}`);
	}
	return any;
}

// Plain object return (NOT $tuple/LuaTuple): a LuaTuple stored in a variable
// before destructuring captures only its first value — the crash that broke
// pitch building.
function computeBounds(folder: Instance): { min: Vector3; max: Vector3 } | undefined {
	let minBound: Vector3 | undefined;
	let maxBound: Vector3 | undefined;
	for (const descendant of folder.GetDescendants()) {
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
	return { min: minBound, max: maxBound };
}

function translateFolder(folder: Instance, offset: Vector3) {
	for (const descendant of folder.GetDescendants()) {
		if (descendant.IsA("BasePart")) {
			descendant.CFrame = descendant.CFrame.add(offset);
		}
	}
}

// The ball-containment walls are query surfaces only: BallSim's include-list
// sweeps hit them regardless of CanCollide (RespectCanCollide defaults to
// false), so they can be fully invisible and engine-collide with nothing —
// cars, wheels and characters drive straight through.
const BALL_WALL_NAME = "PartWallForBallProtection";

function neutralizeBallWalls(folder: Instance) {
	const wall = folder.FindFirstChild(BALL_WALL_NAME, true);
	if (wall === undefined) {
		return;
	}
	const parts = wall.GetDescendants();
	if (wall.IsA("BasePart")) {
		parts.push(wall);
	}
	for (const part of parts) {
		if (part.IsA("BasePart")) {
			part.Transparency = 1;
			part.CanCollide = false;
			part.CanTouch = false;
		}
	}
}

const PitchManager = {
	getPitches(): Pitch[] {
		return pitches;
	},

	getPitchById(pitchId: string): Pitch | undefined {
		return pitches.find((pitch) => pitch.folder.Name === pitchId);
	},

	validatePitch(pitch: Pitch): { ok: boolean; reason?: string } {
		if (pitch.folder.Parent === undefined) return { ok: false, reason: "pitch is not parented" };
		const ballSpawn = pitch.folder.FindFirstChild("BallSpawn", true);
		if (!ballSpawn || !ballSpawn.IsA("BasePart")) return { ok: false, reason: "missing BallSpawn" };
		const spawnRoot = pitch.folder.FindFirstChild("SpawnPoints");
		if (!spawnRoot) return { ok: false, reason: "missing SpawnPoints" };
		let spawnCount = 0;
		for (const descendant of spawnRoot.GetDescendants()) if (descendant.IsA("BasePart")) spawnCount += 1;
		if (spawnCount === 0) return { ok: false, reason: "SpawnPoints has no parts" };
		if (!pitch.muckabout && pitch.variantName !== VARIANT_FREEPLAY) {
			if (!mapHasGoalParts(pitch.folder)) return { ok: false, reason: "missing competitive goal pair" };
			for (const side of ["Red", "Blue"]) {
				const folder = spawnRoot.FindFirstChild(side);
				if (!folder || !folder.FindFirstChildWhichIsA("BasePart", true)) return { ok: false, reason: `missing ${side} spawns` };
			}
		}
		return { ok: true };
	},

	destroyPitch(pitchId: string): boolean {
		const index = pitches.findIndex((pitch) => pitch.folder.Name === pitchId);
		if (index < 0) return false;
		const pitch = pitches[index];
		pitches.remove(index);
		if (pitch.folder.Parent !== undefined) pitch.folder.Destroy();
		warn(`[PitchManager] destroyed ${pitchId}`);
		return true;
	},

	/**
	 * Build the round's pitches into Workspace.Map. Slot 0 (gold) keeps its
	 * authored position and anchors the line; slot i sits 2×goldWidth further
	 * along +X. Returns the built pitches top-first (muckabout last).
	 */
	buildPitches(realCount: number, includeMuckabout: boolean): Pitch[] {
		const mapFolder = (game.Workspace as unknown as { Map: Folder }).Map;
		const spawnFolder = (game.Workspace as unknown as { SpawnPoints: Folder }).SpawnPoints;
		mapFolder.ClearAllChildren();
		spawnFolder.ClearAllChildren();
		pitches = [];
		lineAnchor = undefined;
		lineSlotWidth = 0;

		const total = realCount + (includeMuckabout ? 1 : 0);

		for (let i = 0; i < total; i++) {
			const muckabout = includeMuckabout && i === total - 1;
			const variantName = muckabout ? VARIANT_FREEPLAY : variantNameFor(i, realCount);
			const source = findVariant(variantName);
			if (!source) {
				warn(`[PitchManager] ServerStorage.Maps is empty — no pitch ${i}`);
				continue;
			}
			const clone = source.Clone();
			const stableId = nextStablePitchId++;
			clone.Name = muckabout ? `Pitch${stableId}_Muckabout` : `Pitch${stableId}_${variantName}`;
			neutralizeBallWalls(clone);

			const bounds = computeBounds(clone);
			if (bounds === undefined) {
				warn(`[PitchManager] ${source.Name} has no BaseParts — skipped`);
				clone.Destroy();
				continue;
			}
			const minBound = bounds.min;
			const maxBound = bounds.max;
			const center = minBound.add(maxBound).div(2);
			if (lineAnchor === undefined) {
				lineAnchor = center;
				lineSlotWidth = (maxBound.X - minBound.X) * 2; // pitch + pitch-wide gap
			} else {
				const target = lineAnchor.add(new Vector3(lineSlotWidth * i, 0, 0));
				translateFolder(clone, target.sub(center));
			}
			clone.Parent = mapFolder;
			const pitch = { index: i, variantName, folder: clone, muckabout };
			const validation = PitchManager.validatePitch(pitch);
			if (!validation.ok) {
				warn(`[PitchManager] rejected ${clone.Name}: ${validation.reason}`);
				clone.Destroy();
				continue;
			}
			pitches.push(pitch);
		}
		nextSlot = total;

		warn(`[PitchManager] built ${pitches.size()} pitch(es) (real=${realCount} muckabout=${includeMuckabout})`);
		return pitches;
	},

	/**
	 * Mid-round append (pending-pool design): clone `variantName` (default
	 * GreenPitch for real pitches, FreePlayPitch for the muckabout) onto the
	 * NEXT free slot at the end of the line — same
	 * 2×goldWidth spacing — without touching the pitches already in play. The
	 * next startRound reseat rebuilds the whole line with gold/mud back at the
	 * ends as usual.
	 */
	addPitch(variantName?: string, muckabout?: boolean): Pitch | undefined {
		const mapFolder = (game.Workspace as unknown as { Map: Folder }).Map;
		const isMuck = muckabout === true;
		const variant = variantName ?? (isMuck ? VARIANT_FREEPLAY : VARIANT_GREEN);
		if (lineAnchor === undefined || lineSlotWidth === 0) {
			warn("[PitchManager] addPitch before buildPitches — no line to extend");
			return undefined;
		}
		const source = findVariant(variant);
		if (!source) {
			warn("[PitchManager] addPitch: ServerStorage.Maps is empty — no pitch added");
			return undefined;
		}
		const index = nextSlot;
		const clone = source.Clone();
		const stableId = nextStablePitchId++;
		clone.Name = isMuck ? `Pitch${stableId}_Muckabout` : `Pitch${stableId}_${variant}`;
		neutralizeBallWalls(clone);
		const bounds = computeBounds(clone);
		if (bounds === undefined) {
			warn(`[PitchManager] ${source.Name} has no BaseParts — addPitch aborted`);
			clone.Destroy();
			return undefined;
		}
		const center = bounds.min.add(bounds.max).div(2);
		const target = lineAnchor.add(new Vector3(lineSlotWidth * index, 0, 0));
		translateFolder(clone, target.sub(center));
		clone.Parent = mapFolder;
		const pitch: Pitch = { index, variantName: variant, folder: clone, muckabout: isMuck };
		const validation = PitchManager.validatePitch(pitch);
		if (!validation.ok) {
			warn(`[PitchManager] addPitch rejected ${clone.Name}: ${validation.reason}`);
			clone.Destroy();
			return undefined;
		}
		pitches.push(pitch);
		nextSlot = index + 1;
		warn(`[PitchManager] added ${clone.Name} at slot ${index} (mid-round)`);
		return pitch;
	},
};

export default PitchManager;
