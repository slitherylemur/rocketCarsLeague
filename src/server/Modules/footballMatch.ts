// Football (Rocket-League style) match controller.
//
// roundHandler loads a map + ball and calls beginMatch(); this module then
// owns the match flow:
//
//   Waiting  — cars spawn in with controls locked until each team has at
//              least one player in a car (min 2 players total).
//   Kickoff  — ball reset to center, cars reset to their team spawn points,
//              3-2-1 countdown, then controls unlock ("GO!").
//   Play     — match clock runs; goals are detected; kills auto-respawn at
//              the team spawn with a 5 s control lock (TimerGui countdown).
//   Goal     — short celebration pause, then back to Kickoff.
//   Ended    — clock hit zero; most goals wins; roundHandler's end screen.
//
// Client HUD state travels as attributes on ReplicatedStorage (FB_*) —
// attributes replicate automatically, so no new RemoteEvents are needed
// (FunctionsAndEvents is a place-file folder code cannot extend).
// matchHud.client.ts renders them.
//
// Control locks use the same mechanism the shared sim itself uses while
// driving: the player's VehicleControls InputContext (vehicleInputActions).
// The sim re-enables the context on every fresh sit edge, so locks are
// (re)applied AFTER SpawnVehicle returns — its internal task.wait(2) puts us
// safely after the deferred sit-edge enable.

import ballSpawner from "./ballSpawner";
import { Globals } from "../Globals";
import { BALL_NAME } from "shared/ballSim/BallConfig";
import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import { VehicleInput } from "shared/vehicleSim/VehicleSim";

const PlayerService = game.GetService("Players");
const RunService = game.GetService("RunService");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const TeamsService = game.GetService("Teams");

export type TeamName = "Red" | "Blue";
const TEAM_NAMES: TeamName[] = ["Blue", "Red"];

const MATCH_TIME = 300; // seconds of Play time
const KICKOFF_COUNTDOWN = 3;
const RESPAWN_DELAY = 1.5; // death effect breathing room before the car respawns
const RESPAWN_LOCK = 5; // seconds of locked controls after a respawn
const GOAL_PAUSE = 2.5; // celebration freeze before the next kickoff
const END_ANNOUNCE_TIME = 2;

const BLUE_HEX = "#4FA8FF";
const RED_HEX = "#FF5050";

// Replicated HUD attributes (on ReplicatedStorage).
export const FootballAttr = {
	Phase: "FB_Phase",
	BlueScore: "FB_BlueScore",
	RedScore: "FB_RedScore",
	TimeLeft: "FB_TimeLeft",
	Announce: "FB_Announce",
} as const;

type Phase = "Idle" | "Waiting" | "Kickoff" | "Play" | "Goal" | "Ended";

interface RosterEntry {
	team: TeamName;
	/** 0-based spawn slot inside the team's spawn folder. */
	slot: number;
}

interface TimerGuiShape extends ScreenGui {
	TextLabel: TextLabel;
}

let phase: Phase = "Idle";
const scores = { Red: 0, Blue: 0 };
const roster = new Map<Player, RosterEntry>();
/** Goal parts by the team DEFENDING them (ball in Blue's goal => Red scores). */
const goalParts = new Map<TeamName, BasePart>();

let matchGen = 0; // bumped by beginMatch/stop — invalidates every running loop
let flowGen = 0; // bumped whenever the kickoff/goal/waiting flow restarts
const lockGen = new Map<Player, number>();
let clockStarted = false;
let timeLeft = MATCH_TIME;
let goalWatcher: RBXScriptConnection | undefined;
let endCallback: (() => void) | undefined;

// ---- replicated HUD state ------------------------------------------------

function setAttr(name: string, value: string | number) {
	ReplicatedStorage.SetAttribute(name, value);
}

function setPhase(newPhase: Phase) {
	phase = newPhase;
	setAttr(FootballAttr.Phase, newPhase);
}

function announce(text: string) {
	setAttr(FootballAttr.Announce, text);
}

function publishScores() {
	setAttr(FootballAttr.BlueScore, scores.Blue);
	setAttr(FootballAttr.RedScore, scores.Red);
}

// ---- teams & spawns ------------------------------------------------------

function teamInstance(team: TeamName): Team {
	return (TeamsService as unknown as Record<TeamName, Team>)[team];
}

function rosterCount(team: TeamName): number {
	let count = 0;
	for (const [, entry] of roster) {
		if (entry.team === team) {
			count += 1;
		}
	}
	return count;
}

function lowestFreeSlot(team: TeamName): number {
	const used = new Set<number>();
	for (const [, entry] of roster) {
		if (entry.team === team) {
			used.add(entry.slot);
		}
	}
	let slot = 0;
	while (used.has(slot)) {
		slot += 1;
	}
	return slot;
}

function assignTeam(player: Player): RosterEntry {
	const existing = roster.get(player);
	if (existing) {
		return existing;
	}
	const blue = rosterCount("Blue");
	const red = rosterCount("Red");
	let team: TeamName;
	if (blue < red) {
		team = "Blue";
	} else if (red < blue) {
		team = "Red";
	} else {
		team = TEAM_NAMES[math.random(1, 2) - 1];
	}
	const entry: RosterEntry = { team, slot: lowestFreeSlot(team) };
	roster.set(player, entry);
	pcall(() => {
		player.Team = teamInstance(team);
		player.Neutral = false;
	});
	warn(`[Football] ${player.Name} assigned to ${team} (slot ${entry.slot})`);
	return entry;
}

/** Spawn parts for a team: SpawnPoints/<Team> folder contents (sorted by
 * name), falling back to every BasePart under SpawnPoints (old flat maps). */
function teamSpawnParts(team: TeamName): BasePart[] {
	const spawnFolder = (game.Workspace as unknown as { SpawnPoints: Folder }).SpawnPoints;
	let source: Instance = spawnFolder;
	for (const child of spawnFolder.GetChildren()) {
		if (child.Name.lower() === team.lower()) {
			source = child;
			break;
		}
	}
	const parts: BasePart[] = [];
	for (const descendant of source.GetDescendants()) {
		if (descendant.IsA("BasePart")) {
			parts.push(descendant);
		}
	}
	parts.sort((a, b) => a.Name < b.Name);
	return parts;
}

function spawnCFrameFor(entry: RosterEntry): CFrame | undefined {
	const parts = teamSpawnParts(entry.team);
	if (parts.size() === 0) {
		return undefined;
	}
	return parts[entry.slot % parts.size()].CFrame;
}

// ---- goal parts ----------------------------------------------------------

/** BasePart in the map whose name reads like "<color> goal" (e.g.
 * BlueGoalPart / redGoalPart) — tolerant of exact naming. */
function findGoalPart(map: Instance, colorWord: string): BasePart | undefined {
	for (const descendant of map.GetDescendants()) {
		if (!descendant.IsA("BasePart")) {
			continue;
		}
		const name = descendant.Name.lower();
		if (name.find("goal")[0] !== undefined && name.find(colorWord)[0] !== undefined) {
			return descendant;
		}
	}
	return undefined;
}

export function mapHasGoalParts(map: Instance): boolean {
	return findGoalPart(map, "blue") !== undefined && findGoalPart(map, "red") !== undefined;
}

function locateGoals(map: Instance) {
	goalParts.clear();
	for (const team of TEAM_NAMES) {
		const part = findGoalPart(map, team.lower());
		if (part) {
			// Trigger volume only: the ball's sweep raycasts hit CanQuery parts
			// (which would bounce it off the goal mouth) and cars collide with
			// CanCollide parts — neutralize both, detection is pure math below.
			part.CanCollide = false;
			part.CanQuery = false;
			part.CanTouch = false;
			part.Anchored = true;
			goalParts.set(team, part);
		} else {
			warn(`[Football] map ${map.Name} has no ${team} goal part — goals for ${team === "Blue" ? "Red" : "Blue"} cannot be scored`);
		}
	}
}

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

// ---- control locks -------------------------------------------------------

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

/**
 * Lock a player's driving controls. With `seconds`, TimerGui counts it down
 * and the lock self-releases; without, the lock holds until unlockPlayer
 * (kickoff/waiting flows release everyone together).
 */
function lockPlayer(player: Player, seconds?: number, timerText?: (i: number) => string) {
	const gen = (lockGen.get(player) ?? 0) + 1;
	lockGen.set(player, gen);
	setContextEnabled(player, false);
	zeroVehicleInputs(player);

	if (seconds === undefined) {
		// An indefinite lock may supersede a running countdown (e.g. a goal
		// freeze during a respawn lock) — clear its stale TimerGui text.
		hideTimerText(player);
	}

	if (seconds !== undefined) {
		const localMatchGen = matchGen;
		task.spawn(() => {
			for (let i = seconds; i >= 1; i--) {
				if (lockGen.get(player) !== gen || matchGen !== localMatchGen || player.Parent === undefined) {
					return;
				}
				showTimerText(player, timerText !== undefined ? timerText(i) : `You can drive in ${i}`);
				task.wait(1);
			}
			if (lockGen.get(player) === gen && matchGen === localMatchGen && player.Parent !== undefined) {
				unlockPlayer(player);
			}
		});
	}
}

function unlockPlayer(player: Player) {
	lockGen.set(player, (lockGen.get(player) ?? 0) + 1);
	hideTimerText(player);
	setContextEnabled(player, true);
}

function lockAll() {
	for (const [player] of roster) {
		lockPlayer(player);
	}
}

function unlockAll() {
	for (const [player] of roster) {
		unlockPlayer(player);
	}
}

// ---- kickoff / goal / waiting flow --------------------------------------

function repositionVehicles() {
	for (const [player, entry] of roster) {
		const vehicle = Globals.vehiclesTable[player.UserId];
		const model = vehicle && vehicle.model;
		if (!model || model.Parent === undefined) {
			continue;
		}
		const spawnCFrame = spawnCFrameFor(entry);
		if (spawnCFrame === undefined) {
			continue;
		}
		pcall(() => {
			const size = model.GetExtentsSize();
			model.SetPrimaryPartCFrame(spawnCFrame.add(new Vector3(0, size.Y / 2, 0)));
			const base = model.FindFirstChild("Base");
			if (base && base.IsA("BasePart")) {
				base.AssemblyLinearVelocity = new Vector3(0, 0, 0);
				base.AssemblyAngularVelocity = new Vector3(0, 0, 0);
			}
		});
	}
}

function teamsReady(): boolean {
	return rosterCount("Blue") >= 1 && rosterCount("Red") >= 1 && roster.size() >= 2;
}

function startKickoff() {
	const gen = ++flowGen;
	const localMatchGen = matchGen;
	setPhase("Kickoff");
	task.spawn(() => {
		ballSpawner.RespawnBall();
		repositionVehicles();
		lockAll();
		for (let i = KICKOFF_COUNTDOWN; i >= 1; i--) {
			if (flowGen !== gen || matchGen !== localMatchGen) {
				return;
			}
			announce(tostring(i));
			task.wait(1);
		}
		if (flowGen !== gen || matchGen !== localMatchGen) {
			return;
		}
		announce("GO!");
		setPhase("Play");
		unlockAll();
		if (!clockStarted) {
			clockStarted = true;
			startClock();
		}
		task.delay(0.8, () => {
			if (flowGen === gen && matchGen === localMatchGen) {
				announce("");
			}
		});
	});
}

function enterWaiting() {
	flowGen += 1;
	setPhase("Waiting");
	announce("Waiting for players...");
	lockAll();
}

function onGoal(defendingTeam: TeamName) {
	const scoringTeam: TeamName = defendingTeam === "Blue" ? "Red" : "Blue";
	scores[scoringTeam] += 1;
	publishScores();
	const gen = ++flowGen;
	const localMatchGen = matchGen;
	setPhase("Goal");
	const hex = scoringTeam === "Blue" ? BLUE_HEX : RED_HEX;
	announce(`<font color="${hex}">${scoringTeam.upper()} TEAM SCORES!</font>`);
	warn(`[Football] GOAL — ${scoringTeam} scores (Blue ${scores.Blue} : ${scores.Red} Red)`);
	task.spawn(() => {
		task.wait(GOAL_PAUSE);
		if (flowGen !== gen || matchGen !== localMatchGen) {
			return;
		}
		announce("");
		if (timeLeft <= 0) {
			endMatch();
		} else if (teamsReady()) {
			startKickoff();
		} else {
			enterWaiting();
		}
	});
}

function startClock() {
	const localMatchGen = matchGen;
	task.spawn(() => {
		while (matchGen === localMatchGen && timeLeft > 0) {
			task.wait(1);
			if (matchGen !== localMatchGen) {
				return;
			}
			if (phase === "Play") {
				timeLeft -= 1;
				setAttr(FootballAttr.TimeLeft, timeLeft);
				if (timeLeft <= 0) {
					endMatch();
				}
			}
		}
	});
}

function endMatch() {
	if (phase === "Ended") {
		return;
	}
	flowGen += 1;
	const localMatchGen = matchGen;
	setPhase("Ended");
	lockAll();
	if (scores.Blue > scores.Red) {
		announce(`<font color="${BLUE_HEX}">BLUE TEAM WINS!</font>`);
	} else if (scores.Red > scores.Blue) {
		announce(`<font color="${RED_HEX}">RED TEAM WINS!</font>`);
	} else {
		announce("TIE GAME!");
	}
	warn(`[Football] match over — Blue ${scores.Blue} : ${scores.Red} Red`);
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

// ---- public API ----------------------------------------------------------

const footballMatch = {
	mapHasGoalParts,

	getScores() {
		return { Blue: scores.Blue, Red: scores.Red };
	},

	/** Kill every running loop and clear replicated state (endRound calls this
	 * before the victory stage; beginMatch calls it defensively). */
	stop() {
		matchGen += 1;
		flowGen += 1;
		if (goalWatcher) {
			goalWatcher.Disconnect();
			goalWatcher = undefined;
		}
		for (const [player] of roster) {
			lockGen.set(player, (lockGen.get(player) ?? 0) + 1);
			hideTimerText(player);
		}
		roster.clear();
		goalParts.clear();
		clockStarted = false;
		endCallback = undefined;
		setPhase("Idle");
		announce("");
	},

	/** Start a fresh match on the freshly loaded map (roundHandler.startRound). */
	beginMatch(map: Instance, onMatchEnd: () => void) {
		footballMatch.stop();
		matchGen += 1;
		endCallback = onMatchEnd;
		scores.Red = 0;
		scores.Blue = 0;
		timeLeft = MATCH_TIME;
		publishScores();
		setAttr(FootballAttr.TimeLeft, timeLeft);
		locateGoals(map);
		enterWaiting();

		const localMatchGen = matchGen;
		goalWatcher = RunService.Heartbeat.Connect(() => {
			if (matchGen !== localMatchGen || phase !== "Play") {
				return;
			}
			const ball = game.Workspace.FindFirstChild(BALL_NAME);
			if (!ball || !ball.IsA("BasePart")) {
				return;
			}
			for (const [team, part] of goalParts) {
				if (part.Parent === undefined) {
					continue;
				}
				if (ballInPart(ball, part)) {
					onGoal(team);
					break;
				}
			}
		});
		warn(`[Football] match ready on ${map.Name} — waiting for one car per team`);
	},

	/** Team spawn point for a player, assigning them to a team on first use.
	 * undefined => caller falls back to the legacy random spawn. */
	getSpawnCFrame(player: Player): CFrame | undefined {
		if (phase === "Idle") {
			return undefined;
		}
		return spawnCFrameFor(assignTeam(player));
	},

	/** Called after SpawnVehicle finished seating the player (SpawnInPlayer).
	 * Applies the phase-appropriate control lock and may start the kickoff. */
	onPlayerSpawned(player: Player) {
		if (phase === "Idle" || phase === "Ended") {
			return;
		}
		assignTeam(player);
		if (phase === "Play") {
			lockPlayer(player, RESPAWN_LOCK);
		} else {
			// Waiting/Kickoff/Goal: hold the lock; the global announce (MatchHud)
			// tells the player why. Kickoff's GO! releases everyone together.
			lockPlayer(player);
		}
		if (phase === "Waiting" && teamsReady()) {
			startKickoff();
		}
	},

	/** Death during a match: auto-respawn at the team spawn after a beat.
	 * Returns false when the caller should use the legacy spectate flow. */
	onPlayerDied(player: Player): boolean {
		if (phase === "Idle" || phase === "Ended" || !roster.has(player)) {
			return false;
		}
		const localMatchGen = matchGen;
		task.spawn(() => {
			task.wait(RESPAWN_DELAY);
			if (matchGen !== localMatchGen || player.Parent === undefined || !roster.has(player)) {
				return;
			}
			if (phase === "Idle" || phase === "Ended") {
				return;
			}
			const [ok, err] = pcall(() => Globals.SpawnInPlayer(player));
			if (!ok) {
				warn(`[Football] respawn of ${player.Name} failed: ${err}`);
			}
		});
		return true;
	},
};

PlayerService.PlayerRemoving.Connect((player) => {
	if (!roster.has(player)) {
		return;
	}
	roster.delete(player);
	lockGen.delete(player);
	if ((phase === "Play" || phase === "Kickoff" || phase === "Goal") && !teamsReady()) {
		warn(`[Football] ${player.Name} left — pausing for players`);
		enterWaiting();
	}
});

export default footballMatch;
