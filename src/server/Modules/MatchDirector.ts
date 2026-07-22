// MatchDirector (Top Table Phase 4 core): ladder movement between rounds and
// the one-minute shop phase that auto-spawns everyone into the next round.
// The visual interlude (victory cameras, ladder map UI, rewards panel, coin
// flip animation) layers on top of this in Phase 4b.

import TeamRegistry from "./TeamRegistry";
import { Globals } from "../Globals";
import UiState from "../ui/UiState";
import type { RoundResult } from "./footballMatch";

const Players = game.GetService("Players");
const Workspace = game.GetService("Workspace");

const SHOP_TIME = 60;
/** Rounds per session (Phase 5): after this many, champions + shuffle. */
export const SESSION_ROUNDS = 6;

let roundNumber = 0;
let shopGen = 0;

/** One team's ladder movement this round — feeds the LadderMap screen. */
export interface MovementEntry {
	teamId: string;
	name: string;
	color: Color3;
	fromPosition: number;
	toPosition: number;
	outcome: "win" | "loss" | "draw" | "muck" | "idle";
	/** True for the team that sits out on the muckabout pitch NEXT round. */
	nextMuckabout: boolean;
}

export interface MovementReport {
	entries: MovementEntry[];
	/** pitchIndex → teamId that won that drawn pitch's coin flip. */
	flipWinners: Map<number, string>;
}

/** True only for a car spawned INTO THE MATCH (parented under
 * Workspace.Vehicles). The garage/menu display car ALSO occupies
 * Globals.vehiclesTable (SpawnVehicle registers every spawn, clientSided
 * included) — treating it as "already driving" was FAILURE 3's root cause:
 * the shop-phase menu remount gives everyone a display car, which hid the
 * countdown for all players and left the auto-spawn list empty, so no one
 * ever entered the rebuilt round. */
function hasMatchVehicle(player: Player): boolean {
	const vehicle = Globals.vehiclesTable[player.UserId];
	const model = vehicle && vehicle.model;
	if (!model || model.Parent === undefined) {
		return false;
	}
	const vehiclesFolder = game.Workspace.FindFirstChild("Vehicles");
	return vehiclesFolder !== undefined && model.IsDescendantOf(vehiclesFolder);
}

/** True while the player is on the landing page or in the Friends Team mini
 * lobby — deliberately outside the play loop, so the shop-phase countdown and
 * auto-spawn must not touch them (design rule: the auto start only ever moves
 * players who are in the shop because they played). EXCEPTION: a lobby whose
 * vote completed while no round was spawnable is "STARTING SOON" — its
 * members carry CB_PendingLaunch and ride the countdown + auto start. */
function isInMenuFlow(player: Player): boolean {
	if (player.GetAttribute("CB_PendingLaunch") === true) {
		return false;
	}
	// Phase 4: Landing/CreateTeam are CLIENT-owned — their Enabled no longer
	// exists server-side. CB_FlowState (UiState.setFlowState) is the server's
	// own record of the same fact: "menu" = landing page, "lobby" = Friends
	// Team mini lobby. "garage" is deliberately NOT exempt — a player on the
	// shop-phase CARS page is in the shop BECAUSE they played, exactly the
	// audience the countdown/auto-spawn is for (matches the old check, which
	// only looked at the Landing/CreateTeam screens).
	const state = player.GetAttribute("CB_FlowState");
	return state === "menu" || state === "lobby";
}

const MatchDirector = {
	getRoundNumber(): number {
		return roundNumber;
	},

	/**
	 * Classic top table via sort keys: winners move one whole table up,
	 * losers move one whole table down, and the muckabout team moves up onto
	 * the lowest real table. Equal keys retain the previous ladder order,
	 * pairing arrivals from adjacent tables. Thus opponents do not immediately
	 * replay on the same pitch; only the top winner and bottom loser stay at a
	 * boundary. Draws are coin-flipped and anyone unseen sorts to the bottom.
	 */
	applyMovement(results: RoundResult[]): MovementReport {
		roundNumber += 1;

		// Coin flip: within each drawn pitch, randomly promote one team.
		const flipWinners = new Map<number, string>();
		const drawsByPitch = new Map<number, RoundResult[]>();
		for (const result of results) {
			if (result.outcome === "draw") {
				const list = drawsByPitch.get(result.pitchIndex) ?? [];
				list.push(result);
				drawsByPitch.set(result.pitchIndex, list);
			}
		}
		for (const [pitchIndex, drawn] of drawsByPitch) {
			if (drawn.size() >= 2) {
				const winnerIndex = math.random(1, drawn.size()) - 1;
				for (let i = 0; i < drawn.size(); i++) {
					drawn[i].outcome = i === winnerIndex ? "win" : "loss";
				}
				flipWinners.set(pitchIndex, drawn[winnerIndex].teamId);
				warn(`[Director] coin flip on pitch ${drawn[0].pitchIndex}: ${drawn[winnerIndex].teamId} moves up`);
			}
		}

		// Post-flip outcome per team (draw only survives a 1-team drawn pitch).
		const outcomeById = new Map<string, MovementEntry["outcome"]>();
		for (const result of results) {
			outcomeById.set(result.teamId, result.outcome);
		}

		const keys = new Map<string, number>();
		for (const result of results) {
			const delta =
				result.outcome === "win" || result.outcome === "muck" ? -1 : result.outcome === "loss" ? 1 : 0;
			keys.set(result.teamId, result.pitchIndex + delta);
		}

		const teams = TeamRegistry.getTeams(); // sorted by previous position
		const fromPositions = new Map<string, number>();
		for (const team of teams) {
			fromPositions.set(team.id, team.position);
		}
		teams.sort((a, b) => {
			const keyA = keys.get(a.id) ?? math.huge;
			const keyB = keys.get(b.id) ?? math.huge;
			if (keyA === keyB) {
				return a.position < b.position; // stable on previous position
			}
			return keyA < keyB;
		});

		// Anti-repeat muckabout: with an odd count the bottom team sits out —
		// never twice in a row while a swap is possible.
		if (teams.size() % 2 === 1 && teams.size() >= 3) {
			const bottom = teams[teams.size() - 1];
			if (bottom.lastMuckRound === roundNumber - 1) {
				teams[teams.size() - 1] = teams[teams.size() - 2];
				teams[teams.size() - 2] = bottom;
			}
			teams[teams.size() - 1].lastMuckRound = roundNumber;
		}

		for (let i = 0; i < teams.size(); i++) {
			teams[i].position = i;
		}
		TeamRegistry.updateLeaderboardNames();
		for (const team of teams) {
			warn(`[Director] table ${team.position + 1}: ${team.name}`);
		}

		// Movement payload for the LadderMap screen (Phase 4b).
		const muckaboutIndex = teams.size() % 2 === 1 && teams.size() >= 3 ? teams.size() - 1 : -1;
		const entries: MovementEntry[] = [];
		for (let i = 0; i < teams.size(); i++) {
			const team = teams[i];
			entries.push({
				teamId: team.id,
				name: team.name,
				color: team.robloxTeam.TeamColor.Color,
				fromPosition: fromPositions.get(team.id) ?? team.position,
				toPosition: team.position,
				outcome: outcomeById.get(team.id) ?? "idle",
				nextMuckabout: i === muckaboutIndex,
			});
		}
		return { entries, flipWinners };
	},

	/** True once applyMovement for the session's last round has run. */
	isSessionEnd(): boolean {
		return roundNumber >= SESSION_ROUNDS;
	},

	/**
	 * Session over (Phase 5): Fisher-Yates shuffle the ladder, reset the
	 * session leaderstats and the round counter. The champions screen + payout
	 * happen in roundHandler BEFORE this (it reads the pre-shuffle position 0).
	 */
	endSession() {
		const teams = TeamRegistry.getTeams();
		for (let i = teams.size() - 1; i >= 1; i--) {
			const j = math.random(1, i + 1) - 1;
			const swap = teams[i];
			teams[i] = teams[j];
			teams[j] = swap;
		}
		for (let i = 0; i < teams.size(); i++) {
			teams[i].position = i;
			teams[i].lastMuckRound = undefined;
		}
		TeamRegistry.updateLeaderboardNames();
		for (const player of Players.GetPlayers()) {
			pcall(() => {
				const stats = player.FindFirstChild("leaderstats");
				const goals = stats && stats.FindFirstChild("Goals");
				if (goals && goals.IsA("IntValue")) {
					goals.Value = 0;
				}
				const kills = stats && stats.FindFirstChild("Kills");
				if (kills && kills.IsA("IntValue")) {
					kills.Value = 0;
				}
			});
		}
		roundNumber = 0;
		warn(`[Director] session over — ladder shuffled (${teams.size()} team(s)), session stats reset`);
	},

	/** 60 s (or `seconds`) in the menu/shop,
	 * countdown on every screen, then everyone with a team auto-spawns into
	 * the (already rebuilt) round. */
	startShopPhase(seconds?: number) {
		const duration = seconds ?? SHOP_TIME;
		const gen = ++shopGen;
		Globals.shopPhaseActive = true;
		// The "NEXT ROUND Ns" countdown label is rendered CLIENT-side
		// (src/client/ui/timer.client.ts) from these two attributes — including
		// the who-sees-it rules (menu-flow and in-match players are exempt, see
		// isInMenuFlow/hasMatchVehicle; the client mirrors both from replicated
		// state). The server no longer touches TimerGui instances.
		UiState.setReplicatedAttr("CB_ShopPhase", true);
		UiState.setReplicatedAttr("CB_ShopEndsAt", Workspace.GetServerTimeNow() + duration);
		warn(`[Director] shop phase started (${duration}s)`);
		task.spawn(() => {
			// Per-second ticks (rather than one long wait) so cancelShopPhase
			// still takes effect promptly — same cadence as the old UI loop.
			for (let i = duration; i >= 1; i--) {
				if (shopGen !== gen) {
					return;
				}
				task.wait(1);
			}
			if (shopGen !== gen) {
				return;
			}
			Globals.shopPhaseActive = false;
			UiState.setReplicatedAttr("CB_ShopPhase", false);
			const toSpawn: Player[] = [];
			for (const player of Players.GetPlayers()) {
				if (TeamRegistry.getTeamOf(player) && !hasMatchVehicle(player) && !isInMenuFlow(player)) {
					toSpawn.push(player);
				}
			}
			warn(`[Director] shop over — auto-spawning ${toSpawn.size()} player(s)`);
			for (const player of toSpawn) {
				task.spawn(() => {
					const [ok, result] = pcall(() => Globals.SpawnInPlayer(player));
					if (!ok || result !== true) {
						warn(
							`[Director] auto-spawn of ${player.Name} failed (ok=${ok} result=${tostring(result)}) — returning to menu`,
						);
						// The menu remount also destroys any character that
						// SpawnInPlayer's LoadCharacter left standing at the
						// world origin (ResetAndInitialisePlayerMenuUI).
						pcall(() => {
							(
								game.GetService("ServerStorage") as unknown as {
									Events: { InitialisePlayerMenuUi: BindableEvent };
								}
							).Events.InitialisePlayerMenuUi.Fire(player);
						});
					}
				});
			}
		});
	},

	cancelShopPhase() {
		shopGen += 1;
		// Stop the client-side countdown too (Globals.shopPhaseActive is left
		// as-is, matching the original cancel semantics).
		UiState.setReplicatedAttr("CB_ShopPhase", false);
	},
};

export default MatchDirector;
