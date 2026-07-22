import { validateReconcileInput } from "./LeagueInvariants";
import type {
	AssignmentMutation,
	MatchMutation,
	MatchSnapshot,
	PlayerSnapshot,
	ReconcileInput,
	ReconcilePlan,
	TeamAssignmentSnapshot,
	TeamMutation,
	TeamSnapshot,
} from "./LeagueTypes";

const MAX_TEAM_SIZE = 3;

function cloneTeam(team: TeamSnapshot): TeamSnapshot {
	return { ...team, memberIds: [...team.memberIds] };
}

function teamOrder(a: TeamSnapshot, b: TeamSnapshot): boolean {
	const pa = a.position ?? math.huge;
	const pb = b.position ?? math.huge;
	return pa === pb ? a.creationOrder < b.creationOrder : pa < pb;
}

function eligibleIdle(team: TeamSnapshot): boolean {
	return team.lifecycle === "Queued" || team.lifecycle === "Intermission" || team.lifecycle === "Muckabout";
}

function playerOrder(players: Map<string, PlayerSnapshot>, a: string, b: string): boolean {
	const pa = players.get(a);
	const pb = players.get(b);
	const ao = pa?.joinOrder ?? math.huge;
	const bo = pb?.joinOrder ?? math.huge;
	return ao === bo ? a < b : ao < bo;
}

function nextGeneratedId(used: Set<string>, index: number): string {
	let candidate = `R@${index}`;
	while (used.has(candidate)) {
		index += 1;
		candidate = `R@${index}`;
	}
	used.add(candidate);
	return candidate;
}

function repackAtBoundary(teams: TeamSnapshot[], players: Map<string, PlayerSnapshot>): TeamSnapshot[] {
	const fixed = teams.filter((team) => !eligibleIdle(team) || team.protection === "Protected" || team.origin === "Friends");
	const sources = teams.filter((team) => eligibleIdle(team) && team.protection === "Recombinable" && team.origin === "Random");
	if (sources.size() === 0) return teams.map(cloneTeam);

	const randomMembers: string[] = [];
	for (const source of sources) for (const member of source.memberIds) randomMembers.push(member);
	randomMembers.sort((a, b) => playerOrder(players, a, b));
	if (randomMembers.size() === 0) return fixed.map(cloneTeam);

	let outputCount = math.ceil(randomMembers.size() / MAX_TEAM_SIZE);
	const fixedEligibleCount = fixed.filter(eligibleIdle).size();
	if ((fixedEligibleCount + outputCount) % 2 === 1 && outputCount < randomMembers.size()) outputCount += 1;
	outputCount = math.max(1, outputCount);

	const sizes: number[] = [];
	const small = math.floor(randomMembers.size() / outputCount);
	const largeCount = randomMembers.size() % outputCount;
	for (let i = 0; i < outputCount; i++) sizes.push(small + (i >= outputCount - largeCount ? 1 : 0));

	sources.sort((a, b) => teamOrder(a, b));
	const identities: TeamSnapshot[] = [];
	const usedIds = new Set(teams.map((team) => team.id));
	const worstPosition = sources.reduce((worst, source) => math.max(worst, source.position ?? -1), -1);
	const lastCreationOrder = teams.reduce((latest, team) => math.max(latest, team.creationOrder), 0);
	for (let i = 0; i < outputCount; i++) {
		const existing = sources[i];
		identities.push(
			existing
				? { ...cloneTeam(existing), memberIds: [] }
				: {
						id: nextGeneratedId(usedIds, i + 1),
						name: `Random Team ${i + 1}`,
						origin: "Random",
						protection: "Recombinable",
						nameSource: "Generated",
						memberIds: [],
						openToRandoms: true,
						position: worstPosition + i + 1,
						lifecycle: "Queued",
						revision: 0,
						creationOrder: lastCreationOrder + i + 1,
						waitingSince: 0,
					},
		);
	}

	// Preserve source membership where it fits before distributing overflow.
	const assigned = new Set<string>();
	for (let i = 0; i < identities.size(); i++) {
		const source = sources.find((candidate) => candidate.id === identities[i].id);
		if (!source) continue;
		for (const member of source.memberIds) {
			if (identities[i].memberIds.size() >= sizes[i]) break;
			identities[i].memberIds.push(member);
			assigned.add(member);
		}
	}
	const overflow = randomMembers.filter((member) => !assigned.has(member));
	let overflowIndex = 0;
	for (let i = 0; i < identities.size(); i++) {
		while (identities[i].memberIds.size() < sizes[i]) {
			identities[i].memberIds.push(overflow[overflowIndex++]);
		}
		identities[i].memberIds.sort((a, b) => playerOrder(players, a, b));
		const contributorPositions: number[] = [];
		for (const member of identities[i].memberIds) {
			const source = sources.find((candidate) => candidate.memberIds.includes(member));
			if (source?.position !== undefined) contributorPositions.push(source.position);
		}
		if (contributorPositions.size() > 0) identities[i].position = math.max(...contributorPositions);
		identities[i].revision += 1;
		identities[i].lifecycle = "Queued";
	}
	return [...fixed.map(cloneTeam), ...identities];
}

function assignmentMap(assignments: TeamAssignmentSnapshot[]): Map<string, TeamAssignmentSnapshot> {
	const out = new Map<string, TeamAssignmentSnapshot>();
	for (const assignment of assignments) out.set(assignment.teamId, assignment);
	return out;
}

function makeMutations(before: TeamSnapshot[], after: TeamSnapshot[]): TeamMutation[] {
	const out: TeamMutation[] = [];
	const beforeById = new Map(before.map((team) => [team.id, team]));
	const afterById = new Map(after.map((team) => [team.id, team]));
	for (const source of before) if (!afterById.has(source.id)) out.push({ kind: "DisbandTeam", teamId: source.id });
	for (const target of after) {
		const source = beforeById.get(target.id);
		if (!source) out.push({ kind: "CreateRandomTeam", team: target });
		else if (
			source.lifecycle !== target.lifecycle ||
			source.position !== target.position ||
			source.memberIds.join("|") !== target.memberIds.join("|")
		) out.push({ kind: "UpdateTeam", beforeId: source.id, team: target });
	}
	const oldTeamOf = new Map<string, string>();
	const newTeamOf = new Map<string, string>();
	for (const team of before) for (const playerId of team.memberIds) oldTeamOf.set(playerId, team.id);
	for (const team of after) for (const playerId of team.memberIds) newTeamOf.set(playerId, team.id);
	for (const [playerId, toTeamId] of newTeamOf) {
		const fromTeamId = oldTeamOf.get(playerId);
		if (fromTeamId !== toTeamId) out.push({ kind: "MovePlayer", playerId, fromTeamId, toTeamId });
	}
	return out;
}

export function reconcileLeague(input: ReconcileInput): ReconcilePlan {
	const diagnostics = validateReconcileInput(input).map((violation) => ({ code: violation.code, detail: violation.detail }));
	const players = new Map(input.players.filter((player) => player.connected).map((player) => [player.id, player]));
	let teams = input.teams
		.map(cloneTeam)
		.map((team) => ({ ...team, memberIds: team.memberIds.filter((memberId) => players.has(memberId)) }))
		.filter((team) => team.memberIds.size() > 0 && team.lifecycle !== "Disbanded");

	const oldAssignments = assignmentMap(input.assignments);
	const matchMutations: MatchMutation[] = [];
	const resultsToVoid: string[] = [];
	const reusablePitchIds: string[] = [];
	const keptAssignments: TeamAssignmentSnapshot[] = [];
	const activeTeamIds = new Set<string>();
	for (const match of input.matches) {
		if (match.phase === "Ended" || match.phase === "Voided") continue;
		const blue = teams.find((team) => team.id === match.blueTeamId);
		const red = teams.find((team) => team.id === match.redTeamId);
		if (!blue || !red || blue.memberIds.size() === 0 || red.memberIds.size() === 0) {
			matchMutations.push({ kind: "VoidMatch", matchId: match.id });
			resultsToVoid.push(match.id);
			reusablePitchIds.push(match.pitchId);
			for (const survivor of [blue, red]) if (survivor) survivor.lifecycle = "Queued";
			continue;
		}
		matchMutations.push({ kind: "KeepMatch", matchId: match.id });
		blue.lifecycle = "Active";
		red.lifecycle = "Active";
		activeTeamIds.add(blue.id);
		activeTeamIds.add(red.id);
		keptAssignments.push({ teamId: blue.id, kind: "Match", matchId: match.id, pitchId: match.pitchId, side: "Blue" });
		keptAssignments.push({ teamId: red.id, kind: "Match", matchId: match.id, pitchId: match.pitchId, side: "Red" });
	}

	// Fill live vacancies only from idle, recombinable random teams.
	const donors = teams.filter((team) => eligibleIdle(team) && team.origin === "Random" && team.protection === "Recombinable");
	donors.sort((a, b) => teamOrder(a, b));
	for (const target of teams.filter((team) => activeTeamIds.has(team.id) && team.openToRandoms && team.memberIds.size() < MAX_TEAM_SIZE)) {
		while (target.memberIds.size() < MAX_TEAM_SIZE) {
			const donor = donors.find((candidate) => candidate.memberIds.size() > 0);
			if (!donor) break;
			donor.memberIds.sort((a, b) => playerOrder(players, a, b));
			target.memberIds.push(donor.memberIds.shift()!);
			target.revision += 1;
			donor.revision += 1;
		}
	}
	teams = teams.filter((team) => team.memberIds.size() > 0);

	if (input.roundPhase === "Intermission" || input.roundPhase === "Preparing") {
		teams = repackAtBoundary(teams, players);
	}

	const assignable = teams.filter((team) => !activeTeamIds.has(team.id) && eligibleIdle(team));
	if (input.roundPhase === "Live" && input.timeRemaining <= 0) {
		for (const team of assignable) team.lifecycle = "Queued";
	}
	if (input.roundPhase === "Live") {
		assignable.sort((a, b) => {
			const sizeDelta = a.memberIds.size() - b.memberIds.size();
			if (sizeDelta !== 0) return sizeDelta < 0;
			if (a.waitingSince !== b.waitingSince) return a.waitingSince < b.waitingSince;
			return teamOrder(a, b);
		});
	} else {
		assignable.sort((a, b) => teamOrder(a, b));
	}

	const assignmentMutations: AssignmentMutation[] = [];
	const finalAssignments = [...keptAssignments];
	const createdMatches: MatchSnapshot[] = [];
	if (input.timeRemaining > 0 || input.roundPhase !== "Live") {
		let index = 0;
		while (index + 1 < assignable.size()) {
			const blue = assignable[index];
			const red = assignable[index + 1];
			const matchId = `M@${input.epoch}:${index / 2}`;
			const pitchId = reusablePitchIds.shift() ?? `P@${input.epoch}:${index / 2}`;
			blue.lifecycle = "Reserved";
			red.lifecycle = "Reserved";
			const match: MatchSnapshot = {
				id: matchId,
				generation: 1,
				pitchId,
				blueTeamId: blue.id,
				redTeamId: red.id,
				phase: "Reserved",
				startedAtRoundTime: input.timeRemaining,
				score: { blue: 0, red: 0 },
			};
			createdMatches.push(match);
			matchMutations.push({ kind: "CreateMatch", match });
			finalAssignments.push({ teamId: blue.id, kind: "Match", matchId, pitchId, side: "Blue" });
			finalAssignments.push({ teamId: red.id, kind: "Match", matchId, pitchId, side: "Red" });
			index += 2;
		}
		if (index < assignable.size()) {
			const waiting = assignable[index];
			waiting.lifecycle = "Muckabout";
			finalAssignments.push({ teamId: waiting.id, kind: "Muckabout", arenaId: `MUCK@${input.epoch}` });
		}
	}

	for (const assignment of finalAssignments) {
		if (assignment.kind === "Muckabout") assignmentMutations.push({ kind: "AssignMuckabout", teamId: assignment.teamId, arenaId: assignment.arenaId });
		else if (assignment.kind === "Match") assignmentMutations.push({ kind: "AssignMatch", teamId: assignment.teamId, matchId: assignment.matchId, pitchId: assignment.pitchId, side: assignment.side });
	}
	for (const old of input.assignments) if (!finalAssignments.find((assignment) => assignment.teamId === old.teamId)) assignmentMutations.push({ kind: "Unassign", teamId: old.teamId });

	const pitchOperations: ReconcilePlan["pitchOperations"] = [];
	for (const match of createdMatches) pitchOperations.push({ kind: "PrepareCompetitive", pitchId: match.pitchId, matchId: match.id });
	const muck = finalAssignments.find((assignment) => assignment.kind === "Muckabout");
	if (muck && muck.kind === "Muckabout") pitchOperations.push({ kind: "PrepareMuckabout", arenaId: muck.arenaId });
	const oldArenaIds = new Set<string>();
	for (const assignment of input.assignments) {
		if (assignment.kind === "Muckabout") oldArenaIds.add(assignment.arenaId);
		if (assignment.kind === "Match") oldArenaIds.add(assignment.pitchId);
	}
	const newArenaIds = new Set<string>();
	for (const assignment of finalAssignments) {
		if (assignment.kind === "Muckabout") newArenaIds.add(assignment.arenaId);
		if (assignment.kind === "Match") newArenaIds.add(assignment.pitchId);
	}
	for (const arenaId of oldArenaIds) if (!newArenaIds.has(arenaId)) pitchOperations.push({ kind: "Destroy", arenaId });

	const playerMoves: ReconcilePlan["playerMoves"] = [];
	const oldTeamByPlayer = new Map<string, string>();
	for (const sourceTeam of input.teams) {
		for (const playerId of sourceTeam.memberIds) oldTeamByPlayer.set(playerId, sourceTeam.id);
	}
	for (const assignment of finalAssignments) {
		const team = teams.find((candidate) => candidate.id === assignment.teamId);
		if (!team) continue;
		const newArena = assignment.kind === "Match" ? assignment.pitchId : assignment.kind === "Muckabout" ? assignment.arenaId : undefined;
		if (!newArena) continue;
		for (const playerId of team.memberIds) {
			const old = oldAssignments.get(oldTeamByPlayer.get(playerId) ?? team.id);
			const oldArena = old?.kind === "Match" ? old.pitchId : old?.kind === "Muckabout" ? old.arenaId : undefined;
			if (newArena === oldArena) continue;
			playerMoves.push({
				playerId,
				fromArenaId: oldArena,
				toArenaId: newArena,
				arenaKind: assignment.kind === "Match" ? "Competitive" : "Muckabout",
				matchId: assignment.kind === "Match" ? assignment.matchId : undefined,
				side: assignment.kind === "Match" ? assignment.side : undefined,
			});
		}
	}

	return {
		sourceEpoch: input.epoch,
		teams,
		teamMutations: makeMutations(input.teams, teams),
		matchMutations,
		assignmentMutations,
		playerMoves,
		pitchOperations,
		resultsToVoid,
		diagnostics,
	};
}
