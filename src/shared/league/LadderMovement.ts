import type { LadderPositionMutation, LadderResultSnapshot, TeamSnapshot } from "./LeagueTypes";

/**
 * Stable top-table movement. Each valid result moves at most one table from
 * the team's own round-start position. Voided fixtures never enter results.
 */
export function calculateLadderMovement(teams: TeamSnapshot[], results: LadderResultSnapshot[]): LadderPositionMutation[] {
	const resultByTeam = new Map<string, LadderResultSnapshot>();
	for (const result of results) resultByTeam.set(result.teamId, result);
	const ordered = teams.filter((team) => team.position !== undefined && team.lifecycle !== "Disbanded");
	ordered.sort((a, b) => a.position! < b.position!);
	const key = (team: TeamSnapshot) => {
		const result = resultByTeam.get(team.id);
		const start = result?.startPosition ?? team.position!;
		if (result?.outcome === "Win") return start - 1;
		if (result?.outcome === "Loss") return start + 1;
		if (result?.outcome === "Muck") return start - 1;
		return start;
	};
	ordered.sort((a, b) => {
		const delta = key(a) - key(b);
		return delta !== 0 ? delta < 0 : a.position! < b.position!;
	});
	return ordered.map((team, index) => ({ teamId: team.id, fromPosition: team.position!, toPosition: index }));
}
