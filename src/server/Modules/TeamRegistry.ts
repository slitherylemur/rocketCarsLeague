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

const Players = game.GetService("Players");
const TeamsService = game.GetService("Teams");
const TextService = game.GetService("TextService");

/** Developer product for renaming a team (repeatable). PLACEHOLDER — create
 * the product in the Roblox dashboard and paste its id here (Phase 2 wires
 * the purchase prompt + popup). */
export const RENAME_PRODUCT_ID = 0;

const MAX_MEMBERS = 3;

// Preset pool (resolved decision D3): names are drawn from here; "Team N"
// when exhausted. The rename product lets teams pick a custom (filtered) name.
const NAME_POOL = [
	"Turbo Strikers",
	"Piston United",
	"Nitro Netters",
	"Boost Ballers",
	"Drift Dynamos",
	"Octane Owls",
	"Bumper Bandits",
	"Redline Rovers",
	"Exhaust Eagles",
	"Clutch City",
	"Gearbox Galacticos",
	"Skid Marks FC",
	"Handbrake Hooligans",
	"Overdrive Olympians",
	"Torque Town",
	"Fuel Injected FC",
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
	open: boolean;
	/** Ladder position, 0 = gold. Compacted at reseat (MatchDirector, Phase 4). */
	position: number;
	lastMuckRound?: number;
	joinedMidRound: boolean;
}

const teams = new Map<string, LadderTeam>();
const teamOfPlayer = new Map<Player, LadderTeam>();
const renameCredits = new Map<Player, number>();
let nextTeamNumber = 1;

// Runtime remotes folder (nothing place-file-side): PromptGameInvite tells a
// client to open Roblox's native invite prompt; SubmitTeamName carries the
// rename popup's typed text (player-typed TextBox.Text never replicates).
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const carBallFolder = new Instance("Folder");
carBallFolder.Name = "CarBall";
const promptGameInviteRemote = new Instance("RemoteEvent");
promptGameInviteRemote.Name = "PromptGameInvite";
promptGameInviteRemote.Parent = carBallFolder;
const submitTeamNameRemote = new Instance("RemoteEvent");
submitTeamNameRemote.Name = "SubmitTeamName";
submitTeamNameRemote.Parent = carBallFolder;
carBallFolder.Parent = ReplicatedStorage;

export const CarBallRemotes = {
	PromptGameInvite: promptGameInviteRemote,
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

function teamCount(): number {
	let count = 0;
	for (const [] of teams) {
		count += 1;
	}
	return count;
}

function nextPosition(): number {
	let highest = -1;
	for (const [, team] of teams) {
		highest = math.max(highest, team.position);
	}
	return highest + 1;
}

/**
 * When a second overflow team arrives, the waiting muckabout team and the
 * newcomer become a new competitive pairing. New real capacity is inserted
 * immediately above the physical Mud pitch, so its existing occupants must
 * remain the bottom pair rather than having their venue silently turn Green.
 *
 * Returns the new team's position, or undefined when this is an ordinary
 * append (including the one-team -> two-team Gold-only case).
 */
function positionForNewTeam(): number | undefined {
	const ordered = TeamRegistry.getTeams();
	const count = ordered.size();
	// Up to four teams there is no existing Mud venue to preserve: the second
	// real pitch being introduced becomes Mud and an ordinary append is right.
	if (count < 5 || count % 2 === 0) {
		return undefined;
	}

	const insertionPosition = count - 3;
	const waitingMuckabout = ordered[count - 1];

	// Make two slots immediately above Mud. The old bottom pair moves down
	// into those slots and therefore stays on the physical Mud venue.
	for (let i = count - 2; i >= count - 3; i--) {
		ordered[i].position += 2;
	}
	waitingMuckabout.position = insertionPosition;
	return insertionPosition + 1;
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
}

function disband(team: LadderTeam) {
	teams.delete(team.id);
	pcall(() => team.robloxTeam.Destroy());
	warn(`[TeamRegistry] disbanded ${team.name}`);
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

	getTeams(): LadderTeam[] {
		const list: LadderTeam[] = [];
		for (const [, team] of teams) {
			list.push(team);
		}
		list.sort((a, b) => a.position < b.position);
		return list;
	},

	createTeam(creator: Player, open: boolean): LadderTeam {
		TeamRegistry.leaveTeam(creator);
		const insertedPosition = positionForNewTeam();

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
			open,
			position: insertedPosition ?? nextPosition(),
			joinedMidRound: false,
		};
		teams.set(id, team);
		teamOfPlayer.set(creator, team);
		setPlayerTeam(creator, team);
		warn(`[TeamRegistry] ${creator.Name} created ${name} (${open ? "open" : "locked"})`);
		return team;
	},

	/** Add to a specific team (invite acceptance / referred joins). */
	addToTeam(player: Player, team: LadderTeam): boolean {
		if (!teams.has(team.id) || team.members.size() >= MAX_MEMBERS) {
			return false;
		}
		TeamRegistry.leaveTeam(player);
		team.members.push(player);
		teamOfPlayer.set(player, team);
		setPlayerTeam(player, team);
		warn(`[TeamRegistry] ${player.Name} joined ${team.name} (${team.members.size()}/${MAX_MEMBERS})`);
		return true;
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
			if (team.open && team.members.size() < MAX_MEMBERS) {
				open.push(team);
			}
		}

		if (teamCount() % 2 === 1) {
			// Odd count: a new team evens it and retires the muckabout pitch.
			return TeamRegistry.createTeam(player, true);
		}

		const pickLowest = (candidates: LadderTeam[]) => {
			candidates.sort((a, b) =>
				a.members.size() === b.members.size() ? a.position > b.position : a.members.size() < b.members.size(),
			);
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
		return TeamRegistry.createTeam(player, true);
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
		team.robloxTeam.Name = filtered;
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

	/** Player-list ordering: prefix every Roblox Team name with its table
	 * rank so the default leaderboard reads top-table-first. */
	updateLeaderboardNames() {
		for (const [, team] of teams) {
			pcall(() => {
				team.robloxTeam.Name = `${team.position + 1} · ${team.name}`;
			});
		}
	},

	/** Goal credit → leaderstats column (called by the match layer). */
	addGoal(player: Player) {
		const stats = player.FindFirstChild("leaderstats");
		const goals = stats && stats.FindFirstChild("Goals");
		if (goals && goals.IsA("IntValue")) {
			goals.Value += 1;
		}
	},
};

Players.PlayerAdded.Connect((player) => {
	ensureLeaderstats(player);
});
for (const player of Players.GetPlayers()) {
	ensureLeaderstats(player);
}

Players.PlayerRemoving.Connect((player) => {
	TeamRegistry.leaveTeam(player);
	renameCredits.delete(player);
});

export default TeamRegistry;
