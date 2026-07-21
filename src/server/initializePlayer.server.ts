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
import { Globals } from "./Globals";
import footballMatch from "./Modules/footballMatch";
import TeamRegistry, { CarBallRemotes, RENAME_PRODUCT_ID } from "./Modules/TeamRegistry";
import { ProductIds } from "shared/Monetization";
import type { LadderTeam } from "./Modules/TeamRegistry";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import { PlayerGuiManager } from "./ui/PlayerGuiManager";
import VehicleInputActions from "./Modules/vehicleInputActions";
import { CASH_PURCHACE_MENU_OPEN_SIZE } from "./ui/uiConstants";
import type { CrateItem } from "./Modules/dataTypes";

const TweenService = game.GetService("TweenService");
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
		Purchases: Frame & { VIP: GuiButton; Nuke: GuiButton; LowGravity: GuiButton };
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
		(player.WaitForChild("PlayerGui").WaitForChild("DataLoss") as ScreenGui).Enabled = true;
	}
});

const uiConnections = new Map<Player, Map<string, RBXScriptConnection>>();
const crateDebounces = new Map<Player, boolean>();
const selectedCrate = new Map<Player, number>();

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
	"crateTutorial",
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

//Ui
function openCrate(player: Player) {
	if (!crateDebounces.get(player)) {
		crateDebounces.set(player, true);
		crateModule.openCrate(player, selectedCrate.get(player)!);
		crateDebounces.set(player, false);
	}
}

Globals.openCrateMenu = (player: Player, crateName: number) => {
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

	uiConnections.get(player)!.set(
		"shop3",
		shop.Purchases.Nuke.MouseButton1Click.Connect(() => {
			MarketplaceService.PromptProductPurchase(player, ProductIds.Nuke);
		}),
	);

	uiConnections.get(player)!.set(
		"shop4",
		shop.Purchases.LowGravity.MouseButton1Click.Connect(() => {
			MarketplaceService.PromptProductPurchase(player, ProductIds.LowGravity);
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

interface LandingGuiShape extends ScreenGui {
	Panel: Frame & { Buttons: Frame & { JoinTeam: TextButton; CreateTeam: TextButton; Cars: TextButton } };
}

/** Landing page (Top Table §5): title + Join Team / Create Team / Cars, car
 * in view via the menu camera. Buttons are wired server-side like every other
 * menu screen. */
function showLanding(player: Player) {
	if (!uiConnections.get(player)) {
		uiConnections.set(player, new Map());
	}
	for (const [, connection] of pairs(uiConnections.get(player)!)) {
		connection.Disconnect();
	}

	const gui = playerGuiOf(player);
	const landing = player.WaitForChild("PlayerGui").WaitForChild("Landing") as LandingGuiShape;
	gui.Garage.Enabled = false;
	landing.Enabled = true;

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
			pcall(() => {
				spawnVehicle.SpawnVehicle(
					player,
					false,
					DataUtilities.getPlayerEquippedVehicle(player),
					playerGarage.spawnPlate.CFrame,
					true,
				);
			});
		});
	}

	uiConnections.get(player)!.set(
		"landingJoin",
		landing.Panel.Buttons.JoinTeam.MouseButton1Click.Connect(() => {
			TeamRegistry.joinRandom(player);
			landing.Enabled = false;
			spawnIntoMatch(player);
		}),
	);
	uiConnections.get(player)!.set(
		"landingCreate",
		landing.Panel.Buttons.CreateTeam.MouseButton1Click.Connect(() => {
			// Creates the (locked) team immediately, then opens the team page
			// for invites/settings — Play there spawns in.
			if (!TeamRegistry.getTeamOf(player)) {
				TeamRegistry.createTeam(player, false);
			}
			landing.Enabled = false;
			showTeamPage(player);
		}),
	);
	uiConnections.get(player)!.set(
		"landingCars",
		landing.Panel.Buttons.Cars.MouseButton1Click.Connect(() => {
			landing.Enabled = false;
			gui.Garage.Enabled = true;
			const [ok, err] = pcall(() => OpenInventory(player));
			if (!ok) {
				warn(`[Landing] OpenInventory error: ${err}`);
			}
			ensureGarageMenuButtons(player);
		}),
	);
}

function spawnIntoMatch(player: Player) {
	task.spawn(() => {
		const [ok, result] = pcall(() => Globals.SpawnInPlayer(player));
		if (!ok || result !== true) {
			warn(`[Landing] SpawnInPlayer failed (ok=${ok}) — returning to menu`);
			ResetAndInitialisePlayerMenuUI(player);
			return;
		}
		// Teammates still in the lobby see this member flip to IN MATCH.
		const team = TeamRegistry.getTeamOf(player);
		if (team) {
			for (const member of team.members) {
				if (member !== player) {
					refreshTeamPage(member);
				}
			}
		}
	});
}

// ---- Top Table Phase 2: team page, invites, rename ------------------------

type TeamMemberSlot = Frame & { Avatar: ImageLabel; PlayerName: TextLabel; ReadyTag: TextLabel };
interface CreateTeamGuiShape extends ScreenGui {
	Panel: Frame & {
		Header: Frame & { TeamName: TextLabel; Rename: TextButton };
		Members: Frame & { Slot1: TeamMemberSlot; Slot2: TeamMemberSlot; Slot3: TeamMemberSlot };
		PlayerList: ScrollingFrame & { EmptyHint: TextLabel };
		InviteFriends: TextButton;
		AllowRandoms: TextButton & { SwitchTrack: Frame & { SwitchKnob: Frame } };
		Play: TextButton;
		Leave: TextButton;
	};
}
interface InvitePopupShape extends ScreenGui {
	Panel: Frame & { Message: TextLabel; Accept: TextButton; Decline: TextButton };
}
interface RenamePopupShape extends ScreenGui {
	Panel: Frame & { NameBox: TextBox; Status: TextLabel; Confirm: TextButton; Close: TextButton };
}

const MENU_FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

// ---- vote start (the team page is a mini lobby) ---------------------------
// Play is a ready vote: every member must press it, then the whole team
// spawns together. A lobby team's members are ALWAYS all in the lobby —
// invites can't be accepted into a team that started playing (team.inPlay)
// and joinRandom never fills lobby teams — so there are no exemptions. Votes
// reset on any membership change so a new arrival is never launched by stale
// votes.
const teamReadyVotes = new Map<string, Set<Player>>();

// Lobbies whose vote completed while no round was spawnable (the end-of-round
// interlude, or the shop window): held on "STARTING SOON…" and launched by the
// shop-phase auto start — members carry CB_PendingLaunch so MatchDirector
// shows them the NEXT ROUND countdown and includes them in the auto-spawn.
const pendingLaunchTeams = new Set<string>();

function cancelPendingLaunch(team: LadderTeam) {
	if (!pendingLaunchTeams.delete(team.id)) {
		return;
	}
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
		for (const member of team.members) {
			member.SetAttribute("CB_PendingLaunch", true);
			refreshTeamPage(member);
		}
		warn(`[TeamLobby] ${team.name} vote complete — STARTING SOON (rides the next-round countdown)`);
		return;
	}
	teamReadyVotes.delete(team.id);
	warn(`[TeamLobby] ${team.name} vote complete — launching ${team.members.size()} player(s)`);
	for (const member of team.members) {
		const page = member.FindFirstChild("PlayerGui")?.FindFirstChild("CreateTeam");
		if (page && page.IsA("ScreenGui")) {
			page.Enabled = false;
		}
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
				for (const member of team.members) {
					refreshTeamPage(member);
				}
				tryLaunchTeam(team);
			}
		}
	});
});

TeamRegistry.onTeamDisbanded((team) => {
	teamReadyVotes.delete(team.id);
	pendingLaunchTeams.delete(team.id);
});

function refreshTeamPage(player: Player) {
	const page = player.WaitForChild("PlayerGui").FindFirstChild("CreateTeam") as CreateTeamGuiShape | undefined;
	const team = TeamRegistry.getTeamOf(player);
	if (!page || !team) {
		return;
	}
	page.Panel.Header.TeamName.Text = team.name.upper();
	page.Panel.AllowRandoms.SwitchTrack.BackgroundColor3 = team.open ? Color3.fromRGB(0, 190, 100) : Color3.fromRGB(75, 84, 98);
	page.Panel.AllowRandoms.SwitchTrack.SwitchKnob.Position = UDim2.fromScale(team.open ? 0.73 : 0.27, 0.5);

	// Member cards: slot i shows team.members[i] (index 0 = creator = crown).
	const votes = teamReadyVotes.get(team.id);
	const slots = [page.Panel.Members.Slot1, page.Panel.Members.Slot2, page.Panel.Members.Slot3];
	for (let i = 0; i < slots.size(); i++) {
		const slot = slots[i];
		const member = team.members[i] as Player | undefined;
		if (member) {
			slot.Avatar.Image = `rbxthumb://type=AvatarHeadShot&id=${member.UserId}&w=150&h=150`;
			slot.PlayerName.Text = i === 0 ? `👑 ${member.DisplayName}` : member.DisplayName;
			slot.PlayerName.TextColor3 = member === player ? Color3.fromRGB(255, 214, 120) : new Color3(1, 1, 1);
			slot.PlayerName.TextTransparency = 0;
			slot.ReadyTag.Visible = votes !== undefined && votes.has(member);
		} else {
			slot.Avatar.Image = "";
			slot.PlayerName.Text = "EMPTY SLOT";
			slot.PlayerName.TextColor3 = new Color3(1, 1, 1);
			slot.PlayerName.TextTransparency = 0.5;
			slot.ReadyTag.Visible = false;
		}
	}

	// Play button doubles as the vote button once the team has 2+ members.
	let readyCount = 0;
	for (const member of team.members) {
		if (votes !== undefined && votes.has(member)) {
			readyCount += 1;
		}
	}
	if (pendingLaunchTeams.has(team.id)) {
		page.Panel.Play.Text = "STARTING SOON…";
	} else if (team.members.size() <= 1) {
		page.Panel.Play.Text = "PLAY";
	} else if (votes !== undefined && votes.has(player)) {
		page.Panel.Play.Text = `CANCEL — ${readyCount}/${team.members.size()} READY`;
	} else {
		page.Panel.Play.Text = `READY UP (${readyCount}/${team.members.size()})`;
	}

	for (const child of page.Panel.PlayerList.GetChildren()) {
		if (child.IsA("Frame")) {
			child.Destroy();
		}
	}
	let rowCount = 0;
	for (const other of Players.GetPlayers()) {
		if (other === player || TeamRegistry.getTeamOf(other) === team) {
			continue;
		}
		rowCount += 1;
		const row = new Instance("Frame");
		row.Name = "InviteRow";
		row.Size = new UDim2(1, -16, 0, 46);
		row.BackgroundColor3 = Color3.fromRGB(30, 43, 60);
		row.BorderSizePixel = 0;
		const rowCorner = new Instance("UICorner");
		rowCorner.CornerRadius = new UDim(0, 8);
		rowCorner.Parent = row;
		const rowStroke = new Instance("UIStroke");
		rowStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
		rowStroke.Color = Color3.fromRGB(105, 135, 175);
		rowStroke.Transparency = 0.55;
		rowStroke.Parent = row;

		const avatar = new Instance("ImageLabel");
		avatar.Name = "Avatar";
		avatar.AnchorPoint = new Vector2(0, 0.5);
		avatar.BackgroundColor3 = Color3.fromRGB(46, 60, 80);
		avatar.BorderSizePixel = 0;
		avatar.Image = `rbxthumb://type=AvatarHeadShot&id=${other.UserId}&w=48&h=48`;
		avatar.Position = new UDim2(0, 8, 0.5, 0);
		avatar.Size = new UDim2(0, 34, 0, 34);
		const avatarCorner = new Instance("UICorner");
		avatarCorner.CornerRadius = new UDim(0.5, 0);
		avatarCorner.Parent = avatar;
		avatar.Parent = row;

		const nameLabel = new Instance("TextLabel");
		nameLabel.Name = "PlayerName";
		nameLabel.AnchorPoint = new Vector2(0, 0.5);
		nameLabel.BackgroundTransparency = 1;
		nameLabel.FontFace = MENU_FONT;
		nameLabel.Position = new UDim2(0, 52, 0.5, 0);
		nameLabel.Size = new UDim2(1, -180, 0, 22);
		nameLabel.Text = other.DisplayName;
		nameLabel.TextColor3 = new Color3(1, 1, 1);
		nameLabel.TextScaled = true;
		nameLabel.TextXAlignment = Enum.TextXAlignment.Left;
		nameLabel.Parent = row;

		const inviteButton = new Instance("TextButton");
		inviteButton.Name = "Invite";
		inviteButton.AnchorPoint = new Vector2(1, 0.5);
		inviteButton.AutoButtonColor = true;
		inviteButton.BackgroundColor3 = Color3.fromRGB(166, 235, 187);
		inviteButton.BorderSizePixel = 0;
		inviteButton.FontFace = MENU_FONT;
		inviteButton.Position = new UDim2(1, -8, 0.5, 0);
		inviteButton.Size = new UDim2(0, 108, 0, 30);
		inviteButton.Text = "INVITE";
		inviteButton.TextColor3 = Color3.fromRGB(20, 76, 43);
		inviteButton.TextScaled = true;
		const inviteCorner = new Instance("UICorner");
		inviteCorner.CornerRadius = new UDim(0, 15);
		inviteCorner.Parent = inviteButton;
		const invitePadding = new Instance("UIPadding");
		invitePadding.PaddingTop = new UDim(0, 6);
		invitePadding.PaddingBottom = new UDim(0, 6);
		invitePadding.Parent = inviteButton;
		inviteButton.MouseButton1Click.Connect(() => {
			inviteButton.Text = "SENT ✓";
			sendInvitePopup(other, player);
		});
		inviteButton.Parent = row;
		row.Parent = page.Panel.PlayerList;
	}
	page.Panel.PlayerList.EmptyHint.Visible = rowCount === 0;
}

function showTeamPage(player: Player) {
	if (!uiConnections.get(player)) {
		uiConnections.set(player, new Map());
	}
	for (const [, connection] of pairs(uiConnections.get(player)!)) {
		connection.Disconnect();
	}
	const page = player.WaitForChild("PlayerGui").WaitForChild("CreateTeam") as CreateTeamGuiShape;
	// The lobby can open from anywhere (landing button, invite acceptance
	// mid-menu or mid-match) — make sure the other menu screens drop away.
	pcall(() => {
		playerGuiOf(player).Garage.Enabled = false;
	});
	const landingGui = player.FindFirstChild("PlayerGui")?.FindFirstChild("Landing");
	if (landingGui && landingGui.IsA("ScreenGui")) {
		landingGui.Enabled = false;
	}
	page.Enabled = true;
	refreshTeamPage(player);

	const wire = (key: string, buttonInstance: TextButton, handler: () => void) => {
		uiConnections.get(player)!.set(key, buttonInstance.MouseButton1Click.Connect(handler));
	};
	wire("teamAllow", page.Panel.AllowRandoms, () => {
		const team = TeamRegistry.getTeamOf(player);
		if (team) {
			team.open = !team.open;
			refreshTeamPage(player);
		}
	});
	wire("teamInviteFriends", page.Panel.InviteFriends, () => {
		// Roblox's native invite prompt must run client-side.
		CarBallRemotes.PromptGameInvite.FireClient(player);
	});
	wire("teamRename", page.Panel.Header.Rename, () => {
		handleRenameRequest(player);
	});
	wire("teamPlay", page.Panel.Play, () => {
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
		for (const member of team.members) {
			refreshTeamPage(member);
		}
		tryLaunchTeam(team);
	});
	wire("teamLeave", page.Panel.Leave, () => {
		const team = TeamRegistry.getTeamOf(player);
		page.Enabled = false;
		if (team) {
			// Cancel BEFORE leaveTeam so the leaver's pending marker clears too.
			cancelPendingLaunch(team);
		}
		TeamRegistry.leaveTeam(player);
		if (team) {
			// Membership changed: stale votes must not launch the rest.
			teamReadyVotes.delete(team.id);
			for (const member of team.members) {
				refreshTeamPage(member);
			}
		}
		showLanding(player);
	});
	// Keep the roster live while the page is open: players joining/leaving the
	// server change both the invite list and (via TeamRegistry's own
	// PlayerRemoving) possibly the member cards. Deferred so registry cleanup
	// runs first.
	uiConnections.get(player)!.set(
		"teamRosterAdded",
		Players.PlayerAdded.Connect(() => task.defer(() => refreshTeamPage(player))),
	);
	uiConnections.get(player)!.set(
		"teamRosterRemoved",
		Players.PlayerRemoving.Connect((leaving) => {
			if (leaving !== player) {
				task.defer(() => refreshTeamPage(player));
			}
		}),
	);
}

const inviteGen = new Map<Player, number>();
const inviteConnections = new Map<Player, RBXScriptConnection[]>();

Players.PlayerRemoving.Connect((player) => {
	inviteGen.delete(player);
	for (const connection of inviteConnections.get(player) ?? []) {
		connection.Disconnect();
	}
	inviteConnections.delete(player);
});

function sendInvitePopup(target: Player, from: Player) {
	const team = TeamRegistry.getTeamOf(from);
	// No invites for playing teams (referral popups can arrive long after the
	// lobby launched) — joining mid-play is only via the allow-randoms path.
	if (!team || team.inPlay || team.members.size() >= 3) {
		return;
	}
	const popup = target.FindFirstChild("PlayerGui")?.FindFirstChild("InvitePopup") as InvitePopupShape | undefined;
	if (!popup) {
		return;
	}
	const gen = (inviteGen.get(target) ?? 0) + 1;
	inviteGen.set(target, gen);
	popup.Panel.Message.Text = `${from.DisplayName} invited you to ${team.name}`;
	// A previous invite may have ended on the buttons-hidden failure message.
	popup.Panel.Accept.Visible = true;
	popup.Panel.Decline.Visible = true;
	popup.Enabled = true;

	// A superseded invite's handlers would otherwise stay connected forever
	// (their gen guard keeps them inert but they leak).
	for (const connection of inviteConnections.get(target) ?? []) {
		connection.Disconnect();
	}
	const connections: RBXScriptConnection[] = [];
	inviteConnections.set(target, connections);
	const finish = () => {
		popup.Enabled = false;
		for (const connection of connections) {
			connection.Disconnect();
		}
		if (inviteConnections.get(target) === connections) {
			inviteConnections.delete(target);
		}
	};
	connections.push(
		popup.Panel.Accept.MouseButton1Click.Connect(() => {
			if (inviteGen.get(target) !== gen) {
				return;
			}
			// Validate BEFORE joining: during the invite's 30s lifetime the
			// lobby may have launched into a round, filled up, or disbanded —
			// accepting must fail with a message, never join a playing team.
			let failText: string | undefined;
			if (!TeamRegistry.teamExists(team)) {
				failText = `${team.name} no longer exists`;
			} else if (team.inPlay) {
				failText = `${team.name} already started playing`;
			} else if (team.members.size() >= 3) {
				failText = `${team.name} is full`;
			}
			if (failText !== undefined) {
				finish();
				popup.Panel.Message.Text = `Sorry — ${failText}!`;
				popup.Panel.Accept.Visible = false;
				popup.Panel.Decline.Visible = false;
				popup.Enabled = true;
				task.delay(2.5, () => {
					if (inviteGen.get(target) === gen) {
						popup.Enabled = false;
					}
				});
				return;
			}
			finish();
			const oldTeam = TeamRegistry.getTeamOf(target);
			const wasInMatch = footballMatch.isInMatch(target);
			if (!TeamRegistry.addToTeam(target, team)) {
				warn(`[Invite] ${target.Name} accepted but ${team.name} is full/gone`);
			} else {
				// Membership changed on both sides — stale ready votes or a
				// pending launch must not carry anyone who didn't vote.
				cancelPendingLaunch(team);
				teamReadyVotes.delete(team.id);
				if (oldTeam) {
					cancelPendingLaunch(oldTeam);
					teamReadyVotes.delete(oldTeam.id);
				}
				target.SetAttribute("CB_PendingLaunch", undefined);
				// Accepting mid-match pulls the player off their pitch (the
				// pitch falls back / rebalances like a disconnect), then the
				// accepter lands in the new team's mini lobby.
				const [ok, err] = pcall(() => {
					if (wasInMatch) {
						footballMatch.leaveMatch(target);
						ResetAndInitialisePlayerMenuUI(target);
					}
					showTeamPage(target);
				});
				if (!ok) {
					warn(`[Invite] opening the lobby for ${target.Name} failed: ${err}`);
				}
				// Every member with a mounted team page sees the roster update
				// (refreshTeamPage no-ops for players without page/team).
				for (const member of team.members) {
					refreshTeamPage(member);
				}
			}
		}),
	);
	connections.push(
		popup.Panel.Decline.MouseButton1Click.Connect(() => {
			if (inviteGen.get(target) !== gen) {
				return;
			}
			finish();
		}),
	);
	task.delay(30, () => {
		if (inviteGen.get(target) === gen) {
			finish();
		}
	});
}

function showRenamePopup(player: Player, statusText?: string) {
	const popup = player.WaitForChild("PlayerGui").FindFirstChild("RenamePopup") as RenamePopupShape | undefined;
	if (!popup) {
		return;
	}
	popup.Panel.Status.Text = statusText ?? "";
	popup.Enabled = true;
	if (!popup.GetAttribute("CloseWired")) {
		popup.SetAttribute("CloseWired", true);
		popup.Panel.Close.MouseButton1Click.Connect(() => {
			popup.Enabled = false;
		});
	}
}

function handleRenameRequest(player: Player) {
	if (TeamRegistry.getRenameCredits(player) > 0) {
		showRenamePopup(player);
		return;
	}
	if (RENAME_PRODUCT_ID === 0) {
		// Product not created in the dashboard yet — free credit so the flow
		// stays testable in Studio.
		warn("[Rename] RENAME_PRODUCT_ID not set — granting a free test credit");
		TeamRegistry.grantRenameCredit(player);
		return; // the credit-attribute watcher opens the popup
	}
	MarketplaceService.PromptProductPurchase(player, RENAME_PRODUCT_ID);
}

// Typed rename submissions (client fires with the TextBox contents).
CarBallRemotes.SubmitTeamName.OnServerEvent.Connect((player, raw) => {
	if (!typeIs(raw, "string")) {
		return;
	}
	const result = TeamRegistry.tryRename(player, raw);
	const popup = player.FindFirstChild("PlayerGui")?.FindFirstChild("RenamePopup") as RenamePopupShape | undefined;
	if (!popup) {
		return;
	}
	if (result === "ok") {
		popup.Enabled = false;
		const teamName = playerGuiOf(player).Garage.FindFirstChild("CurrentTeamName", true);
		if (teamName?.IsA("TextLabel")) {
			teamName.Text = TeamRegistry.getTeamOf(player)?.name ?? "NO TEAM";
		}
		refreshTeamPage(player);
	} else if (result === "moderated") {
		popup.Panel.Status.Text = "That name was moderated — try another";
	} else if (result === "nocredit") {
		popup.Enabled = false;
	} else {
		popup.Panel.Status.Text = "Something went wrong — try again";
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
			// EXIT TEAM: leaving the team is what disconnects the player from
			// the shop-phase auto start (auto-spawn only takes teamed players).
			const team = TeamRegistry.getTeamOf(player);
			if (team) {
				TeamRegistry.leaveTeam(player);
				teamReadyVotes.delete(team.id);
			}
			backButton.Text = backButtonLabel(player);
			showLanding(player);
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

Globals.SpawnInPlayer = (player: Player): boolean => {
	warn(`[SpawnInPlayer] ENTER ${player.Name}`);
	Globals.clearPlayerGarage(player);

	// Original: for i,v in pairs(player.PlayerGui:GetChildren()) do v:Destroy() end
	PlayerGuiManager.destroyAll(player);

	player.LoadCharacter();
	warn(`[SpawnInPlayer] after LoadCharacter Character=${player.Character?.GetFullName() ?? "nil"}`);
	// Original: the engine re-cloned StarterGui into PlayerGui on LoadCharacter
	// (every ScreenGui has ResetOnSpawn = true) — the React equivalent mounts here.
	PlayerGuiManager.mountAll(player);
	FunctionsAndEvents.ToggleMenuCamera.FireClient(player, false);

	// local timerGui = player.PlayerGui:WaitForChild("TimerGui")
	// timerGui.Enabled = true
	// for i = 2, 1, -1 do
	// 	timerGui.TextLabel.Text = "Spawning in " .. i
	// 	task.wait(1)
	// end
	//task.wait(2)
	//timerGui.Enabled = false

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
			pendingLaunchTeams.delete(ladderTeam.id);
			teamReadyVotes.delete(ladderTeam.id);
		}
		player.SetAttribute("CB_PendingLaunch", undefined);
		spawnCFrame = footballMatch.getSpawnCFrame(player);
	}
	if (spawnCFrame === undefined) {
		const spawnParts: BasePart[] = [];
		for (const descendant of (game.Workspace as unknown as { SpawnPoints: Folder }).SpawnPoints.GetDescendants()) {
			if (descendant.IsA("BasePart")) {
				spawnParts.push(descendant);
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

	if (Globals.gamemode === "Football") {
		// onPlayerSpawned starts the countdown/lock bookkeeping; the marker set
		// by preSpawnLock already kept the sit-edge enable from firing.
		footballMatch.onPlayerSpawned(player);
		const matchHud = player.WaitForChild("PlayerGui").FindFirstChild("MatchHud");
		if (matchHud && matchHud.IsA("ScreenGui")) {
			matchHud.Enabled = true;
		}
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
	return true;
};

function initialisePlayerUi(player: Player) {
	task.spawn(() => {
		DataStore2.SaveAll(player);
	});
	let playerGarage: ReturnType<typeof Globals.addPlayerToGarage> | undefined = Globals.addPlayerToGarage(player);

	const playerMoney = DataStore2("money", player);

	setPlayerCash(player, playerMoney.Get(DataStoreDefaults.money) as number);
	setPlayerTrophies(player, DataStore2("trophies", player).Get(DataStoreDefaults.trophies) as number);

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
		} else {
			showLanding(player);
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

	//_G.CrateTutorial(player)
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

//stops the players character from spawning and moves all the uis into the player as it deosnt automaticaly happen without spawning character
game.GetService("Players").CharacterAutoLoads = false;

function ResetAndInitialisePlayerMenuUI(player: Player) {
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

	const existingCharacter = player.Character;
	if (existingCharacter) {
		existingCharacter.Destroy();
	}

	//task.wait(0.2)
	Globals.PlayerJoinedTimes[player.UserId] = os.time();

	const ui = player.WaitForChild("PlayerGui");

	// Original: clone every StarterGui child into PlayerGui.
	PlayerGuiManager.mountAll(player);

	createValues(player);
	initialisePlayerUi(player);

	// Rename purchase completions open the naming popup (credits arrive
	// asynchronously via purchaseHandler's receipt processor).
	player.GetAttributeChangedSignal("CB_RenameCredits").Connect(() => {
		const credits = player.GetAttribute("CB_RenameCredits");
		if (typeIs(credits, "number") && credits > 0) {
			showRenamePopup(player);
		}
	});

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
				sendInvitePopup(player, referrer);
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

roundHandler.startRound();
