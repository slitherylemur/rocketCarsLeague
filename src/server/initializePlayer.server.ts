// Original: ServerScriptService/initializePlayer (Script)

import spawnVehicle from "./Modules/spawnVehicle";

import setTab from "./Modules/UiModules/setTab";
import DataUtilities from "./Modules/DataUtilities";
import GeneralUtils from "./GeneralUtils";
import DataStoreDefaults from "./Modules/DataStoreDefaults";
import roundHandler from "./Modules/roundHandler";
//local playerGarage = workspace.garageModel
import crateModule from "./Modules/CrateModule";
import selectedFunctions from "./Modules/UiModules/itemSelectedFunctions";
import populateCrateFrameModule from "shared/PopulateCrateFrame";
import ContentModule from "./Modules/Content";
import paidRandomItemsPolicy from "./Modules/paidRandomItemsPolicy";
import { Globals } from "./Globals";
import footballMatch from "./Modules/footballMatch";
import TeamRegistry, { CarBallRemotes, RENAME_PRODUCT_ID } from "./Modules/TeamRegistry";
import UiState from "./ui/UiState";
import { getUiIntentEvent, type UiIntentEventName } from "shared/UiIntents";
import { ProductIds } from "shared/Monetization";
import type { LadderTeam } from "./Modules/TeamRegistry";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import { PlayerGuiManager } from "./ui/PlayerGuiManager";
import VehicleInputActions from "./Modules/vehicleInputActions";
import { CASH_PURCHACE_MENU_OPEN_SIZE } from "shared/ui/uiConstants";
import type { CrateItem } from "./Modules/dataTypes";

const TweenService = game.GetService("TweenService");
const HttpService = game.GetService("HttpService");
// Original: game.StarterGui.Garage.cashPurchace.Size (an unused local; the
// template value now lives in uiConstants)
const cashPurchaceMenuOpenSize = CASH_PURCHACE_MENU_OPEN_SIZE;
const MarketplaceService = game.GetService("MarketplaceService");
const DSDefaultValues = DataStoreDefaults;

//Constants
const SELECTED_TAB_COLOR = Color3.fromRGB(255, 153, 29);
const DEFAULT_TAB_COLOR = new Color3(1, 1, 1);

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

// ---- PlayerGui instance shapes (server-rendered React tree) ----

interface GarageGuiShape extends ScreenGui {
	Inventory: Frame & {
		SpawnButton: Frame & { Button: TextButton };
		BuyButton: Frame & { Button: TextButton; BuyButtonConsole: BindableEvent };
		Buttons: Frame & { Buttons: Frame & { Inventory: Frame } };
		ShopButton: GuiButton;
	};
	Shop: Frame & {
		InventoryButton: GuiButton;
		Purchases: Frame & { VIP: GuiButton };
		Crates: Frame;
	};
	CrateMenu: Frame & {
		Content: Frame;
		BackButton: GuiButton;
		OpenButton: GuiButton & { TextLabel: TextLabel };
		CrateName: TextLabel;
	};
	cashPurchace: Frame;
	payOrSpectate: Frame & { Pay: GuiButton; Spectate: GuiButton };
	cantRespawn: TextLabel;
	Money: Frame & {
		Currency: Frame & { TextLabel: TextLabel; Add: GuiButton };
		Trophies: Frame & { TextLabel: TextLabel };
	};
}

interface GameGuiShape extends ScreenGui {
	Money: Frame & { Currency: Frame & { TextLabel: TextLabel } };
	WhoKilledYou: TextButton & {
		Content: Frame & { KillerName: TextLabel; kills: TextLabel; Person: ImageLabel };
	};
	Spectate: Frame & { Information: Frame & { Respawn: TextButton } };
	BoostMeter: CanvasGroup;
}

type PlayerGuiShape = Instance & {
	Garage: GarageGuiShape;
	Game: GameGuiShape;
};

function playerGuiOf(player: Player): PlayerGuiShape {
	return (player as unknown as { PlayerGui: PlayerGuiShape }).PlayerGui;
}

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

const uiConnections = new Map<Player, Map<string, RBXScriptConnection>>();
const crateDebounces = new Map<Player, boolean>();
const selectedCrate = new Map<Player, number>();

// ---- UI flow ownership (menu vs spawn) -------------------------------------
// SpawnInPlayer and the menu (re)initialisers both span yields (LoadCharacter,
// SpawnVehicle's internal ~2s of waits, cold/throttled DataStore Gets). When
// they interleave for the same player — round-end sendToMenu firing while a
// PLAY press is mid-spawn, the shop-end auto-spawn landing inside a
// datastore-delayed initialisePlayerUi, an invite accepted mid-spawn —
// whichever thread resumes LAST wins, so a player could end up seated in a
// match car with the landing/garage menu enabled on top (or vice versa).
//
// Phase 4: the CB_FlowState player attribute (UiState.setFlowState) IS the
// flow claim now — it replaces the old uiFlowGen/uiFlowKind generation maps.
// Every flow that takes the player over writes its state ("menu" / "lobby" /
// "garage" from menu flows, "spawning" from SpawnInPlayer); long flows
// re-check after their yields and stand down when the state is no longer the
// one they wrote, so the NEWEST intent always wins. The same attribute is what
// the client menu router renders from, and what MatchDirector/roundHandler
// read for their menu-exemption rules.
type FlowStateValue = "menu" | "lobby" | "garage" | "spawning" | "match";

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

function GetModelByPlayerAndParent(player: Player, parent: Instance): Instance | undefined {
	for (const model of parent.GetChildren()) {
		if ((model as Instance & { Player: ObjectValue }).Player.Value === player) {
			return model;
		}
	}
	return undefined;
}

function ColorButton(button: ImageButton, highlightedButton: GuiObject, selectedColor: Color3, defaultColor: Color3) {
	if (button === highlightedButton) {
		button.ImageColor3 = selectedColor;
	} else {
		button.ImageColor3 = defaultColor;
	}
}

Globals.CrateNames = new Map<number, string>([
	[1, "Lightning Crate"],
	[2, "Interceptor Crate"],
	[3, "Apex Crate"],
]);
Globals.CrateNames.set(-1, "OverDRIVE Crate");

const selectedTab = new Map<Player, string>();

function HighlightButtonInBar(
	highlightedButton: GuiObject,
	buttonsBar: Instance,
	selectedColor: Color3,
	defaultColor: Color3,
	player: Player,
) {
	selectedTab.set(player, highlightedButton.Name);
	GeneralUtils.IterateOverChildrenOfType(
		buttonsBar,
		"GuiObject",
		ColorButton as unknown as (object: Instance, ...args: unknown[]) => void,
		highlightedButton,
		selectedColor,
		defaultColor,
	);
}

function OpenTabButton(button: GuiObject, player: Player, buttonsBar: Instance, location: string) {
	HighlightButtonInBar(button, buttonsBar, SELECTED_TAB_COLOR, DEFAULT_TAB_COLOR, player);
	(setTab as unknown as Record<string, (player: Player, tab: string) => void>)[location](player, button.Name);
}

FunctionsAndEvents.GamePadButtonR1Down.OnServerEvent.Connect((player) => {
	const gui = playerGuiOf(player);
	if (gui.Garage.Enabled && gui.Garage.Inventory.Visible) {
		const buttonsBar = gui.Garage.Inventory.Buttons.Buttons.Inventory;
		const buttons = GeneralUtils.GetChildrenOfType(buttonsBar, "ImageButton");
		if (selectedTab.get(player) === undefined) {
			selectedTab.set(player, "Body");
		}
		const selectedButton = selectedTab.get(player)!;

		let index = 0;

		for (const [i, button] of ipairs(buttons)) {
			if (button.Name === selectedButton) {
				index = i;
			}
		}

		let nextButtonIndex = index + 1;
		if (nextButtonIndex > buttons.size()) {
			nextButtonIndex = 1;
		}
		const nextButton = buttons[nextButtonIndex - 1];
		OpenTabButton(nextButton as GuiObject, player, buttonsBar, "Inventory");
	}
});

FunctionsAndEvents.GamePadButtonL1Down.OnServerEvent.Connect((player) => {
	const gui = playerGuiOf(player);
	if (gui.Garage.Enabled && gui.Garage.Inventory.Visible) {
		const buttonsBar = gui.Garage.Inventory.Buttons.Buttons.Inventory;
		const buttons = GeneralUtils.GetChildrenOfType(buttonsBar, "ImageButton");
		if (selectedTab.get(player) === undefined) {
			selectedTab.set(player, "Body");
		}
		const selectedButton = selectedTab.get(player)!;

		let index = 0;

		for (const [i, button] of ipairs(buttons)) {
			if (button.Name === selectedButton) {
				index = i;
			}
		}

		let nextButtonIndex = index - 1;
		if (nextButtonIndex < 1) {
			nextButtonIndex = buttons.size();
		}
		const nextButton = buttons[nextButtonIndex - 1];
		OpenTabButton(nextButton as GuiObject, player, buttonsBar, "Inventory");
	}
});

function ConnectTabButton(button: GuiObject, player: Player, buttonsBar: Instance, location: string) {
	uiConnections.get(player)!.set(
		button.Name + "tabButton",
		(button as GuiButton).MouseButton1Click.Connect(() => {
			OpenTabButton(button, player, buttonsBar, location);
		}),
	);
}

function SetupTabButtons(player: Player, buttonsBar: Instance, location: string) {
	GeneralUtils.IterateOverChildrenOfType(
		buttonsBar,
		"GuiObject",
		ConnectTabButton as unknown as (object: Instance, ...args: unknown[]) => void,
		player,
		buttonsBar,
		location,
	);
}

function resetVehicle(player: Player) {
	const carClass = Globals.vehiclesTable[player.UserId]!;
	carClass.resetVehicle();
}

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
function openCrate(player: Player) {
	if (!crateDebounces.get(player)) {
		crateDebounces.set(player, true);
		crateModule.openCrate(player, selectedCrate.get(player)!);
		crateDebounces.set(player, false);
	}
}

Globals.openCrateMenu = (player: Player, crateName: number) => {
	// Lootbox compliance: don't even show the crate menu in restricted countries.
	if (paidRandomItemsPolicy.isRestricted(player)) {
		paidRandomItemsPolicy.showRestrictedPopup(player);
		return;
	}

	if (!uiConnections.get(player)) {
		uiConnections.set(player, new Map());
	}

	for (const [, connection] of pairs(uiConnections.get(player)!)) {
		connection.Disconnect();
	}

	selectedCrate.set(player, crateName);

	const gui = playerGuiOf(player);
	const shop = gui.Garage.Shop;
	const crateMenu = gui.Garage.CrateMenu;
	const gameUi = gui.Game;
	gameUi.Enabled = false;
	for (const child of crateMenu.Content.GetChildren()) {
		if (child.IsA("Frame")) {
			child.Destroy();
		}
	}

	const inventory = gui.Garage.Inventory;

	crateMenu.Visible = true;
	inventory.Visible = false;
	shop.Visible = false;

	uiConnections.get(player)!.set(
		"crate1",
		crateMenu.BackButton.MouseButton1Click.Connect(() => {
			OpenShop(player);
		}),
	);

	const playerGarage = Globals.findPlayerGarage(player)!;
	FunctionsAndEvents.SetMenuCameraCFrame.FireClient(player, playerGarage.Cameras.CrateMenu.CFrame);

	crateMenu.CrateName.Text = Globals.CrateNames.get(crateName)!;

	// Original: require(game.ServerStorage.Modules.Content)[crateName]
	// (Content is statically imported at the top in TS — require caching makes
	// the original's repeated require equivalent to this.)
	const crateContent = ContentModule.get(crateName)!;

	uiConnections.get(player)!.set(
		"crate2",
		crateMenu.OpenButton.MouseButton1Click.Connect(() => {
			openCrate(player);
		}),
	);

	if (crateName > 0) {
		crateMenu.OpenButton.TextLabel.Text = "OPEN - $" + crateContent.price;
	} else {
		crateMenu.OpenButton.TextLabel.Text = "OPEN - R$ …";
	}

	for (const [i, itemToShow] of ipairs(crateContent.content)) {
		const itemGui = (
			game.GetService("ReplicatedStorage") as unknown as { Ui: { CrateFrame: Frame } }
		).Ui.CrateFrame.Clone();

		const button = new Instance("TextButton");
		button.Parent = itemGui;
		button.Transparency = 1;
		button.Size = new UDim2(1, 0, 1, 0);
		button.ZIndex = 3;

		populateCrateFrameModule.PopulateFrame(itemGui as never, itemToShow, crateMenu.Content);
		uiConnections.get(player)!.set(
			"itemToShow" + i,
			button.MouseButton1Click.Connect(() => {
				resetVehicle(player);
				//spawnVehicle.SpawnVehicle(player, false, DataUtilities.getPlayerEquippedVehicle(player), workspace.garageModel.spawnPlate.CFrame, true)

				if (itemToShow.type === "Colors") {
					selectedFunctions.Colors(player, itemToShow.name, true, undefined!);
				} else if (itemToShow.type === "CarHorns") {
					selectedFunctions.CarHorn(player, itemToShow.name, true, gui.Garage as never, undefined!);
				} else if (itemToShow.type === "BoostTrails") {
					selectedFunctions.BoostTrail(player, itemToShow.name, true, undefined!, undefined!);
				}
			}),
		);
	}
};


function OpenShop(player: Player) {
	if (!uiConnections.get(player)) {
		uiConnections.set(player, new Map());
	}

	for (const [, connection] of pairs(uiConnections.get(player)!)) {
		connection.Disconnect();
	}
	const gui = playerGuiOf(player);
	const gameUi = gui.Game;
	gameUi.Enabled = false;
	const inventory = gui.Garage.Inventory;
	const shop = gui.Garage.Shop;
	const crateMenu = gui.Garage.CrateMenu;

	crateMenu.Visible = false;
	inventory.Visible = false;
	shop.Visible = true;
	uiConnections.get(player)!.set(
		"shop1",
		shop.InventoryButton.MouseButton1Click.Connect(() => {
			shop.Visible = false;
			OpenInventory(player);
		}),
	);

	uiConnections.get(player)!.set(
		"shop2",
		shop.Purchases.VIP.MouseButton1Click.Connect(() => {
			MarketplaceService.PromptGamePassPurchase(player, Globals.VIP_PASS_ID);
		}),
	);

	for (const CrateSection of shop.Crates.GetChildren()) {
		if (CrateSection.IsA("Frame")) {
			for (const Crate of CrateSection.GetChildren()) {
				if (Crate.IsA("TextButton")) {
					(Crate as TextButton & { CrateName: TextLabel }).CrateName.Text = Globals.CrateNames.get(
						tonumber(Crate.Name)!,
					)!;

					uiConnections.get(player)!.set(
						"shopCrate" + Crate.Name,
						Crate.MouseButton1Click.Connect(() => {
							Globals.openCrateMenu(player, tonumber(Crate.Name)!);
							//crateModule.OpenCrate(player, tonumber(Crate.Name))
						}),
					);
				}
			}
		}
	}

}

function OpenInventory(player: Player) {
	if (!uiConnections.get(player)) {
		uiConnections.set(player, new Map());
	}

	for (const [, connection] of pairs(uiConnections.get(player)!)) {
		connection.Disconnect();
	}
	const gui = playerGuiOf(player);
	const gameUi = gui.Game;
	gameUi.Enabled = false;
	const inventory = gui.Garage.Inventory;
	const shop = gui.Garage.Shop;
	const crateMenu = gui.Garage.CrateMenu;

	crateMenu.Visible = false;
	shop.Visible = false;

	SetupTabButtons(player, inventory.Buttons.Buttons.Inventory, "Inventory");

	setTab.Inventory(player, "Body");

	uiConnections.get(player)!.set(
		"inv",
		inventory.ShopButton.MouseButton1Click.Connect(() => {
			OpenShop(player);
		}),
	);

	inventory.Visible = true;
}

/** Landing page (Top Table §5): title + Join Team / Create Team / Cars, car
 * in view via the menu camera. The Landing ScreenGui itself is CLIENT-owned
 * (Phase 4): src/client/ui/menu.client.ts enables it while CB_FlowState is
 * "menu" and fires the Intent_* remotes for its buttons. This function is the
 * server half of "show the landing page": flow-state transition, menu camera
 * aim, garage display car. */
function enterLandingState(player: Player) {
	// Landing = menu state: invalidate any in-flight spawn for this player.
	UiState.setFlowState(player, "menu");
	if (!uiConnections.get(player)) {
		uiConnections.set(player, new Map());
	}
	for (const [, connection] of pairs(uiConnections.get(player)!)) {
		connection.Disconnect();
	}

	const gui = playerGuiOf(player);
	gui.Garage.Enabled = false;

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

/** Friends Team mini lobby = "lobby" state: the CreateTeam ScreenGui is
 * client-rendered from replicated team state; the server only records the
 * transition and drops its own menu screen (the lobby can be entered from the
 * garage or mid-match via an accepted invite). */
function enterLobbyState(player: Player) {
	pcall(() => {
		playerGuiOf(player).Garage.Enabled = false;
	});
	UiState.setFlowState(player, "lobby");
}

function spawnIntoMatch(player: Player) {
	// The spawn owns the UI from the moment of the press (set synchronously,
	// BEFORE the interlude hold below): the client menus hide as soon as
	// CB_FlowState leaves the menu family, and any later menu transition
	// supersedes this spawn at its next checkpoint.
	UiState.setFlowState(player, "spawning");
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

const MENU_FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

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
// the lobby Rename button is pressed with credits in hand (CB_RenameCredits),
// or when CB_RenamePrompt is bumped (the server-wired Garage TeamNameStrip
// click), or when a purchased credit arrives (the client watches
// CB_RenameCredits — the old server-side watcher moved there). Submission
// still travels over CarBallRemotes.SubmitTeamName; feedback is published as
// CB_RenameStatus.

function handleRenameRequest(player: Player) {
	if (TeamRegistry.getRenameCredits(player) > 0) {
		// Ping the client-owned popup open.
		const count = player.GetAttribute("CB_RenamePrompt");
		UiState.setPlayerAttr(player, "CB_RenamePrompt", (typeIs(count, "number") ? count : 0) + 1);
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
		if (result === "ok") {
			// Garage is still server-owned — keep its team-name strip fresh.
			pcall(() => {
				const teamName = playerGuiOf(player).Garage.FindFirstChild("CurrentTeamName", true);
				if (teamName?.IsA("TextLabel")) {
					teamName.Text = TeamRegistry.getTeamOf(player)?.name ?? "NO TEAM";
				}
			});
		}
		UiState.setPlayerAttr(player, "CB_RenameStatus", "");
	} else if (result === "moderated") {
		UiState.setPlayerAttr(player, "CB_RenameStatus", "moderated");
	} else {
		UiState.setPlayerAttr(player, "CB_RenameStatus", "error");
	}
});

/** Cars-page navigation and team-name controls, created per UI mount. */
/** Bottom-left garage button label: teamed = playing between rounds → the
 * only way out is EXIT TEAM (leave team + landing, excluded from the auto
 * start); teamless = browsing cars from the landing page → plain BACK. */
function backButtonLabel(player: Player): string {
	return TeamRegistry.getTeamOf(player) ? "EXIT TEAM" : "BACK";
}

function ensureGarageMenuButtons(player: Player) {
	const garage = playerGuiOf(player).Garage;
	const existingBack = garage.FindFirstChild("BackToMenu", true);
	if (existingBack) {
		// Same mount can be reached teamed (shop phase) then teamless
		// (EXIT TEAM → landing → SELECT CAR) — keep the label honest.
		if (existingBack.IsA("TextButton")) {
			existingBack.Text = backButtonLabel(player);
		}
		return;
	}
	const inventory = garage.Inventory;
	const shopButton = inventory.ShopButton;
	shopButton.AnchorPoint = new Vector2(1, 0.5);
	shopButton.Position = new UDim2(1, 0, shopButton.Position.Y.Scale, shopButton.Position.Y.Offset);
	const shopOutline = new Instance("UIStroke");
	shopOutline.Name = "MenuOutline";
	shopOutline.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
	shopOutline.Color = Color3.fromRGB(120, 70, 0);
	shopOutline.Thickness = 2;
	shopOutline.Parent = shopButton;
	const shopShadow = new Instance("UIShadow");
	shopShadow.Name = "MenuShadow";
	shopShadow.BlurRadius = new UDim(0, 8);
	shopShadow.Color = new Color3(0, 0, 0);
	shopShadow.Offset = UDim2.fromOffset(0, 5);
	shopShadow.Transparency = 0.5;
	shopShadow.Parent = shopButton;

	const backButton = new Instance("TextButton");
	backButton.Name = "BackToMenu";
	backButton.AnchorPoint = new Vector2(0, 0.5);
	backButton.AutoButtonColor = true;
	backButton.BackgroundColor3 = Color3.fromRGB(205, 55, 55);
	backButton.BorderSizePixel = 0;
	backButton.FontFace = MENU_FONT;
	backButton.Position = new UDim2(0, 0, 0.932, 0);
	backButton.Size = new UDim2(0.11, 0, 0.134, 0);
	backButton.Text = backButtonLabel(player);
	backButton.TextColor3 = new Color3(1, 1, 1);
	backButton.TextScaled = true;
	backButton.ZIndex = shopButton.ZIndex;
	const backCorner = new Instance("UICorner");
	backCorner.CornerRadius = new UDim(0.1, 0);
	backCorner.Parent = backButton;
	const backOutline = new Instance("UIStroke");
	backOutline.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
	backOutline.Color = Color3.fromRGB(95, 15, 15);
	backOutline.Thickness = 2;
	backOutline.Parent = backButton;
	const backShadow = new Instance("UIShadow");
	backShadow.BlurRadius = new UDim(0, 8);
	backShadow.Color = new Color3(0, 0, 0);
	backShadow.Offset = UDim2.fromOffset(0, 5);
	backShadow.Transparency = 0.5;
	backShadow.Parent = backButton;
	backButton.MouseButton1Click.Connect(() => {
		const [ok, err] = pcall(() => {
			// Shared with Intent_ExitToLanding — leave-team guards + the
			// landing transition (the Landing page itself renders client-side).
			exitToLanding(player);
			backButton.Text = backButtonLabel(player);
		});
		if (!ok) {
			warn(`[Garage] back to menu failed: ${err}`);
		}
	});
	backButton.Parent = inventory;

	const teamStrip = new Instance("Frame");
	teamStrip.Name = "TeamNameStrip";
	teamStrip.AnchorPoint = new Vector2(0.5, 1);
	teamStrip.BackgroundColor3 = Color3.fromRGB(20, 20, 24);
	teamStrip.BackgroundTransparency = 0.15;
	teamStrip.BorderSizePixel = 0;
	teamStrip.Position = new UDim2(0.5, 0, 1, 0);
	teamStrip.Size = new UDim2(0.38, 0, 0.07, 0);
	teamStrip.Visible = !inventory.BuyButton.Visible;
	teamStrip.ZIndex = shopButton.ZIndex;
	const stripCorner = new Instance("UICorner");
	stripCorner.CornerRadius = new UDim(0, 7);
	stripCorner.Parent = teamStrip;

	const teamName = new Instance("TextLabel");
	teamName.Name = "CurrentTeamName";
	teamName.BackgroundTransparency = 1;
	teamName.FontFace = MENU_FONT;
	teamName.Position = new UDim2(0.04, 0, 0.15, 0);
	teamName.Size = new UDim2(0.62, 0, 0.7, 0);
	teamName.Text = TeamRegistry.getTeamOf(player)?.name ?? "NO TEAM";
	teamName.TextColor3 = new Color3(1, 1, 1);
	teamName.TextScaled = true;
	teamName.TextTruncate = Enum.TextTruncate.AtEnd;
	teamName.TextXAlignment = Enum.TextXAlignment.Center;
	teamName.ZIndex = teamStrip.ZIndex + 1;
	teamName.Parent = teamStrip;

	const changeName = new Instance("TextButton");
	changeName.Name = "ChangeTeamName";
	changeName.AnchorPoint = new Vector2(1, 0.5);
	changeName.BackgroundColor3 = Color3.fromRGB(150, 70, 200);
	changeName.BorderSizePixel = 0;
	changeName.FontFace = MENU_FONT;
	changeName.Position = new UDim2(0.98, 0, 0.5, 0);
	changeName.Size = new UDim2(0.3, 0, 0.72, 0);
	changeName.Text = "Change Name";
	changeName.TextColor3 = new Color3(1, 1, 1);
	changeName.TextScaled = true;
	changeName.ZIndex = teamStrip.ZIndex + 1;
	const changeCorner = new Instance("UICorner");
	changeCorner.CornerRadius = new UDim(0, 6);
	changeCorner.Parent = changeName;
	changeName.MouseButton1Click.Connect(() => {
		handleRenameRequest(player);
	});
	changeName.Parent = teamStrip;
	teamStrip.Parent = inventory;
}

const resetting = new Map<Player, boolean>();

// One spawn flight per player. Concurrent SpawnInPlayer calls (shop auto-spawn
// firing while a manual click's LoadCharacter is still in flight, double
// clicks during the round-boundary hold below) ran two LoadCharacter +
// SpawnVehicle sequences at once: the second KillVehicle destroyed the first
// car mid-SeatPlayer and left the player seated in nothing — no car, no
// controls, for the whole round. os.clock stamp (not a plain flag) so a spawn
// thread that dies mid-flight can never lock the player out forever.
const spawnInFlight = new Map<Player, number>();
const SPAWN_IN_FLIGHT_TIMEOUT = 45;

Globals.SpawnInPlayer = (player: Player): boolean => {
	const startedAt = spawnInFlight.get(player);
	if (startedAt !== undefined && os.clock() - startedAt < SPAWN_IN_FLIGHT_TIMEOUT) {
		warn(`[SpawnInPlayer] ${player.Name} is already spawning — duplicate call ignored`);
		// "true": the in-flight spawn is handling this player; a false here
		// would make spawnIntoMatch remount the menu OVER the live spawn.
		return true;
	}
	spawnInFlight.set(player, os.clock());
	const [ok, result] = pcall(() => spawnInPlayerInner(player));
	spawnInFlight.delete(player);
	if (!ok) {
		error(result);
	}
	return result === true;
};

function spawnInPlayerInner(player: Player): boolean {
	warn(`[SpawnInPlayer] ENTER ${player.Name}`);
	// The spawn claims the UI flow: CB_FlowState = "spawning". (spawnIntoMatch
	// already wrote it at the button press; writing again here also covers the
	// direct Globals.SpawnInPlayer callers — the shop auto-spawn and the
	// gamepad Y handler.)
	UiState.setFlowState(player, "spawning");
	// True (and cleans up) when a newer flow claimed the player's UI while this
	// spawn was inside one of its yields — i.e. CB_FlowState is no longer the
	// "spawning" this thread wrote. Returning true afterwards is deliberate:
	// the newer flow owns the UI, so spawnIntoMatch's failure path must NOT
	// stomp it with yet another menu remount.
	const standDownIfSuperseded = (stage: string): boolean => {
		const state = getFlowState(player);
		if (state === "spawning") {
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

	// Original: for i,v in pairs(player.PlayerGui:GetChildren()) do v:Destroy() end
	PlayerGuiManager.destroyAll(player);

	// Mark this engine spawn as requested: initializePlayer's CharacterAdded
	// guard destroys any character that appears WITHOUT this mark (boot-race
	// auto-loads at 0,0,0). Cleared by ResetAndInitialisePlayerMenuUI.
	player.SetAttribute("CB_ExpectCharacter", true);
	player.LoadCharacter();
	warn(`[SpawnInPlayer] after LoadCharacter Character=${player.Character?.GetFullName() ?? "nil"}`);
	if (standDownIfSuperseded("during LoadCharacter")) {
		return true;
	}
	// Original: the engine re-cloned StarterGui into PlayerGui on LoadCharacter
	// (every ScreenGui has ResetOnSpawn = true) — the React equivalent mounts here.
	PlayerGuiManager.mountAll(player);
	FunctionsAndEvents.ToggleMenuCamera.FireClient(player, false);

	// (The original's "Spawning in N" TimerGui countdown was already retired;
	// the TimerGui is client-owned now — see src/client/ui/timer.client.ts.)

	const garageUi = player.WaitForChild("PlayerGui").WaitForChild("Garage") as GarageGuiShape;
	garageUi.Enabled = false;
	//workspace:WaitForChild(player.Name)
	(player.FindFirstChild("spawned") as NumberValue).Value += 1;
	playerGuiOf(player).Game.Enabled = true;

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
	// round-end sendToMenu / accepted invite to remount the menus. Without this
	// check the code below ran match bookkeeping (onPlayerSpawned) on top of a
	// fresh MENU mount and the player ended up seated in a match car with the
	// menu still on screen.
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
	if (
		spawnedVehicle === undefined ||
		spawnedVehicle.model.Parent === undefined ||
		spawnedSeat === undefined ||
		spawnedSeat.Occupant === undefined
	) {
		warn(`[SpawnInPlayer] ABORT no seated vehicle after SpawnVehicle for ${player.Name}`);
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
	//game.ReplicatedStorage.FunctionsAndEvents.ToggleMenuCamera:FireClient(player,false)
	// player.PlayerGui.Game.KillVehicle.MouseButton1Click:Connect(function()
	// 	if not resetting[player] then
	// 		resetting[player] = true
	//
	// 		player.PlayerGui.Game.KillVehicle.Text = "Resetting in 10 seconds"
	// 		task.delay(10, function()
	// 			if _G.killstreak[player] ~= 0 then
	// 				_G.killstreak[player] = 0
	// 			end
	// 			if player.Character then
	// 				player.Character.Humanoid.Health = 0
	// 			end
	// 			spawnVehicle.KillVehicle(player, true)
	//
	// 			player.PlayerGui.Game.KillVehicle.Text = "Reset"
	// 			ResetAndInitialisePlayerMenuUI(player)
	// 			resetting[player] = false
	// 		end)
	// 	end
	// end)

	task.wait(1);
	//game.ReplicatedStorage.FunctionsAndEvents.ToggleMenuCamera:FireClient(player,false)
	// Final yield above is the last window a menu flow can land in — if it did,
	// clean up the now-stray car/character so the player really is in the menu.
	if (standDownIfSuperseded("after spawn")) {
		return true;
	}
	// Spawn completed and still owns the flow — the player is in the match.
	UiState.setFlowState(player, "match");
	return true;
}

function initialisePlayerUi(player: Player) {
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
	if (getFlowState(player) !== "menu") {
		warn(
			`[initialisePlayerUi] superseded for ${player.Name} (flow state ${tostring(
				getFlowState(player),
			)}) — leaving the UI to the newer flow`,
		);
		return;
	}

	FunctionsAndEvents.ToggleMenuCamera.FireClient(player, true, playerGarage);

	const gui = playerGuiOf(player);
	const garageUi = gui.Garage;
	garageUi.Enabled = true;

	gui.Garage.Money.Currency.Add.MouseButton1Click.Connect(() => {
		selectedFunctions.openCashPurchaceMenu(player);
	});

	// Top Table: play starts automatically (landing buttons / shop countdown)
	// — the garage Spawn button is retired.
	pcall(() => {
		garageUi.Inventory.SpawnButton.Visible = false;
		garageUi.Inventory.SpawnButton.Button.Visible = false;
	});

	// Landing page first (Top Table §5) — except during the between-rounds
	// shop window, when everyone lands straight on the CARS page with the
	// restart countdown already ticking.
	garageUi.Enabled = false;
	const [landOk, landErr] = pcall(() => {
		if (Globals.shopPhaseActive === true) {
			garageUi.Enabled = true;
			OpenInventory(player);
			ensureGarageMenuButtons(player);
			// CARS page = "garage": counted by the shop countdown/auto-spawn
			// (unlike "menu"/"lobby"), skipped by the round-end sendToMenu.
			UiState.setFlowState(player, "garage");
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
	const moneyString = "$" + GeneralUtils.CommaNumber(money);
	const gui = playerGuiOf(player);
	gui.Garage.Money.Currency.TextLabel.Text = moneyString;
	gui.Game.Money.Currency.TextLabel.Text = moneyString;
}

function setPlayerTrophies(player: Player, trophies: number) {
	const gui = playerGuiOf(player);
	gui.Garage.Money.Trophies.TextLabel.Text = "🏆 " + GeneralUtils.CommaNumber(trophies);
}

function showKilledByScreen(player: Player, killer: Player) {
	const killedByScreen = playerGuiOf(player).Game.WhoKilledYou;
	killedByScreen.Content.KillerName.Text = killer.Name;
	killedByScreen.Content.kills.Text = tostring((killer as unknown as { kills: NumberValue }).kills.Value + 1);
	killedByScreen.Content.Person.Image = Globals.getPlayerIcon(killer);
	killedByScreen.MouseButton1Click.Connect(() => {
		killedByScreen.Visible = false;
	});
	task.delay(9, () => {
		killedByScreen.Visible = false;
	});
	killedByScreen.Visible = true;
}

function hideKilledByScreen(player: Player) {
	const killedByScreen = playerGuiOf(player).Game.WhoKilledYou;
	killedByScreen.Visible = false;
}

function enablePayOrSpectate(player: Player) {
	const payOrSpectate = (player.WaitForChild("PlayerGui").WaitForChild("Garage") as GarageGuiShape).payOrSpectate;
	payOrSpectate.Visible = true;
	payOrSpectate.Spectate.MouseButton1Click.Connect(() => {
		payOrSpectate.Visible = false;
		enableSpectateScreen(player, undefined);
	});
}

function enableSpectateScreen(player: Player, playerToWatch: Player | undefined) {
	const spectateScreen = (player.WaitForChild("PlayerGui").WaitForChild("Game") as GameGuiShape).Spectate;

	let resConnect: RBXScriptConnection | undefined = undefined;
	resConnect = spectateScreen.Information.Respawn.MouseButton1Click.Connect(() => {
		resConnect!.Disconnect();
		spectateScreen.Visible = false;
		hideKilledByScreen(player);
		ResetAndInitialisePlayerMenuUI(player);
	});
	spectateScreen.Information.Respawn.Visible = true;

	spectateScreen.Visible = true;

	FunctionsAndEvents.spectatePlayer.FireClient(player, playerToWatch);
}

// (CharacterAutoLoads = false moved to the top of this script's body — see the
// comment there. Keeping the flag OFF is what makes a character in the menu
// flow always a bug.)

function ResetAndInitialisePlayerMenuUI(player: Player) {
	// Take the UI over from any in-flight spawn (it stands down at its next
	// checkpoint instead of re-enabling gameplay UI on top of the menus).
	UiState.setFlowState(player, "menu");
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
	player.WaitForChild("PlayerGui");
	// Original: destroy every PlayerGui child, then clone every StarterGui child
	// back in — PlayerGuiManager reproduces both steps.
	PlayerGuiManager.destroyAll(player);
	PlayerGuiManager.mountAll(player);

	initialisePlayerUi(player);
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

	const ui = player.WaitForChild("PlayerGui");

	// Initial flow state: the menu. Written BEFORE the (yieldy)
	// initialisePlayerUi so the client-owned landing page can paint
	// immediately and order-independently of the DataStore reads.
	UiState.setFlowState(player, "menu");
	// Original: clone every StarterGui child into PlayerGui.
	PlayerGuiManager.mountAll(player);

	createValues(player);
	initialisePlayerUi(player);

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

	const playerVehicles = DataStore2("vehicles", player);
	playerVehicles.OnUpdate((newValue) => {
		pcall(() => {
			setTab.Inventory(player, "Body");
		});
	});

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

FunctionsAndEvents.GamePadButtonXDown.OnServerEvent.Connect((player) => {
	const gui = playerGuiOf(player);
	if (gui.Garage.Enabled) {
		const garage = gui.Garage;

		if (garage.cashPurchace.Visible) {
			ReturnUiSelectedValues(player);
			garage.cashPurchace.Visible = false;
		} else if (garage.Inventory.Visible) {
			OpenShop(player);
		} else if (garage.CrateMenu.Visible) {
			OpenShop(player);
		} else if (garage.Shop.Visible) {
			OpenInventory(player);
		}
	}
});

FunctionsAndEvents.GamePadButtonYDown.OnServerEvent.Connect((player) => {
	if ((player.WaitForChild("PlayerGui").WaitForChild("Garage") as GarageGuiShape).Enabled) {
		const garage = playerGuiOf(player).Garage;
		if (garage.Inventory.Visible) {
			if (garage.Inventory.SpawnButton.Visible) {
				Globals.SpawnInPlayer(player);
			} else if (garage.Inventory.BuyButton.Visible) {
				garage.Inventory.BuyButton.BuyButtonConsole.Fire();
			}
		} else if (garage.CrateMenu.Visible) {
			if (uiConnections.get(player)!.get("crate2") !== undefined) {
				openCrate(player);
			}
		}
	} else if (playerGuiOf(player).Game.Enabled) {
		const gameUi = playerGuiOf(player).Game;
		if (gameUi.Spectate.Visible) {
			ResetAndInitialisePlayerMenuUI(player);
		}
	}
});

const playerGuisSelection = new Map<Player, Map<GuiObject, boolean>>();

function MakeAllUisNotSelectable(player: Player, exeption: Instance) {
	if (!playerGuisSelection.get(player)) {
		playerGuisSelection.set(player, new Map());
	}
	for (const ui of playerGuiOf(player).GetDescendants()) {
		if (!ui.IsDescendantOf(exeption) && ui.IsA("GuiObject")) {
			playerGuisSelection.get(player)!.set(ui, ui.Selectable);
			ui.Selectable = false;
		}
	}
}

function ReturnUiSelectedValues(player: Player) {
	if (!playerGuisSelection.get(player)) {
		return;
	}
	for (const ui of playerGuiOf(player).GetDescendants()) {
		if (playerGuisSelection.get(player)!.get(ui as GuiObject)) {
			(ui as GuiObject).Selectable = playerGuisSelection.get(player)!.get(ui as GuiObject)!;
		}
	}
}

FunctionsAndEvents.GamePadButtonR2Down.OnServerEvent.Connect((player) => {
	if ((player.WaitForChild("PlayerGui").WaitForChild("Garage") as GarageGuiShape).Enabled) {
		MakeAllUisNotSelectable(player, playerGuiOf(player).Garage.cashPurchace);
		selectedFunctions.openCashPurchaceMenu(player);
	}
});

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
			showKilledByScreen(player, attacker);
			enableSpectateScreen(player, attacker);
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

	// Landing.Cars (SELECT CAR): the Garage is still fully server-owned this
	// phase — enabling it and wiring its pages here is required.
	connectIntent("Intent_OpenGarage", (player) => {
		const state = getFlowState(player);
		if (state !== "menu" && state !== "lobby") {
			return;
		}
		// State first so the client menus drop before the (potentially
		// yieldy) inventory build.
		UiState.setFlowState(player, "garage");
		const [ok, err] = pcall(() => {
			playerGuiOf(player).Garage.Enabled = true;
			OpenInventory(player);
			ensureGarageMenuButtons(player);
		});
		if (!ok) {
			warn(`[Menu] OpenGarage error: ${err}`);
		}
	});

	// Garage BackToMenu equivalent (the server-wired button calls the same
	// exitToLanding body — this intent exists for a future client-owned
	// garage).
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

	// CreateTeam.Rename (the Garage TeamNameStrip click stays server-wired and
	// calls handleRenameRequest directly).
	connectIntent("Intent_RequestRename", (player) => {
		const state = getFlowState(player);
		if (state !== "lobby" && state !== "garage") {
			return;
		}
		handleRenameRequest(player);
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
