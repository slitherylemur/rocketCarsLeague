import type { MatchSnapshot, ReconcileInput, TeamAssignmentSnapshot, TeamSnapshot } from "./LeagueTypes";

export interface InvariantViolation {
	code: string;
	detail: string;
}

function duplicates(values: string[]): string[] {
	const seen = new Set<string>();
	const duplicate = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) duplicate.add(value);
		seen.add(value);
	}
	return [...duplicate];
}

export function validateLeagueState(
	teams: TeamSnapshot[],
	assignments: TeamAssignmentSnapshot[],
	matches: MatchSnapshot[],
): InvariantViolation[] {
	const out: InvariantViolation[] = [];
	const teamIds = new Set<string>();
	const allMembers: string[] = [];
	for (const team of teams) {
		if (teamIds.has(team.id)) out.push({ code: "DUPLICATE_TEAM", detail: team.id });
		teamIds.add(team.id);
		if (team.memberIds.size() > 3) out.push({ code: "TEAM_TOO_LARGE", detail: `${team.id}:${team.memberIds.size()}` });
		for (const duplicate of duplicates(team.memberIds)) {
			out.push({ code: "DUPLICATE_TEAM_MEMBER", detail: `${team.id}:${duplicate}` });
		}
		for (const memberId of team.memberIds) allMembers.push(memberId);
		if (team.protection === "Protected" && team.origin === "Random" && team.nameSource !== "Custom") {
			out.push({ code: "RANDOM_PROTECTION_WITHOUT_CUSTOM_NAME", detail: team.id });
		}
	}
	for (const duplicate of duplicates(allMembers)) out.push({ code: "PLAYER_IN_MULTIPLE_TEAMS", detail: duplicate });

	const assignmentTeams: string[] = [];
	let muckaboutCount = 0;
	const assignmentByTeam = new Map<string, TeamAssignmentSnapshot>();
	const arenaOwners = new Map<string, string>();
	for (const assignment of assignments) {
		assignmentTeams.push(assignment.teamId);
		assignmentByTeam.set(assignment.teamId, assignment);
		if (assignment.kind === "Muckabout") {
			muckaboutCount += 1;
			const owner = arenaOwners.get(assignment.arenaId);
			if (owner && owner !== "Muckabout") out.push({ code: "ARENA_ASSIGNED_TWICE", detail: assignment.arenaId });
			arenaOwners.set(assignment.arenaId, "Muckabout");
		} else if (assignment.kind === "Match") {
			const owner = arenaOwners.get(assignment.pitchId);
			if (owner && owner !== assignment.matchId) out.push({ code: "ARENA_ASSIGNED_TWICE", detail: assignment.pitchId });
			arenaOwners.set(assignment.pitchId, assignment.matchId);
		}
		if (!teamIds.has(assignment.teamId)) out.push({ code: "UNKNOWN_ASSIGNED_TEAM", detail: assignment.teamId });
	}
	for (const duplicate of duplicates(assignmentTeams)) out.push({ code: "TEAM_ASSIGNED_TWICE", detail: duplicate });
	if (muckaboutCount > 1) out.push({ code: "MULTIPLE_MUCKABOUT_TEAMS", detail: `${muckaboutCount}` });

	const pitchIds = new Set<string>();
	const matchIds = new Set<string>();
	for (const match of matches) {
		if (matchIds.has(match.id)) out.push({ code: "DUPLICATE_MATCH", detail: match.id });
		matchIds.add(match.id);
		if (pitchIds.has(match.pitchId) && match.phase !== "Ended" && match.phase !== "Voided") {
			out.push({ code: "PITCH_HAS_MULTIPLE_MATCHES", detail: match.pitchId });
		}
		if (match.phase !== "Ended" && match.phase !== "Voided") pitchIds.add(match.pitchId);
		if (match.blueTeamId === match.redTeamId) out.push({ code: "MATCH_DUPLICATES_TEAM", detail: match.id });
		for (const [teamId, side] of [
			[match.blueTeamId, "Blue"],
			[match.redTeamId, "Red"],
		] as const) {
			const assignment = assignmentByTeam.get(teamId);
			if (
				match.phase !== "Ended" &&
				match.phase !== "Voided" &&
				(!assignment || assignment.kind !== "Match" || assignment.matchId !== match.id || assignment.side !== side)
			) {
				out.push({ code: "MATCH_ASSIGNMENT_MISMATCH", detail: `${match.id}:${teamId}:${side}` });
			}
		}
	}
	return out;
}

export function validateReconcileInput(input: ReconcileInput): InvariantViolation[] {
	const out = validateLeagueState(input.teams, input.assignments, input.matches);
	const playerIds = new Set(input.players.filter((player) => player.connected).map((player) => player.id));
	for (const team of input.teams) {
		for (const memberId of team.memberIds) {
			if (!playerIds.has(memberId)) out.push({ code: "DISCONNECTED_TEAM_MEMBER", detail: `${team.id}:${memberId}` });
		}
	}
	return out;
}

export function assertLeagueState(
	teams: TeamSnapshot[],
	assignments: TeamAssignmentSnapshot[],
	matches: MatchSnapshot[],
): void {
	const violations = validateLeagueState(teams, assignments, matches);
	if (violations.size() > 0) {
		error(`League invariant failed: ${violations.map((violation) => `${violation.code}(${violation.detail})`).join(", ")}`);
	}
}
