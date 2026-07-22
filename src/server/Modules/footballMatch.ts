// Football match layer (Top Table Phase 3b).
//
// PitchMatch = ONE match on ONE pitch (the proven single-pitch flow from the
// earlier footballMatch: kickoff choreography, control locks, goal watching,
// respawn locks — now instance-scoped). The module-level coordinator pairs
// ladder teams onto pitches by position, routes players to their pitch, runs
// the ONE shared round clock, and ends every match at the same whistle.
//
// Per-pitch HUD state lives as FB_* attributes ON THE PITCH FOLDER (players
// carry CB_PitchId to find theirs); the shared clock stays global on
// ReplicatedStorage. Control locks use the owner's VehicleControls
// InputContext exactly as before, applied after SpawnVehicle returns.

import ballSpawner from "./ballSpawner";
import DataStore2 from "./DataStore2";
import DataUtilities from "./DataUtilities";
import { findGoalPart, mapHasGoalParts } from "./goalParts";
// SAFE value import (no runtime cycle): MatchDirector only imports
// `type { RoundResult }` from this module, which is erased at compile time.
import MatchDirector, { SESSION_ROUNDS } from "./MatchDirector";
// SAFE value import: PitchManager requires goalParts, not this module.
import PitchManager, { VARIANT_FREEPLAY, VARIANT_GOLD } from "./PitchManager";
import spawnVehicle from "./spawnVehicle";
import TeamRegistry from "./TeamRegistry";
import type { LadderTeam } from "./TeamRegistry";
import { Globals } from "../Globals";
import { BallAttr } from "shared/ballSim/BallSim";
import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import { VehicleInput } from "shared/vehicleSim/VehicleSim";
import type { Pitch } from "./PitchManager";

// Re-export (goal helpers used to live here; keep the old import surface).
export { mapHasGoalParts };

const PlayerService = game.GetService("Players");
const RunService = game.GetService("RunService");
const ReplicatedStorage = game.GetService("ReplicatedStorage");

export type TeamName = "Red" | "Blue";
const TEAM_NAMES: TeamName[] = ["Blue", "Red"];

const MATCH_TIME = 30;
const KICKOFF_COUNTDOWN = 3;
const FACE_OFF_TIME = 7; // was 10 — cut by a third per playtest
const RESPAWN_DELAY = 1.5;
const RESPAWN_LOCK = 5;
const GOAL_PAUSE = 2.5;
const GOAL_BLAST_SPEED = 1000;
const GOAL_BLAST_LIFT = 5500 / 9;
const END_ANNOUNCE_TIME = 2;
const FREE_PLAY_INTRO_TIME = 1.8;

const BLUE_HEX = "#4FA8FF";
const RED_HEX = "#FF5050";

// Clearance between the car's lowest point and the floor at spawn/kickoff
// placement — enough that wheels never start embedded in the ground, small
// enough that the car settles instantly instead of dropping and twisting.
const SPAWN_FLOOR_MARGIN = 0.5;

export const FootballAttr = {
	Phase: "FB_Phase",
	BlueScore: "FB_BlueScore",
	RedScore: "FB_RedScore",
	TimeLeft: "FB_TimeLeft", // global (ReplicatedStorage) — one shared clock
	Announce: "FB_Announce",
	// Face-off segment: overlay team names + the stage camera shot.
	BlueName: "FB_BlueName",
	RedName: "FB_RedName",
	FaceOffCamCFrame: "FB_FaceOffCamCFrame",
	// Victory overlay: set by playVictoryScene while the lineup camera runs,
	// cleared when the scene ends. matchHud shows the Victory ScreenGui
	// (WINNERS / YOU LOSE + confetti) while WinnerSide is non-empty.
	WinnerSide: "FB_WinnerSide",
	WinnerName: "FB_WinnerName",
	// Coin-flip reveal on a drawn pitch: set when the "<SIDE> MOVES UP!"
	// announce lands so the client fires a confetti burst in that side's
	// colors (no WINNERS/YOU LOSE headline — the announce owns the text).
	FlipSide: "FB_FlipSide",
} as const;

// "FreePlay" (design §muckabout): ≥1 rostered player but no opponent yet —
// everyone on the pitch drives freely, goals count on the pitch scoreboard
// for fun, and the shared clock does NOT run off it.
type Phase = "Idle" | "Waiting" | "FreePlay" | "Kickoff" | "FaceOff" | "Play" | "Goal" | "Ended";

interface RosterEntry {
	team: TeamName; // pitch SIDE (D1), not the ladder team
	slot: number;
}

interface TimerGuiShape extends ScreenGui {
	TextLabel: TextLabel;
}

// ---- module-wide (round-scoped) state ------------------------------------

let matchGen = 0;
const lockGen = new Map<Player, number>();
let matches: PitchMatch[] = [];
const matchByTeamId = new Map<string, PitchMatch>();
let clockStarted = false;
let timeLeft = MATCH_TIME;
let goalWatcher: RBXScriptConnection | undefined;
let endCallback: (() => void) | undefined;
// Snapshot for the end-of-round banner: stop() clears `matches`, which made
// the old banner read 0-0 regardless of the real score.
let lastGoldScores = { Blue: 0, Red: 0 };
const VICTORY_SCENE_TIME = 8;
const SUMMARY_TIME = 6;
const COIN_FLIP_SUSPENSE = 2;

// Round economy (design §10; replaces the retired EndScreen.giveRewards).
const ROUND_MONEY_PARTICIPATION = 300;
const ROUND_MONEY_WIN = 500;
const ROUND_MONEY_DRAW = 250;
const ROUND_MONEY_GOAL = 150;

// Trophies (progression currency): flat, never multiplied, never spent —
// cars unlock at lifetime-trophy thresholds. Champions round pays double.
const TROPHIES_ROUND_WIN = 1;
const TROPHIES_CHAMPION_WIN = 2;

// Per-round stats for the summary screen (cleared each beginRound).
const roundGoals = new Map<Player, number>();
const roundEarnings = new Map<Player, number>();
const roundTrophies = new Map<Player, number>();
const roundChampions = new Set<Player>();

function setGlobalAttr(name: string, value: string | number) {
	ReplicatedStorage.SetAttribute(name, value);
}

function escapeRichText(text: string): string {
	return text.gsub("&", "&amp;")[0].gsub("<", "&lt;")[0].gsub(">", "&gt;")[0].gsub('"', "&quot;")[0];
}

// ---- control locks (player-scoped, shared across pitches) ----------------

function setContextEnabled(player: Player, enabled: boolean) {
	const context = player.FindFirstChild(VehicleInput.ContextName);
	if (context && context.IsA("InputContext")) {
		context.Enabled = enabled;
	}
}

function timerGuiOf(player: Player): TimerGuiShape | undefined {
	const playerGui = player.FindFirstChild("PlayerGui");
	const timerGui = playerGui && playerGui.FindFirstChild("TimerGui");
	if (timerGui && timerGui.IsA("ScreenGui") && timerGui.FindFirstChild("TextLabel")) {
		return timerGui as TimerGuiShape;
	}
	return undefined;
}

function showTimerText(player: Player, text: string) {
	pcall(() => {
		const timerGui = timerGuiOf(player);
		if (timerGui) {
			timerGui.TextLabel.Text = text;
			timerGui.Enabled = true;
		}
	});
}

function hideTimerText(player: Player) {
	pcall(() => {
		const timerGui = timerGuiOf(player);
		if (timerGui) {
			timerGui.Enabled = false;
		}
	});
}

function zeroVehicleInputs(player: Player) {
	const vehicle = Globals.vehiclesTable[player.UserId];
	if (vehicle && vehicle.model && vehicle.model.Parent) {
		VehicleSim.setThrottleSteer(vehicle.model, 0, 0);
		VehicleSim.setDriftHeld(vehicle.model, false);
		VehicleSim.setBoostHeld(vehicle.model, false);
	}
}

/** While set on the Player, the sim's fresh-sit context enable
 * (VehicleSim.setOwnerContextEnabled) leaves controls disabled — closing the
 * ~2s window where a respawned car was drivable before the phase lock landed
 * (the sit-edge enable fires inside SpawnVehicle's internal waits, long
 * before onPlayerSpawned runs). unlockPlayer clears it. */
const CONTROL_LOCK_ATTR = "CB_ControlLock";

function lockPlayer(player: Player, seconds?: number) {
	const gen = (lockGen.get(player) ?? 0) + 1;
	lockGen.set(player, gen);
	player.SetAttribute(CONTROL_LOCK_ATTR, true);
	setContextEnabled(player, false);
	zeroVehicleInputs(player);

	if (seconds === undefined) {
		hideTimerText(player);
		return;
	}
	const localMatchGen = matchGen;
	task.spawn(() => {
		for (let i = seconds; i >= 1; i--) {
			if (lockGen.get(player) !== gen || matchGen !== localMatchGen || player.Parent === undefined) {
				return;
			}
			showTimerText(player, `You can drive in ${i}`);
			task.wait(1);
		}
		if (lockGen.get(player) === gen && matchGen === localMatchGen && player.Parent !== undefined) {
			unlockPlayer(player);
		}
	});
}

function unlockPlayer(player: Player) {
	lockGen.set(player, (lockGen.get(player) ?? 0) + 1);
	hideTimerText(player);
	player.SetAttribute(CONTROL_LOCK_ATTR, undefined);
	setContextEnabled(player, true);
}

// ---- goal parts (discovery helpers live in ./goalParts) ------------------

function ballInPart(ball: BasePart, part: BasePart): boolean {
	const localPos = part.CFrame.PointToObjectSpace(ball.Position);
	const half = part.Size.div(2);
	const r = ball.Size.X / 2;
	return (
		math.abs(localPos.X) <= half.X + r &&
		math.abs(localPos.Y) <= half.Y + r &&
		math.abs(localPos.Z) <= half.Z + r
	);
}

// ---- face-off stage (Studio-authored, discovered by structure) -----------
//
// The stage is a Model/Folder with a BasePart named "CameraPart" plus "Red"
// and "Blue" sub-containers holding the podium parts. Its name is unknown
// (it only exists in the place file), so it is found structurally. The
// VictoryLineup Red/Blue models ALSO contain CameraPart parts now, so
// anything named/inside "VictoryLineup" never counts.

function insideVictoryLineup(instance: Instance, root: Instance): boolean {
	let current: Instance | undefined = instance.Parent;
	while (current !== undefined && current !== root) {
		if (current.Name === "VictoryLineup") {
			return true;
		}
		current = current.Parent;
	}
	return false;
}

function stageCameraPart(stage: Instance): BasePart | undefined {
	for (const descendant of stage.GetDescendants()) {
		if (descendant.Name === "CameraPart" && descendant.IsA("BasePart") && !insideVictoryLineup(descendant, stage)) {
			return descendant;
		}
	}
	return undefined;
}

function stageSideParts(stage: Instance, side: TeamName): BasePart[] {
	const parts: BasePart[] = [];
	for (const container of stage.GetDescendants()) {
		if (container.Name !== side || insideVictoryLineup(container, stage)) {
			continue;
		}
		for (const descendant of container.GetDescendants()) {
			if (descendant.IsA("BasePart")) {
				parts.push(descendant);
			}
		}
		if (parts.size() > 0) {
			break;
		}
	}
	parts.sort((a, b) => a.Name < b.Name);
	return parts;
}

function isFaceOffStage(candidate: Instance): boolean {
	if (candidate.Name === "VictoryLineup") {
		return false;
	}
	if (!candidate.IsA("Model") && !candidate.IsA("Folder")) {
		return false;
	}
	if (stageCameraPart(candidate) === undefined) {
		return false;
	}
	for (const side of TEAM_NAMES) {
		if (stageSideParts(candidate, side).size() === 0) {
			return false;
		}
	}
	return true;
}

function findFaceOffStage(pitchFolder: Instance): Instance | undefined {
	for (const descendant of pitchFolder.GetDescendants()) {
		if (insideVictoryLineup(descendant, pitchFolder)) {
			continue;
		}
		if (isFaceOffStage(descendant)) {
			return descendant;
		}
	}
	const mapFolder = game.Workspace.FindFirstChild("Map");
	const vehiclesFolder = game.Workspace.FindFirstChild("Vehicles");
	for (const child of game.Workspace.GetChildren()) {
		if (child === mapFolder || child === vehiclesFolder) {
			continue;
		}
		if (child.Name === "VictoryStage" || child.Name === "VictoryLineup") {
			continue;
		}
		if (isFaceOffStage(child)) {
			return child;
		}
	}
	return undefined;
}

// ---- one match on one pitch ----------------------------------------------

class PitchMatch {
	readonly pitch: Pitch;
	readonly muckabout: boolean;
	phase: Phase = "Waiting";
	readonly scores = { Red: 0, Blue: 0 };
	readonly roster = new Map<Player, RosterEntry>();
	readonly sideByTeamId = new Map<string, TeamName>();
	readonly goalParts = new Map<TeamName, BasePart>();
	flowGen = 0;
	private shownFreePlayIntro = false;
	private faceOffStage?: Instance;
	private faceOffStageWarned = false;
	private faceOffDone = false;

	constructor(pitch: Pitch) {
		this.pitch = pitch;
		this.muckabout = pitch.muckabout;
		for (const team of TEAM_NAMES) {
			const part = findGoalPart(pitch.folder, team.lower());
			if (part) {
				part.CanCollide = false;
				part.CanQuery = false;
				part.CanTouch = false;
				part.Anchored = true;
				this.goalParts.set(team, part);
			} else if (!this.muckabout) {
				warn(`[Football] ${pitch.folder.Name} has no ${team} goal part`);
			}
		}
		this.publishScores();
		this.setPhase("Waiting");
		this.announce(this.muckabout ? "FREE PLAY — waiting for a car" : "Waiting for players...");
		// Stale victory overlay state from the previous round on this pitch.
		this.setAttr(FootballAttr.WinnerSide, "");
		this.setAttr(FootballAttr.WinnerName, "");
		this.setAttr(FootballAttr.FlipSide, "");
	}

	setAttr(name: string, value: string | number) {
		this.pitch.folder.SetAttribute(name, value);
	}

	setPhase(phase: Phase) {
		this.phase = phase;
		this.setAttr(FootballAttr.Phase, phase);
	}

	announce(text: string) {
		this.setAttr(FootballAttr.Announce, text);
	}

	publishScores() {
		this.setAttr(FootballAttr.BlueScore, this.scores.Blue);
		this.setAttr(FootballAttr.RedScore, this.scores.Red);
	}

	rosterCount(side: TeamName): number {
		let count = 0;
		for (const [, entry] of this.roster) {
			if (entry.team === side) {
				count += 1;
			}
		}
		return count;
	}

	lowestFreeSlot(side: TeamName): number {
		const used = new Set<number>();
		for (const [, entry] of this.roster) {
			if (entry.team === side) {
				used.add(entry.slot);
			}
		}
		let slot = 0;
		while (used.has(slot)) {
			slot += 1;
		}
		return slot;
	}

	sideForLadderTeam(teamId: string): TeamName {
		const existing = this.sideByTeamId.get(teamId);
		if (existing) {
			return existing;
		}
		let blueTaken = false;
		let redTaken = false;
		for (const [, side] of this.sideByTeamId) {
			if (side === "Blue") {
				blueTaken = true;
			} else {
				redTaken = true;
			}
		}
		let side: TeamName;
		if (!blueTaken) {
			side = "Blue";
		} else if (!redTaken) {
			side = "Red";
		} else {
			side = this.rosterCount("Blue") <= this.rosterCount("Red") ? "Blue" : "Red";
			warn(`[Football] ${this.pitch.folder.Name}: >2 ladder teams — overflow to ${side}`);
		}
		this.sideByTeamId.set(teamId, side);
		return side;
	}

	ladderTeamNameForSide(side: TeamName): string | undefined {
		for (const [teamId, assignedSide] of this.sideByTeamId) {
			if (assignedSide !== side) {
				continue;
			}
			for (const team of TeamRegistry.getTeams()) {
				if (team.id === teamId) {
					return team.name;
				}
			}
		}
		return undefined;
	}

	assignSide(player: Player): RosterEntry {
		const existing = this.roster.get(player);
		if (existing) {
			return existing;
		}
		const ladderTeam = TeamRegistry.getTeamOf(player);
		const side = ladderTeam ? this.sideForLadderTeam(ladderTeam.id) : this.rosterCount("Blue") <= this.rosterCount("Red") ? "Blue" : "Red";
		const entry: RosterEntry = { team: side, slot: this.lowestFreeSlot(side) };
		this.roster.set(player, entry);
		player.SetAttribute("CB_Side", side);
		player.SetAttribute("CB_PitchId", this.pitch.folder.Name);
		return entry;
	}

	spawnParts(side: TeamName): BasePart[] {
		const spawnPoints = this.pitch.folder.FindFirstChild("SpawnPoints");
		let source: Instance | undefined = spawnPoints;
		if (spawnPoints) {
			for (const child of spawnPoints.GetChildren()) {
				if (child.Name.lower() === side.lower()) {
					source = child;
					break;
				}
			}
		}
		const parts: BasePart[] = [];
		if (source) {
			for (const descendant of source.GetDescendants()) {
				if (descendant.IsA("BasePart")) {
					parts.push(descendant);
				}
			}
		}
		parts.sort((a, b) => a.Name < b.Name);
		return parts;
	}

	spawnCFrameFor(entry: RosterEntry): CFrame | undefined {
		const parts = this.spawnParts(entry.team);
		if (parts.size() === 0) {
			return undefined;
		}
		const spawnPart = parts[entry.slot % parts.size()];
		const ball = ballSpawner.GetBall(this.pitch.folder);
		const ballSpawn = this.pitch.folder.FindFirstChild("BallSpawn", true);
		const targetPosition = ball?.Position ?? (ballSpawn && ballSpawn.IsA("BasePart") ? ballSpawn.Position : undefined);
		if (targetPosition === undefined) {
			return spawnPart.CFrame;
		}
		const flatTarget = new Vector3(targetPosition.X, spawnPart.Position.Y, targetPosition.Z);
		return CFrame.lookAt(spawnPart.Position, flatTarget);
	}

	teamsReady(): boolean {
		if (this.muckabout) {
			// The muckabout pitch never runs a real kickoff/match — its team
			// free-plays until the shared whistle.
			return false;
		}
		return this.rosterCount("Blue") >= 1 && this.rosterCount("Red") >= 1 && this.roster.size() >= 2;
	}

	/** Y of the pitch floor under `position`. Prefers a strict raycast against
	 * the pitch's groundPart; falls back to a collidable-world raycast that
	 * ignores cars and the ball (spawn pads are CanCollide false, so
	 * RespectCanCollide skips them too). */
	private floorYBelow(position: Vector3): number | undefined {
		const params = new RaycastParams();
		const ground = this.pitch.folder.FindFirstChild("groundPart", true);
		if (ground && ground.IsA("BasePart")) {
			params.FilterType = Enum.RaycastFilterType.Include;
			params.FilterDescendantsInstances = [ground];
		} else {
			params.FilterType = Enum.RaycastFilterType.Exclude;
			params.RespectCanCollide = true;
			const exclude: Instance[] = [];
			const vehicles = game.Workspace.FindFirstChild("Vehicles");
			if (vehicles) {
				exclude.push(vehicles);
			}
			const ball = ballSpawner.GetBall(this.pitch.folder);
			if (ball) {
				exclude.push(ball);
			}
			params.FilterDescendantsInstances = exclude;
		}
		const result = game.Workspace.Raycast(
			position.add(new Vector3(0, 50, 0)),
			new Vector3(0, -500, 0),
			params,
		);
		return result ? result.Position.Y : undefined;
	}

	/** Place the car at rest on its spawn CFrame with its lowest point
	 * SPAWN_FLOOR_MARGIN above the floor: with next to no drop height it
	 * settles in place instead of bouncing and twisting off the ball line. */
	placeVehicle(model: Model, spawnCFrame: CFrame) {
		pcall(() => {
			const primary = model.PrimaryPart;
			if (!primary) {
				return;
			}
			const position = spawnCFrame.Position;
			const floorY = this.floorYBelow(position);
			let targetY;
			if (floorY !== undefined) {
				// Primary-origin height above the model's lowest point is
				// translation-invariant, so it can be measured pre-move.
				const [bbCFrame, bbSize] = model.GetBoundingBox();
				const lift = primary.Position.Y - (bbCFrame.Position.Y - bbSize.Y / 2);
				targetY = floorY + SPAWN_FLOOR_MARGIN + lift;
			} else {
				targetY = position.Y + model.GetExtentsSize().Y / 2;
			}
			model.SetPrimaryPartCFrame(spawnCFrame.Rotation.add(new Vector3(position.X, targetY, position.Z)));
			// Wheels are SEPARATE assemblies (springs/hinges, not welds): zero
			// every assembly, not just the body, or a wheel keeps its
			// goal-blast velocity and yanks the suspension around on arrival.
			for (const part of model.GetDescendants()) {
				if (part.IsA("BasePart")) {
					part.AssemblyLinearVelocity = new Vector3(0, 0, 0);
					part.AssemblyAngularVelocity = new Vector3(0, 0, 0);
				}
			}
		});
	}

	/** Re-place ONE player's car (mid-round spawns while the phase lock is
	 * on); the full-roster path is repositionVehicles. */
	placeVehicleFor(player: Player) {
		const entry = this.roster.get(player);
		const vehicle = Globals.vehiclesTable[player.UserId];
		const model = vehicle && vehicle.model;
		if (!entry || !model || model.Parent === undefined) {
			return;
		}
		const spawnCFrame = this.spawnCFrameFor(entry);
		if (spawnCFrame !== undefined) {
			this.placeVehicle(model, spawnCFrame);
		}
	}

	repositionVehicles() {
		for (const [player, entry] of this.roster) {
			const vehicle = Globals.vehiclesTable[player.UserId];
			const model = vehicle && vehicle.model;
			if (!model || model.Parent === undefined) {
				continue;
			}
			const spawnCFrame = this.spawnCFrameFor(entry);
			if (spawnCFrame === undefined) {
				continue;
			}
			this.placeVehicle(model, spawnCFrame);
		}
	}

	/** Mid-face-off spawn (SpawnVehicle's ~2s internal waits let onPlayerSpawned
	 * land AFTER runFaceOff posed the roster, and deaths respawn mid-segment):
	 * pose the late car on ITS podium — slot-keyed, the same part runFaceOff
	 * picks — instead of the kickoff spot. False when no stage/podium exists
	 * (caller falls back to the kickoff placement). */
	placeVehicleOnStageFor(player: Player): boolean {
		const entry = this.roster.get(player);
		const vehicle = Globals.vehiclesTable[player.UserId];
		const model = vehicle && vehicle.model;
		if (!entry || !model || model.Parent === undefined) {
			return false;
		}
		const stage = this.faceOffStageModel();
		if (!stage) {
			return false;
		}
		const stageParts = stageSideParts(stage, entry.team);
		if (stageParts.size() === 0) {
			return false;
		}
		this.poseOnPodium(model, stageParts[entry.slot % stageParts.size()]);
		return true;
	}

	/** Direct placement (no floor raycast — the floor here is the stage's own
	 * geometry, not the pitch groundPart): podium part orientation, lifted by
	 * half the model height like placeVehicle's no-floor fallback. */
	private poseOnPodium(model: Model, part: BasePart) {
		const target = part.CFrame.Rotation.add(
			part.Position.add(new Vector3(0, model.GetExtentsSize().Y / 2, 0)),
		);
		pcall(() => {
			model.SetPrimaryPartCFrame(target);
			for (const descendant of model.GetDescendants()) {
				if (descendant.IsA("BasePart")) {
					descendant.AssemblyLinearVelocity = new Vector3(0, 0, 0);
					descendant.AssemblyAngularVelocity = new Vector3(0, 0, 0);
				}
			}
		});
	}

	/** Cached per round; re-resolved if the cached model went away. */
	faceOffStageModel(): Instance | undefined {
		if (this.faceOffStage !== undefined && this.faceOffStage.Parent !== undefined) {
			return this.faceOffStage;
		}
		this.faceOffStage = findFaceOffStage(this.pitch.folder);
		return this.faceOffStage;
	}

	/** Pre-countdown face-off (~7s): both teams posed still on the stage
	 * podiums, camera on the stage's CameraPart, controls LOCKED for the whole
	 * segment (the kickoff lock from startKickoff simply stays on) — a static
	 * showcase, no physics pins involved. Skipped when no stage model exists.
	 * Returns false when the flow was cancelled mid-segment (camera already
	 * cleaned up). */
	runFaceOff(gen: number, localMatchGen: number): boolean {
		if (this.faceOffDone) {
			return true;
		}
		this.faceOffDone = true;
		const stage = this.faceOffStageModel();
		if (!stage) {
			if (!this.faceOffStageWarned) {
				this.faceOffStageWarned = true;
				warn(`[Football] ${this.pitch.folder.Name}: no face-off stage model — skipping face-off`);
			}
			return true;
		}
		// Names and camera BEFORE the phase flip so the client sees a complete
		// scene the moment FB_Phase lands.
		this.setAttr(FootballAttr.BlueName, this.ladderTeamNameForSide("Blue") ?? "BLUE TEAM");
		this.setAttr(FootballAttr.RedName, this.ladderTeamNameForSide("Red") ?? "RED TEAM");
		const cameraPart = stageCameraPart(stage);
		if (cameraPart) {
			this.pitch.folder.SetAttribute(FootballAttr.FaceOffCamCFrame, cameraPart.CFrame);
		}
		this.setPhase("FaceOff");
		this.announce("");

		for (const side of TEAM_NAMES) {
			const stageParts = stageSideParts(stage, side);
			if (stageParts.size() === 0) {
				continue;
			}
			for (const [player, entry] of this.roster) {
				if (entry.team !== side) {
					continue;
				}
				const vehicle = Globals.vehiclesTable[player.UserId];
				const model = vehicle && vehicle.model;
				if (!model || model.Parent === undefined) {
					continue;
				}
				// Slot-keyed part choice — placeVehicleOnStageFor (late spawns
				// mid-segment) must land on the SAME podium.
				this.poseOnPodium(model, stageParts[entry.slot % stageParts.size()]);
				// Controls stay locked (startKickoff's lockPlayer): the cars sit
				// still on the podiums, so no showcase pin — and none of the
				// pin-release physics that flung cars in playtests.
			}
		}

		let cancelled = false;
		for (let i = 0; i < FACE_OFF_TIME; i++) {
			task.wait(1);
			if (this.flowGen !== gen || matchGen !== localMatchGen) {
				cancelled = true;
				break;
			}
		}
		this.pitch.folder.SetAttribute(FootballAttr.FaceOffCamCFrame, undefined);
		if (cancelled) {
			return false;
		}
		this.setPhase("Kickoff");
		this.repositionVehicles();
		return true;
	}

	/** Teardown safety (endMatch/stop can land mid-face-off): the face-off
	 * camera must not outlive the segment. (No physics locks to undo — the
	 * face-off is a static showcase.) */
	clearFaceOffScene() {
		this.pitch.folder.SetAttribute(FootballAttr.FaceOffCamCFrame, undefined);
	}

	/** `introText` (free-play → match transition): brief announce while the
	 * free-players are still driving, then the normal reposition + 3-2-1. */
	startKickoff(introText?: string) {
		const gen = ++this.flowGen;
		const localMatchGen = matchGen;
		this.setPhase("Kickoff");
		task.spawn(() => {
			if (introText !== undefined) {
				this.announce(introText);
				task.wait(1.2);
				if (this.flowGen !== gen || matchGen !== localMatchGen) {
					return;
				}
			}
			ballSpawner.RespawnBall(this.pitch.folder);
			this.repositionVehicles();
			for (const [player] of this.roster) {
				lockPlayer(player);
			}
			if (!this.runFaceOff(gen, localMatchGen)) {
				return;
			}
			for (let i = KICKOFF_COUNTDOWN; i >= 1; i--) {
				if (this.flowGen !== gen || matchGen !== localMatchGen) {
					return;
				}
				this.announce(tostring(i));
				task.wait(1);
			}
			if (this.flowGen !== gen || matchGen !== localMatchGen) {
				return;
			}
			this.announce("GO!");
			this.setPhase("Play");
			ballSpawner.ReleaseBall(this.pitch.folder);
			for (const [player] of this.roster) {
				unlockPlayer(player);
			}
			// teamsReady() is false for the muckabout pitch, so startKickoff only
			// ever runs for a REAL 2-team match: this is exactly "the shared clock
			// starts when the first real match reaches Play" (never from free play).
			if (!clockStarted) {
				clockStarted = true;
				startClock();
			}
			task.delay(0.8, () => {
				if (this.flowGen === gen && matchGen === localMatchGen) {
					this.announce("");
				}
			});
		});
	}

	enterWaiting() {
		this.flowGen += 1;
		this.setPhase("Waiting");
		this.announce(this.muckabout ? "FREE PLAY — waiting for a car" : "Waiting for players...");
		for (const [player] of this.roster) {
			lockPlayer(player);
		}
	}

	/** FAILURE 2 fix: ≥1 rostered player but no opponent — unlock everyone on
	 * the pitch and let them knock the ball around until the opponent arrives
	 * (or the shared whistle blows). Used by BOTH the muckabout pitch and a
	 * real pitch whose opponent hasn't arrived yet. */
	enterFreePlay(resetBall: boolean) {
		const gen = ++this.flowGen;
		const localMatchGen = matchGen;
		this.setPhase("FreePlay");
		if (!this.shownFreePlayIntro) {
			this.shownFreePlayIntro = true;
			this.announce(this.muckabout ? "FREE PLAY!" : "FREE PLAY — waiting for an opponent");
			task.delay(FREE_PLAY_INTRO_TIME, () => {
				if (this.flowGen === gen && matchGen === localMatchGen && this.phase === "FreePlay") {
					this.announce("");
				}
			});
		} else {
			this.announce("");
		}
		if (resetBall) {
			ballSpawner.RespawnBall(this.pitch.folder);
		}
		ballSpawner.ReleaseBall(this.pitch.folder);
		for (const [player] of this.roster) {
			unlockPlayer(player);
		}
	}

	/** Free-play goals are for fun only: the real match starts 0-0. */
	resetScores() {
		this.scores.Blue = 0;
		this.scores.Red = 0;
		// Fresh pairing → fresh face-off (post-goal kickoffs never reset scores,
		// so they skip it).
		this.faceOffDone = false;
		this.publishScores();
	}

	creditScorer(ball: BasePart, scoringTeam: TeamName): { player: Player; ownGoal: boolean } | undefined {
		const lastHitCar = ball.GetAttribute(BallAttr.LastHitCar);
		if (!typeIs(lastHitCar, "string") || lastHitCar === "") {
			return undefined;
		}
		for (const player of PlayerService.GetPlayers()) {
			const vehicle = Globals.vehiclesTable[player.UserId];
			if (vehicle && vehicle.model && vehicle.model.Name === lastHitCar) {
				const team = this.roster.get(player)?.team;
				if (team === undefined) {
					return undefined;
				}
				if (team !== scoringTeam) {
					return { player, ownGoal: true };
				}
				if (!this.muckabout) {
					TeamRegistry.addGoal(player);
					roundGoals.set(player, (roundGoals.get(player) ?? 0) + 1);
				}
				return { player, ownGoal: false };
			}
		}
		return undefined;
	}

	onGoal(defendingTeam: TeamName, ball: BasePart) {
		// Free-play goals show on the pitch scoreboard for fun but earn no
		// ladder stats/money (and the scores reset when the real match starts).
		const scoringTeam: TeamName = defendingTeam === "Blue" ? "Red" : "Blue";
		this.scores[scoringTeam] += 1;
		this.publishScores();
		const scorer = this.creditScorer(ball, scoringTeam);
		const gen = ++this.flowGen;
		const localMatchGen = matchGen;
		this.setPhase("Goal");
		const hex = scoringTeam === "Blue" ? BLUE_HEX : RED_HEX;
		const scorerText = scorer
			? scorer.ownGoal
				? `${escapeRichText(scorer.player.DisplayName)} OWN GOALED!`
				: `${escapeRichText(scorer.player.DisplayName)} SCORES!`
			: `${scoringTeam.upper()} TEAM SCORES!`;
		this.announce(`<font color="${hex}">${scorerText}</font>`);
		const goalPart = this.goalParts.get(defendingTeam);
		if (goalPart && goalPart.Parent !== undefined) {
			for (const [player] of this.roster) {
				const vehicle = Globals.vehiclesTable[player.UserId];
				const model = vehicle && vehicle.model;
				const base = model && model.FindFirstChild("Base");
				if (!base || !base.IsA("BasePart")) {
					continue;
				}
				const away = base.Position.sub(goalPart.Position);
				const horizontal = new Vector3(away.X, 0, away.Z);
				const outward = horizontal.Magnitude > 0.01 ? horizontal.Unit : goalPart.CFrame.LookVector;
				const impulseVelocity = outward.mul(GOAL_BLAST_SPEED).add(new Vector3(0, GOAL_BLAST_LIFT, 0));
				base.ApplyImpulse(impulseVelocity.mul(base.AssemblyMass));
			}
		}
		task.spawn(() => {
			task.wait(GOAL_PAUSE);
			if (this.flowGen !== gen || matchGen !== localMatchGen) {
				return;
			}
			this.announce("");
			if (timeLeft <= 0 && clockStarted) {
				this.endMatch();
			} else if (this.teamsReady()) {
				this.startKickoff();
			} else if (this.roster.size() > 0) {
				this.enterFreePlay(true);
			} else {
				this.enterWaiting();
			}
		});
	}

	endMatch() {
		if (this.phase === "Ended") {
			return;
		}
		this.flowGen += 1;
		this.clearFaceOffScene();
		this.setPhase("Ended");
		for (const [player] of this.roster) {
			lockPlayer(player);
		}
		// Winner text is announced by playVictoryScene AFTER the camera is on
		// the goal shot (per design) — here it's just the whistle. Pitches that
		// never got a second team (muckabout / pending) just hear "TIME!".
		this.announce(this.muckabout || this.sideByTeamId.size() < 2 ? "TIME!" : "FULL TIME!");
	}

	checkBall(ball: BasePart) {
		for (const [team, part] of this.goalParts) {
			if (part.Parent === undefined) {
				continue;
			}
			if (ballInPart(ball, part)) {
				this.onGoal(team, ball);
				break;
			}
		}
	}
}

// ---- shared clock ---------------------------------------------------------

function startClock() {
	const localMatchGen = matchGen;
	warn(`[Football] shared clock started (${timeLeft}s)`);
	setGlobalAttr(FootballAttr.TimeLeft, timeLeft);
	task.spawn(() => {
		while (matchGen === localMatchGen && timeLeft > 0) {
			task.wait(1);
			if (matchGen !== localMatchGen) {
				return;
			}
			// One global whistle: once started the clock never pauses, even
			// while every pitch sits in a kickoff countdown or goal pause.
			timeLeft -= 1;
			setGlobalAttr(FootballAttr.TimeLeft, timeLeft);
			if (timeLeft <= 0) {
				warn("[Football] clock expired — ending every match at the shared whistle");
				endRoundForAll();
			}
		}
	});
}

function endRoundForAll() {
	const localMatchGen = matchGen;
	for (const match of matches) {
		match.endMatch();
	}
	const previousCue = ReplicatedStorage.GetAttribute("FB_GameEndCue");
	setGlobalAttr("FB_GameEndCue", (typeIs(previousCue, "number") ? previousCue : 0) + 1);
	const gold = matches[0];
	if (gold) {
		lastGoldScores = { Blue: gold.scores.Blue, Red: gold.scores.Red };
	}
	awardRoundMoney();
	warn(`[Football] round over — gold pitch Blue ${matches[0] ? matches[0].scores.Blue : 0} : ${matches[0] ? matches[0].scores.Red : 0} Red`);
	task.spawn(() => {
		task.wait(END_ANNOUNCE_TIME);
		if (matchGen !== localMatchGen) {
			return;
		}
		const callback = endCallback;
		if (callback) {
			callback();
		}
	});
}

// Round payout at the whistle: participation + result bonus + goal bonuses,
// through the same multiplier pipeline as kill/damage money.
function awardRoundMoney() {
	for (const match of matches) {
		const diff = match.scores.Blue - match.scores.Red;
		for (const [player, entry] of match.roster) {
			let amount = ROUND_MONEY_PARTICIPATION;
			// Result/goal bonuses only for real 2-team matches — free-play-only
			// pitches (muckabout, opponent never arrived) pay participation.
			if (!match.muckabout && match.sideByTeamId.size() >= 2) {
				if (diff === 0) {
					amount += ROUND_MONEY_DRAW;
				} else if ((diff > 0) === (entry.team === "Blue")) {
					amount += ROUND_MONEY_WIN;
				}
				amount += (roundGoals.get(player) ?? 0) * ROUND_MONEY_GOAL;
			}
			const [ok, calcOrErr] = pcall(() => {
				const calculated = Globals.calculateMultMoney(player, amount);
				DataStore2("money", player).Increment(calculated, 0);
				return calculated;
			});
			roundEarnings.set(player, ok ? (calcOrErr as number) : amount);
		}
	}
}

interface SummaryGuiShape extends ScreenGui {
	Columns: Frame;
}

const SUMMARY_FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

function buildSummaryColumn(parent: Frame, forPlayer: Player, subject: Player, layoutOrder: number) {
	const isSelf = forPlayer === subject;
	const column = new Instance("Frame");
	column.Name = "Column";
	column.LayoutOrder = layoutOrder;
	column.BackgroundColor3 = Color3.fromRGB(25, 32, 40);
	column.BackgroundTransparency = 0.15;
	column.Size = isSelf ? new UDim2(0.24, 0, 0.7, 0) : new UDim2(0.17, 0, 0.55, 0);
	const corner = new Instance("UICorner");
	corner.CornerRadius = new UDim(0.06, 0);
	corner.Parent = column;
	const layout = new Instance("UIListLayout");
	layout.FillDirection = Enum.FillDirection.Vertical;
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center;
	layout.VerticalAlignment = Enum.VerticalAlignment.Center;
	layout.Padding = new UDim(0.03, 0);
	layout.SortOrder = Enum.SortOrder.LayoutOrder;
	layout.Parent = column;

	const kills = subject.FindFirstChild("kills");
	// Trophy gain is the hero row: top and biggest. "CHAMPIONS 🏆+2" makes it
	// obvious the double trophy comes from winning the champions round.
	const trophies = roundTrophies.get(subject) ?? 0;
	const isChampion = roundChampions.has(subject);
	const rows: Array<[string, string, Color3]> = [
		[
			"Trophy",
			isChampion ? `CHAMPIONS 🏆+${trophies}` : `🏆 +${trophies}`,
			trophies > 0 ? Color3.fromRGB(255, 215, 0) : Color3.fromRGB(150, 150, 150),
		],
		["Name", isSelf ? "YOU" : subject.Name, new Color3(1, 1, 1)],
		["Goals", `Goals: ${roundGoals.get(subject) ?? 0}`, Color3.fromRGB(255, 220, 120)],
		["Kills", `Kills: ${kills && kills.IsA("NumberValue") ? kills.Value : 0}`, Color3.fromRGB(255, 140, 120)],
		["Money", `+$${roundEarnings.get(subject) ?? 0}`, Color3.fromRGB(140, 255, 160)],
	];
	for (let i = 0; i < rows.size(); i++) {
		const label = new Instance("TextLabel");
		label.Name = rows[i][0];
		label.LayoutOrder = i;
		label.BackgroundTransparency = 1;
		label.FontFace = SUMMARY_FONT;
		label.TextScaled = true;
		label.TextColor3 = rows[i][2];
		label.Text = rows[i][1];
		label.Size = new UDim2(0.9, 0, i === 0 ? 0.28 : i === 1 ? 0.18 : 0.12, 0);
		if (i === 0 && isChampion) {
			label.TextStrokeTransparency = 0;
			label.TextStrokeColor3 = Color3.fromRGB(90, 60, 0);
		}
		label.Parent = column;
	}
	column.Parent = parent;
}

// ---- coordinator (public API — same surface the callers already use) -----

function matchOf(player: Player): PitchMatch | undefined {
	const team = TeamRegistry.getTeamOf(player);
	if (!team) {
		return undefined;
	}
	const existing = matchByTeamId.get(team.id);
	if (existing) {
		return existing;
	}
	return assignTeamToPitch(team);
}

/** Pure roster lookup — unlike matchOf this can NEVER assign the player's
 * (possibly brand-new) ladder team to a pitch as a side effect. Death/leave
 * paths must use this: matchOf there caused spurious pitch creation when the
 * player switched teams between death and respawn. */
function matchWithPlayer(player: Player): PitchMatch | undefined {
	for (const match of matches) {
		if (match.roster.has(player)) {
			return match;
		}
	}
	return undefined;
}

/**
 * A ladder team evaporated (last member left the server or was pulled into
 * another team's lobby). Free its pitch slot, then rescue an abandoned
 * opponent: pair them with the team waiting on the muckabout pitch when one
 * exists (they become a new match together), otherwise the leftover team
 * free-plays — their pitch is effectively the muckabout until the whistle.
 * Runs deferred so the PlayerRemoving roster cleanups land first.
 */
function handleTeamGone(teamId: string) {
	const match = matchByTeamId.get(teamId);
	matchByTeamId.delete(teamId);
	if (!match || match.phase === "Ended") {
		return;
	}
	match.sideByTeamId.delete(teamId);
	if (match.muckabout) {
		return;
	}
	if (match.sideByTeamId.size() !== 1) {
		if (match.roster.size() === 0 && match.phase !== "Waiting") {
			match.enterWaiting();
		}
		return;
	}

	// One team left behind mid-round. Muckabout rescue first.
	const muck = matches.find((m) => m.muckabout);
	let movedTeamId: string | undefined;
	if (muck) {
		for (const [id] of muck.sideByTeamId) {
			movedTeamId = id;
			break;
		}
	}
	if (muck && movedTeamId !== undefined) {
		muck.sideByTeamId.delete(movedTeamId);
		matchByTeamId.set(movedTeamId, match);
		match.sideForLadderTeam(movedTeamId);
		const moving: Player[] = [];
		for (const [rosterPlayer] of muck.roster) {
			const team = TeamRegistry.getTeamOf(rosterPlayer);
			if (team && team.id === movedTeamId) {
				moving.push(rosterPlayer);
			}
		}
		for (const rosterPlayer of moving) {
			muck.roster.delete(rosterPlayer);
			match.assignSide(rosterPlayer);
		}
		if (muck.roster.size() === 0) {
			muck.enterWaiting();
		}
		warn(`[Football] muckabout team → ${match.pitch.folder.Name} to replace the leavers`);
		match.repositionVehicles();
		if (match.teamsReady()) {
			match.resetScores();
			match.startKickoff("NEW OPPONENT!");
		} else if (match.roster.size() > 0) {
			match.enterFreePlay(false);
		} else {
			match.enterWaiting();
		}
		return;
	}

	// No muckabout partner — leftover team free-plays until the whistle.
	if (match.roster.size() > 0) {
		if (match.phase !== "FreePlay") {
			warn(`[Football] ${match.pitch.folder.Name} lost its opponent — free play`);
			match.enterFreePlay(false);
		}
	} else if (match.phase !== "Waiting") {
		match.enterWaiting();
	}
}

TeamRegistry.onTeamDisbanded((team) => {
	task.defer(() => handleTeamGone(team.id));
});

/** A pitch that can only host free play: the muckabout pitch, or the
 * FreePlayPitch variant built when the round started with ≤1 team. Real
 * matches must never kick off here — teams get relocated to a real pitch. */
function isFreePlayHost(match: PitchMatch): boolean {
	return match.muckabout || match.pitch.variantName === VARIANT_FREEPLAY;
}

/** FAILURE 1 fix: clone a brand-new pitch mid-round onto the next slot along
 * the line, spawn its ball and stand up a PitchMatch for it. The shared goal
 * watcher and clock loops iterate `matches`, so pushing IS registration; the
 * new match ends at the same shared whistle as everyone else. */
function createMidRoundPitch(): PitchMatch | undefined {
	// First real pitch of the round (everyone so far was free-playing on the
	// FreePlayPitch): this hosts the top-table match, so it's gold. Later
	// mid-round pitches stay green until the next rebuild resorts the line.
	const hasRealPitch = matches.find((m) => !isFreePlayHost(m)) !== undefined;
	const pitch = PitchManager.addPitch(hasRealPitch ? undefined : VARIANT_GOLD);
	if (!pitch) {
		return undefined;
	}
	ballSpawner.SpawnBall(pitch.folder);
	const match = new PitchMatch(pitch);
	matches.push(match);
	warn(`[Football] mid-round pitch ${pitch.folder.Name} is live (${matches.size()} pitch(es) total)`);
	return match;
}

// Brief client-side black cover (pitchTransition.client.ts mirrors the join
// loading screen's look) shown while a waiting team is teleported off the
// free-play pitch onto their real match pitch.
const PITCH_MOVE_COVER_ATTR = "CB_PitchMoveCover";

/** A team was free-playing on a muckabout/FreePlayPitch and just got a real
 * match on `target`: cover their screens, teleport them over, then free-play
 * there until the opponent spawns in and the face-off + 3-2-1 kicks off. */
function moveTeamBehindCover(target: PitchMatch, moving: Player[]) {
	task.spawn(() => {
		for (const player of moving) {
			player.SetAttribute(PITCH_MOVE_COVER_ATTR, true);
		}
		task.wait(0.4);
		target.repositionVehicles();
		if (target.teamsReady()) {
			target.resetScores();
			target.startKickoff();
		} else if (target.roster.size() > 0) {
			target.enterFreePlay(false);
		}
		task.wait(0.5);
		for (const player of moving) {
			player.SetAttribute(PITCH_MOVE_COVER_ATTR, undefined);
		}
	});
}

/** If a team sits alone on a free-play-only pitch while `target` (a real
 * pitch) still has a free team slot, pair them: move their side assignment,
 * roster and vehicles onto `target`. This is what turns "friend joined but I'm
 * stuck on the free-play pitch" into a real match. */
function pairWaitingFreePlayTeam(target: PitchMatch) {
	if (isFreePlayHost(target) || target.sideByTeamId.size() >= 2) {
		return;
	}
	const waiting = matches.find((m) => m !== target && isFreePlayHost(m) && m.sideByTeamId.size() === 1);
	if (!waiting) {
		return;
	}
	let movedTeamId: string | undefined;
	for (const [id] of waiting.sideByTeamId) {
		movedTeamId = id;
		break;
	}
	if (movedTeamId === undefined) {
		return;
	}
	waiting.sideByTeamId.delete(movedTeamId);
	matchByTeamId.set(movedTeamId, target);
	target.sideForLadderTeam(movedTeamId);
	const moving: Player[] = [];
	for (const [rosterPlayer] of waiting.roster) {
		const team = TeamRegistry.getTeamOf(rosterPlayer);
		if (team && team.id === movedTeamId) {
			moving.push(rosterPlayer);
		}
	}
	for (const rosterPlayer of moving) {
		waiting.roster.delete(rosterPlayer);
		target.assignSide(rosterPlayer);
	}
	if (waiting.roster.size() === 0) {
		waiting.enterWaiting();
	}
	warn(`[Football] free-play team → ${target.pitch.folder.Name} for a real match`);
	moveTeamBehindCover(target, moving);
}

/** Mid-round team placement (pending-pool design): a new team may join a REAL
 * pitch that still has a free TEAM slot (a pending team is free-playing there
 * waiting for an opponent) — never an occupied pitch and never a free-play
 * host (muckabout / FreePlayPitch: matches must not kick off there). If no
 * slot is free, a fresh pitch is cloned; a team waiting on a free-play host
 * is then moved over to pair up (loading cover + teleport). */
function assignTeamToPitch(team: LadderTeam): PitchMatch | undefined {
	if (matches.size() === 0) {
		return undefined;
	}
	let target: PitchMatch | undefined;
	for (const match of matches) {
		if (!isFreePlayHost(match) && match.sideByTeamId.size() < 2) {
			target = match;
			break;
		}
	}
	if (!target) {
		// No real slot. An EMPTY free-play pitch hosts this team's free play —
		// the intended flow: first team knocks about on the FreePlayPitch, and
		// only when an opponent team arrives (finding the host occupied, next
		// branch) is the real pitch cloned and both teams moved onto it.
		for (const match of matches) {
			if (isFreePlayHost(match) && match.sideByTeamId.size() === 0) {
				target = match;
				break;
			}
		}
	}
	if (!target) {
		target = createMidRoundPitch();
	}
	if (!target) {
		// Could not clone a pitch (missing map variants) — last-resort overflow
		// keeps the team playable instead of stranded.
		target = matches[matches.size() - 1];
		warn(`[Football] could not add a pitch for ${team.name} — overflowing onto ${target.pitch.folder.Name}`);
	}
	matchByTeamId.set(team.id, target);
	target.sideForLadderTeam(team.id);
	warn(`[Football] team ${team.name} → ${target.pitch.folder.Name}`);
	pairWaitingFreePlayTeam(target);
	return target;
}

export interface RoundResult {
	teamId: string;
	pitchIndex: number;
	outcome: "win" | "loss" | "draw" | "muck";
}

const footballMatch = {
	mapHasGoalParts,

	/** Per-team outcomes of the (just-ended) round — read BEFORE stop().
	 * Draws are reported as draws; the MatchDirector coin-flips them. */
	getRoundResults(): RoundResult[] {
		const out: RoundResult[] = [];
		for (const match of matches) {
			// A pitch that never got its second team (muckabout, or a pending
			// team's free-play pitch) had no real match: outcome "muck" — the
			// team moves with the pack instead of winning against nobody.
			if (match.muckabout || match.sideByTeamId.size() < 2) {
				for (const [teamId] of match.sideByTeamId) {
					out.push({ teamId, pitchIndex: match.pitch.index, outcome: "muck" });
				}
				continue;
			}
			const diff = match.scores.Blue - match.scores.Red;
			for (const [teamId, side] of match.sideByTeamId) {
				const outcome: RoundResult["outcome"] =
					diff === 0 ? "draw" : (diff > 0) === (side === "Blue") ? "win" : "loss";
				out.push({ teamId, pitchIndex: match.pitch.index, outcome });
			}
		}
		return out;
	},

	/** Trophy grants for the (just-ended) round — call AFTER applyMovement so
	 * coin-flipped draws have been resolved to wins in `results`, and BEFORE
	 * showRoundSummary so the summary shows the fresh amounts. Winners bank
	 * 🏆+1; the champions-round winner (session-final round, position 0 after
	 * movement) banks 🏆+2. Flat amounts: no multiplier pipeline, never spent. */
	awardRoundTrophies(results: RoundResult[], isChampionRound: boolean) {
		const winningTeamIds = new Set<string>();
		for (const result of results) {
			if (result.outcome === "win") {
				winningTeamIds.add(result.teamId);
			}
		}
		let championTeamId: string | undefined;
		if (isChampionRound) {
			const champion = TeamRegistry.getTeams()[0];
			if (champion !== undefined && champion.position === 0) {
				championTeamId = champion.id;
			}
		}
		for (const team of TeamRegistry.getTeams()) {
			if (!winningTeamIds.has(team.id)) {
				continue;
			}
			const isChampion = team.id === championTeamId;
			const amount = isChampion ? TROPHIES_CHAMPION_WIN : TROPHIES_ROUND_WIN;
			for (const member of team.members) {
				pcall(() => {
					DataUtilities.AddTrophies(member, amount);
					roundTrophies.set(member, amount);
					if (isChampion) {
						roundChampions.add(member);
					}
				});
			}
		}
	},

	/** Gold-pitch scores (live, or the end-of-round snapshot after stop()). */
	getScores() {
		const gold = matches[0];
		return gold ? { Blue: gold.scores.Blue, Red: gold.scores.Red } : lastGoldScores;
	},

	/**
	 * Victory scene (design §9, replaces the old podium for football): per
	 * pitch, the winning team's cars teleport to the VictoryLineup parts —
	 * or spread in front of the goal they defended — while clients aim their
	 * camera at the pitch's VictoryCamera (matchHud reacts to Phase=Ended).
	 * Blocks ~8 s; the winner announce is already on screen.
	 *
	 * `flipWinners` (Phase 4b, from MatchDirector.applyMovement) maps a DRAWN
	 * pitch's index to the ladder team its coin flip promoted: those pitches
	 * get the "COIN FLIP..." → "<SIDE> MOVES UP!" presentation (matching the
	 * ACTUAL flip) and the same goal-shot camera as a win, aimed at the flip
	 * winner's goal. No lineup for ties.
	 */
	playVictoryScene(flipWinners?: Map<number, string>) {
		// Winner cars get their controls back for the scene — pinned on X/Z by
		// the showcase lock so they can jump/boost/spin on the lineup without
		// leaving it. Undone after the scene so the ladder map / summary play
		// out over a still lineup.
		const winnerBases: BasePart[] = [];
		const winnerPlayers: Player[] = [];
		for (const match of matches) {
			// No winner presentation for free-play-only pitches (muckabout /
			// opponent never arrived) — there was no match to win.
			if (match.muckabout || match.roster.size() === 0 || match.sideByTeamId.size() < 2) {
				continue;
			}
			// Per-pitch pcall: a staging error on one pitch (missing lineup
			// part, despawned car, ...) must never escape the method — that
			// would skip the VICTORY_SCENE_TIME wait below and slam the ladder
			// map on screen a fraction of a second after the camera cut.
			const [stageOk, stageErr] = pcall(() => {
				const diff = match.scores.Blue - match.scores.Red;
				const winner: TeamName | undefined = diff === 0 ? undefined : diff > 0 ? "Blue" : "Red";
				// Translate the flip-winning ladder team back to this pitch's SIDE.
				let flipSide: TeamName | undefined;
				if (winner === undefined && flipWinners) {
					const flipTeamId = flipWinners.get(match.pitch.index);
					if (flipTeamId !== undefined) {
						flipSide = match.sideByTeamId.get(flipTeamId);
					}
				}

				const lineupFolder = match.pitch.folder.FindFirstChild("VictoryLineup");
				if (winner) {
					// Winning cars onto the VictoryLineup/<side> parts (Red/Blue
					// subfolders), fallback: spread across the goal mouth.
					const lineup: BasePart[] = [];
					let lineupSource: Instance | undefined = lineupFolder;
					const sideFolder = lineupFolder && lineupFolder.FindFirstChild(winner);
					if (sideFolder) {
						lineupSource = sideFolder;
					}
					if (lineupSource) {
						for (const descendant of lineupSource.GetDescendants()) {
							// The side models also hold the authored camera shot —
							// never pose a car on it.
							if (descendant.IsA("BasePart") && descendant.Name !== "CameraPart") {
								lineup.push(descendant);
							}
						}
					}
					lineup.sort((a, b) => a.Name < b.Name);
					const goal = match.goalParts.get(winner);
					let placed = 0;
					for (const [player, entry] of match.roster) {
						if (entry.team !== winner) {
							continue;
						}
						const vehicle = Globals.vehiclesTable[player.UserId];
						const model = vehicle && vehicle.model;
						if (!model || model.Parent === undefined) {
							continue;
						}
						let target: CFrame | undefined;
						if (lineup.size() > 0) {
							target = lineup[placed % lineup.size()].CFrame;
						} else if (goal) {
							target = goal.CFrame.mul(new CFrame((placed - 1) * 14, 2, -18));
						}
						if (target) {
							const [posed, lockPos] = pcall(() => {
								const size = model.GetExtentsSize();
								const lifted = target!.add(new Vector3(0, size.Y / 2, 0));
								model.SetPrimaryPartCFrame(lifted);
								const base = model.FindFirstChild("Base");
								if (base && base.IsA("BasePart")) {
									base.AssemblyLinearVelocity = new Vector3(0, 0, 0);
									base.AssemblyAngularVelocity = new Vector3(0, 0, 0);
								}
								return lifted.Position;
							});
							if (posed) {
								const base = model.FindFirstChild("Base");
								if (base && base.IsA("BasePart")) {
									VehicleSim.setShowcaseLock(base, lockPos as Vector3);
									winnerBases.push(base);
								}
								// Only the winners celebrate with live controls.
								unlockPlayer(player);
								winnerPlayers.push(player);
							}
						}
						placed += 1;
					}
				}

				// Use the exact authored shot for the winning side: the CameraPart
				// inside the VictoryLineup side model (legacy CameraWinParts kept as
				// a fallback). CFrame is a supported attribute type, so the client
				// reproduces the part's complete position and rotation without
				// recalculating either.
				const camSide: TeamName = winner ?? flipSide ?? "Blue";
				const sideModel = lineupFolder ? lineupFolder.FindFirstChild(camSide) : undefined;
				let cameraPart: Instance | undefined = sideModel ? sideModel.FindFirstChild("CameraPart", true) : undefined;
				if (!(cameraPart && cameraPart.IsA("BasePart"))) {
					const cameraWinParts = match.pitch.folder.FindFirstChild("CameraWinParts", true);
					cameraPart = cameraWinParts ? cameraWinParts.FindFirstChild(camSide) : undefined;
				}
				if (cameraPart && cameraPart.IsA("BasePart")) {
					match.pitch.folder.SetAttribute("FB_VictoryCamCFrame", cameraPart.CFrame);
				} else {
					match.pitch.folder.SetAttribute("FB_VictoryCamCFrame", undefined);
					warn(`[Football] ${match.pitch.folder.Name} is missing VictoryLineup/${camSide}/CameraPart`);
				}

				// Camera first, THEN the winner presentation.
				task.wait(0.2);
				if (winner !== undefined) {
					// The Victory overlay replaces the old center announce: it
					// renders WINNERS/YOU LOSE, the winning side, the ladder
					// team name, the roster icons and the confetti client-side.
					const teamName = match.ladderTeamNameForSide(winner) ?? `${winner.upper()} TEAM`;
					match.announce("");
					match.setAttr(FootballAttr.WinnerName, teamName);
					match.setAttr(FootballAttr.WinnerSide, winner);
				} else if (flipSide !== undefined) {
					// Coin-flip presentation (Phase 4b): suspense, then the ACTUAL
					// result the MatchDirector already flipped.
					match.announce("COIN FLIP...");
					const localMatchGen = matchGen;
					const side = flipSide;
					task.delay(COIN_FLIP_SUSPENSE, () => {
						if (matchGen !== localMatchGen) {
							return;
						}
						const hex = side === "Blue" ? BLUE_HEX : RED_HEX;
						match.announce(`<font color="${hex}">${side.upper()} MOVES UP!</font>`);
						match.setAttr(FootballAttr.FlipSide, side);
					});
				} else {
					match.announce("TIE GAME!");
				}
			});
			if (!stageOk) {
				warn(`[Football] victory staging FAILED on ${match.pitch.folder.Name}: ${stageErr}`);
			}
		}
		task.wait(VICTORY_SCENE_TIME);
		// Drop the victory overlay before the ladder map takes the screen.
		for (const match of matches) {
			match.setAttr(FootballAttr.WinnerSide, "");
			match.setAttr(FootballAttr.WinnerName, "");
			match.setAttr(FootballAttr.FlipSide, "");
		}
		for (const base of winnerBases) {
			if (base.Parent !== undefined) {
				VehicleSim.setShowcaseLock(base, undefined);
			}
		}
		for (const player of winnerPlayers) {
			if (player.Parent !== undefined) {
				lockPlayer(player);
			}
		}
	},

	/** Full-screen per-player round summary (design §9): a stats column per
	 * LADDER TEAMMATE of the viewer (never the opponents) — yours centered and
	 * bigger. Blocks ~6 s. */
	showRoundSummary() {
		for (const match of matches) {
			for (const [player] of match.roster) {
				pcall(() => {
					const playerGui = player.FindFirstChild("PlayerGui");
					const gui = playerGui && playerGui.FindFirstChild("RoundSummary");
					if (!gui || !gui.IsA("ScreenGui") || !gui.FindFirstChild("Columns")) {
						return;
					}
					const summary = gui as SummaryGuiShape;
					for (const child of summary.Columns.GetChildren()) {
						if (child.IsA("Frame")) {
							child.Destroy();
						}
					}
					// Only the viewer's own ladder team makes the board: same
					// LadderTeam members, restricted to this match's roster so
					// the stats maps actually cover them.
					const ladderTeam = TeamRegistry.getTeamOf(player);
					const teammates: Player[] = [];
					if (ladderTeam) {
						for (const member of ladderTeam.members) {
							if (match.roster.has(member)) {
								teammates.push(member);
							}
						}
					}
					if (teammates.size() === 0) {
						teammates.push(player); // teamless viewer: just their own column
					}
					// Own column centered: teammates fill orders around the middle.
					const middle = math.floor(teammates.size() / 2);
					let order = 0;
					for (const subject of teammates) {
						if (subject === player) {
							continue;
						}
						if (order === middle) {
							order += 1; // reserve the middle slot
						}
						buildSummaryColumn(summary.Columns, player, subject, order);
						order += 1;
					}
					buildSummaryColumn(summary.Columns, player, player, middle);
					summary.Enabled = true;
				});
			}
		}
		task.wait(SUMMARY_TIME);
		for (const player of PlayerService.GetPlayers()) {
			pcall(() => {
				const playerGui = player.FindFirstChild("PlayerGui");
				const gui = playerGui && playerGui.FindFirstChild("RoundSummary");
				if (gui && gui.IsA("ScreenGui")) {
					gui.Enabled = false;
				}
			});
		}
	},

	stop() {
		matchGen += 1;
		if (goalWatcher) {
			goalWatcher.Disconnect();
			goalWatcher = undefined;
		}
		for (const match of matches) {
			match.flowGen += 1;
			match.clearFaceOffScene();
			for (const [player] of match.roster) {
				lockGen.set(player, (lockGen.get(player) ?? 0) + 1);
				hideTimerText(player);
				// Stale marker would silence the sit-edge enable on the NEXT
				// round's first (unlocked) spawn.
				player.SetAttribute(CONTROL_LOCK_ATTR, undefined);
				player.SetAttribute("CB_Side", undefined);
				player.SetAttribute("CB_PitchId", undefined);
				// Round-end vehicle cleanup (the retired EndScreen used to do
				// this): cars must not outlive their pitch.
				pcall(() => {
					const character = player.Character;
					const humanoid = character && character.FindFirstChildOfClass("Humanoid");
					if (humanoid) {
						humanoid.Health = 0;
					}
					spawnVehicle.KillVehicle(player);
				});
			}
		}
		matches = [];
		matchByTeamId.clear();
		clockStarted = false;
		endCallback = undefined;
		setGlobalAttr(FootballAttr.TimeLeft, MATCH_TIME);
	},

	/** Start a round across the freshly built pitches (roundHandler). Teams
	 * are paired onto real pitches by ladder position; the leftover goes to
	 * the muckabout pitch. */
	beginRound(pitches: Pitch[], onRoundEnd: () => void) {
		footballMatch.stop();
		matchGen += 1;
		endCallback = onRoundEnd;
		roundGoals.clear();
		roundEarnings.clear();
		roundTrophies.clear();
		roundChampions.clear();
		timeLeft = MATCH_TIME;
		setGlobalAttr(FootballAttr.TimeLeft, timeLeft);
		// Session round counter for the HUD ("Round N/6" under the clock).
		// applyMovement has already run for the previous round, so the round
		// being built is roundNumber + 1.
		setGlobalAttr("CB_Round", MatchDirector.getRoundNumber() + 1);
		setGlobalAttr("CB_SessionRounds", SESSION_ROUNDS);

		matches = pitches.map((pitch) => new PitchMatch(pitch));

		const teams = TeamRegistry.getTeams();
		const realMatches = matches.filter((m) => !m.muckabout);
		const muckMatch = matches.find((m) => m.muckabout);
		for (let i = 0; i < teams.size(); i++) {
			const pairIndex = math.floor(i / 2);
			let target: PitchMatch | undefined = realMatches[pairIndex];
			if (target === undefined) {
				const isOddLeftover = i === teams.size() - 1 && teams.size() % 2 === 1;
				if (isOddLeftover && muckMatch) {
					target = muckMatch;
				} else {
					// loadMap under-built for the CURRENT team count (e.g. teams
					// formed during the interlude): top the line up with a fresh
					// pitch instead of overflowing onto an occupied one.
					const created = createMidRoundPitch();
					if (created) {
						realMatches.push(created);
						target = created;
					}
				}
			}
			if (target === undefined) {
				target = muckMatch ?? realMatches[realMatches.size() - 1];
				if (target) {
					warn(`[Football] no pitch available for ${teams[i].name} — overflowing onto ${target.pitch.folder.Name}`);
				}
			}
			if (target) {
				matchByTeamId.set(teams[i].id, target);
				target.sideForLadderTeam(teams[i].id);
			}
		}

		const localMatchGen = matchGen;
		goalWatcher = RunService.Heartbeat.Connect(() => {
			if (matchGen !== localMatchGen) {
				return;
			}
			for (const match of matches) {
				// FreePlay counts too: fun goals show on the scoreboard.
				if (match.phase !== "Play" && match.phase !== "FreePlay") {
					continue;
				}
				const ball = ballSpawner.GetBall(match.pitch.folder);
				if (ball && ball.Parent !== undefined) {
					match.checkBall(ball);
				}
			}
		});
		warn(`[Football] round ready: ${matches.size()} pitch(es), ${teams.size()} team(s)`);
	},

	getSpawnCFrame(player: Player): CFrame | undefined {
		const match = matchOf(player);
		if (!match) {
			return undefined;
		}
		return match.spawnCFrameFor(match.assignSide(player));
	},

	/**
	 * Call BEFORE SpawnVehicle seats the player (SpawnInPlayer): stamps the
	 * control-lock marker so the sim's fresh-sit context enable respects the
	 * coming phase lock instead of opening a drive window ~2s ahead of
	 * onPlayerSpawned. Waiting/FreePlay spawns stay unlocked (no marker).
	 * Requires the player to already be rostered (getSpawnCFrame does that).
	 */
	preSpawnLock(player: Player) {
		const match = matchWithPlayer(player);
		if (!match) {
			return;
		}
		if (match.phase === "Play" || match.phase === "Kickoff" || match.phase === "FaceOff" || match.phase === "Goal") {
			player.SetAttribute(CONTROL_LOCK_ATTR, true);
			setContextEnabled(player, false);
		}
	},

	onPlayerSpawned(player: Player) {
		const match = matchOf(player);
		if (!match || match.phase === "Ended") {
			return;
		}
		match.assignSide(player);
		if (match.phase === "Play") {
			lockPlayer(player, RESPAWN_LOCK);
			// Re-place at floor level facing the ball — SpawnVehicle's
			// free-fall placement drops from height and can twist the car.
			match.placeVehicleFor(player);
			return;
		}
		if (match.phase === "Kickoff" || match.phase === "FaceOff" || match.phase === "Goal") {
			// startKickoff's GO / the goal-pause resolution unlocks the roster.
			lockPlayer(player);
			// Mid-face-off the car belongs on its podium, NOT the kickoff spot
			// (a late SpawnVehicle return here teleported cars off the stage).
			if (match.phase === "FaceOff" && match.placeVehicleOnStageFor(player)) {
				return;
			}
			match.placeVehicleFor(player);
			return;
		}
		// Waiting / FreePlay: either this spawn completes the pairing (kickoff)
		// or the pitch (re-)enters free play with everyone unlocked.
		if (match.teamsReady()) {
			warn(`[Football] opponent arrived on ${match.pitch.folder.Name} — kickoff`);
			match.resetScores();
			match.startKickoff(match.phase === "FreePlay" ? "OPPONENT ARRIVED!" : undefined);
		} else {
			match.enterFreePlay(false);
		}
	},

	onPlayerDied(player: Player): boolean {
		const match = matchWithPlayer(player);
		if (!match || match.phase === "Ended") {
			return false;
		}
		const localMatchGen = matchGen;
		task.spawn(() => {
			task.wait(RESPAWN_DELAY);
			if (matchGen !== localMatchGen || player.Parent === undefined) {
				return;
			}
			// Roster lookup, NOT matchOf: if the player switched ladder teams
			// during the delay (invite accepted → lobby) matchOf would assign
			// the new team to a pitch and respawn them into it.
			const stillMatch = matchWithPlayer(player);
			if (!stillMatch || stillMatch.phase === "Ended") {
				return;
			}
			const [ok, err] = pcall(() => Globals.SpawnInPlayer(player));
			if (!ok) {
				warn(`[Football] respawn of ${player.Name} failed: ${err}`);
			}
		});
		return true;
	},

	/** True when the player is on any pitch's roster (spawned into the round,
	 * dead-and-respawning included). Menu/lobby players are not. */
	isInMatch(player: Player): boolean {
		return matchWithPlayer(player) !== undefined;
	},

	/** True while the current round can be spawned into: pitches exist and the
	 * whistle hasn't blown. False during the end-of-round interlude (victory
	 * scene → ladder map → summary) and after stop() until the next
	 * beginRound. Lobby vote launches hold on this. */
	isRoundLive(): boolean {
		return matches.size() > 0 && matches[0].phase !== "Ended";
	},

	/**
	 * Mini-lobby pull (accepted an invite mid-match): remove the player from
	 * their pitch without them leaving the server. Car and character die the
	 * same way stop() kills them (no PlayerDamaged event, so no death screen
	 * or respawn scheduling), and the pitch falls back exactly as if they had
	 * disconnected. Team-level consequences (opponent abandoned → muckabout
	 * rescue) ride on the TeamRegistry disband callback, since the puller has
	 * already moved the player onto their new team.
	 */
	leaveMatch(player: Player) {
		const match = matchWithPlayer(player);
		if (!match) {
			return;
		}
		match.roster.delete(player);
		lockGen.set(player, (lockGen.get(player) ?? 0) + 1);
		hideTimerText(player);
		player.SetAttribute(CONTROL_LOCK_ATTR, undefined);
		player.SetAttribute("CB_Side", undefined);
		player.SetAttribute("CB_PitchId", undefined);
		pcall(() => {
			const character = player.Character;
			const humanoid = character && character.FindFirstChildOfClass("Humanoid");
			if (humanoid) {
				humanoid.Health = 0;
			}
			spawnVehicle.KillVehicle(player);
		});
		if (
			(match.phase === "Play" || match.phase === "Kickoff" || match.phase === "FaceOff" || match.phase === "Goal") &&
			!match.teamsReady()
		) {
			if (match.roster.size() > 0) {
				warn(`[Football] ${player.Name} pulled to a lobby — ${match.pitch.folder.Name} falls back to free play`);
				match.enterFreePlay(false);
			} else {
				match.enterWaiting();
			}
		}
	},
};

PlayerService.PlayerRemoving.Connect((player) => {
	lockGen.delete(player);
	for (const match of matches) {
		if (match.roster.has(player)) {
			match.roster.delete(player);
			if (
				(match.phase === "Play" || match.phase === "Kickoff" || match.phase === "FaceOff" || match.phase === "Goal") &&
				!match.teamsReady()
			) {
				if (match.roster.size() > 0) {
					warn(`[Football] ${player.Name} left — ${match.pitch.folder.Name} falls back to free play`);
					match.enterFreePlay(false);
				} else {
					warn(`[Football] ${player.Name} left — ${match.pitch.folder.Name} waiting for players`);
					match.enterWaiting();
				}
			}
		}
	}
});

export default footballMatch;
