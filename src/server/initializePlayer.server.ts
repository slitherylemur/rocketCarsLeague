// Original: ServerScriptService/initializePlayer (Script)

import spawnVehicle from "./Modules/spawnVehicle";

import DataUtilities from "./Modules/DataUtilities";
import DataStoreDefaults from "./Modules/DataStoreDefaults";
import roundHandler from "./Modules/roundHandler";
//local playerGarage = workspace.garageModel
import crateModule from "./Modules/CrateModule";
import garageIntents from "./ui/garageIntents";
import profileSnapshot from "./ui/profileSnapshot";
import { CrateCatalog } from "shared/CrateCatalog";
import { Globals } from "./Globals";
import footballMatch from "./Modules/footballMatch";
import TeamRegistry, { CarBallRemotes, RENAME_PRODUCT_ID } from "./Modules/TeamRegistry";
import UiState from "./ui/UiState";
import { getUiIntentEvent, type UiIntentEventName } from "shared/UiIntents";
import type { LadderTeam } from "./Modules/TeamRegistry";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import VehicleInputActions from "./Modules/vehicleInputActions";
import { CarAttr, CarModelAttr } from "shared/vehicleV2/CarState";

const HttpService = game.GetService("HttpService");
const MarketplaceService = game.GetService("MarketplaceService");

//DataStores--
import DataStore2 from "./Modules/DataStore2";

//MemoryStoreTest--
const Players = game.GetService("Players");

// Stops the engine auto-spawning characters (menu-first flow; UIs are mounted
// into the player manually). This used to sit mid-file, AFTER hundreds of
// lines of handler setup — moved to the top of the body so the window in
// which a production first-joiner can be admitted with the flag still true is
// as small as this script can make it (initCharacterAutoLoads.server.ts and
// the StarterPlayer property in default.project.json cover the imports above).
Players.CharacterAutoLoads = false;

const MemoryStoreService = game.GetService("MemoryStoreService");
const testStoreMap = MemoryStoreService.GetSortedMap("testStoreMap");

// (GarageGuiShape retired in Phase 5; GameGuiShape/playerGuiOf in Phase 6;
// RoundSummary/LadderMap moved client-side in Phase 7; PlayerGuiManager
// demolished in Phase 8: EVERY ScreenGui is CLIENT-owned — the server
// publishes attributes/remotes only and never touches PlayerGui instances.)

Players.PlayerRemoving.Connect((player) => {
	const playerMoney = DataStore2("money", player).Get(0) as number;
	testStoreMap.SetAsync(tostring(player.UserId), playerMoney, 600000);
	task.delay(4, () => {
		DataStore2.SaveAll(player);
	});
});

game.BindToClose(() => {
	const RunService = game.GetService("RunService");

	// if the current session is studio, do nothing
	if (RunService.IsStudio()) {
		return;
	}

	print("saving player data");

	// go through all players, saving their data
	const players = Players.GetPlayers();
	for (const player of players) {
		const playerMoney = DataStore2("money", player).Get(0) as number;
		testStoreMap.SetAsync(tostring(player.UserId), playerMoney, 600000);
	}

	print("completed saving player data");
});

Players.PlayerAdded.Connect((player) => {
	const playerMoneyDS = DataStore2("money", player).Get(0) as number | undefined;
	const [playerMoneyMS] = testStoreMap.GetAsync(tostring(player.UserId)) as LuaTuple<[number | undefined]>;
	if (playerMoneyDS !== undefined && playerMoneyMS !== undefined && playerMoneyDS !== playerMoneyMS) {
		warn(
			"Datastore NOT Saved: USER: " +
				player.UserId +
				", DSValue: " +
				playerMoneyDS +
				", MSValue: " +
				playerMoneyMS,
		);
		// DataLoss is CLIENT-mounted (Phase 3) — publish the flag as a player
		// attribute; src/client/ui/dataLoss.client.ts derives Enabled from it.
		UiState.setPlayerAttr(player, "CB_DataLoss", true);
	}
});

// (uiConnections / selectedCrate / the server-wired tab + shop + crate menus
// are gone — Phase 5 moved the whole Garage/CrateMenu UI client-side; the
// remaining crate entry point is the Intent_OpenCrate handler below.)
const crateDebounces = new Map<Player, boolean>();

// ---- UI flow ownership (menu vs spawn) -------------------------------------
// SpawnInPlayer and the menu (re)initialisers both span yields (LoadCharacter,
// SpawnVehicle's internal ~2s of waits, cold/throttled DataStore Gets). When
// they interleave for the same player — round-end sendToMenu firing while a
// PLAY press is mid-spawn, the shop-end auto-spawn landing inside a
// datastore-delayed initialisePlayerUi, an invite accepted mid-spawn —
// whichever thread resumes LAST wins, so a player could end up seated in a
// match car with the landing/garage menu enabled on top (or vice versa).
//
// CB_FlowState is the replicated presentation state. A separate monotonically
// increasing token is the actual ownership claim, because the state string
// alone cannot distinguish spawning(A) -> menu -> spawning(B). Long flows
// re-check both after yielding so only the newest intent can complete.
type FlowStateValue = "menu" | "lobby" | "garage" | "spawning" | "match";
const flowGeneration = new Map<Player, number>();

/** Replicate presentation state and issue an identity token. The token is
 * required for ABA transitions such as spawning(A) -> menu -> spawning(B),
 * where the state string alone cannot tell stale A from current B. */
function claimFlowState(player: Player, state: FlowStateValue): number {
	const generation = (flowGeneration.get(player) ?? 0) + 1;
	flowGeneration.set(player, generation);
	UiState.setFlowState(player, state);
	return generation;
}

function ownsFlow(player: Player, generation: number): boolean {
	return flowGeneration.get(player) === generation;
}

Players.PlayerRemoving.Connect((player) => flowGeneration.delete(player));

function getFlowState(player: Player): FlowStateValue | undefined {
	const state = player.GetAttribute("CB_FlowState");
	return typeIs(state, "string") ? (state as FlowStateValue) : undefined;
}

/** Menu-family states: the player sits outside the play loop (client renders
 * the landing page / lobby, or the server-owned Garage screen is up). */
function isMenuFamily(state: FlowStateValue | undefined): boolean {
	return state === "menu" || state === "lobby" || state === "garage";
}

DataStore2.Combine(
	"BumperCarsRelease",
	"money",
	"trophies",
	"wins",
	"kills",
	"deaths",
	"equippedVehicle",
	"colors",
	"hornSounds",
	"boostTrails",
	"vehicles",
	"vehicleCustomization",
	"crates",
	"multipliers",
	"keyBinds",
	"codes",
);

//DataStores--
FunctionsAndEvents.GetKeyBinding.OnServerInvoke = (player, action) => {
	return DataUtilities.GetKeyBinding(player, action as string);
};
FunctionsAndEvents.SetKeyBinding.OnServerInvoke = (player, action, key) => {
	const result = DataUtilities.SetKeyBinding(player, action as string, key as EnumItem);
	// Retarget the live IAS binding too (Phase 3) — rebinds apply immediately.
	VehicleInputActions.updateBinding(player, action as string, key as EnumItem);
	return result;
};

// (Removed the legacy FunctionsAndEvents.Throttle handler: nothing on the
// client fires it — movement floats travel via the per-vehicle
// inputChangedEvent into the shared sim.)

// (GetModelByPlayerAndParent, the tab-bar helpers, the gamepad R1/L1 garage
// tab-cycling handlers and resetVehicle are gone — Phase 5: tab navigation,
// tile population and gamepad garage nav are client-local in
// src/client/ui/garage.client.ts; the display-car reset lives in
// src/server/ui/garageIntents.ts. Crate display names moved to the shared
// catalog (shared/CrateCatalog.CRATE_NAMES) — Globals.CrateNames retired.)

//Garages
Globals.findEmptyGarage = () => {
	for (const v of (game.Workspace as unknown as { PlayerGarages: Folder }).PlayerGarages.GetChildren()) {
		if ((v as unknown as { Player: NumberValue }).Player.Value === 0) {
			return v as never;
		}
	}
	return undefined;
};

Globals.findPlayerGarage = (player: Player) => {
	for (const v of (game.Workspace as unknown as { PlayerGarages: Folder }).PlayerGarages.GetChildren()) {
		if ((v as unknown as { Player: NumberValue }).Player.Value === player.UserId) {
			return v as never;
		}
	}
	return undefined;
};

Globals.addPlayerToGarage = (player: Player) => {
	Globals.clearPlayerGarage(player);
	const garage = Globals.findEmptyGarage()!;
	garage.Player.Value = player.UserId;
	return garage;
};

Globals.clearPlayerGarage = (player: Player) => {
	const playerGarage = Globals.findPlayerGarage(player);
	if (playerGarage) {
		playerGarage.Player.Value = 0;
	}
};

// Menu-camera join handshake. The initial ToggleMenuCamera /
// SetMenuCameraCFrame fires happen inside PlayerAdded, which can beat the
// client's LocalScripts connecting their handlers — fires in that window are
// lost and the player joins staring at the sky. The client pings this remote
// once its connections exist; we re-send whatever menu camera state the join
// flow established. (Created in code, like GeneralUtilFunc — the
// FunctionsAndEvents folder itself is a place-file instance.)
const menuCameraReady = (() => {
	const existing = FunctionsAndEvents.FindFirstChild("MenuCameraReady");
	if (existing && existing.IsA("RemoteEvent")) {
		return existing;
	}
	const remote = new Instance("RemoteEvent");
	remote.Name = "MenuCameraReady";
	remote.Parent = FunctionsAndEvents;
	return remote;
})();

function resendMenuCameraState(player: Player) {
	const playerGarage = Globals.findPlayerGarage(player);
	// No garage yet: initialisePlayerUi hasn't assigned one, and its own fires
	// will land on the now-connected client handlers. A character means the
	// player already spawned into play — never re-force the menu camera then.
	if (!playerGarage || player.Character !== undefined) {
		return;
	}
	FunctionsAndEvents.ToggleMenuCamera.FireClient(player, true, playerGarage);
	const bodyCamera = playerGarage.Cameras.FindFirstChild("Body");
	if (bodyCamera && bodyCamera.IsA("BasePart")) {
		if (Globals.shopPhaseActive === true) {
			// Mirrors setTab.Inventory's shot for the shop-phase Cars page.
			FunctionsAndEvents.SetMenuCameraCFrame.FireClient(player, bodyCamera.CFrame);
		} else {
			// Mirrors showLanding's offset landing shot.
			FunctionsAndEvents.SetMenuCameraCFrame.FireClient(player, bodyCamera.CFrame.mul(new CFrame(-5, 1, 0)), 55);
		}
	}
}

menuCameraReady.OnServerEvent.Connect((player) => resendMenuCameraState(player));

//Ui
/** Intent_OpenCrate body: the old openCrate debounce around the crate module
 * (policy/affordability/Robux logic re-validated inside crateModule.openCrate;
 * the crate id now arrives with the intent instead of the selectedCrate map). */
function openCrate(player: Player, crateId: number) {
	if (!crateDebounces.get(player)) {
		crateDebounces.set(player, true);
		const [ok, err] = pcall(() => crateModule.openCrate(player, crateId));
		crateDebounces.set(player, false);
		if (!ok) {
			warn(`[Crate] openCrate(${crateId}) failed for ${player.Name}: ${err}`);
		}
	}
}

/* Phase 5: Globals.openCrateMenu / OpenShop / OpenInventory are DELETED — the
 * Garage's shop, inventory tabs and in-garage crate page render client-side
 * (src/client/ui/garage.client.ts) from the profile snapshot + shared crate
 * catalog; the camera shot for the crate page arrives via Intent_ViewCrate. */

/** Landing page (Top Table §5): title + Join Team / Create Team / Cars, car
 * in view via the menu camera. The Landing ScreenGui itself is CLIENT-owned
 * (Phase 4): src/client/ui/menu.client.ts enables it while CB_FlowState is
 * "menu" and fires the Intent_* remotes for its buttons. This function is the
 * server half of "show the landing page": flow-state transition, menu camera
 * aim, garage display car. */
function enterLandingState(player: Player) {
	// Landing = menu state: invalidate any in-flight spawn for this player.
	// (The client-owned Garage derives its Enabled from CB_FlowState, so the
	// old server-side Garage.Enabled=false is this same write now.)
	const flowGen = claimFlowState(player, "menu");

	// Landing is outside the play loop — the client-rendered shop countdown
	// (src/client/ui/timer.client.ts) hides itself while CB_FlowState is a
	// menu-family value, so no server-side TimerGui clear is needed here.

	// Aim the menu camera at the garage car. setTab.Inventory used to do this
	// as a side effect of OpenInventory on join; the landing page must send a
	// camera CFrame itself or the client camera has nothing to point at
	// (the menuCamera "CoordinateFrame expected, got nil" crash).
	const playerGarage = Globals.findPlayerGarage(player);
	const bodyCamera = playerGarage && playerGarage.Cameras.FindFirstChild("Body");
	if (bodyCamera && bodyCamera.IsA("BasePart")) {
		// Offset only the landing shot in the camera's local space.
		const landingCamera = bodyCamera.CFrame.mul(new CFrame(-5, 1, 0));
		FunctionsAndEvents.SetMenuCameraCFrame.FireClient(player, landingCamera, 55);
	} else {
		warn(`[Landing] no Body camera in garage for ${player.Name} — menu camera not aimed`);
	}

	// Display car on the launch screen (setTab.Inventory used to spawn it as
	// a side effect; the landing page shows the equipped car itself).
	if (playerGarage) {
		task.spawn(() => {
			const [okSpawn, errSpawn] = pcall(() => {
				if (!ownsFlow(player, flowGen)) {
					return;
				}
				spawnVehicle.SpawnVehicle(
					player,
					false,
					DataUtilities.getPlayerEquippedVehicle(player),
					playerGarage.spawnPlate.CFrame,
					true,
				);
			});
			if (!okSpawn) {
				warn(`[Landing] garage display SpawnVehicle failed: ${errSpawn}`);
			}
		});
	}

	// (Landing button wiring lives client-side now — menu.client.ts fires
	// Intent_PlayRandom / Intent_CreateTeam / Intent_OpenGarage, handled in the
	// intent section at the bottom of this file.)
}

/** Cars page = "garage" state (Intent_OpenGarage, and the shop-window menu
 * re-init). The Garage ScreenGui is CLIENT-owned since Phase 5 — the server's
 * whole contribution is the flow state, the Body camera shot (the old
 * setTab.Inventory side effect; tab SWITCHES aim locally on the client) and
 * the equipped display car on the plate. */
function enterGarageState(player: Player) {
	const flowGen = claimFlowState(player, "garage");

	const playerGarage = Globals.findPlayerGarage(player);
	const bodyCamera = playerGarage && playerGarage.Cameras.FindFirstChild("Body");
	if (bodyCamera && bodyCamera.IsA("BasePart")) {
		FunctionsAndEvents.SetMenuCameraCFrame.FireClient(player, bodyCamera.CFrame);
	} else {
		warn(`[Garage] no Body camera in garage for ${player.Name} — menu camera not aimed`);
	}

	// Display car (the old OpenInventory → setTab.Inventory("Body") spawn).
	if (playerGarage) {
		task.spawn(() => {
			const [okSpawn, errSpawn] = pcall(() => {
				if (!ownsFlow(player, flowGen)) {
					return;
				}
				spawnVehicle.SpawnVehicle(
					player,
					false,
					DataUtilities.getPlayerEquippedVehicle(player),
					playerGarage.spawnPlate.CFrame,
					true,
				);
			});
			if (!okSpawn) {
				warn(`[Garage] display SpawnVehicle failed: ${errSpawn}`);
			}
		});
	}
}

/** Friends Team mini lobby = "lobby" state: the CreateTeam ScreenGui is
 * client-rendered from replicated team state; the server only records the
 * transition and drops its own menu screen (the lobby can be entered from the
 * garage or mid-match via an accepted invite). */
function enterLobbyState(player: Player) {
	// (Client-owned Garage hides itself when CB_FlowState leaves "garage".)
	claimFlowState(player, "lobby");
}

function spawnIntoMatch(player: Player) {
	// The spawn owns the UI from the moment of the press (set synchronously,
	// BEFORE the interlude hold below): the client menus hide as soon as
	// CB_FlowState leaves the menu family, and any later menu transition
	// supersedes this spawn at its next checkpoint.
	const flowGen = claimFlowState(player, "spawning");
	task.spawn(() => {
		// Round-end interlude: the old round is being torn down and rebuilt
		// (~20 s of victory scene / ladder map / summary). A SpawnInPlayer
		// started now would roster onto the DYING round and race the
		// stop()/beginRound rebuild — its car lands after the roster wipe and
		// the player ends up driving unrostered on the wrong pitch (and their
		// team can then never reach kickoff). Hold until the rebuilt round is
		// spawnable; bail through on timeout so a wedged round can't trap the
		// button forever.
		if (!footballMatch.isRoundLive()) {
			// The client TimerGui shows "NEXT ROUND STARTING…" while this
			// attribute is set (src/client/ui/timer.client.ts).
			UiState.setPlayerAttr(player, "CB_InterludeHold", true);
			for (let i = 0; i < 60 && !footballMatch.isRoundLive(); i++) {
				task.wait(0.5);
			}
			UiState.setPlayerAttr(player, "CB_InterludeHold", undefined);
			if (player.Parent === undefined) {
				return;
			}
		}
		if (!ownsFlow(player, flowGen)) {
			UiState.setPlayerAttr(player, "CB_InterludeHold", undefined);
			return;
		}
		const [ok, result] = pcall(() => Globals.SpawnInPlayer(player));
		if (!ok || result !== true) {
			warn(`[Landing] SpawnInPlayer failed (ok=${ok} result=${tostring(result)}) — returning to menu`);
			ResetAndInitialisePlayerMenuUI(player);
			return;
		}
		// Teammates still in the lobby re-render client-side from the attribute
		// changes the spawn published (CB_InPlay via markInPlay, CB_Ready via
		// the vote clear) — no server-side page refresh any more.
	});
}

// ---- Top Table Phase 2: team page, invites, rename ------------------------
// (The CreateTeam / InvitePopup / RenamePopup ScreenGuis are CLIENT-owned
// since migration Phase 4 — the server publishes team/vote/invite/rename
// state as attributes and the client renders it.)

// ---- vote start (the team page is a mini lobby) ---------------------------
// Play is a ready vote: every member must press it, then the whole team
// spawns together. A lobby team's members are ALWAYS all in the lobby —
// invites can't be accepted into a team that started playing (team.inPlay)
// and joinRandom never fills lobby teams — so there are no exemptions. Votes
// reset on any membership change so a new arrival is never launched by stale
// votes.
const teamReadyVotes = new Map<string, Set<Player>>();

/** Publishes each member's vote as the CB_Ready player attribute (the client
 * lobby renders the READY checkmarks from it). */
function publishReadyVotes(team: LadderTeam) {
	const votes = teamReadyVotes.get(team.id);
	for (const member of team.members) {
		UiState.setPlayerAttr(member, "CB_Ready", votes !== undefined && votes.has(member) ? true : undefined);
	}
}

/** Drops a team's vote set AND clears the published CB_Ready mirrors —
 * everywhere the old code did teamReadyVotes.delete(team.id). */
function clearTeamVotes(team: LadderTeam) {
	teamReadyVotes.delete(team.id);
	for (const member of team.members) {
		UiState.setPlayerAttr(member, "CB_Ready", undefined);
	}
}

// Lobbies whose vote completed while no round was spawnable (the end-of-round
// interlude, or the shop window): held on "STARTING SOON…" and launched by the
// shop-phase auto start — members carry CB_PendingLaunch so MatchDirector
// shows them the NEXT ROUND countdown and includes them in the auto-spawn.
const pendingLaunchTeams = new Set<string>();

function cancelPendingLaunch(team: LadderTeam) {
	if (!pendingLaunchTeams.delete(team.id)) {
		return;
	}
	pcall(() => team.robloxTeam.SetAttribute("CB_Pending", false));
	for (const member of team.members) {
		member.SetAttribute("CB_PendingLaunch", undefined);
	}
}

/** Every member voted → spawn the team together, or hold on STARTING SOON
 * when there is no live round to spawn into. */
function tryLaunchTeam(team: LadderTeam) {
	if (pendingLaunchTeams.has(team.id)) {
		return;
	}
	const votes = teamReadyVotes.get(team.id);
	if (!votes || team.members.size() === 0) {
		return;
	}
	for (const member of team.members) {
		if (!votes.has(member)) {
			return;
		}
	}
	if (!footballMatch.isRoundLive() || Globals.shopPhaseActive === true) {
		pendingLaunchTeams.add(team.id);
		pcall(() => team.robloxTeam.SetAttribute("CB_Pending", true));
		for (const member of team.members) {
			member.SetAttribute("CB_PendingLaunch", true);
		}
		warn(`[TeamLobby] ${team.name} vote complete — STARTING SOON (rides the next-round countdown)`);
		return;
	}
	clearTeamVotes(team);
	warn(`[TeamLobby] ${team.name} vote complete — launching ${team.members.size()} player(s)`);
	for (const member of team.members) {
		// spawnIntoMatch flips each member to "spawning", which hides their
		// client-rendered lobby page.
		spawnIntoMatch(member);
	}
}

Players.PlayerRemoving.Connect((player) => {
	// Drop the leaver's votes, then re-check every voting team: if the leaver
	// was the only unready member, the rest should launch, not sit waiting.
	// (A pending team stays pending — the rest are all ready and the auto
	// start will take them.)
	task.defer(() => {
		const affectedIds: string[] = [];
		for (const [teamId, votes] of teamReadyVotes) {
			votes.delete(player);
			affectedIds.push(teamId);
		}
		for (const teamId of affectedIds) {
			const team = TeamRegistry.getTeamById(teamId);
			if (team) {
				publishReadyVotes(team);
				tryLaunchTeam(team);
			}
		}
	});
});

TeamRegistry.onTeamDisbanded((team) => {
	teamReadyVotes.delete(team.id);
	pendingLaunchTeams.delete(team.id);
	// Outstanding invites to the dead team are void — clear them so the client
	// popups close (accepting would only have hit the teamExists failure path).
	for (const player of Players.GetPlayers()) {
		const invite = decodeInvite(player);
		if (invite !== undefined && invite.teamId === team.id) {
			UiState.setPlayerAttr(player, "CB_Invite", undefined);
		}
	}
});

// ---- lobby intents (old CreateTeam page button bodies) ---------------------
// The CreateTeam ScreenGui is client-rendered (menu.client.ts) from team
// attributes + CB_Ready; its buttons arrive as intents handled at the bottom
// of this file, which call these bodies — the same logic the server-wired
// buttons ran, minus the UI writes.

/** Intent_ReadyVote — the old team-page Play button body. */
function readyVote(player: Player) {
	const team = TeamRegistry.getTeamOf(player);
	if (!team || pendingLaunchTeams.has(team.id)) {
		return;
	}
	let votes = teamReadyVotes.get(team.id);
	if (!votes) {
		votes = new Set();
		teamReadyVotes.set(team.id, votes);
	}
	if (team.members.size() <= 1) {
		// Solo team: no vote to hold — tryLaunchTeam spawns immediately,
		// or holds on STARTING SOON when no round is spawnable.
		votes.add(player);
	} else if (votes.has(player)) {
		votes.delete(player);
	} else {
		votes.add(player);
	}
	publishReadyVotes(team);
	tryLaunchTeam(team);
}

/** Intent_LeaveTeam — the old team-page Leave button body. */
function leaveTeamToLanding(player: Player) {
	const team = TeamRegistry.getTeamOf(player);
	if (team) {
		// Cancel BEFORE leaveTeam so the leaver's pending marker clears too.
		cancelPendingLaunch(team);
	}
	// The leaver drops out of team.members inside leaveTeam, so clear their
	// published vote explicitly.
	UiState.setPlayerAttr(player, "CB_Ready", undefined);
	TeamRegistry.leaveTeam(player);
	if (team) {
		// Membership changed: stale votes must not launch the rest.
		clearTeamVotes(team);
	}
	enterLandingState(player);
}

/** Garage BackToMenu / Intent_ExitToLanding — the old back-button body.
 * EXIT TEAM: leaving the team is what disconnects the player from the
 * shop-phase auto start (auto-spawn only takes teamed players). */
function exitToLanding(player: Player) {
	const team = TeamRegistry.getTeamOf(player);
	if (team) {
		// Defensive: if this player is somehow still rostered on a pitch (menu
		// shown over a live match), leaving the TEAM without leaving the MATCH
		// stranded a teamless roster entry nothing ever cleaned. No-op for the
		// normal shop-phase press.
		footballMatch.leaveMatch(player);
		UiState.setPlayerAttr(player, "CB_Ready", undefined);
		TeamRegistry.leaveTeam(player);
		clearTeamVotes(team);
	}
	enterLandingState(player);
}

// ---- published invite state ------------------------------------------------
// One outstanding invite per target, published as the CB_Invite player
// attribute (JSON) — the client renders the popup from it and answers with
// Intent_ResolveInvite. Replaces the old sendInvitePopup + inviteGen /
// inviteConnections server-side popup wiring.

interface InvitePayload {
	fromUserId: number;
	fromName: string;
	teamId: string;
	teamName: string;
}

const INVITE_LIFETIME = 30;

function decodeInvite(player: Player): InvitePayload | undefined {
	const raw = player.GetAttribute("CB_Invite");
	if (!typeIs(raw, "string") || raw === "") {
		return undefined;
	}
	const [ok, decoded] = pcall(() => HttpService.JSONDecode(raw) as InvitePayload);
	if (!ok || !typeIs(decoded, "table")) {
		return undefined;
	}
	return decoded as InvitePayload;
}

function sendInvite(target: Player, from: Player) {
	const team = TeamRegistry.getTeamOf(from);
	// No invites for playing teams (referral popups can arrive long after the
	// lobby launched) — joining mid-play is only via the allow-randoms path.
	if (!team || team.inPlay || team.members.size() >= 3) {
		return;
	}
	// Same audience the old invite rows offered: anyone in the server who is
	// not already on the inviter's team.
	if (target === from || TeamRegistry.getTeamOf(target) === team) {
		return;
	}
	const payload: InvitePayload = {
		fromUserId: from.UserId,
		fromName: from.DisplayName,
		teamId: team.id,
		teamName: team.name,
	};
	const encoded = HttpService.JSONEncode(payload);
	UiState.setPlayerAttr(target, "CB_Invite", encoded);
	// Same 30 s lifetime the old inviteGen timeout enforced. A newer invite
	// overwrites the attribute, so a stale timer only ever clears its own
	// payload (an identical re-sent invite shares the fate of the first —
	// acceptable, the re-send window is the same 30 s).
	task.delay(INVITE_LIFETIME, () => {
		if (target.Parent !== undefined && target.GetAttribute("CB_Invite") === encoded) {
			UiState.setPlayerAttr(target, "CB_Invite", undefined);
		}
	});
}

/** Intent_ResolveInvite: validate against the published invite + the CURRENT
 * team state (during the invite's 30 s lifetime the lobby may have launched
 * into a round, filled up, or disbanded — accepting must fail with a message,
 * never join a playing team), then run the old Accept body. */
function resolveInvite(target: Player, accept: boolean) {
	const invite = decodeInvite(target);
	if (invite === undefined) {
		return;
	}
	UiState.setPlayerAttr(target, "CB_Invite", undefined);
	if (!accept) {
		return;
	}
	const team = TeamRegistry.getTeamById(invite.teamId);
	let failText: string | undefined;
	if (team === undefined) {
		failText = `${invite.teamName} no longer exists`;
	} else if (team.inPlay) {
		failText = `${invite.teamName} already started playing`;
	} else if (team.members.size() >= 3) {
		failText = `${invite.teamName} is full`;
	}
	if (failText !== undefined || team === undefined) {
		// The old popup swapped to a buttons-hidden "Sorry — X!" for 2.5 s; the
		// client renders the same from CB_InviteError.
		const message = `Sorry — ${failText}!`;
		UiState.setPlayerAttr(target, "CB_InviteError", message);
		task.delay(2.5, () => {
			if (target.Parent !== undefined && target.GetAttribute("CB_InviteError") === message) {
				UiState.setPlayerAttr(target, "CB_InviteError", undefined);
			}
		});
		return;
	}
	const oldTeam = TeamRegistry.getTeamOf(target);
	const wasInMatch = footballMatch.isInMatch(target);
	if (!TeamRegistry.addToTeam(target, team)) {
		warn(`[Invite] ${target.Name} accepted but ${team.name} is full/gone`);
		return;
	}
	// Membership changed on both sides — stale ready votes or a pending launch
	// must not carry anyone who didn't vote.
	cancelPendingLaunch(team);
	clearTeamVotes(team);
	if (oldTeam) {
		cancelPendingLaunch(oldTeam);
		clearTeamVotes(oldTeam);
	}
	target.SetAttribute("CB_PendingLaunch", undefined);
	// Accepting mid-match pulls the player off their pitch (the pitch falls
	// back / rebalances like a disconnect), then the accepter lands in the new
	// team's mini lobby. Accepting mid-SPAWN is covered by the flow state:
	// enterLobbyState writes "lobby", and the in-flight spawn stands down at
	// its next checkpoint (menu-family supersession also cleans up its car).
	const [ok, err] = pcall(() => {
		if (wasInMatch) {
			footballMatch.leaveMatch(target);
			ResetAndInitialisePlayerMenuUI(target);
		}
		enterLobbyState(target);
	});
	if (!ok) {
		warn(`[Invite] opening the lobby for ${target.Name} failed: ${err}`);
	}
}

// ---- rename ----------------------------------------------------------------
// The RenamePopup ScreenGui is client-owned: the client opens it locally when
// a rename button (lobby header, or the client-owned Garage's TeamNameStrip)
// is pressed with credits in hand (CB_RenameCredits), or when a purchased
// credit arrives (the client watches CB_RenameCredits). Intent_RequestRename
// is therefore only the PURCHASE path now — Phase 5 retired the
// CB_RenamePrompt open-ping. Submission still travels over
// CarBallRemotes.SubmitTeamName; feedback is published as CB_RenameStatus.

function handleRenameRequest(player: Player) {
	if (TeamRegistry.getRenameCredits(player) > 0) {
		// Credits in hand: the client opens its popup locally without asking
		// us — reaching here means a stale/raced request; nothing to do (the
		// client's CB_RenameCredits watcher has already opened the popup).
		return;
	}
	if (RENAME_PRODUCT_ID === 0) {
		// Product not created in the dashboard yet — free credit so the flow
		// stays testable in Studio.
		warn("[Rename] RENAME_PRODUCT_ID not set — granting a free test credit");
		TeamRegistry.grantRenameCredit(player);
		return; // the client's credit-attribute watcher opens the popup
	}
	MarketplaceService.PromptProductPurchase(player, RENAME_PRODUCT_ID);
}

// Typed rename submissions (client fires with the TextBox contents). Result
// feedback via CB_RenameStatus: "" closes the popup ("ok" — and "nocredit",
// which closed it before too), "moderated"/"error" show the matching status
// line client-side.
CarBallRemotes.SubmitTeamName.OnServerEvent.Connect((player, raw) => {
	if (!typeIs(raw, "string")) {
		return;
	}
	UiState.setPlayerAttr(player, "CB_RenameStatus", "pending");
	const result = TeamRegistry.tryRename(player, raw);
	if (result === "ok" || result === "nocredit") {
		// (The client-owned Garage's CurrentTeamName strip re-renders itself
		// from the team's CB_TeamName attribute — no server label write.)
		UiState.setPlayerAttr(player, "CB_RenameStatus", "");
	} else if (result === "moderated") {
		UiState.setPlayerAttr(player, "CB_RenameStatus", "moderated");
	} else {
		UiState.setPlayerAttr(player, "CB_RenameStatus", "error");
	}
});

// (backButtonLabel / ensureGarageMenuButtons are DELETED — Phase 5: the
// Garage BackToMenu button and TeamNameStrip are built client-side in
// src/client/ui/garage.client.ts; BackToMenu fires Intent_ExitToLanding and
// the strip renders live from the team's CB_TeamName attribute.)

const resetting = new Map<Player, boolean>();

// One spawn flight per player. Concurrent SpawnInPlayer calls (shop auto-spawn
// firing while a manual click's LoadCharacter is still in flight, double
// clicks during the round-boundary hold below) ran two LoadCharacter +
// SpawnVehicle sequences at once: the second KillVehicle destroyed the first
// car mid-SeatPlayer and left the player seated in nothing — no car, no
// controls, for the whole round. os.clock stamp (not a plain flag) so a spawn
// thread that dies mid-flight can never lock the player out forever.
const spawnInFlight = new Map<Player, number>();
const activeSpawnGeneration = new Map<Player, number>();
const pendingSpawnGeneration = new Map<Player, number>();
const SPAWN_IN_FLIGHT_TIMEOUT = 45;

Globals.SpawnInPlayer = (player: Player): boolean => {
	const startedAt = spawnInFlight.get(player);
	if (startedAt !== undefined && os.clock() - startedAt < SPAWN_IN_FLIGHT_TIMEOUT) {
		const currentGeneration = flowGeneration.get(player);
		if (
			getFlowState(player) === "spawning" &&
			currentGeneration !== undefined &&
			currentGeneration !== activeSpawnGeneration.get(player)
		) {
			pendingSpawnGeneration.set(player, currentGeneration);
		}
		warn(`[SpawnInPlayer] ${player.Name} is already spawning — duplicate call ignored`);
		// "true": the in-flight spawn is handling this player; a false here
		// would make spawnIntoMatch force the menu state OVER the live spawn.
		return true;
	}
	const flowGen = claimFlowState(player, "spawning");
	spawnInFlight.set(player, os.clock());
	activeSpawnGeneration.set(player, flowGen);
	const [ok, result] = pcall(() => spawnInPlayerInner(player, flowGen));
	spawnInFlight.delete(player);
	activeSpawnGeneration.delete(player);
	const retryGeneration = pendingSpawnGeneration.get(player);
	pendingSpawnGeneration.delete(player);
	if (
		retryGeneration !== undefined &&
		ownsFlow(player, retryGeneration) &&
		getFlowState(player) === "spawning" &&
		player.Parent !== undefined
	) {
		task.defer(() => {
			const [retryOk, retryResult] = pcall(() => Globals.SpawnInPlayer(player));
			if (!retryOk || retryResult !== true) {
				ResetAndInitialisePlayerMenuUI(player);
			}
		});
	}
	if (!ok) {
		error(result);
	}
	return result === true;
};

function spawnInPlayerInner(player: Player, flowGen: number): boolean {
	warn(`[SpawnInPlayer] ENTER ${player.Name}`);
	// The spawn claims the UI flow: CB_FlowState = "spawning". (spawnIntoMatch
	// already wrote it at the button press; writing again here also covers the
	// direct Globals.SpawnInPlayer callers — the shop auto-spawn and the
	// gamepad Y handler.)
	// True (and cleans up) when a newer flow claimed the player's UI while this
	// spawn was inside one of its yields — i.e. CB_FlowState is no longer the
	// "spawning" this thread wrote. Returning true afterwards is deliberate:
	// the newer flow owns the UI, so spawnIntoMatch's failure path must NOT
	// stomp it by forcing the menu flow state on top.
	const standDownIfSuperseded = (stage: string): boolean => {
		const state = getFlowState(player);
		if (ownsFlow(player, flowGen)) {
			return false;
		}
		warn(`[SpawnInPlayer] superseded ${stage} for ${player.Name} (flow state ${tostring(state)}) — standing down`);
		if (isMenuFamily(state)) {
			// A menu flow owns the UI now (round-end sendToMenu, an accepted
			// invite, a menu re-init) — put the world half back the way menu
			// players are left (stop()/leaveMatch idiom): off any pitch
			// roster, dead character, no match car. leaveMatch no-ops when
			// this spawn never reached a roster, hence the direct cleanup too.
			pcall(() => footballMatch.leaveMatch(player));
			pcall(() => {
				const character = player.Character;
				const humanoid = character?.FindFirstChildOfClass("Humanoid");
				if (humanoid) {
					humanoid.Health = 0;
				}
				const vehicle = Globals.vehiclesTable[player.UserId];
				const vehiclesFolder = game.Workspace.FindFirstChild("Vehicles");
				if (
					vehicle !== undefined &&
					vehiclesFolder !== undefined &&
					vehicle.model.IsDescendantOf(vehiclesFolder)
				) {
					// Match car only — a garage display car spawned by the
					// menu flow lives under the garage's VehicleFolder and
					// belongs to that flow.
					spawnVehicle.KillVehicle(player);
				}
			});
		}
		return true;
	};

	// Round-boundary hold: pressing a spawn button during the end-of-round
	// interlude (victory scene → ladder map → summary, ~20 s) used to roster
	// the player onto a pitch stop() was about to tear down — the car died
	// mid-seat and the roster entry leaked into the next round. Hold here
	// until the next round's pitches exist, then spawn into them normally
	// (same as the "landing buttons still work during the shop" path).
	if (Globals.gamemode === "Football" && !footballMatch.isRoundLive()) {
		warn(`[SpawnInPlayer] ${player.Name} spawning during the interlude — holding for the next round`);
		let waited = 0;
		while (!footballMatch.isRoundLive() && waited < 30 && player.Parent !== undefined) {
			task.wait(0.5);
			waited += 0.5;
		}
		if (player.Parent === undefined) {
			return false;
		}
		// The hold is a multi-second yield of its own — a round-end sendToMenu
		// or accepted invite during it owns the UI now.
		if (standDownIfSuperseded("during the interlude hold")) {
			return true;
		}
	}
	Globals.clearPlayerGarage(player);

	// (The original destroyed every PlayerGui child here; since Phase 7 every
	// ScreenGui is client-owned and never destroyed — the client menus hide
	// themselves when CB_FlowState reads "spawning".)

	// Mark this engine spawn as requested: initializePlayer's CharacterAdded
	// guard destroys any character that appears WITHOUT this mark (boot-race
	// auto-loads at 0,0,0). Cleared by ResetAndInitialisePlayerMenuUI.
	player.SetAttribute("CB_ExpectCharacter", true);
	player.LoadCharacter();
	warn(`[SpawnInPlayer] after LoadCharacter Character=${player.Character?.GetFullName() ?? "nil"}`);
	if (standDownIfSuperseded("during LoadCharacter")) {
		return true;
	}
	// (The original relied on the engine re-cloning StarterGui into PlayerGui on
	// LoadCharacter; the client-owned guis are mounted once at boot instead and
	// derive their visibility from CB_FlowState & friends.)
	FunctionsAndEvents.ToggleMenuCamera.FireClient(player, false);

	// (The original's "Spawning in N" TimerGui countdown was already retired;
	// the TimerGui is client-owned now — see src/client/ui/timer.client.ts.)

	// (The client-owned Garage hides itself: CB_FlowState left "garage" at the
	// top of this spawn.)
	//workspace:WaitForChild(player.Name)
	(player.FindFirstChild("spawned") as NumberValue).Value += 1;
	// (Phase 6: Game.Enabled is CLIENT-derived — gameHud.client.ts enables the
	// HUD while CB_FlowState is "match", or "spawning" once the character
	// exists, which is exactly this point: the flow wrote "spawning" above and
	// LoadCharacter just ran. The old playerGuiOf(player).Game.Enabled = true
	// write is that same edge.)

	const playerMoney = DataStore2("money", player);
	setPlayerCash(player, playerMoney.Get(DataStoreDefaults.money) as number);

	// Football (Phase 3b): every spawner needs a ladder team first (joinRandom
	// is a no-op if teamed — covers the garage Spawn button path); the match
	// layer routes the team to its pitch and hands out that pitch's spawn
	// point. Spawn points live INSIDE pitch folders now; the flat
	// Workspace.SpawnPoints folder is only a legacy fallback.
	let spawnCFrame: CFrame | undefined;
	if (Globals.gamemode === "Football") {
		TeamRegistry.joinRandom(player);
		// Spawning is THE transition out of the lobby state: markInPlay seats
		// the team on the ladder (lobby teams have no position/pitch) and
		// permanently closes it to invites; any held launch state is spent.
		const ladderTeam = TeamRegistry.getTeamOf(player);
		if (ladderTeam) {
			TeamRegistry.markInPlay(ladderTeam);
			if (pendingLaunchTeams.delete(ladderTeam.id)) {
				pcall(() => ladderTeam.robloxTeam.SetAttribute("CB_Pending", false));
			}
			clearTeamVotes(ladderTeam);
		}
		player.SetAttribute("CB_PendingLaunch", undefined);
		spawnCFrame = footballMatch.getSpawnCFrame(player);
	}
	if (spawnCFrame === undefined) {
		const spawnParts: BasePart[] = [];
		// FindFirstChild, not a direct index: PitchManager CLEARS this legacy
		// folder on every round build, and a missing/empty folder must mean
		// "no spawn" (clean false → caller returns the player to the menu),
		// never a throw that strands the character LoadCharacter just put at
		// the world origin.
		const legacySpawnPoints = game.Workspace.FindFirstChild("SpawnPoints");
		if (legacySpawnPoints) {
			for (const descendant of legacySpawnPoints.GetDescendants()) {
				if (descendant.IsA("BasePart")) {
					spawnParts.push(descendant);
				}
			}
		}
		if (spawnParts.size() === 0) {
			warn(`[SpawnInPlayer] ABORT no pitch spawn point and no legacy SpawnPoints — cannot spawn vehicle`);
			return false;
		}
		spawnCFrame = spawnParts[math.random(1, spawnParts.size()) - 1].CFrame;
	}
	if (Globals.gamemode === "Football") {
		// Lock marker BEFORE seating: the sim's sit-edge context enable fires
		// inside SpawnVehicle's internal waits, ~2s before onPlayerSpawned —
		// without the marker that window is fully drivable mid-match.
		footballMatch.preSpawnLock(player);
	}
	spawnVehicle.SpawnVehicle(player, true, DataUtilities.getPlayerEquippedVehicle(player), spawnCFrame);

	// SpawnVehicle spans ~2s of internal waits — the widest window for a
	// round-end sendToMenu / accepted invite to claim the menu flow state.
	// Without this check the code below ran match bookkeeping (onPlayerSpawned)
	// on top of a menu-family CB_FlowState and the player ended up seated in a
	// match car with the client-rendered menu still on screen.
	if (standDownIfSuperseded("during SpawnVehicle")) {
		return true;
	}

	// SpawnVehicle can abort WITHOUT throwing (missing template, car destroyed
	// mid-choreography by a sweeper, SeatPlayer bailing before Sit). Every one
	// of those left the player as a raw walking character at the LoadCharacter
	// spawn — the world origin, since no SpawnLocation exists — with the match
	// HUD on and the round running without them. Verify car + occupied seat
	// before declaring success; callers route `false` back to the menu, which
	// clears the character.
	const spawnedVehicle = Globals.vehiclesTable[player.UserId];
	const spawnedSeat = spawnedVehicle?.model.FindFirstChildWhichIsA("VehicleSeat", true);
	const spawnedRoot = spawnedVehicle?.model.FindFirstChild("VehicleRoot");
	const v2Ready =
		spawnedVehicle?.model.GetAttribute(CarModelAttr.V2) !== undefined &&
		spawnedRoot !== undefined &&
		spawnedRoot.IsA("BasePart") &&
		spawnedRoot.GetAttribute(CarAttr.Driving) === true;
	const legacyReady = spawnedSeat !== undefined && spawnedSeat.Occupant !== undefined;
	if (
		spawnedVehicle === undefined ||
		spawnedVehicle.model.Parent === undefined ||
		(!v2Ready && !legacyReady)
	) {
		warn(`[SpawnInPlayer] ABORT no driven vehicle after SpawnVehicle for ${player.Name}`);
		if (Globals.gamemode === "Football") {
			// Un-roster cleanly (clears CB_Side/CB_PitchId/lock marker) so the
			// pitch doesn't wait on a ghost; the shop-phase auto start retries
			// this player next round.
			pcall(() => footballMatch.leaveMatch(player));
		}
		return false;
	}

	if (Globals.gamemode === "Football") {
		// onPlayerSpawned starts the countdown/lock bookkeeping; the marker set
		// by preSpawnLock already kept the sit-edge enable from firing.
		// (MatchHud is CLIENT-mounted now — matchHud.client.ts derives its
		// Enabled from the CB_PitchId attribute the roster flow already set.)
		footballMatch.onPlayerSpawned(player);
	}
	// (Legacy KillVehicle reset button, long disabled: 10 s "Resetting in 10
	// seconds" delay, then killstreak zeroed, character killed,
	// spawnVehicle.KillVehicle(player, true) and back to the menu via
	// ResetAndInitialisePlayerMenuUI — the `resetting` debounce map guarded it.)

	task.wait(1);
	//game.ReplicatedStorage.FunctionsAndEvents.ToggleMenuCamera:FireClient(player,false)
	// Final yield above is the last window a menu flow can land in — if it did,
	// clean up the now-stray car/character so the player really is in the menu.
	if (standDownIfSuperseded("after spawn")) {
		return true;
	}
	// Spawn completed and still owns the flow — the player is in the match.
	claimFlowState(player, "match");
	return true;
}

function initialisePlayerUi(player: Player, flowGen: number) {
	// Callers (initializePlayer / ResetAndInitialisePlayerMenuUI) set the
	// flow state to "menu" before calling; this run owns the UI only while
	// CB_FlowState still reads "menu" after its yields.
	task.spawn(() => {
		DataStore2.SaveAll(player);
	});
	let playerGarage: ReturnType<typeof Globals.addPlayerToGarage> | undefined = Globals.addPlayerToGarage(player);

	// Break the streaming deadlock: with CharacterAutoLoads off there is no
	// character to anchor streaming near the garage, and the client camera only
	// moves there after the garage has streamed in. Explicitly pull the area
	// around the garage to this client.
	{
		const garageForStream = playerGarage;
		task.spawn(() => {
			pcall(() => {
				const bodyCamera = garageForStream.Cameras.FindFirstChild("Body");
				if (bodyCamera && bodyCamera.IsA("BasePart")) {
					player.RequestStreamAroundAsync(bodyCamera.Position, 10);
				}
			});
		});
	}

	const playerMoney = DataStore2("money", player);

	setPlayerCash(player, playerMoney.Get(DataStoreDefaults.money) as number);
	setPlayerTrophies(player, DataStore2("trophies", player).Get(DataStoreDefaults.trophies) as number);

	// The Gets above yield on a cold/throttled datastore (live-server latency
	// Studio never showed). If a NEWER flow claimed the UI in that window — a
	// spawn ("spawning"/"match": the shop-end auto-spawn, a PLAY press) or
	// another menu flow (an accepted invite's "lobby") — enabling the menus /
	// re-forcing the menu camera now would paint over it. Callers set "menu"
	// right before this ran, so any other value means superseded — stand down.
	if (!ownsFlow(player, flowGen) || getFlowState(player) !== "menu") {
		warn(
			`[initialisePlayerUi] superseded for ${player.Name} (flow state ${tostring(
				getFlowState(player),
			)}) — leaving the UI to the newer flow`,
		);
		return;
	}

	FunctionsAndEvents.ToggleMenuCamera.FireClient(player, true, playerGarage);

	// Landing page first (Top Table §5) — except during the between-rounds
	// shop window, when everyone lands straight on the CARS page with the
	// restart countdown already ticking. (Both pages are CLIENT-rendered from
	// CB_FlowState now — the server contributes state, camera and display car.)
	const [landOk, landErr] = pcall(() => {
		if (Globals.shopPhaseActive === true) {
			// CARS page = "garage": counted by the shop countdown/auto-spawn
			// (unlike "menu"/"lobby"), skipped by the round-end sendToMenu.
			enterGarageState(player);
		} else {
			enterLandingState(player);
		}
	});
	if (!landOk) {
		warn(`[initialisePlayerUi] menu init error: ${landErr}`);
	}
	playerGarage = undefined;
	//wait(3)
	//player:LoadCharacter()
	//game.ReplicatedStorage.FunctionsAndEvents.ToggleMenuCamera:FireClient(player,false)

	//local rand = math.random(1, #workspace.SpawnPoints:GetChildren())
	//local spawnPoint = workspace.SpawnPoints:GetChildren()[rand]
	//spawnVehicle.SpawnVehicle(player, true, DataUtilities.getPlayerEquippedVehicle(player), spawnPoint.CFrame)

}

//removes players garage and sets door playerValue to nil

function setPlayerCash(player: Player, money: number) {
	// Pure publication since Phase 6: BOTH money labels are client-rendered now
	// (the Garage's by garage.client.ts, the Game HUD's by gameHud.client.ts)
	// from this attribute.
	UiState.setPlayerAttr(player, "CB_Money", money);
}

function setPlayerTrophies(player: Player, trophies: number) {
	// Garage-only label originally — now purely the CB_Trophies publication
	// (the client Garage renders "🏆 N" from it).
	UiState.setPlayerAttr(player, "CB_Trophies", trophies);
}

// (enablePayOrSpectate DELETED in Phase 5: it was the deathmatch-era writer of
// the payOrSpectate frame INSIDE the Garage gui, and nothing has called it
// since the Football rework — dead code, and the Garage is client-owned now.
// The payOrSpectate/cantRespawn frames remain, dormant, in the client-mounted
// GarageGui component; if a deathmatch mode returns, publish a CB_* attribute
// and let the client render them.)

/** Phase 6 replacement for showKilledByScreen + enableSpectateScreen (the
 * dormant non-football death path): the Game gui is CLIENT-owned, so the
 * server publishes WHO killed the player as the CB_Killer attribute (JSON) and
 * fires the existing spectatePlayer remote (gameUi.client.ts still owns the
 * spectate camera + Left/Right cycling — contract unchanged).
 * gameHud.client.ts renders the WhoKilledYou banner (9 s auto-hide,
 * click-dismiss — both client-local now) and the Spectate frame from the
 * attribute; its Respawn button fires Intent_ReturnToMenu, handled below.
 * kills+1 mirrors the original label (it read the stat before roundHandler's
 * increment landed); the headshot is fetched client-side from the userId. */
function beginSpectate(player: Player, killer: Player) {
	const killsValue = killer.FindFirstChild("kills");
	const payload = {
		name: killer.Name,
		kills: (killsValue && killsValue.IsA("NumberValue") ? killsValue.Value : 0) + 1,
		userId: killer.UserId,
	};
	UiState.setPlayerAttr(player, "CB_Killer", HttpService.JSONEncode(payload));
	FunctionsAndEvents.spectatePlayer.FireClient(player, killer);
}

// (CharacterAutoLoads = false moved to the top of this script's body — see the
// comment there. Keeping the flag OFF is what makes a character in the menu
// flow always a bug.)

function ResetAndInitialisePlayerMenuUI(player: Player) {
	// Take the UI over from any in-flight spawn (it stands down at its next
	// checkpoint instead of re-enabling gameplay UI on top of the menus).
	const flowGen = claimFlowState(player, "menu");
	// Any spectate/killed-by presentation ends with the return to the menu
	// (the old flow hid both frames on the Respawn press; every path into the
	// menu goes through here).
	UiState.setPlayerAttr(player, "CB_Killer", undefined);
	// Menu-flow players never have a character (menu camera + garage). Any
	// character reaching here is a leftover: SpawnInPlayer's LoadCharacter
	// after a failed spawn attempt, or a boot-race engine auto-load — standing
	// at the world origin, since the place has no SpawnLocation. Destroying it
	// also kills the owned car via spawnVehicle's CharacterRemoving hook, and
	// lets the MenuCameraReady handshake re-aim the menu camera (it refuses
	// while a character exists).
	player.SetAttribute("CB_ExpectCharacter", undefined);
	const leftoverCharacter = player.Character;
	if (leftoverCharacter) {
		leftoverCharacter.Destroy();
	}
	// (The original destroyed every PlayerGui child and re-cloned StarterGui
	// here — since Phase 7 the client-owned guis mount once and re-render from
	// the "menu" flow state written above; a PlayerGui barrier is no longer
	// needed because no server-side GUI work follows.)

	initialisePlayerUi(player, flowGen);
}

Globals.PlayerJoinedTimes = {};

function createValues(player: Player) {
	const kills = new Instance("NumberValue");
	const deaths = new Instance("NumberValue");
	const damageDealt = new Instance("NumberValue");
	const survivalTime = new Instance("NumberValue");
	const spawned = new Instance("NumberValue");

	kills.Name = "kills";
	deaths.Name = "deaths";
	damageDealt.Name = "damageDealt";
	survivalTime.Name = "survivalTime";
	spawned.Name = "spawned";

	kills.Value = 0;
	deaths.Value = 0;
	damageDealt.Value = 0;
	survivalTime.Value = -1;
	spawned.Value = 0;

	kills.Parent = player;
	deaths.Parent = player;
	damageDealt.Parent = player;
	survivalTime.Parent = player;
	spawned.Parent = player;
}

const initializedPlayers = new Set<Player>();

function initializePlayer(player: Player) {
	// Team Test can create players before this script finishes requiring its
	// dependencies. In that case PlayerAdded has already fired and Roblox may
	// also have auto-loaded a character before CharacterAutoLoads was disabled.
	if (initializedPlayers.has(player)) return;
	initializedPlayers.add(player);

	// Production DataStore resilience: DataStore2.Get() retries FOREVER when
	// the service errors (no backup was configured anywhere) — a launch-day
	// outage or throttle wedged join/spawn threads mid-flow, leaving players
	// with no menu (or standing at 0,0,0 mid-SpawnInPlayer) and the game never
	// starting. After 5 failed attempts Get() now falls back to the provided
	// defaults; DataStore2 marks the session as a backup so those defaults are
	// never saved over the player's real data. All keys are combined into one
	// store, so this single call covers every key.
	DataStore2("money", player).SetBackup(5);

	const existingCharacter = player.Character;
	if (existingCharacter) {
		existingCharacter.Destroy();
	}
	// The destroy above only helps when the auto-loaded character ALREADY
	// exists. A player admitted while this script was still evaluating (the
	// engine will do that on a slow production cold boot, with
	// CharacterAutoLoads still true) can have their character materialize
	// AFTER that check — it then stands at the world origin forever (no
	// SpawnLocation in the place, and nothing else ever removes it, while the
	// MenuCameraReady handshake refuses to aim the menu camera as long as a
	// character exists). Destroy any character that appears without
	// SpawnInPlayer having requested it.
	player.CharacterAdded.Connect((character) => {
		if (player.GetAttribute("CB_ExpectCharacter") !== true) {
			warn(`[initializePlayer] destroying stray auto-loaded character for ${player.Name}`);
			character.Destroy();
		}
	});

	//task.wait(0.2)
	Globals.PlayerJoinedTimes[player.UserId] = os.time();

	// (The old `player.WaitForChild("PlayerGui")` barrier + StarterGui clone
	// step is gone — the client mounts its own guis; nothing below touches
	// PlayerGui or depends on it existing yet.)

	// Initial flow state: the menu. Written BEFORE the (yieldy)
	// initialisePlayerUi so the client-owned landing page can paint
	// immediately and order-independently of the DataStore reads.
	const flowGen = claimFlowState(player, "menu");

	// Phase 5: CB_ProfileVersion counter + OnUpdate hooks on every
	// owned/equipped dataset (the client garage refetches Ui_GetProfile on
	// version bumps).
	profileSnapshot.registerPlayer(player);

	createValues(player);
	initialisePlayerUi(player, flowGen);

	// (Rename purchase completions: the CLIENT watches CB_RenameCredits and
	// opens its own RenamePopup when a credit arrives — the server-side
	// watcher moved to menu.client.ts in Phase 4.)

	// Game-invited friends: offer the referrer's team on arrival (join data
	// carries ReferredByPlayerId for game invites; absent in Studio tests).
	task.spawn(() => {
		const [ok, joinData] = pcall(() => player.GetJoinData());
		if (!ok) {
			return;
		}
		const referrerId = (joinData as { ReferredByPlayerId?: number }).ReferredByPlayerId;
		if (referrerId !== undefined && referrerId !== 0) {
			const referrer = Players.GetPlayerByUserId(referrerId);
			if (referrer && TeamRegistry.getTeamOf(referrer)) {
				task.wait(3); // let the landing page mount first
				sendInvite(player, referrer);
			}
		}
	});

	const playerMoney = DataStore2("money", player);

	playerMoney.OnUpdate((newValue) => {
		setPlayerCash(player, newValue as number);
	});

	const playerTrophies = DataStore2("trophies", player);

	playerTrophies.OnUpdate((newValue) => {
		setPlayerTrophies(player, newValue as number);
	});

	// (The old vehicles OnUpdate → setTab.Inventory server re-render is gone:
	// profileSnapshot.registerPlayer's hook bumps CB_ProfileVersion instead and
	// the client garage re-renders its own Cars grid.)

	//change to do garage ui stuff
	// player.CharacterAdded:Connect(function(character)
	// 	-- find the humanoid, and detect when it dies
	// 	local humanoid = character:FindFirstChild("Humanoid")
	// 	if humanoid then
	// 		humanoid.Died:Connect(function()
	// 			ResetAndInitialisePlayerMenuUI(player)
	// 		end)
	// 	end
	// end)
}

Players.PlayerAdded.Connect(initializePlayer);

// PlayerAdded is not retroactive. This is required by Studio Team Test, where
// clients can join while the server is still evaluating this script's imports.
for (const player of Players.GetPlayers()) {
	task.spawn(() => initializePlayer(player));
}

// ---- gamepad menu buttons ---------------------------------------------------
// Phase 6: ALL gamepad menu handlers are gone. Phase 5 moved the garage halves
// (X/Y/R1/L1/R2) client-local; the last server half — Y = "respawn while the
// spectate screen is up" — is client-local too now (gameHud.client.ts fires
// Intent_ReturnToMenu when Y is pressed with the spectate frame visible).
// VehicleKeyHandler.client.ts no longer fires GamePadButtonYDown/BDown (B had
// no server consumer for a long time) — the remotes' typed accessors were
// pruned from shared/FunctionsAndEvents.ts in Phase 8 (the place-file
// instances remain, unused).

(
	game.GetService("ServerStorage") as unknown as { Events: { PlayerDamaged: BindableEvent } }
).Events.PlayerDamaged.Event.Connect((...args: unknown[]) => {
	const [player, attacker, damage, killed] = args as [Player, Player | undefined, number, boolean];
	//if the player is killed by a player then show the killed by screen
	if (killed) {
		// Football: no spectate/menu round-trip — the match controller
		// respawns the car at the team spawn with a 5s control lock.
		if (Globals.gamemode === "Football" && footballMatch.onPlayerDied(player)) {
			return;
		}
		if (attacker) {
			beginSpectate(player, attacker);
		} else {
			ResetAndInitialisePlayerMenuUI(player);
		}
	}
});

(
	game.GetService("ServerStorage") as unknown as { Events: { InitialisePlayerMenuUi: BindableEvent } }
).Events.InitialisePlayerMenuUi.Event.Connect((...args: unknown[]) => {
	ResetAndInitialisePlayerMenuUI(args[0] as Player);
});

game.GetService("Players").PlayerRemoving.Connect((player) => {
	Globals.clearPlayerGarage(player);
	spawnInFlight.delete(player);
	activeSpawnGeneration.delete(player);
	pendingSpawnGeneration.delete(player);
});

//DUPLICATE OF PLAYER DAMAGED WITH NO ATTACKER
FunctionsAndEvents.PlayerReset.OnServerEvent.Connect((player) => {
	if (!resetting.get(player)) {
		resetting.set(player, true);
		//if _G.killstreak[player] ~= 0 then
		//	_G.killstreak[player] = 0
		//end

		//if player.Character then
		//	player.Character.Humanoid.Health = 0
		//end
		if (Globals.vehiclesTable[player.UserId]) {
			Globals.vehiclesTable[player.UserId]!.TakeDamage(99999999);
		}
		//spawnVehicle.KillVehicle(player, true)

		resetting.set(player, false);
		//ResetAndInitialisePlayerMenuUI(player)
	}
});

// ---- Phase 4: client menu intents ------------------------------------------
// Landing / CreateTeam / InvitePopup / RenamePopup are CLIENT-owned; their
// button presses arrive on the UiIntents remotes. Validation first (flow
// state + typeIs + per-player debounce), then the same bodies the old
// server-wired buttons ran. Wired here (not a separate .server.ts) because
// the handlers need this script's locals (spawnIntoMatch, enterLandingState,
// readyVote, ...).

const intentLastFired = new Map<Player, Map<string, number>>();
const INTENT_DEBOUNCE = 0.15;

Players.PlayerRemoving.Connect((player) => {
	intentLastFired.delete(player);
});

function passesIntentDebounce(player: Player, key: string): boolean {
	let byKey = intentLastFired.get(player);
	if (!byKey) {
		byKey = new Map();
		intentLastFired.set(player, byKey);
	}
	const now = os.clock();
	const last = byKey.get(key);
	if (last !== undefined && now - last < INTENT_DEBOUNCE) {
		return false;
	}
	byKey.set(key, now);
	return true;
}

// task.spawn: getUiIntentEvent WaitForChilds the UiIntents folder, which
// UiIntents.server.ts may not have created yet at this point in boot.
task.spawn(() => {
	const connectIntent = (
		name: UiIntentEventName,
		handler: (player: Player, ...args: unknown[]) => void,
		debounceKey?: (player: Player, ...args: unknown[]) => string,
	) => {
		getUiIntentEvent(name).OnServerEvent.Connect((player, ...args) => {
			const key = debounceKey !== undefined ? debounceKey(player, ...args) : name;
			if (!passesIntentDebounce(player, key)) {
				return;
			}
			handler(player, ...args);
		});
	};

	// Landing.JoinTeam (PLAY): join/create an open team and spawn in.
	connectIntent("Intent_PlayRandom", (player) => {
		if (getFlowState(player) !== "menu") {
			return;
		}
		TeamRegistry.joinRandom(player);
		spawnIntoMatch(player);
	});

	// Landing.CreateTeam (FRIENDS TEAM): create the (locked) team immediately,
	// then open the team page for invites/settings — Play there spawns in.
	connectIntent("Intent_CreateTeam", (player) => {
		if (getFlowState(player) !== "menu") {
			return;
		}
		if (!TeamRegistry.getTeamOf(player)) {
			TeamRegistry.createTeam(player, false);
		}
		enterLobbyState(player);
	});

	// Landing.Cars (SELECT CAR): the Garage renders CLIENT-side (Phase 5) —
	// the server's whole job is validation, the flow-state transition and the
	// display-car/camera side effects (enterGarageState).
	connectIntent("Intent_OpenGarage", (player) => {
		const state = getFlowState(player);
		if (state !== "menu" && state !== "lobby") {
			return;
		}
		const [ok, err] = pcall(() => enterGarageState(player));
		if (!ok) {
			warn(`[Menu] OpenGarage error: ${err}`);
		}
	});

	// Garage BackToMenu (the client-built button fires this).
	connectIntent("Intent_ExitToLanding", (player) => {
		if (getFlowState(player) !== "garage") {
			return;
		}
		const [ok, err] = pcall(() => exitToLanding(player));
		if (!ok) {
			warn(`[Garage] back to menu failed: ${err}`);
		}
	});

	// CreateTeam.Play: ready vote (launch when everyone voted).
	connectIntent("Intent_ReadyVote", (player) => {
		if (getFlowState(player) !== "lobby") {
			return;
		}
		readyVote(player);
	});

	// CreateTeam.Leave.
	connectIntent("Intent_LeaveTeam", (player) => {
		if (getFlowState(player) !== "lobby") {
			return;
		}
		leaveTeamToLanding(player);
	});

	// CreateTeam.AllowRandoms toggle.
	connectIntent("Intent_SetTeamOpen", (player, open) => {
		if (!typeIs(open, "boolean")) {
			return;
		}
		if (getFlowState(player) !== "lobby") {
			return;
		}
		const team = TeamRegistry.getTeamOf(player);
		if (team) {
			TeamRegistry.setTeamOpen(team, open);
		}
	});

	// CreateTeam invite-row buttons. Debounced per target so inviting several
	// players in quick succession still works.
	connectIntent(
		"Intent_InvitePlayer",
		(player, targetUserId) => {
			if (!typeIs(targetUserId, "number")) {
				return;
			}
			if (getFlowState(player) !== "lobby") {
				return;
			}
			const target = Players.GetPlayerByUserId(targetUserId);
			if (!target) {
				return;
			}
			sendInvite(target, player);
		},
		(player, targetUserId) => `Intent_InvitePlayer:${tostring(targetUserId)}`,
	);

	// InvitePopup Accept/Decline — no flow-state requirement: the popup
	// overlays any state (the old popup did too); resolveInvite re-validates
	// everything against CB_Invite + the current team state.
	connectIntent("Intent_ResolveInvite", (player, accept) => {
		if (!typeIs(accept, "boolean")) {
			return;
		}
		resolveInvite(player, accept);
	});

	// Spectate Respawn button / gamepad Y while spectating (Phase 6 — the
	// dormant non-football death path). Preconditions mirror the old
	// server-wired Respawn click: the connection only existed after
	// enableSpectateScreen (CB_Killer set here now) and the player was outside
	// the menus (a menu-family flow state means the menus already own the UI —
	// re-running the menu init on top would double-init).
	connectIntent("Intent_ReturnToMenu", (player) => {
		if (isMenuFamily(getFlowState(player))) {
			return;
		}
		if (player.GetAttribute("CB_Killer") === undefined) {
			return;
		}
		// ResetAndInitialisePlayerMenuUI clears CB_Killer, which hides the
		// client-rendered Spectate/WhoKilledYou frames — the old handler's
		// explicit Visible=false writes.
		ResetAndInitialisePlayerMenuUI(player);
	});

	// Rename purchase path (lobby header Rename / Garage TeamNameStrip — both
	// client-owned; with credits in hand the client opens its popup locally
	// and never fires this).
	connectIntent("Intent_RequestRename", (player) => {
		const state = getFlowState(player);
		if (state !== "lobby" && state !== "garage") {
			return;
		}
		handleRenameRequest(player);
	});

	// ---- Phase 5: client-garage intents -------------------------------------
	// The Garage/CrateMenu ScreenGuis are client-owned; tiles/buttons fire
	// these. Every handler: garage flow-state gate + typeIs validation, then
	// the extracted server bodies (src/server/ui/garageIntents.ts /
	// crateModule). Ownership and trophy thresholds are re-validated inside
	// those bodies — the client's own checks are cosmetic only.

	const inGarage = (player: Player) => getFlowState(player) === "garage";

	// Cars tab: equip an owned car (unowned names degrade to a preview spawn).
	connectIntent("Intent_EquipVehicle", (player, vehicleName) => {
		if (!typeIs(vehicleName, "string") || !inGarage(player)) {
			return;
		}
		garageIntents.equipVehicle(player, vehicleName);
	});

	// Cars tab: display a (typically locked) car on the plate; withTrail
	// re-applies the equipped boost trail (BoostTrail tab re-opens).
	connectIntent("Intent_PreviewVehicle", (player, vehicleName, withTrail) => {
		if (!typeIs(vehicleName, "string") || !inGarage(player)) {
			return;
		}
		if (withTrail !== undefined && !typeIs(withTrail, "boolean")) {
			return;
		}
		garageIntents.previewVehicle(player, vehicleName, withTrail === true);
	});

	// Cars tab: trophy-gated free unlock (threshold re-checked server-side).
	connectIntent("Intent_UnlockVehicle", (player, vehicleName) => {
		if (!typeIs(vehicleName, "string") || !inGarage(player)) {
			return;
		}
		garageIntents.unlockVehicle(player, vehicleName);
		// (Grant + equip Set()s bump CB_ProfileVersion via the registered
		// OnUpdate hooks — the client re-renders from the refetched profile.)
	});

	// Colors / Horns / Trails: equip-if-owned with display-car side effects;
	// previewOnly=true (crate-page content tiles) never writes data.
	const equipIntent = (
		name: UiIntentEventName,
		body: (player: Player, itemName: string, previewOnly?: boolean) => void,
	) => {
		connectIntent(name, (player, itemName, previewOnly) => {
			if (!typeIs(itemName, "string") || !inGarage(player)) {
				return;
			}
			if (previewOnly !== undefined && !typeIs(previewOnly, "boolean")) {
				return;
			}
			body(player, itemName, previewOnly === true);
		});
	};
	equipIntent("Intent_EquipColor", garageIntents.equipColor);
	equipIntent("Intent_EquipHorn", garageIntents.equipHorn);
	equipIntent("Intent_EquipTrail", garageIntents.equipTrail);

	// Shop crate tile: server-authoritative camera for the crate page (the
	// page navigation itself is client-local).
	connectIntent("Intent_ViewCrate", (player, crateId) => {
		if (!typeIs(crateId, "number") || !inGarage(player)) {
			return;
		}
		if (!CrateCatalog.has(crateId)) {
			return;
		}
		const playerGarage = Globals.findPlayerGarage(player);
		const crateCamera = playerGarage && playerGarage.Cameras.FindFirstChild("CrateMenu");
		if (crateCamera && crateCamera.IsA("BasePart")) {
			FunctionsAndEvents.SetMenuCameraCFrame.FireClient(player, crateCamera.CFrame);
		}
	});

	// Crate page OPEN button: policy/affordability/Robux logic re-validated in
	// crateModule.openCrate; grant + Ui_CrateResult + version bump inside.
	connectIntent("Intent_OpenCrate", (player, crateId) => {
		if (!typeIs(crateId, "number") || !inGarage(player)) {
			return;
		}
		if (!CrateCatalog.has(crateId)) {
			return;
		}
		openCrate(player, crateId);
	});
});

// The whole round system hangs off this one boot call. If it throws (a
// production-only hiccup during pitch build/ball spawn), no round ever
// exists, footballMatch.getSpawnCFrame returns nil for everyone, and every
// PLAY press bounces straight back to the menu — the game never starts.
// Retry until a round is up instead of dying silently.
task.spawn(() => {
	let bootAttempt = 0;
	while (true) {
		bootAttempt += 1;
		const [ok, err] = pcall(() => roundHandler.startRound());
		if (ok) {
			break;
		}
		warn(`[Boot] startRound failed (attempt ${bootAttempt}): ${err} — retrying in 10s`);
		task.wait(10);
	}
});
