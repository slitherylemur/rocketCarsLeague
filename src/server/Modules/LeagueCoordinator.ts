import type {
	ArenaKind,
	MatchSide,
	PlayerLifecycle,
	ReconcileReason,
	TeamAssignmentSnapshot,
} from "shared/league/LeagueTypes";
import TeamRegistry from "./TeamRegistry";

const Players = game.GetService("Players");
const RunService = game.GetService("RunService");

export interface LiveTeamAssignment {
	kind: "Muckabout" | "Match";
	arenaId: string;
	matchId?: string;
	side?: MatchSide;
	revision: number;
}

export interface SpawnReservation {
	reservationId: string;
	assignmentGeneration: number;
	arenaId: string;
	arenaKind: ArenaKind;
	matchId?: string;
	side?: MatchSide;
	spawnCFrame: CFrame;
}

export interface TransitionToken {
	leagueEpoch: number;
	assignmentGeneration: number;
	transitionId: string;
}

interface PlayerState {
	lifecycle: PlayerLifecycle;
	generation: number;
	reservationId?: string;
	transitionId?: string;
}

interface DiagnosticCounters {
	reconciliations: number;
	abandonedFixtures: number;
	randomMembershipMoves: number;
	pitchTransitions: number;
	transitionFailures: number;
	staleCallbacksRejected: number;
	spawnReservationsTimedOut: number;
}

const assignments = new Map<string, LiveTeamAssignment>();
const PITCH_MOVE_COVER_ATTR = "CB_PitchMoveCover";
const playerStates = new Map<Player, PlayerState>();
const counters: DiagnosticCounters = {
	reconciliations: 0,
	abandonedFixtures: 0,
	randomMembershipMoves: 0,
	pitchTransitions: 0,
	transitionFailures: 0,
	staleCallbacksRejected: 0,
	spawnReservationsTimedOut: 0,
};
let epoch = 0;
let nextOperation = 1;
let reconciling = false;
const reconcileQueue: Array<{ reason: ReconcileReason; callback: () => void }> = [];
const spawnTimeoutCallbacks: Array<(player: Player, reservation: SpawnReservation) => void> = [];

function stateOf(player: Player): PlayerState {
	let state = playerStates.get(player);
	if (!state) {
		state = { lifecycle: "Menu", generation: 0 };
		playerStates.set(player, state);
	}
	return state;
}

function publish(player: Player, assignment: LiveTeamAssignment | undefined, lifecycle: PlayerLifecycle) {
	const state = stateOf(player);
	state.lifecycle = lifecycle;
	player.SetAttribute("CB_AssignmentGeneration", state.generation);
	player.SetAttribute("CB_ArenaKind", assignment?.kind === "Match" ? "Competitive" : assignment?.kind);
	player.SetAttribute("CB_MatchId", assignment?.matchId);
	player.SetAttribute("CB_PitchId", assignment?.arenaId);
	player.SetAttribute("CB_Side", assignment?.kind === "Match" ? assignment.side : undefined);
}

function publishTeam(teamId: string) {
	const team = TeamRegistry.getTeamById(teamId);
	if (!team) return;
	const assignment = assignments.get(teamId);
	for (const member of team.members) {
		const state = stateOf(member);
		const lifecycle: PlayerLifecycle =
			assignment?.kind === "Match" ? "Competitive" : assignment?.kind === "Muckabout" ? "Muckabout" : state.lifecycle;
		publish(member, assignment, lifecycle);
	}
}

function republishTeamWithNewGeneration(teamId: string, lifecycle: PlayerLifecycle) {
	const team = TeamRegistry.getTeamById(teamId);
	if (!team) return;
	const assignment = assignments.get(teamId);
	for (const member of team.members) {
		const state = stateOf(member);
		state.generation += 1;
		state.reservationId = undefined;
		state.transitionId = undefined;
		member.SetAttribute(PITCH_MOVE_COVER_ATTR, undefined);
		publish(member, assignment, lifecycle);
	}
}

function validateAssignments(context: string) {
	const validationEpoch = epoch;
	task.defer(() => {
		if (epoch !== validationEpoch) return;
		let muckCount = 0;
		const byMatch = new Map<string, LiveTeamAssignment[]>();
		const arenaOwner = new Map<string, string>();
		const failures: string[] = [];
		for (const [teamId, assignment] of assignments) {
			if (!TeamRegistry.getTeamById(teamId)) failures.push(`${teamId}:assigned-after-disband`);
			if (assignment.kind === "Muckabout") {
				muckCount += 1;
				const owner = arenaOwner.get(assignment.arenaId);
				if (owner && owner !== "Muckabout") failures.push(`${assignment.arenaId}:multiple-arena-owners`);
				arenaOwner.set(assignment.arenaId, "Muckabout");
			}
			else {
				const owner = arenaOwner.get(assignment.arenaId);
				if (owner && owner !== assignment.matchId) failures.push(`${assignment.arenaId}:multiple-match-ids`);
				arenaOwner.set(assignment.arenaId, assignment.matchId!);
				const list = byMatch.get(assignment.matchId!) ?? [];
				list.push(assignment);
				byMatch.set(assignment.matchId!, list);
			}
		}
		for (const failure of TeamRegistry.validateInvariants()) failures.push(`team:${failure}`);
		if (muckCount > 1) failures.push(`muckabout=${muckCount}`);
		for (const [matchId, sides] of byMatch) {
			if (sides.size() !== 2) failures.push(`${matchId}:teams=${sides.size()}`);
			else if (sides[0].arenaId !== sides[1].arenaId || sides[0].side === sides[1].side) failures.push(`${matchId}:side/pitch mismatch`);
		}
		if (failures.size() === 0) return;
		const detail = `[League] invariant failed after ${context}: ${failures.join(", ")}`;
		if (RunService.IsStudio()) error(detail);
		warn(detail);
	});
}

function clearTeamAssignments() {
	const affected: string[] = [];
	for (const [teamId] of assignments) affected.push(teamId);
	assignments.clear();
	epoch += 1;
	for (const teamId of affected) publishTeam(teamId);
}

const LeagueCoordinator = {
	getEpoch(): number {
		return epoch;
	},

	getCounters(): Readonly<DiagnosticCounters> {
		return counters;
	},

	getAssignment(teamId: string): LiveTeamAssignment | undefined {
		return assignments.get(teamId);
	},

	getAssignmentForPlayer(player: Player): LiveTeamAssignment | undefined {
		const team = TeamRegistry.getTeamOf(player);
		return team ? assignments.get(team.id) : undefined;
	},

	getMuckaboutTeamId(): string | undefined {
		for (const [teamId, assignment] of assignments) if (assignment.kind === "Muckabout") return teamId;
		return undefined;
	},

	getAssignments(): TeamAssignmentSnapshot[] {
		const out: TeamAssignmentSnapshot[] = [];
		for (const [teamId, assignment] of assignments) {
			if (assignment.kind === "Muckabout") out.push({ teamId, kind: "Muckabout", arenaId: assignment.arenaId });
			else out.push({ teamId, kind: "Match", matchId: assignment.matchId!, pitchId: assignment.arenaId, side: assignment.side! });
		}
		return out;
	},

	beginRound() {
		clearTeamAssignments();
		for (const player of Players.GetPlayers()) {
			const state = stateOf(player);
			state.generation += 1;
			state.reservationId = undefined;
			publish(player, undefined, state.lifecycle === "Leaving" ? "Leaving" : "Intermission");
		}
		warn(`[League] epoch=${epoch} begin-round`);
	},

	stopRound() {
		clearTeamAssignments();
		for (const player of Players.GetPlayers()) {
			const state = stateOf(player);
			state.generation += 1;
			state.reservationId = undefined;
			publish(player, undefined, "Intermission");
		}
	},

	assignMuckabout(teamId: string, arenaId: string): boolean {
		const existing = LeagueCoordinator.getMuckaboutTeamId();
		if (existing !== undefined && existing !== teamId) {
			warn(`[League] invariant rejection: muckabout already owns ${existing}; refused ${teamId}`);
			counters.transitionFailures += 1;
			return false;
		}
		epoch += 1;
		assignments.set(teamId, { kind: "Muckabout", arenaId, revision: epoch });
		const team = TeamRegistry.getTeamById(teamId);
		if (team) TeamRegistry.setLifecycle(team, "Muckabout");
		republishTeamWithNewGeneration(teamId, "Muckabout");
		validateAssignments("assignMuckabout");
		return true;
	},

	assignMatch(blueTeamId: string, redTeamId: string, pitchId: string, matchId?: string): string | undefined {
		if (blueTeamId === redTeamId) return undefined;
		const actualMatchId = matchId ?? `Match-${epoch + 1}-${nextOperation++}`;
		epoch += 1;
		assignments.set(blueTeamId, { kind: "Match", arenaId: pitchId, matchId: actualMatchId, side: "Blue", revision: epoch });
		assignments.set(redTeamId, { kind: "Match", arenaId: pitchId, matchId: actualMatchId, side: "Red", revision: epoch });
		for (const teamId of [blueTeamId, redTeamId]) {
			const team = TeamRegistry.getTeamById(teamId);
			if (team) TeamRegistry.setLifecycle(team, "Reserved");
			republishTeamWithNewGeneration(teamId, "Transitioning");
		}
		validateAssignments("assignMatch");
		return actualMatchId;
	},

	unassignTeam(teamId: string, partOfLargerTransaction = false) {
		if (!assignments.delete(teamId)) return;
		epoch += 1;
		const team = TeamRegistry.getTeamById(teamId);
		if (team) TeamRegistry.setLifecycle(team, "Queued");
		republishTeamWithNewGeneration(teamId, "Queued");
		if (!partOfLargerTransaction) validateAssignments("unassignTeam");
	},

	markMatchActive(teamIds: string[]) {
		for (const teamId of teamIds) {
			const team = TeamRegistry.getTeamById(teamId);
			if (team) TeamRegistry.setLifecycle(team, "Active");
		}
	},

	markMatchAbandoned() {
		counters.abandonedFixtures += 1;
	},

	beginTransition(player: Player): TransitionToken {
		const state = stateOf(player);
		state.generation += 1;
		state.lifecycle = "Transitioning";
		state.reservationId = undefined;
		counters.pitchTransitions += 1;
		publish(player, LeagueCoordinator.getAssignmentForPlayer(player), "Transitioning");
		const token: TransitionToken = {
			leagueEpoch: epoch,
			assignmentGeneration: state.generation,
			transitionId: `Transition-${player.UserId}-${nextOperation++}`,
		};
		state.transitionId = token.transitionId;
		return token;
	},

	isCurrent(player: Player, token: TransitionToken): boolean {
		// The league epoch is diagnostic context. An unrelated pitch assignment
		// may advance it; this player's generation is the cancellation authority.
		const state = stateOf(player);
		const current = state.generation === token.assignmentGeneration && state.transitionId === token.transitionId;
		if (!current) counters.staleCallbacksRejected += 1;
		return current;
	},

	completeTransition(player: Player, token: TransitionToken): boolean {
		if (!LeagueCoordinator.isCurrent(player, token)) return false;
		const state = stateOf(player);
		state.transitionId = undefined;
		const assignment = LeagueCoordinator.getAssignmentForPlayer(player);
		publish(player, assignment, assignment?.kind === "Match" ? "Competitive" : assignment ? "Muckabout" : "Queued");
		if (player.GetAttribute(PITCH_MOVE_COVER_ATTR) === token.transitionId) {
			player.SetAttribute(PITCH_MOVE_COVER_ATTR, undefined);
		}
		return true;
	},

	reserveSpawn(player: Player, spawnCFrame: CFrame): SpawnReservation | undefined {
		const assignment = LeagueCoordinator.getAssignmentForPlayer(player);
		if (!assignment) return undefined;
		const state = stateOf(player);
		state.generation += 1;
		state.lifecycle = "Spawning";
		state.transitionId = undefined;
		player.SetAttribute(PITCH_MOVE_COVER_ATTR, undefined);
		const reservationId = `Spawn-${player.UserId}-${state.generation}-${nextOperation++}`;
		state.reservationId = reservationId;
		publish(player, assignment, "Spawning");
		const reservation: SpawnReservation = {
			reservationId,
			assignmentGeneration: state.generation,
			arenaId: assignment.arenaId,
			arenaKind: assignment.kind === "Match" ? "Competitive" : "Muckabout",
			matchId: assignment.matchId,
			side: assignment.side,
			spawnCFrame,
		};
		task.delay(20, () => {
			const current = playerStates.get(player);
			if (!current || current.reservationId !== reservationId) return;
			current.generation += 1;
			current.reservationId = undefined;
			counters.spawnReservationsTimedOut += 1;
			publish(player, LeagueCoordinator.getAssignmentForPlayer(player), "Queued");
			warn(`[League] spawn reservation timed out player=${player.UserId} reservation=${reservationId}`);
			for (const callback of spawnTimeoutCallbacks) task.defer(() => callback(player, reservation));
		});
		return reservation;
	},

	onSpawnReservationTimedOut(callback: (player: Player, reservation: SpawnReservation) => void) {
		spawnTimeoutCallbacks.push(callback);
	},

	confirmSpawn(player: Player, reservationId: string): boolean {
		const state = stateOf(player);
		if (state.reservationId !== reservationId) {
			counters.staleCallbacksRejected += 1;
			return false;
		}
		state.reservationId = undefined;
		const assignment = LeagueCoordinator.getAssignmentForPlayer(player);
		publish(player, assignment, assignment?.kind === "Match" ? "Competitive" : "Muckabout");
		return assignment !== undefined;
	},

	reservationTargetsCurrentAssignment(player: Player, reservation: SpawnReservation): boolean {
		const assignment = LeagueCoordinator.getAssignmentForPlayer(player);
		if (!assignment || assignment.arenaId !== reservation.arenaId) return false;
		if (reservation.arenaKind === "Muckabout") return assignment.kind === "Muckabout";
		return assignment.kind === "Match" && assignment.matchId === reservation.matchId && assignment.side === reservation.side;
	},

	failSpawn(player: Player, reservationId?: string): boolean {
		const state = stateOf(player);
		if (reservationId !== undefined && state.reservationId !== reservationId) {
			counters.staleCallbacksRejected += 1;
			return false;
		}
		state.generation += 1;
		state.reservationId = undefined;
		state.transitionId = undefined;
		player.SetAttribute(PITCH_MOVE_COVER_ATTR, undefined);
		counters.transitionFailures += 1;
		publish(player, LeagueCoordinator.getAssignmentForPlayer(player), "Queued");
		return true;
	},

	invalidatePlayer(player: Player, lifecycle: PlayerLifecycle) {
		const state = stateOf(player);
		state.generation += 1;
		state.reservationId = undefined;
		state.transitionId = undefined;
		player.SetAttribute(PITCH_MOVE_COVER_ATTR, undefined);
		publish(player, lifecycle === "Leaving" ? undefined : LeagueCoordinator.getAssignmentForPlayer(player), lifecycle);
	},

	requestReconcile(reason: ReconcileReason, reconcile: () => void) {
		reconcileQueue.push({ reason, callback: reconcile });
		if (reconciling) {
			return;
		}
		reconciling = true;
		while (reconcileQueue.size() > 0) {
			const request = reconcileQueue.shift()!;
			counters.reconciliations += 1;
			const [ok, failure] = pcall(request.callback);
			if (!ok) {
				counters.transitionFailures += 1;
				warn(`[League] reconcile reason=${request.reason} epoch=${epoch} failed: ${failure}`);
			}
		}
		reconciling = false;
	},
};

Players.PlayerAdded.Connect((player) => {
	stateOf(player);
	player.SetAttribute("CB_AssignmentGeneration", 0);
});
for (const player of Players.GetPlayers()) stateOf(player);

Players.PlayerRemoving.Connect((player) => {
	const previousTeam = TeamRegistry.getTeamOf(player);
	LeagueCoordinator.invalidatePlayer(player, "Leaving");
	TeamRegistry.onPlayerRemoved(player);
	if (previousTeam && !TeamRegistry.teamExists(previousTeam)) LeagueCoordinator.unassignTeam(previousTeam.id, true);
	playerStates.delete(player);
});

if (RunService.IsStudio()) {
	task.spawn(() => {
		while (true) {
			task.wait(30);
			warn(
				`[League] diagnostics epoch=${epoch} reconciles=${counters.reconciliations} abandoned=${counters.abandonedFixtures} transitions=${counters.pitchTransitions} failures=${counters.transitionFailures} stale=${counters.staleCallbacksRejected}`,
			);
		}
	});
}

export default LeagueCoordinator;
