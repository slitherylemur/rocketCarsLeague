/* eslint-disable */
declare const check: (condition: boolean, label: string) => void;

import { validateLeagueState } from "shared/league/LeagueInvariants";
import { reconcileLeague } from "shared/league/LeagueReconciler";
import type {
	MatchSnapshot,
	PlayerSnapshot,
	ReconcileInput,
	TeamAssignmentSnapshot,
	TeamSnapshot,
} from "shared/league/LeagueTypes";

function player(id: string, teamId: string, order: number): PlayerSnapshot {
	return { id, teamId, lifecycle: "Queued", connected: true, joinOrder: order, assignmentGeneration: 0 };
}

function team(
	id: string,
	members: string[],
	position: number,
	options?: Partial<TeamSnapshot>,
): TeamSnapshot {
	return {
		id,
		name: id,
		origin: "Random",
		protection: "Recombinable",
		nameSource: "Generated",
		memberIds: members,
		openToRandoms: true,
		position,
		lifecycle: "Intermission",
		revision: 0,
		creationOrder: position,
		waitingSince: position,
		...options,
	};
}

function input(
	teams: TeamSnapshot[],
	players: PlayerSnapshot[],
	options?: Partial<ReconcileInput>,
): ReconcileInput {
	return {
		epoch: 4,
		reason: "RoundPreparing",
		roundPhase: "Preparing",
		timeRemaining: 210,
		teams,
		players,
		assignments: [],
		matches: [],
		...options,
	};
}

{
	const teams = [team("A", ["p1"], 0), team("B", ["p2", "p3"], 5)];
	const players = [player("p1", "A", 1), player("p2", "B", 2), player("p3", "B", 3)];
	const plan = reconcileLeague(input(teams, players));
	check(plan.teams.size() === 2, "three random players become two teams so everyone can compete");
	check(plan.teams[0].memberIds.size() + plan.teams[1].memberIds.size() === 3, "repack keeps all random players");
	check(plan.assignmentMutations.filter((mutation) => mutation.kind === "AssignMatch").size() === 2, "two outputs enter one match");
}

{
	const players: PlayerSnapshot[] = [];
	const teams: TeamSnapshot[] = [];
	for (let i = 0; i < 7; i++) {
		const id = `p${i}`;
		players.push(player(id, `T${i}`, i));
		teams.push(team(`T${i}`, [id], i));
	}
	const plan = reconcileLeague(input(teams, players));
	check(plan.teams.size() === 4, "seven random players repack into four playable teams");
	check(plan.teams.every((candidate) => candidate.memberIds.size() <= 3), "repack respects maximum team size");
	check(!plan.assignmentMutations.find((mutation) => mutation.kind === "AssignMuckabout"), "seven players all enter competitive pairings");
}

{
	const protectedTeam = team("Friends", ["f1", "f2"], 0, {
		origin: "Friends",
		protection: "Protected",
		lifecycle: "Intermission",
	});
	const random = team("Random", ["r1"], 1);
	const players = [player("f1", "Friends", 1), player("f2", "Friends", 2), player("r1", "Random", 3)];
	const plan = reconcileLeague(input([protectedTeam, random], players));
	const after = plan.teams.find((candidate) => candidate.id === "Friends");
	check(after?.memberIds.join("|") === "f1|f2", "protected friends roster is not repacked");
}

{
	const teams = [team("Only", ["p1"], 0)];
	const plan = reconcileLeague(input(teams, [player("p1", "Only", 1)]));
	check(plan.assignmentMutations.filter((mutation) => mutation.kind === "AssignMuckabout").size() === 1, "one team enters muckabout");
	check(plan.assignmentMutations.filter((mutation) => mutation.kind === "AssignMatch").size() === 0, "one team cannot create a competitive match");
}

{
	const assignments: TeamAssignmentSnapshot[] = [
		{ teamId: "A", kind: "Muckabout", arenaId: "M" },
		{ teamId: "B", kind: "Muckabout", arenaId: "M" },
	];
	const violations = validateLeagueState([team("A", ["p1"], 0), team("B", ["p2"], 1)], assignments, []);
	check(violations.some((violation) => violation.code === "MULTIPLE_MUCKABOUT_TEAMS"), "invariant rejects two muckabout teams");
}

{
	const blue = team("Blue", ["b1"], 0, { lifecycle: "Active" });
	const red = team("Red", ["r1"], 1, { lifecycle: "Active" });
	const donor = team("Donor", ["d1"], 2, { lifecycle: "Queued" });
	const match: MatchSnapshot = {
		id: "M1",
		generation: 1,
		pitchId: "P1",
		blueTeamId: "Blue",
		redTeamId: "Red",
		phase: "Playing",
		startedAtRoundTime: 210,
		score: { blue: 2, red: 1 },
	};
	const assignments: TeamAssignmentSnapshot[] = [
		{ teamId: "Blue", kind: "Match", matchId: "M1", pitchId: "P1", side: "Blue" },
		{ teamId: "Red", kind: "Match", matchId: "M1", pitchId: "P1", side: "Red" },
	];
	const players = [player("b1", "Blue", 1), player("r1", "Red", 2), player("d1", "Donor", 3)];
	const plan = reconcileLeague(input([blue, red, donor], players, { roundPhase: "Live", timeRemaining: 80, matches: [match], assignments }));
	check(plan.teams.find((candidate) => candidate.id === "Blue")?.memberIds.includes("d1") === true, "idle random fills a live open vacancy");
	check(plan.matchMutations.some((mutation) => mutation.kind === "KeepMatch"), "live match remains fixed while filling vacancy");
}

{
	const survivor = team("Blue", ["b1"], 0, { lifecycle: "Active" });
	const gone = team("Red", [], 1, { lifecycle: "Active" });
	const match: MatchSnapshot = {
		id: "Old",
		generation: 1,
		pitchId: "P1",
		blueTeamId: "Blue",
		redTeamId: "Red",
		phase: "Playing",
		startedAtRoundTime: 50,
		score: { blue: 9, red: 0 },
	};
	const assignments: TeamAssignmentSnapshot[] = [
		{ teamId: "Blue", kind: "Match", matchId: "Old", pitchId: "P1", side: "Blue" },
		{ teamId: "Red", kind: "Match", matchId: "Old", pitchId: "P1", side: "Red" },
	];
	const plan = reconcileLeague(input([survivor, gone], [player("b1", "Blue", 1)], { roundPhase: "Live", timeRemaining: 1, matches: [match], assignments }));
	check(plan.resultsToVoid.includes("Old"), "complete opponent loss voids the fixture score");
	check(plan.assignmentMutations.some((mutation) => mutation.kind === "AssignMuckabout" && mutation.teamId === "Blue"), "unmatched survivor moves to neutral muckabout");
}

{
	for (let population = 1; population <= 10; population++) {
		const players: PlayerSnapshot[] = [];
		const teams: TeamSnapshot[] = [];
		for (let i = 0; i < population; i++) {
			const playerId = `population-${population}-${i}`;
			const teamId = `population-team-${population}-${i}`;
			players.push(player(playerId, teamId, i));
			teams.push(team(teamId, [playerId], i));
		}
		const plan = reconcileLeague(input(teams, players));
		const muckCount = plan.assignmentMutations.filter((mutation) => mutation.kind === "AssignMuckabout").size();
		check(muckCount <= 1, `population ${population} never creates a second muckabout team`);
		check(plan.teams.every((candidate) => candidate.memberIds.size() <= 3), `population ${population} respects team cap`);
		check(validateLeagueState(plan.teams, plan.assignmentMutations
			.filter((mutation): mutation is Extract<typeof mutation, { kind: "AssignMuckabout" | "AssignMatch" }> => mutation.kind === "AssignMuckabout" || mutation.kind === "AssignMatch")
			.map((mutation) => mutation.kind === "AssignMuckabout"
				? { teamId: mutation.teamId, kind: "Muckabout" as const, arenaId: mutation.arenaId }
				: { teamId: mutation.teamId, kind: "Match" as const, matchId: mutation.matchId, pitchId: mutation.pitchId, side: mutation.side }),
			plan.matchMutations.filter((mutation): mutation is Extract<typeof mutation, { kind: "CreateMatch" }> => mutation.kind === "CreateMatch").map((mutation) => mutation.match),
		).size() === 0, `population ${population} produces an invariant-safe plan`);
	}
}

{
	const a = team("A", ["a"], 0, { origin: "Friends", protection: "Protected" });
	const b = team("B", ["b"], 1, { origin: "Friends", protection: "Protected" });
	const players = [player("a", "A", 1), player("b", "B", 2)];
	const oneSecond = reconcileLeague(input([a, b], players, { roundPhase: "Live", timeRemaining: 1 }));
	check(oneSecond.matchMutations.some((mutation) => mutation.kind === "CreateMatch"), "one remaining second still permits a late match");
	const zero = reconcileLeague(input([a, b], players, { roundPhase: "Live", timeRemaining: 0 }));
	check(!zero.matchMutations.some((mutation) => mutation.kind === "CreateMatch"), "zero remaining time queues rather than starts a match");
	check(zero.teams.every((candidate) => candidate.lifecycle === "Queued"), "zero-time teams are explicitly queued");
}

{
	const fixed = team("Fixed", ["f"], 0, { origin: "Friends", protection: "Protected" });
	const high = team("High", ["h"], 1);
	const low = team("Low", ["l1", "l2"], 7);
	const players = [player("f", "Fixed", 1), player("h", "High", 2), player("l1", "Low", 3), player("l2", "Low", 4)];
	const plan = reconcileLeague(input([fixed, high, low], players));
	const merged = plan.teams.find((candidate) => candidate.origin === "Random");
	check(merged?.memberIds.size() === 3, "random one and two merge when a protected opponent makes one full team playable");
	check(merged?.position === 7, "merged random identity inherits the worst contributing ladder position");
}

{
	const blue = team("Blue", ["b1"], 0, { lifecycle: "Active" });
	const red = team("Red", ["r1"], 1, { lifecycle: "Active" });
	const donor = team("Donor", ["d1"], 2, { lifecycle: "Muckabout" });
	const match: MatchSnapshot = { id: "Live", generation: 1, pitchId: "P", blueTeamId: "Blue", redTeamId: "Red", phase: "Playing", startedAtRoundTime: 200, score: { blue: 0, red: 0 } };
	const assignments: TeamAssignmentSnapshot[] = [
		{ teamId: "Blue", kind: "Match", matchId: "Live", pitchId: "P", side: "Blue" },
		{ teamId: "Red", kind: "Match", matchId: "Live", pitchId: "P", side: "Red" },
		{ teamId: "Donor", kind: "Muckabout", arenaId: "Muck" },
	];
	const plan = reconcileLeague(input([blue, red, donor], [player("b1", "Blue", 1), player("r1", "Red", 2), player("d1", "Donor", 3)], { roundPhase: "Live", timeRemaining: 30, matches: [match], assignments }));
	check(plan.playerMoves.some((move) => move.playerId === "d1" && move.fromArenaId === "Muck" && move.toArenaId === "P"), "live vacancy plan physically moves only the idle donor player");
}

{
	const teams = [team("A", ["a"], 0), team("B", ["b"], 1), team("C", ["c"], 2)];
	const players = [player("a", "A", 1), player("b", "B", 2), player("c", "C", 3)];
	const first = reconcileLeague(input(teams, players));
	const second = reconcileLeague(input(teams, players));
	check(JSON.stringify(first) === JSON.stringify(second), "identical snapshots reconcile deterministically");
}

{
	const renamed = team("Named", ["n1", "n2"], 0, {
		protection: "Protected",
		nameSource: "Custom",
	});
	const random = team("Random", ["r1"], 1);
	const plan = reconcileLeague(input([renamed, random], [player("n1", "Named", 1), player("n2", "Named", 2), player("r1", "Random", 3)]));
	check(plan.teams.find((candidate) => candidate.id === "Named")?.memberIds.join("|") === "n1|n2", "custom-named random team is protected from repacking");
}

{
	const a = team("A", ["a"], 0, { lifecycle: "Active" });
	const deadA = team("DeadA", [], 1, { lifecycle: "Active" });
	const b = team("B", ["b"], 2, { lifecycle: "Active" });
	const deadB = team("DeadB", [], 3, { lifecycle: "Active" });
	const first: MatchSnapshot = { id: "First", generation: 1, pitchId: "P1", blueTeamId: "A", redTeamId: "DeadA", phase: "Playing", startedAtRoundTime: 20, score: { blue: 4, red: 0 } };
	const second: MatchSnapshot = { id: "Second", generation: 1, pitchId: "P2", blueTeamId: "B", redTeamId: "DeadB", phase: "Playing", startedAtRoundTime: 20, score: { blue: 3, red: 0 } };
	const assignments: TeamAssignmentSnapshot[] = [
		{ teamId: "A", kind: "Match", matchId: "First", pitchId: "P1", side: "Blue" },
		{ teamId: "DeadA", kind: "Match", matchId: "First", pitchId: "P1", side: "Red" },
		{ teamId: "B", kind: "Match", matchId: "Second", pitchId: "P2", side: "Blue" },
		{ teamId: "DeadB", kind: "Match", matchId: "Second", pitchId: "P2", side: "Red" },
	];
	const plan = reconcileLeague(input([a, deadA, b, deadB], [player("a", "A", 1), player("b", "B", 2)], { roundPhase: "Live", timeRemaining: 10, matches: [first, second], assignments }));
	check(plan.resultsToVoid.includes("First") && plan.resultsToVoid.includes("Second"), "simultaneous opponent disbandments void both old scores");
	const fresh = plan.matchMutations.find((mutation) => mutation.kind === "CreateMatch");
	check(fresh !== undefined && fresh.match.blueTeamId !== fresh.match.redTeamId, "two legal survivors receive one fresh fixture");
	check(fresh !== undefined && fresh.match.score.blue === 0 && fresh.match.score.red === 0, "replacement fixture starts at zero-zero");
}
