// Ladder team registry (TOP_TABLE design §4 — Phase 1).
//
// Source of truth for player-formed teams: membership, open/locked flag,
// ladder position, the dynamically created Roblox Team instance (default
// player-list grouping) and team naming/renaming. Session-scoped — nothing
// persists to DataStore.
//
// Pitch SIDES (Red/Blue dressing per match) are NOT stored here — they are
// per-round assignments owned by the match layer (footballMatch/PitchMatch),
// per resolved decision D1.

import { ProductIds } from "shared/Monetization";
import type { TeamLifecycle, TeamNameSource, TeamOrigin, TeamProtection } from "shared/league/LeagueTypes";

const Players = game.GetService("Players");
const TeamsService = game.GetService("Teams");
const TextService = game.GetService("TextService");
const HttpService = game.GetService("HttpService");

/** Developer product for renaming a team (repeatable). PLACEHOLDER — create
 * the product in the Roblox dashboard and paste its id here (Phase 2 wires
 * the purchase prompt + popup). */
export const RENAME_PRODUCT_ID: number = ProductIds.RenameTeam;

export const MAX_TEAM_MEMBERS = 3;

// Preset pool (resolved decision D3): names are drawn from here; "Team N"
// when exhausted. The rename product lets teams pick a custom (filtered) name.
const NAME_POOL = [
	"Gearchester United",
	"Gearchester City",
	"Liverfuel",
	"Car-senal",
	"Chelsea Chassis",
	"Aston Motor Villa",
	"Crystal Pistons",
	"Newcastle Turbo",
	"Brighton Road Runners",
	"Wolverhampton Wheelers",
	"Nottingham Torque",
	"Real Motorid",
	"Barcarona",
	"Atlético Motorid",
	"Sevilla Speed",
	"Valencia Velocity",
	"Inter Mileage",
	"AC Mileage",
	"Nitro Napoli",
	"Turbo Juventus",
	"Bayern Motorworks",
	"Borussia Driftmund",
	"Paris Saint Gearmain",
	"Auto Ajax",
	"Turbo Porto",
	"Celtic Cruisers",
	"Road Rangers",
	"LA Garage",
	"Boca Cruisers",
	"River Racers",
];

// Distinct player-list colors. White is reserved for the muckabout dressing;
// pure reds/blues are avoided so ladder identity never reads as a pitch side.
const COLOR_POOL = [
	"Bright yellow",
	"Bright orange",
	"Bright violet",
	"Bright green",
	"Cyan",
	"Magenta",
	"Lime green",
	"Deep orange",
	"Teal",
	"Hot pink",
	"Storm blue",
	"Camo",
];

export interface LadderTeam {
	id: string;
	name: string;
	robloxTeam: Team;
	colorName: string;
	members: Player[];
	origin: TeamOrigin;
	protection: TeamProtection;
	nameSource: TeamNameSource;
	openToRandoms: boolean;
	/** Ladder position, 0 = gold. Compacted at reseat (MatchDirector, Phase 4). */
	position?: number;
	lastMuckRound?: number;
	lifecycle: TeamLifecycle;
	revision: number;
	creationOrder: number;
}

const teams = new Map<string, LadderTeam>();
const teamOfPlayer = new Map<Player, LadderTeam>();
const renameCredits = new Map<Player, number>();
const playerJoinOrder = new Map<Player, number>();
let nextPlayerJoinOrder = 1;
let nextTeamNumber = 1;

// Runtime remotes folder (nothing place-file-side): SubmitTeamName carries the
// rename popup's typed text (player-typed TextBox.Text never replicates).
// (PromptGameInvite was removed in Phase 8 — the client-owned team page calls
// SocialService.PromptGameInvite directly since Phase 4.)
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const carBallFolder = new Instance("Folder");
carBallFolder.Name = "CarBall";
const submitTeamNameRemote = new Instance("RemoteEvent");
submitTeamNameRemote.Name = "SubmitTeamName";
submitTeamNameRemote.Parent = carBallFolder;
carBallFolder.Parent = ReplicatedStorage;

export const CarBallRemotes = {
	SubmitTeamName: submitTeamNameRemote,
};

function usedValues(field: "name" | "colorName"): Set<string> {
	const used = new Set<string>();
	for (const [, team] of teams) {
		used.add(field === "name" ? team.name : team.colorName);
	}
	return used;
}

function pickName(): string {
	const used = usedValues("name");
	const free = NAME_POOL.filter((n) => !used.has(n));
	if (free.size() > 0) {
		return free[math.random(1, free.size()) - 1];
	}
	return `Team ${nextTeamNumber}`;
}

function pickColor(): string {
	const used = usedValues("colorName");
	const free = COLOR_POOL.filter((c) => !used.has(c));
	if (free.size() > 0) {
		return free[math.random(1, free.size()) - 1];
	}
	return COLOR_POOL[math.random(1, COLOR_POOL.size()) - 1];
}

/** In-play teams only — lobby teams are invisible to ladder parity. */
function teamCount(): number {
	let count = 0;
	for (const [, team] of teams) {
		if (team.position !== undefined && team.lifecycle !== "Forming" && team.lifecycle !== "Disbanded") {
			count += 1;
		}
	}
	return count;
}

function nextPosition(): number {
	let highest = -1;
	for (const [, team] of teams) {
		if (team.position !== undefined && team.lifecycle !== "Forming" && team.lifecycle !== "Disbanded") {
			highest = math.max(highest, team.position);
		}
	}
	return highest + 1;
}

// ---- published team state (client-side UI migration, Phase 4) -------------
// The client menu router renders the Friends Team lobby FROM replicated state:
// attributes on the ladder team's Roblox Team instance (which replicates to
// every client). Republished at every mutation point. CB_Pending (pending
// shop-window launch) is written by initializePlayer at the pendingLaunchTeams
// mutation sites — publishTeamAttrs only seeds its default.
function publishTeamAttrs(team: LadderTeam) {
	pcall(() => {
		const robloxTeam = team.robloxTeam;
		robloxTeam.SetAttribute("CB_TeamId", team.id);
		// The UNPREFIXED name — robloxTeam.Name carries the "rank · name" ladder
		// prefix for in-play teams (updateLeaderboardNames).
		robloxTeam.SetAttribute("CB_TeamName", team.name);
		robloxTeam.SetAttribute("CB_Open", team.openToRandoms);
		robloxTeam.SetAttribute("CB_InPlay", team.lifecycle !== "Forming" && team.lifecycle !== "Disbanded");
		robloxTeam.SetAttribute("CB_TeamOrigin", team.origin);
		robloxTeam.SetAttribute("CB_TeamProtected", team.protection === "Protected");
		robloxTeam.SetAttribute("CB_TeamLifecycle", team.lifecycle);
		robloxTeam.SetAttribute("CB_TeamRevision", team.revision);
		if (robloxTeam.GetAttribute("CB_Pending") === undefined) {
			robloxTeam.SetAttribute("CB_Pending", false);
		}
		// Member order matters to the lobby render (index 0 = creator = crown);
		// player.Team alone can't express it.
		robloxTeam.SetAttribute(
			"CB_Members",
			HttpService.JSONEncode(team.members.map((member) => member.UserId)),
		);
		for (const member of team.members) {
			member.SetAttribute("CB_TeamOrigin", team.origin);
			member.SetAttribute("CB_TeamProtected", team.protection === "Protected");
		}
	});
}

function setPlayerTeam(player: Player, team: LadderTeam | undefined) {
	pcall(() => {
		if (team) {
			player.Team = team.robloxTeam;
			player.Neutral = false;
		} else {
			player.Team = undefined!;
			player.Neutral = true;
		}
	});
	player.SetAttribute("CB_TeamId", team ? team.id : undefined);
	player.SetAttribute("CB_TeamOrigin", team ? team.origin : undefined);
	player.SetAttribute("CB_TeamProtected", team ? team.protection === "Protected" : undefined);
}

// Disband listeners (footballMatch rebalances the abandoned pitch; menu code
// clears lobby vote state). Fired AFTER the registry forgets the team.
const disbandCallbacks: Array<(team: LadderTeam) => void> = [];
const changedCallbacks: Array<(team: LadderTeam, reason: string) => void> = [];

function changed(team: LadderTeam, reason: string) {
	team.revision += 1;
	publishTeamAttrs(team);
	for (const callback of changedCallbacks) task.defer(() => callback(team, reason));
}

function disband(team: LadderTeam) {
	team.lifecycle = "Disbanded";
	team.revision += 1;
	teams.delete(team.id);
	pcall(() => team.robloxTeam.Destroy());
	warn(`[TeamRegistry] disbanded ${team.name}`);
	for (const callback of disbandCallbacks) {
		task.spawn(() => callback(team));
	}
}

// ---- leaderstats (default player-list columns: Goals, Kills) --------------

function ensureLeaderstats(player: Player) {
	if (player.FindFirstChild("leaderstats")) {
		return;
	}
	const stats = new Instance("Folder");
	stats.Name = "leaderstats";
	const goals = new Instance("IntValue");
	goals.Name = "Goals";
	goals.Parent = stats;
	const kills = new Instance("IntValue");
	kills.Name = "Kills";
	kills.Parent = stats;
	stats.Parent = player;

	// Mirror the existing kills NumberValue (createValues in initializePlayer)
	// into the visible column. Session-cumulative; reset by MatchDirector at
	// the 6-round shuffle (Phase 5).
	task.spawn(() => {
		const killsValue = player.WaitForChild("kills", 30);
		if (killsValue && killsValue.IsA("NumberValue")) {
			killsValue.Changed.Connect((value) => {
				// Round stat resets (startRound zeroes kills) must not wipe the
				// session column — only mirror increases.
				if (value > kills.Value) {
					kills.Value = value;
				}
			});
		}
	});
}

// ---- public API -----------------------------------------------------------

const TeamRegistry = {
	getTeamOf(player: Player): LadderTeam | undefined {
		return teamOfPlayer.get(player);
	},

	/** Register a callback for when a team's last member leaves and the team
	 * evaporates. Runs via task.spawn after the registry state is updated. */
	onTeamDisbanded(callback: (team: LadderTeam) => void) {
		disbandCallbacks.push(callback);
	},

	onTeamChanged(callback: (team: LadderTeam, reason: string) => void) {
		changedCallbacks.push(callback);
	},

	/** True while the team is still registered (an invite may hold a stale
	 * reference after the team disbanded). */
	teamExists(team: LadderTeam): boolean {
		return teams.has(team.id);
	},

	/** THE LADDER: in-play teams sorted by position. Lobby teams (still
	 * forming have no ladder position, no pitch, and no rank until markQueued
	 * seats them — resolve those via getTeamById. */
	getTeams(): LadderTeam[] {
		const list: LadderTeam[] = [];
		for (const [, team] of teams) {
			if (team.position !== undefined && team.lifecycle !== "Forming" && team.lifecycle !== "Disbanded") {
				list.push(team);
			}
		}
		list.sort((a, b) =>
			a.position === b.position ? a.creationOrder < b.creationOrder : a.position! < b.position!,
		);
		return list;
	},

	getTeamById(id: string): LadderTeam | undefined {
		return teams.get(id);
	},

	validateInvariants(): string[] {
		const failures: string[] = [];
		const seenMembers = new Set<Player>();
		for (const [, team] of teams) {
			if (team.members.size() > MAX_TEAM_MEMBERS) failures.push(`${team.id}:members=${team.members.size()}`);
			if (team.origin === "Random" && team.protection === "Protected" && team.nameSource !== "Custom") {
				failures.push(`${team.id}:protected-without-custom-name`);
			}
			for (const member of team.members) {
				if (seenMembers.has(member)) failures.push(`${member.UserId}:duplicate-membership`);
				seenMembers.add(member);
				if (teamOfPlayer.get(member) !== team) failures.push(`${member.UserId}:membership-index-mismatch`);
			}
		}
		return failures;
	},

	/**
	 * The lobby → ladder transition: called when the team's first member
	 * spawns into a match. Seats the team on the ladder (overflow insertion
	 * above Mud when applicable — the same rule new teams always used) and
	 * flips inPlay, which permanently closes the team to invites.
	 */
	markQueued(team: LadderTeam) {
		if (team.lifecycle !== "Forming" || !teams.has(team.id)) {
			return;
		}
		// New identities always enter at the bottom. Physical pitch layout is a
		// projection of the final reconciled ladder and must never reshuffle it.
		team.position = nextPosition();
		team.lifecycle = "Queued";
		changed(team, "Queued");
		TeamRegistry.updateLeaderboardNames();
		warn(`[TeamRegistry] ${team.name} entered the ladder at table ${team.position + 1}`);
	},

	/** Compatibility name for older callers while all spawn entry flows are
	 * migrated to the explicit lifecycle API. */
	markInPlay(team: LadderTeam) {
		TeamRegistry.markQueued(team);
	},

	createTeam(creator: Player, openToRandoms: boolean, origin?: TeamOrigin): LadderTeam {
		TeamRegistry.leaveTeam(creator);

		const id = `T${nextTeamNumber}`;
		nextTeamNumber += 1;
		const name = pickName();
		const colorName = pickColor();

		const robloxTeam = new Instance("Team");
		robloxTeam.Name = name;
		robloxTeam.AutoAssignable = false;
		pcall(() => {
			robloxTeam.TeamColor = new BrickColor(colorName as never);
		});
		robloxTeam.Parent = TeamsService;

		const team: LadderTeam = {
			id,
			name,
			robloxTeam,
			colorName,
			members: [creator],
			origin: origin ?? (openToRandoms ? "Random" : "Friends"),
			protection: (origin ?? (openToRandoms ? "Random" : "Friends")) === "Friends" ? "Protected" : "Recombinable",
			nameSource: "Generated",
			openToRandoms,
			// No ladder seat until the team enters the queue.
			position: undefined,
			lifecycle: "Forming",
			revision: 1,
			creationOrder: nextTeamNumber - 1,
		};
		teams.set(id, team);
		teamOfPlayer.set(creator, team);
		setPlayerTeam(creator, team);
		publishTeamAttrs(team);
		warn(`[TeamRegistry] ${creator.Name} created ${name} (${openToRandoms ? "open" : "locked"})`);
		return team;
	},

	/** Open/locked toggle (AllowRandoms) — mutates AND republishes CB_Open. */
	setTeamOpen(team: LadderTeam, open: boolean) {
		team.openToRandoms = open;
		changed(team, "OpenChanged");
	},

	/** Add to a specific team (invite acceptance / referred joins). */
	addToTeam(player: Player, team: LadderTeam, voluntaryActiveWithdrawal = false): boolean {
		if (!teams.has(team.id) || team.members.size() >= MAX_TEAM_MEMBERS) {
			return false;
		}
		const current = teamOfPlayer.get(player);
		if (current === team) return true;
		if (
			current !== undefined &&
			(current.lifecycle === "Active" || current.lifecycle === "Reserved") &&
			!voluntaryActiveWithdrawal
		) return false;
		TeamRegistry.leaveTeam(player);
		team.members.push(player);
		teamOfPlayer.set(player, team);
		setPlayerTeam(player, team);
		changed(team, "MemberAdded");
		warn(`[TeamRegistry] ${player.Name} joined ${team.name} (${team.members.size()}/${MAX_TEAM_MEMBERS})`);
		return true;
	},

	/** Coordinator-only automatic transfer. The donor must be idle,
	 * recombinable and random; active/protected members can never be pulled. */
	transferIdleRandomPlayer(player: Player, target: LadderTeam): LadderTeam | undefined {
		const source = teamOfPlayer.get(player);
		if (
			!source ||
			source === target ||
			source.origin !== "Random" ||
			source.protection !== "Recombinable" ||
			(source.lifecycle !== "Queued" && source.lifecycle !== "Intermission" && source.lifecycle !== "Muckabout") ||
			!target.openToRandoms ||
			target.members.size() >= MAX_TEAM_MEMBERS ||
			!teams.has(target.id)
		) {
			return undefined;
		}
		const sourceIndex = source.members.indexOf(player);
		if (sourceIndex < 0) return undefined;
		source.members.remove(sourceIndex);
		target.members.push(player);
		teamOfPlayer.set(player, target);
		setPlayerTeam(player, target);
		changed(target, "LiveVacancyFilled");
		if (source.members.size() === 0) disband(source);
		else changed(source, "IdleMemberTransferred");
		return source;
	},

	/**
	 * Join Team button — the optimizer (design §4.2). Priorities: (1) even
	 * team count, (2) fill solo teams, (3) fill smallest open team, else
	 * create. Already-teamed players keep their team (no-op).
	 */
	joinRandom(player: Player): LadderTeam {
		const existing = teamOfPlayer.get(player);
		if (existing) {
			return existing;
		}

		const open: LadderTeam[] = [];
		for (const [, team] of teams) {
			// Never drop a random into a still-forming lobby team: landing PLAY
			// promises immediate play, and a lobby must only grow via invites.
			if (
				team.openToRandoms &&
				team.lifecycle !== "Forming" &&
				team.lifecycle !== "Disbanded" &&
				team.members.size() < MAX_TEAM_MEMBERS
			) {
				open.push(team);
			}
		}

		if (teamCount() % 2 === 1) {
			// Odd count: a new team evens it and retires the muckabout pitch.
			return TeamRegistry.createTeam(player, true, "Random");
		}

		const pickLowest = (candidates: LadderTeam[]) => {
			candidates.sort((a, b) => {
				if (a.members.size() !== b.members.size()) return a.members.size() < b.members.size();
				const ap = a.position ?? math.huge;
				const bp = b.position ?? math.huge;
				return ap === bp ? a.creationOrder < b.creationOrder : ap > bp;
			});
			return candidates[0];
		};

		const solos = open.filter((t) => t.members.size() === 1);
		if (solos.size() > 0) {
			const target = pickLowest(solos);
			TeamRegistry.addToTeam(player, target);
			return target;
		}
		if (open.size() > 0) {
			const target = pickLowest(open);
			TeamRegistry.addToTeam(player, target);
			return target;
		}
		return TeamRegistry.createTeam(player, true, "Random");
	},

	leaveTeam(player: Player) {
		const team = teamOfPlayer.get(player);
		if (!team) {
			return;
		}
		teamOfPlayer.delete(player);
		const index = team.members.indexOf(player);
		if (index >= 0) {
			team.members.remove(index);
		}
		setPlayerTeam(player, undefined);
		if (team.members.size() === 0) {
			disband(team);
		} else {
			changed(team, "MemberRemoved");
		}
	},

	/**
	 * Rename after a rename-product purchase (design D3). Filters through
	 * Roblox moderation; a moderated result is rejected so the popup can
	 * re-prompt (the purchase stays spendable until a clean name lands).
	 */
	renameTeam(requester: Player, rawName: string): "ok" | "moderated" | "error" {
		const team = teamOfPlayer.get(requester);
		if (!team) {
			return "error";
		}
		const trimmed = rawName.gsub("^%s+", "")[0].gsub("%s+$", "")[0];
		if (trimmed.size() < 2 || trimmed.size() > 24) {
			return "moderated";
		}
		let filtered: string | undefined;
		const [ok] = pcall(() => {
			const result = TextService.FilterStringAsync(trimmed, requester.UserId);
			filtered = result.GetNonChatStringForBroadcastAsync();
		});
		if (!ok || filtered === undefined) {
			return "error";
		}
		if (filtered !== trimmed) {
			return "moderated";
		}
		team.name = filtered;
		team.nameSource = "Custom";
		team.protection = "Protected";
		team.robloxTeam.Name = filtered;
		changed(team, "ProtectedByRename");
		TeamRegistry.updateLeaderboardNames();
		warn(`[TeamRegistry] ${requester.Name} renamed team to ${filtered}`);
		return "ok";
	},

	/** Rename credits (D3): granted per rename-product purchase; spendable
	 * until a CLEAN name lands. Mirrored to a player attribute so menu code
	 * can react to purchases finishing asynchronously. */
	grantRenameCredit(player: Player) {
		renameCredits.set(player, (renameCredits.get(player) ?? 0) + 1);
		player.SetAttribute("CB_RenameCredits", renameCredits.get(player));
	},

	getRenameCredits(player: Player): number {
		return renameCredits.get(player) ?? 0;
	},

	tryRename(player: Player, rawName: string): "ok" | "moderated" | "error" | "nocredit" {
		if ((renameCredits.get(player) ?? 0) <= 0) {
			return "nocredit";
		}
		const result = TeamRegistry.renameTeam(player, rawName);
		if (result === "ok") {
			renameCredits.set(player, (renameCredits.get(player) ?? 0) - 1);
			player.SetAttribute("CB_RenameCredits", renameCredits.get(player));
		}
		return result;
	},

	/** Player-list ordering: prefix every LADDER team's Roblox Team name with
	 * its table rank so the default leaderboard reads top-table-first. Lobby
	 * teams have no rank yet and keep their plain name. */
	updateLeaderboardNames() {
		for (const [, team] of teams) {
			pcall(() => {
				team.robloxTeam.Name =
					team.position !== undefined && team.lifecycle !== "Forming" && team.lifecycle !== "Disbanded"
						? `${team.position + 1} · ${team.name}`
						: team.name;
			});
		}
	},

	setLifecycle(team: LadderTeam, lifecycle: TeamLifecycle) {
		if (!teams.has(team.id) || team.lifecycle === lifecycle) return;
		team.lifecycle = lifecycle;
		changed(team, "LifecycleChanged");
	},

	setPosition(team: LadderTeam, position: number | undefined) {
		if (!teams.has(team.id) || team.position === position) return;
		team.position = position;
		changed(team, "PositionChanged");
		TeamRegistry.updateLeaderboardNames();
	},

	/** Final post-shop reconciliation for idle generated teams. Protected and
	 * active identities are never touched. The chosen output count maximizes
	 * complete pairings, then keeps as few team identities as the 3-player cap
	 * permits. */
	reconcileIdleRandomTeams() {
		const isIdle = (team: LadderTeam) =>
			team.lifecycle === "Queued" || team.lifecycle === "Intermission" || team.lifecycle === "Muckabout";
		const sources: LadderTeam[] = [];
		let fixedEligibleCount = 0;
		for (const [, team] of teams) {
			if (!isIdle(team)) continue;
			if (team.origin === "Random" && team.protection === "Recombinable") sources.push(team);
			else fixedEligibleCount += 1;
		}
		if (sources.size() === 0) return;

		const sourceOf = new Map<Player, LadderTeam>();
		const randomPlayers: Player[] = [];
		for (const source of sources) {
			for (const player of source.members) {
				sourceOf.set(player, source);
				randomPlayers.push(player);
			}
		}
		randomPlayers.sort((a, b) => {
			const ao = playerJoinOrder.get(a) ?? math.huge;
			const bo = playerJoinOrder.get(b) ?? math.huge;
			return ao === bo ? a.UserId < b.UserId : ao < bo;
		});
		if (randomPlayers.size() === 0) return;

		let outputCount = math.ceil(randomPlayers.size() / MAX_TEAM_MEMBERS);
		if ((fixedEligibleCount + outputCount) % 2 === 1 && outputCount < randomPlayers.size()) outputCount += 1;

		// If no identity-count change is required, retain whole teams exactly;
		// this keeps full teams of three and minimizes membership churn.
		if (outputCount === sources.size()) {
			for (const source of sources) {
				if (source.lifecycle !== "Queued") {
					source.lifecycle = "Queued";
					changed(source, "IdleReconciled");
				}
			}
			return;
		}

		// Merges retain lower/worse source identities. Splits reuse every source
		// once before creating generated shells at the bottom.
		sources.sort((a, b) => {
			const pa = a.position ?? math.huge;
			const pb = b.position ?? math.huge;
			return pa === pb ? a.creationOrder < b.creationOrder : pa > pb;
		});
		const outputs: LadderTeam[] = [];
		for (let i = 0; i < math.min(outputCount, sources.size()); i++) outputs.push(sources[i]);
		while (outputs.size() < outputCount) {
			const id = `T${nextTeamNumber}`;
			nextTeamNumber += 1;
			const name = pickName();
			const colorName = pickColor();
			const robloxTeam = new Instance("Team");
			robloxTeam.Name = name;
			robloxTeam.AutoAssignable = false;
			pcall(() => (robloxTeam.TeamColor = new BrickColor(colorName as never)));
			robloxTeam.Parent = TeamsService;
			const shell: LadderTeam = {
				id,
				name,
				robloxTeam,
				colorName,
				members: [],
				origin: "Random",
				protection: "Recombinable",
				nameSource: "Generated",
				openToRandoms: true,
				position: nextPosition(),
				lifecycle: "Queued",
				revision: 1,
				creationOrder: nextTeamNumber - 1,
			};
			teams.set(shell.id, shell);
			outputs.push(shell);
		}

		const smallSize = math.floor(randomPlayers.size() / outputCount);
		const largeCount = randomPlayers.size() % outputCount;
		const targetSizes: number[] = [];
		for (let i = 0; i < outputCount; i++) targetSizes.push(smallSize + (i >= outputCount - largeCount ? 1 : 0));

		const assigned = new Set<Player>();
		const planned = new Map<LadderTeam, Player[]>();
		for (let i = 0; i < outputs.size(); i++) {
			const keep: Player[] = [];
			for (const player of outputs[i].members) {
				if (keep.size() >= targetSizes[i]) break;
				keep.push(player);
				assigned.add(player);
			}
			planned.set(outputs[i], keep);
		}
		const overflow = randomPlayers.filter((player) => !assigned.has(player));
		let overflowIndex = 0;
		for (let i = 0; i < outputs.size(); i++) {
			const members = planned.get(outputs[i])!;
			while (members.size() < targetSizes[i]) members.push(overflow[overflowIndex++]);
		}

		for (const output of outputs) {
			const members = planned.get(output)!;
			let inheritedPosition = output.position ?? -1;
			for (const member of members) inheritedPosition = math.max(inheritedPosition, sourceOf.get(member)?.position ?? -1);
			output.members = members;
			output.position = inheritedPosition >= 0 ? inheritedPosition : nextPosition();
			output.lifecycle = "Queued";
			for (const member of members) {
				teamOfPlayer.set(member, output);
				setPlayerTeam(member, output);
			}
			changed(output, "RandomRepacked");
		}
		const outputIds = new Set(outputs.map((output) => output.id));
		for (const source of sources) {
			if (!outputIds.has(source.id)) {
				source.members = [];
				disband(source);
			}
		}

		const ordered = TeamRegistry.getTeams();
		for (let i = 0; i < ordered.size(); i++) ordered[i].position = i;
		TeamRegistry.updateLeaderboardNames();
		warn(`[TeamRegistry] reconciled ${randomPlayers.size()} idle random player(s) into ${outputs.size()} team(s)`);
	},

	onPlayerRemoved(player: Player) {
		TeamRegistry.leaveTeam(player);
		renameCredits.delete(player);
		playerJoinOrder.delete(player);
	},

	/** Goal credit → leaderstats column (called by the match layer). */
	addGoal(player: Player) {
		const stats = player.FindFirstChild("leaderstats");
		const goals = stats && stats.FindFirstChild("Goals");
		if (goals && goals.IsA("IntValue")) {
			goals.Value += 1;
		}
	},

	removeGoals(player: Player, amount: number) {
		const stats = player.FindFirstChild("leaderstats");
		const goals = stats && stats.FindFirstChild("Goals");
		if (goals && goals.IsA("IntValue")) goals.Value = math.max(0, goals.Value - amount);
	},
};

Players.PlayerAdded.Connect((player) => {
	playerJoinOrder.set(player, nextPlayerJoinOrder++);
	ensureLeaderstats(player);
});
for (const player of Players.GetPlayers()) {
	if (!playerJoinOrder.has(player)) playerJoinOrder.set(player, nextPlayerJoinOrder++);
	ensureLeaderstats(player);
}

export default TeamRegistry;
