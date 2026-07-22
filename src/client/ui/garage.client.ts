// Client garage (client-side UI migration, Phase 5).
//
// The Garage ScreenGui is CLIENT-owned (mounted once by bootstrap.client.ts).
// This script reimplements the old server-side garage UI — setTab.ts,
// itemPopulateSpecifics.ts, the UI halves of itemSelectedFunctions.ts and
// initializePlayer's OpenInventory/OpenShop/openCrateMenu/ensureGarageMenuButtons
// — rendering everything from replicated state:
//
//   * Garage.Enabled derives from CB_FlowState == "garage".
//   * Inventory tiles come from the Ui_GetProfile snapshot (owned/equipped)
//     + the ReplicatedStorage mirrors (VehicleModels/CarHorns/Colors/
//     BoostTrails, mirrored by profileSnapshot.ts + CrateModule.ts) + the
//     place-file templates (ReplicatedStorage.Ui.DisplayButtons/LockedButtons/
//     CrateFrame/CarCategory). The snapshot refetches on CB_ProfileVersion.
//   * Money/trophy labels render from CB_Money / CB_Trophies.
//   * Tile clicks fire Intent_EquipVehicle/Color/Horn/Trail,
//     Intent_PreviewVehicle and Intent_UnlockVehicle — ownership and trophy
//     thresholds are re-validated SERVER-side (garageIntents.ts); everything
//     here is cosmetic.
//   * Shop: VIP → client PromptGamePassPurchase; cash packs → client
//     PromptProductPurchase (tile instance names unchanged, so
//     monetizationPrices.client.ts keeps localizing them); crate tiles →
//     client-local crate page + Intent_ViewCrate (server aims the camera).
//   * Crate page OPEN → Intent_OpenCrate (server re-validates policy +
//     affordability; the reveal arrives on Ui_CrateResult, handled by
//     crateAnimation.client.ts). Lootbox-restricted players (the
//     CB_LootboxRestricted attribute) get a client-rendered modal instead.
//   * Tab switches aim the menu camera locally over the menuCameraBus.
//   * Gamepad garage nav (X/Y/R1/L1/R2) is client-local here; the retired
//     server remotes are no longer fired for these (see
//     VehicleKeyHandler.client.ts).

import { getUiIntentEvent, getUiIntentFunction } from "shared/UiIntents";
import CrateCatalog, { CRATE_NAMES } from "shared/CrateCatalog";
import { getCarTrophyCost } from "shared/carTrophyCosts";
import populateCrateFrameModule from "shared/PopulateCrateFrame";
import { PassIds } from "shared/Monetization";
import { CASH_PURCHACE_MENU_OPEN_SIZE } from "shared/ui/uiConstants";
import { NEXT_SELECTION_WIRINGS } from "shared/ui/components/guiMetadata";
import { aimMenuCamera } from "shared/ui/menuCameraBus";
import type { UiProfileSnapshot } from "shared/UiProfile";

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const MarketplaceService = game.GetService("MarketplaceService");
const TweenService = game.GetService("TweenService");
const UserInputService = game.GetService("UserInputService");

const LocalPlayer = Players.LocalPlayer;
const playerGui = LocalPlayer.WaitForChild("PlayerGui") as Instance;

// ---- colors/fonts (from the deleted server modules) -------------------------

const SELECTED_ITEM_COLOR = Color3.fromRGB(173, 138, 0);
const UNSELECTED_ITEM_COLOR = new Color3(0, 0, 0);
const SELECTED_TAB_COLOR = Color3.fromRGB(255, 153, 29);
const DEFAULT_TAB_COLOR = new Color3(1, 1, 1);
const UNLOCK_AFFORDABLE_COLOR = Color3.fromRGB(60, 200, 90);
const UNLOCK_LOCKED_COLOR = Color3.fromRGB(110, 110, 110);
const MENU_FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

// ---- small utils (ports of the server-only GeneralUtils helpers) ------------

function commaNumber(n: number): string {
	if (math.abs(n) < 1000) {
		return tostring(n);
	}
	let result =
		(n < 0 ? "-" : "") +
		string.reverse(
			string.gsub(string.gsub(string.reverse(tostring(math.abs(math.floor(n)))), "%d%d%d", "%1,")[0], ",$", "")[0],
		);
	if (n !== math.floor(n)) {
		result = result + "." + (string.match(tostring(n), "%d+.$")[0] as string);
	}
	return result;
}

function addSpacesBeforeCaps(str: string): string {
	const splitLocation = string.find(str, "%l%u")[0];
	if (splitLocation !== undefined) {
		const first = string.sub(str, 0, splitLocation);
		const second = string.sub(str, splitLocation + 1);
		return first + " " + addSpacesBeforeCaps(second);
	}
	return str;
}

function removeGuiObjectChildren(parent: Instance) {
	for (const child of parent.GetChildren()) {
		if (child.IsA("GuiObject")) {
			child.Destroy();
		}
	}
}

function resolvePath(base: Instance, path: string): Instance | undefined {
	let current: Instance | undefined = base;
	for (const [part] of string.gmatch(path, "[^/]+")) {
		if (current === undefined) return undefined;
		current = current.FindFirstChild(part as string);
	}
	return current;
}

// ---- instance shapes --------------------------------------------------------

type TabName = "Body" | "Colors" | "CarHorn" | "BoostTrail";
const TAB_TO_OWNED: Record<TabName, keyof UiProfileSnapshot> = {
	Body: "ownedVehicles",
	Colors: "ownedColors",
	CarHorn: "ownedHorns",
	BoostTrail: "ownedTrails",
};
const TAB_TO_MIRROR: Record<TabName, string> = {
	Body: "VehicleModels",
	Colors: "Colors",
	CarHorn: "CarHorns",
	BoostTrail: "BoostTrails",
};

interface TabFrame extends Frame {
	List: ScrollingFrame;
}

type CategoryBlock = Frame & { UIGridLayout: UIGridLayout };

interface InventoryShape extends Frame {
	Content: Frame & {
		CarList: Frame & { Scroll: ScrollingFrame };
		List: Frame & { Scroll: ScrollingFrame };
	};
	SpawnButton: Frame & { Button: TextButton };
	BuyButton: Frame & {
		Button: TextButton & { Price: TextLabel; TextLabel: TextLabel };
		BuyButtonConsole: BindableEvent;
	};
	Buttons: Frame & { Buttons: Frame & { Inventory: Frame } };
	ShopButton: GuiButton;
}

interface GarageShape extends ScreenGui {
	Inventory: InventoryShape;
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
	cashPurchace: Frame & { cash: Frame };
	Money: Frame & {
		Currency: Frame & { TextLabel: TextLabel; Add: GuiButton };
		Trophies: Frame & { TextLabel: TextLabel };
	};
}

interface RenamePopupShape extends ScreenGui {
	Panel: Frame & { Status: TextLabel };
}

const garage = playerGui.WaitForChild("Garage") as GarageShape;
const inventory = garage.Inventory;
const shop = garage.Shop;
const cratePage = garage.CrateMenu;
const cashPurchace = garage.cashPurchace;

const uiTemplates = ReplicatedStorage.WaitForChild("Ui") as Instance & {
	DisplayButtons: Folder;
	LockedButtons: Folder;
	CrateFrame: Frame;
};

// ---- replicated-state readers -----------------------------------------------

function flowState(): string | undefined {
	const state = LocalPlayer.GetAttribute("CB_FlowState");
	return typeIs(state, "string") ? state : undefined;
}

function myMoney(): number {
	const money = LocalPlayer.GetAttribute("CB_Money");
	return typeIs(money, "number") ? money : 0;
}

function myTrophies(): number {
	const trophies = LocalPlayer.GetAttribute("CB_Trophies");
	return typeIs(trophies, "number") ? trophies : 0;
}

function lootboxRestricted(): boolean {
	return LocalPlayer.GetAttribute("CB_LootboxRestricted") === true;
}

/** The local player's LADDER team instance (attribute-carrying), if any. */
function myTeam(): Team | undefined {
	const team = LocalPlayer.Team;
	if (team !== undefined && team.GetAttribute("CB_TeamId") !== undefined) {
		return team;
	}
	return undefined;
}

/** The player's world garage stall (for local tab camera shots). Resolved
 * fresh each time — stalls are reassigned on every menu init. */
function myGarageStall(): Instance | undefined {
	const garages = game.Workspace.FindFirstChild("PlayerGarages");
	if (!garages) {
		return undefined;
	}
	for (const stall of garages.GetChildren()) {
		const owner = stall.FindFirstChild("Player");
		if (owner !== undefined && owner.IsA("NumberValue") && owner.Value === LocalPlayer.UserId) {
			return stall;
		}
	}
	return undefined;
}

function aimTabCamera(tab: TabName) {
	const stall = myGarageStall();
	const cameras = stall?.FindFirstChild("Cameras");
	const cameraPart = cameras?.FindFirstChild(tab);
	if (cameraPart && cameraPart.IsA("BasePart")) {
		aimMenuCamera(cameraPart.CFrame);
	}
}

// ---- profile snapshot -------------------------------------------------------

let profile: UiProfileSnapshot | undefined;
let fetchInFlight = false;
let fetchQueued = false;

function refetchProfile() {
	if (fetchInFlight) {
		fetchQueued = true;
		return;
	}
	fetchInFlight = true;
	task.spawn(() => {
		const [ok, result] = pcall(() => getUiIntentFunction("Ui_GetProfile").InvokeServer());
		fetchInFlight = false;
		if (ok && typeIs(result, "table")) {
			profile = result as UiProfileSnapshot;
		} else if (!ok) {
			warn(`[Garage] Ui_GetProfile failed: ${result}`);
		}
		if (fetchQueued) {
			fetchQueued = false;
			refetchProfile();
			return;
		}
		rerenderCurrentTab();
	});
}

LocalPlayer.GetAttributeChangedSignal("CB_ProfileVersion").Connect(refetchProfile);

// ---- money / trophy labels --------------------------------------------------

function renderMoney() {
	garage.Money.Currency.TextLabel.Text = "$" + commaNumber(myMoney());
}

function renderTrophies() {
	garage.Money.Trophies.TextLabel.Text = "🏆 " + commaNumber(myTrophies());
	refreshUnlockButtonColor();
}

LocalPlayer.GetAttributeChangedSignal("CB_Money").Connect(renderMoney);
LocalPlayer.GetAttributeChangedSignal("CB_Trophies").Connect(renderTrophies);

// ---- unlock button (old SetupUnlockButton / EnableSpawnButton) --------------
// The garage Spawn button stayed retired (Top Table: play starts from the
// landing page / shop countdown), so the owned-car state simply hides the
// unlock strip and re-shows the team-name strip.

let currentUnlock: { item: string; cost: number } | undefined;

function setTeamNameStripVisible(visible: boolean) {
	const strip = inventory.FindFirstChild("TeamNameStrip");
	if (strip?.IsA("GuiObject")) {
		strip.Visible = visible;
	}
}

function enableEquipState() {
	currentUnlock = undefined;
	inventory.BuyButton.Visible = false;
	setTeamNameStripVisible(true);
}

function refreshUnlockButtonColor() {
	if (currentUnlock !== undefined) {
		inventory.BuyButton.Button.BackgroundColor3 =
			myTrophies() >= currentUnlock.cost ? UNLOCK_AFFORDABLE_COLOR : UNLOCK_LOCKED_COLOR;
	}
}

function setupUnlockButton(cost: number, item: string) {
	currentUnlock = { item: item, cost: cost };
	inventory.BuyButton.Visible = true;
	setTeamNameStripVisible(false);
	const button = inventory.BuyButton.Button;
	button.TextLabel.Text = "UNLOCK";
	button.Price.Text = `🏆 ${commaNumber(cost)}`;
	refreshUnlockButtonColor();
}

function unlockButtonPressed() {
	const unlock = currentUnlock;
	if (unlock === undefined) {
		return;
	}
	// Client-side pre-check mirrors the old server check at click time; the
	// server re-validates inside Intent_UnlockVehicle regardless.
	if (myTrophies() >= unlock.cost) {
		getUiIntentEvent("Intent_UnlockVehicle").FireServer(unlock.item);
		enableEquipState();
		// The grant bumps CB_ProfileVersion → refetch → the Cars grid re-renders
		// with the tile owned+selected.
	}
}

inventory.BuyButton.Button.MouseButton1Click.Connect(unlockButtonPressed);
// Console path parity: the old server gamepad-Y handler fired this bindable.
inventory.BuyButton.BuyButtonConsole.Event.Connect(unlockButtonPressed);

// ---- selection highlight (old SelectUiFrame) --------------------------------

function selectUiFrame(uiFrame: GuiObject, parent: Instance) {
	for (const ui of parent.GetDescendants()) {
		let breakLoop = false;
		pcall(() => {
			if (ui.IsA("GuiBase") && (ui as GuiObject).BackgroundColor3 === SELECTED_ITEM_COLOR) {
				(ui as GuiObject).BackgroundColor3 = UNSELECTED_ITEM_COLOR;
				breakLoop = true;
			}
		});
		if (breakLoop) {
			break;
		}
	}
	uiFrame.BackgroundColor3 = SELECTED_ITEM_COLOR;
}

// ---- horn preview (old itemSelectedFunctions.CarHorn sound, client-local) ---

function playHornPreview(hornName: string) {
	const existing = inventory.FindFirstChildWhichIsA("Sound");
	if (existing) {
		existing.Destroy();
	}
	const horns = ReplicatedStorage.FindFirstChild("CarHorns");
	const template = horns?.FindFirstChild(hornName);
	if (template && template.IsA("Sound")) {
		const sound = template.Clone();
		sound.Parent = inventory;
		sound.Play();
		sound.Stopped.Connect(() => sound.Destroy());
		sound.Ended.Connect(() => sound.Destroy());
	}
}

// ---- tile population (ports of itemPopulateSpecifics) -----------------------

function mirrorFolder(tab: TabName): Instance | undefined {
	return ReplicatedStorage.FindFirstChild(TAB_TO_MIRROR[tab]);
}

function lockedContentFor(tab: TabName, owned: string[]): string[] {
	const folder = mirrorFolder(tab);
	const locked: string[] = [];
	if (folder) {
		for (const child of folder.GetChildren()) {
			if (owned.indexOf(child.Name) === -1) {
				locked.push(child.Name);
			}
		}
	}
	return locked;
}

function populateBodyTile(uiFrame: GuiButton, carName: string) {
	const typed = uiFrame as GuiButton & { Txt: TextLabel; ViewportFrame: ViewportFrame; Price: TextLabel };
	if (profile && profile.equippedVehicle === carName) {
		uiFrame.BackgroundColor3 = SELECTED_ITEM_COLOR;
	}
	const modelTemplate = ReplicatedStorage.FindFirstChild("VehicleModels")?.FindFirstChild(carName);
	if (modelTemplate) {
		const displayName = modelTemplate.GetAttribute("DisplayName");
		typed.Txt.Text = typeIs(displayName, "string") ? displayName : carName;
		const model = modelTemplate.Clone();
		model.Parent = typed.ViewportFrame;
	} else {
		typed.Txt.Text = carName;
	}

	// Trophy threshold (progression rework): sorts the flat car list ascending
	// and shows 🏆N bottom-right on locked tiles.
	const cost = getCarTrophyCost(carName);
	uiFrame.LayoutOrder = cost;
	if (uiFrame.FindFirstChild("Price")) {
		typed.Price.Text = cost === 0 ? "FREE" : `🏆${commaNumber(cost)}`;
	}
}

function populateColorTile(uiFrame: GuiButton, colorName: string) {
	const typed = uiFrame as GuiButton & { Txt: TextLabel };
	const colorValue = ReplicatedStorage.FindFirstChild("Colors")?.FindFirstChild(colorName);
	if (colorValue && colorValue.IsA("Color3Value")) {
		uiFrame.BackgroundColor3 = colorValue.Value;
	}
	typed.Txt.Text = addSpacesBeforeCaps(colorName);
}

function populateHornTile(uiFrame: GuiButton, hornName: string) {
	const typed = uiFrame as GuiButton & { Txt: TextLabel };
	if (profile && profile.equippedHorn === hornName) {
		uiFrame.BackgroundColor3 = SELECTED_ITEM_COLOR;
	}
	typed.Txt.Text = addSpacesBeforeCaps(hornName);
}

const blancImage = "rbxassetid://5458835735";

function populateTrailTile(uiFrame: GuiButton, trailName: string) {
	const typed = uiFrame as GuiButton & {
		Txt: TextLabel;
		ImageLabel: ImageLabel & { UIGradient: UIGradient };
		particle: ImageLabel & { UIGradient: UIGradient };
	};
	if (profile && profile.equippedTrail === trailName) {
		uiFrame.BackgroundColor3 = SELECTED_ITEM_COLOR;
	}
	typed.Txt.Text = addSpacesBeforeCaps(trailName);

	const trailModel = ReplicatedStorage.FindFirstChild("BoostTrails")?.FindFirstChild(trailName) as
		| (Instance & { Trail: Trail; ParticleEmitter: ParticleEmitter })
		| undefined;
	if (!trailModel) {
		return;
	}

	if (trailModel.Trail.Texture === "" || (trailModel.Trail.Texture as unknown) === undefined) {
		typed.ImageLabel.Image = blancImage;
	} else {
		typed.ImageLabel.Image = trailModel.Trail.Texture;
	}
	typed.ImageLabel.UIGradient.Color = trailModel.Trail.Color;
	typed.ImageLabel.UIGradient.Transparency = trailModel.Trail.Transparency;

	if (trailModel.ParticleEmitter.Texture === "" || (trailModel.ParticleEmitter.Texture as unknown) === undefined) {
		typed.particle.Image = blancImage;
	} else {
		typed.particle.Image = trailModel.ParticleEmitter.Texture;
	}
	typed.particle.UIGradient.Color = trailModel.ParticleEmitter.Color;
}

const POPULATE_SPECIFICS: Record<TabName, (uiFrame: GuiButton, item: string) => void> = {
	Body: populateBodyTile,
	Colors: populateColorTile,
	CarHorn: populateHornTile,
	BoostTrail: populateTrailTile,
};

// ---- tile click callbacks (ports of itemSelectedFunctions) ------------------

function onBodySelected(carName: string, locked: boolean, uiFrame: GuiButton) {
	if (locked) {
		getUiIntentEvent("Intent_PreviewVehicle").FireServer(carName);
		setupUnlockButton(getCarTrophyCost(carName), carName);
	} else {
		getUiIntentEvent("Intent_EquipVehicle").FireServer(carName);
		enableEquipState();
		if (profile) {
			profile.equippedVehicle = carName;
		}
		selectUiFrame(uiFrame, uiFrame.Parent!.Parent!);
	}
}

function onColorSelected(colorName: string, locked: boolean) {
	enableEquipState();
	// Server paints the display car either way; equips only when owned.
	getUiIntentEvent("Intent_EquipColor").FireServer(colorName);
	if (!locked && profile) {
		profile.equippedColor = colorName;
	}
}

function onHornSelected(hornName: string, locked: boolean, uiFrame: GuiButton) {
	getUiIntentEvent("Intent_EquipHorn").FireServer(hornName);
	if (!locked) {
		if (profile) {
			profile.equippedHorn = hornName;
		}
		selectUiFrame(uiFrame, uiFrame.Parent!);
	}
	playHornPreview(hornName);
}

function onTrailSelected(trailName: string, locked: boolean, uiFrame: GuiButton) {
	getUiIntentEvent("Intent_EquipTrail").FireServer(trailName);
	if (!locked) {
		if (profile) {
			profile.equippedTrail = trailName;
		}
		selectUiFrame(uiFrame, uiFrame.Parent!);
	}
}

const ITEM_SELECTED: Record<TabName, (item: string, locked: boolean, uiFrame: GuiButton) => void> = {
	Body: onBodySelected,
	Colors: (item, locked) => onColorSelected(item, locked),
	CarHorn: onHornSelected,
	BoostTrail: onTrailSelected,
};

// ---- list population (ports of setTab's populateScrollFrame*) ---------------

function setOnlyVisibleFrameOfParent(visibleFrameName: string, parent: Instance) {
	for (const ui of parent.GetChildren()) {
		if (ui.IsA("Frame")) {
			ui.Visible = ui.Name === visibleFrameName;
		}
	}
}

function populateScrollFrame(tab: TabName, scrollFrame: ScrollingFrame, content: string[], lockedContent: string[]) {
	removeGuiObjectChildren(scrollFrame);
	const template = uiTemplates.DisplayButtons.FindFirstChild(tab) as GuiButton | undefined;
	const lockedTemplate = uiTemplates.LockedButtons.FindFirstChild(tab) as GuiButton | undefined;
	if (!template) {
		return;
	}
	// Integer keys replicate the original uiFrames table exactly — the
	// NextSelection wiring below does i±2 neighbor lookups on them.
	const uiFrames = new Map<number, GuiButton>();
	let k = 0;
	for (const item of content) {
		k += 1;
		const index = k;
		const uiFrame = template.Clone();
		uiFrames.set(index, uiFrame);
		uiFrame.Parent = scrollFrame;
		uiFrame.MouseButton1Click.Connect(() => {
			ITEM_SELECTED[tab](item, false, uiFrame);
		});
		POPULATE_SPECIFICS[tab](uiFrame, item);
	}
	if (lockedTemplate) {
		for (const item of lockedContent) {
			k += 1;
			const index = k;
			const uiFrame = lockedTemplate.Clone();
			uiFrames.set(index, uiFrame);
			uiFrame.Parent = scrollFrame;
			uiFrame.MouseButton1Click.Connect(() => {
				ITEM_SELECTED[tab](item, true, uiFrame);
			});
			POPULATE_SPECIFICS[tab](uiFrame, item);
		}
	}

	for (const [i, uiFrame] of pairs(uiFrames)) {
		const down = uiFrames.get(i + 2);
		if (down) {
			uiFrame.NextSelectionDown = down;
		}
		const up = uiFrames.get(i - 2);
		if (up) {
			uiFrame.NextSelectionUp = up;
		}
	}
}

function populateCarsGrid(content: string[], lockedContent: string[]) {
	const carList = inventory.Content.CarList;
	carList.Visible = true;
	inventory.Content.List.Visible = false;

	removeGuiObjectChildren(carList.Scroll);

	const blockTemplate = uiTemplates.FindFirstChild("CarCategory") as CategoryBlock | undefined;
	const template = uiTemplates.DisplayButtons.FindFirstChild("Body") as GuiButton | undefined;
	const lockedTemplate = uiTemplates.LockedButtons.FindFirstChild("Body") as GuiButton | undefined;
	if (!blockTemplate || !template) {
		warn("[Garage] car grid templates missing (ReplicatedStorage.Ui.CarCategory / DisplayButtons.Body)");
		return;
	}

	// Categories removed: ONE grid block holds every car, ordered by trophy
	// cost (LayoutOrder, set by populateBodyTile).
	const carBlock = blockTemplate.Clone();
	carBlock.Parent = carList.Scroll;
	carBlock.LayoutOrder = 1;

	for (const car of content) {
		const uiFrame = template.Clone();
		uiFrame.Parent = carBlock;
		uiFrame.MouseButton1Click.Connect(() => {
			onBodySelected(car, false, uiFrame);
		});
		populateBodyTile(uiFrame, car);
	}
	if (lockedTemplate) {
		for (const car of lockedContent) {
			const uiFrame = lockedTemplate.Clone();
			uiFrame.Parent = carBlock;
			uiFrame.MouseButton1Click.Connect(() => {
				onBodySelected(car, true, uiFrame);
			});
			populateBodyTile(uiFrame, car);
		}
	}

	const absoluteFrameSize = carBlock.AbsoluteSize;
	const absoluteContentSize = carBlock.UIGridLayout.AbsoluteContentSize;
	if (absoluteFrameSize.Y > 0 && absoluteContentSize.Y > 0) {
		const increase = absoluteContentSize.Y / absoluteFrameSize.Y;
		carBlock.Size = new UDim2(
			carBlock.Size.X.Scale,
			carBlock.Size.X.Offset,
			carBlock.Size.Y.Scale * increase,
			carBlock.Size.Y.Offset,
		);
		carBlock.UIGridLayout.CellSize = new UDim2(
			carBlock.UIGridLayout.CellSize.X.Scale,
			0,
			carBlock.UIGridLayout.CellSize.Y.Scale / increase,
			0,
		);
	}
}

// ---- tab bar (old SetupTabButtons/OpenTabButton/HighlightButtonInBar) -------

let currentTab: TabName = "Body";

function tabButtonsBar(): Instance {
	return inventory.Buttons.Buttons.Inventory;
}

function highlightTabButton(tabName: string) {
	for (const button of tabButtonsBar().GetChildren()) {
		if (button.IsA("GuiObject")) {
			pcall(() => {
				(button as ImageButton).ImageColor3 = button.Name === tabName ? SELECTED_TAB_COLOR : DEFAULT_TAB_COLOR;
			});
		}
	}
}

/** Open an inventory tab (old setTab.Inventory). initialEntry skips the
 * display-car respawn — the server's enterGarageState just spawned it. */
function openTab(tab: TabName, initialEntry?: boolean) {
	currentTab = tab;
	highlightTabButton(tab);
	aimTabCamera(tab);

	if (initialEntry !== true && profile) {
		// The old setTab respawned the equipped car on every tab switch; the
		// BoostTrail tab also re-applied the equipped trail beam.
		getUiIntentEvent("Intent_PreviewVehicle").FireServer(profile.equippedVehicle, tab === "BoostTrail");
	}

	const owned = profile ? ((profile[TAB_TO_OWNED[tab]] as string[]) ?? []) : [];
	if (tab === "Body") {
		populateCarsGrid(owned, lockedContentFor(tab, owned));
	} else {
		inventory.Content.CarList.Visible = false;
		inventory.Content.List.Visible = true;
		setOnlyVisibleFrameOfParent(tab, inventory.Content.List.Scroll);
		const tabFrame = inventory.Content.List.Scroll.FindFirstChild(tab) as TabFrame | undefined;
		if (tabFrame) {
			populateScrollFrame(tab, tabFrame.List, owned, lockedContentFor(tab, owned));
		}
	}
}

function rerenderCurrentTab() {
	if (garage.Enabled && inventory.Visible) {
		openTab(currentTab, true);
	}
}

for (const button of tabButtonsBar().GetChildren()) {
	if (button.IsA("GuiButton")) {
		button.MouseButton1Click.Connect(() => {
			const name = button.Name;
			if (name === "Body" || name === "Colors" || name === "CarHorn" || name === "BoostTrail") {
				openTab(name);
			}
		});
	}
}

// ---- page navigation (old OpenInventory/OpenShop/openCrateMenu) -------------

function openInventoryPage(initialEntry?: boolean) {
	cratePage.Visible = false;
	shop.Visible = false;
	inventory.Visible = true;
	// The old OpenInventory always (re)opened the Body tab.
	openTab("Body", initialEntry);
}

function openShopPage() {
	cratePage.Visible = false;
	inventory.Visible = false;
	shop.Visible = true;
}

let currentCrateId: number | undefined;

function openCratePage(crateId: number) {
	const crateContent = CrateCatalog.get(crateId);
	if (!crateContent) {
		return;
	}
	currentCrateId = crateId;

	for (const child of cratePage.Content.GetChildren()) {
		if (child.IsA("Frame")) {
			child.Destroy();
		}
	}

	cratePage.Visible = true;
	inventory.Visible = false;
	shop.Visible = false;

	// Server-authoritative crate camera (old openCrateMenu's
	// SetMenuCameraCFrame with the stall's CrateMenu shot).
	getUiIntentEvent("Intent_ViewCrate").FireServer(crateId);

	cratePage.CrateName.Text = CRATE_NAMES.get(crateId) ?? "";

	if (crateId > 0) {
		cratePage.OpenButton.TextLabel.Text = "OPEN - $" + crateContent.price;
	} else {
		// monetizationPrices.client.ts replaces the ellipsis with the
		// localized Robux price (it watches this label's Text).
		cratePage.OpenButton.TextLabel.Text = "OPEN - R$ …";
	}

	for (const itemToShow of crateContent.content) {
		const itemGui = uiTemplates.CrateFrame.Clone();

		const button = new Instance("TextButton");
		button.Parent = itemGui;
		button.Transparency = 1;
		button.Size = new UDim2(1, 0, 1, 0);
		button.ZIndex = 3;

		populateCrateFrameModule.PopulateFrame(itemGui as never, itemToShow, cratePage.Content);
		button.MouseButton1Click.Connect(() => {
			// Preview the crate item on the display car (server resets the car
			// pose first — the old crate-menu click's resetVehicle). previewOnly:
			// never equips, matching the old locked=true calls.
			if (itemToShow.type === "Colors") {
				getUiIntentEvent("Intent_EquipColor").FireServer(itemToShow.name, true);
			} else if (itemToShow.type === "CarHorns") {
				getUiIntentEvent("Intent_EquipHorn").FireServer(itemToShow.name, true);
				playHornPreview(itemToShow.name);
			} else if (itemToShow.type === "BoostTrails") {
				getUiIntentEvent("Intent_EquipTrail").FireServer(itemToShow.name, true);
			}
		});
	}
}

function pressOpenCrate() {
	const crateId = currentCrateId;
	if (crateId === undefined) {
		return;
	}
	if (lootboxRestricted()) {
		showRestrictedModal();
		return;
	}
	const crateContent = CrateCatalog.get(crateId);
	if (!crateContent) {
		return;
	}
	if (crateId > 0 && myMoney() < crateContent.price) {
		// Old server flow opened the cash menu when the player couldn't
		// afford the crate — now client-local (server still re-validates).
		openCashMenu();
		return;
	}
	// The server re-runs policy/affordability and, for the Robux crate,
	// prompts the OverdriveCrate product purchase itself (receipt →
	// crateModule.actuallyOpen, unchanged).
	getUiIntentEvent("Intent_OpenCrate").FireServer(crateId);
}

cratePage.BackButton.MouseButton1Click.Connect(openShopPage);
cratePage.OpenButton.MouseButton1Click.Connect(pressOpenCrate);

// ---- shop wiring ------------------------------------------------------------

shop.InventoryButton.MouseButton1Click.Connect(() => {
	openInventoryPage();
});
inventory.ShopButton.MouseButton1Click.Connect(openShopPage);

shop.Purchases.VIP.MouseButton1Click.Connect(() => {
	MarketplaceService.PromptGamePassPurchase(LocalPlayer, PassIds.Vip);
});

for (const crateSection of shop.Crates.GetChildren()) {
	if (crateSection.IsA("Frame")) {
		for (const crate of crateSection.GetChildren()) {
			if (crate.IsA("TextButton")) {
				const crateId = tonumber(crate.Name);
				if (crateId === undefined) {
					continue;
				}
				const crateName = crate.FindFirstChild("CrateName");
				if (crateName && crateName.IsA("TextLabel")) {
					crateName.Text = CRATE_NAMES.get(crateId) ?? "";
				}
				crate.MouseButton1Click.Connect(() => {
					// Lootbox compliance: don't even show the crate page in
					// restricted countries (old Globals.openCrateMenu guard).
					if (lootboxRestricted()) {
						showRestrictedModal();
						return;
					}
					openCratePage(crateId);
				});
			}
		}
	}
}

// ---- cash purchase menu (old itemSelectedFunctions.openCashPurchaceMenu) ----

function closeCashMenu() {
	const closeTween = TweenService.Create(cashPurchace, new TweenInfo(0.2), {
		Size: new UDim2(0, 0, 0, 0),
	});
	closeTween.Play();
	cashPurchace.Visible = false;
	returnUiSelectedValues();
}

function openCashMenu() {
	cashPurchace.Size = new UDim2(0, 0, 0, 0);
	const openTween = TweenService.Create(cashPurchace, new TweenInfo(0.1), {
		Size: CASH_PURCHACE_MENU_OPEN_SIZE,
	});
	cashPurchace.Visible = true;
	openTween.Play();
}

// Wired ONCE (the old server version re-connected on every open, stacking
// duplicate connections per mount — same buttons, same behavior).
{
	const closeButton = cashPurchace.WaitForChild("closeButton") as GuiButton;
	closeButton.MouseButton1Click.Connect(closeCashMenu);

	for (const cashOption of cashPurchace.cash.GetChildren()) {
		if (cashOption.IsA("ImageLabel")) {
			const typed = cashOption as ImageLabel & { buy: GuiButton; ID: NumberValue };
			typed.buy.MouseButton1Click.Connect(() => {
				MarketplaceService.PromptProductPurchase(LocalPlayer, typed.ID.Value);
			});
		}
	}
}

garage.Money.Currency.Add.MouseButton1Click.Connect(openCashMenu);

// ---- lootbox-restricted modal (replaces the server-built popup) -------------

let restrictedModal: ScreenGui | undefined;

function buildRestrictedModal(): ScreenGui {
	const screenGui = new Instance("ScreenGui");
	screenGui.Name = "LootboxRestrictedPopup";
	screenGui.DisplayOrder = 100;
	screenGui.ResetOnSpawn = false;
	screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
	screenGui.Enabled = false;

	const frame = new Instance("Frame");
	frame.AnchorPoint = new Vector2(0.5, 0.5);
	frame.Position = new UDim2(0.5, 0, 0.5, 0);
	frame.Size = new UDim2(0.35, 0, 0.25, 0);
	frame.BackgroundColor3 = Color3.fromRGB(30, 30, 30);
	frame.Parent = screenGui;

	const corner = new Instance("UICorner");
	corner.CornerRadius = new UDim(0.05, 0);
	corner.Parent = frame;

	const stroke = new Instance("UIStroke");
	stroke.Color = Color3.fromRGB(255, 179, 0);
	stroke.Thickness = 3;
	stroke.Parent = frame;

	const title = new Instance("TextLabel");
	title.BackgroundTransparency = 1;
	title.Position = new UDim2(0.05, 0, 0.05, 0);
	title.Size = new UDim2(0.9, 0, 0.2, 0);
	title.FontFace = new Font("rbxasset://fonts/families/FredokaOne.json");
	title.Text = "NOT AVAILABLE";
	title.TextColor3 = Color3.fromRGB(255, 179, 0);
	title.TextScaled = true;
	title.Parent = frame;

	const message = new Instance("TextLabel");
	message.BackgroundTransparency = 1;
	message.Position = new UDim2(0.05, 0, 0.3, 0);
	message.Size = new UDim2(0.9, 0, 0.35, 0);
	message.FontFace = new Font("rbxasset://fonts/families/FredokaOne.json");
	message.Text = "Sorry, your country does not allow lootboxes.";
	message.TextColor3 = new Color3(1, 1, 1);
	message.TextScaled = true;
	message.TextWrapped = true;
	message.Parent = frame;

	const okButton = new Instance("TextButton");
	okButton.AnchorPoint = new Vector2(0.5, 1);
	okButton.Position = new UDim2(0.5, 0, 0.92, 0);
	okButton.Size = new UDim2(0.3, 0, 0.2, 0);
	okButton.BackgroundColor3 = Color3.fromRGB(255, 179, 0);
	okButton.FontFace = new Font("rbxasset://fonts/families/FredokaOne.json");
	okButton.Text = "OK";
	okButton.TextColor3 = Color3.fromRGB(30, 30, 30);
	okButton.TextScaled = true;
	okButton.Parent = frame;

	const okCorner = new Instance("UICorner");
	okCorner.CornerRadius = new UDim(0.2, 0);
	okCorner.Parent = okButton;

	okButton.MouseButton1Click.Connect(() => {
		screenGui.Enabled = false;
	});

	screenGui.Parent = playerGui;
	return screenGui;
}

function showRestrictedModal() {
	if (!restrictedModal) {
		restrictedModal = buildRestrictedModal();
	}
	restrictedModal.Enabled = true;
}

// ---- BackToMenu + TeamNameStrip (old ensureGarageMenuButtons) ---------------

function backButtonLabel(): string {
	return myTeam() ? "EXIT TEAM" : "BACK";
}

let backButtonRef: TextButton | undefined;
let teamNameLabelRef: TextLabel | undefined;

function refreshTeamControls() {
	if (backButtonRef) {
		backButtonRef.Text = backButtonLabel();
	}
	if (teamNameLabelRef) {
		const team = myTeam();
		const name = team?.GetAttribute("CB_TeamName");
		teamNameLabelRef.Text = typeIs(name, "string") ? name : (team?.Name ?? "NO TEAM");
		if (!team) {
			teamNameLabelRef.Text = "NO TEAM";
		}
	}
}

function buildGarageMenuButtons() {
	if (inventory.FindFirstChild("BackToMenu", true)) {
		return;
	}
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
	backButton.Text = backButtonLabel();
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
		// EXIT TEAM: leaving the team is what disconnects the player from the
		// shop-phase auto start — server-side in the Intent_ExitToLanding body.
		getUiIntentEvent("Intent_ExitToLanding").FireServer();
	});
	backButtonRef = backButton;
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
	teamName.Text = "NO TEAM";
	teamName.TextColor3 = new Color3(1, 1, 1);
	teamName.TextScaled = true;
	teamName.TextTruncate = Enum.TextTruncate.AtEnd;
	teamName.TextXAlignment = Enum.TextXAlignment.Center;
	teamName.ZIndex = teamStrip.ZIndex + 1;
	teamNameLabelRef = teamName;
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
		// Credits in hand: open the client-owned RenamePopup directly (the old
		// CB_RenamePrompt server ping is retired). No credit: the server
		// prompts the rename-product purchase (or grants a test credit when
		// the product id is unset) — the CB_RenameCredits watcher in
		// menu.client.ts opens the popup when the credit lands.
		const credits = LocalPlayer.GetAttribute("CB_RenameCredits");
		if (typeIs(credits, "number") && credits > 0) {
			openRenamePopup();
		} else {
			getUiIntentEvent("Intent_RequestRename").FireServer();
		}
	});
	changeName.Parent = teamStrip;
	teamStrip.Parent = inventory;

	refreshTeamControls();
}

function openRenamePopup() {
	const renamePopup = playerGui.FindFirstChild("RenamePopup") as RenamePopupShape | undefined;
	if (renamePopup) {
		const status = renamePopup.Panel.FindFirstChild("Status");
		if (status?.IsA("TextLabel")) {
			status.Text = "";
		}
		renamePopup.Enabled = true;
	}
}

// Live team-name/back-label updates: the strip re-renders on team membership
// or rename (CB_TeamName attribute) changes.
let teamAttrConnection: RBXScriptConnection | undefined;

function watchTeamForStrip() {
	teamAttrConnection?.Disconnect();
	teamAttrConnection = undefined;
	const team = myTeam();
	if (team) {
		teamAttrConnection = team.AttributeChanged.Connect(refreshTeamControls);
	}
	refreshTeamControls();
}

LocalPlayer.GetPropertyChangedSignal("Team").Connect(watchTeamForStrip);

// ---- gamepad garage navigation (old server X/Y/R1/L1/R2 handlers) -----------

const guiSelectionBackup = new Map<GuiObject, boolean>();

function makeAllUisNotSelectable(exception: Instance) {
	for (const ui of playerGui.GetDescendants()) {
		if (!ui.IsDescendantOf(exception) && ui.IsA("GuiObject")) {
			guiSelectionBackup.set(ui, ui.Selectable);
			ui.Selectable = false;
		}
	}
}

function returnUiSelectedValues() {
	for (const [ui, selectable] of guiSelectionBackup) {
		if (selectable && ui.Parent !== undefined) {
			ui.Selectable = selectable;
		}
	}
	guiSelectionBackup.clear();
}

function cycleTab(direction: number) {
	const bar = tabButtonsBar();
	const buttons: GuiButton[] = [];
	for (const child of bar.GetChildren()) {
		if (child.IsA("ImageButton")) {
			buttons.push(child);
		}
	}
	if (buttons.size() === 0) {
		return;
	}
	let index = 0;
	for (let i = 0; i < buttons.size(); i++) {
		if (buttons[i].Name === currentTab) {
			index = i;
		}
	}
	let nextIndex = index + direction;
	if (nextIndex >= buttons.size()) {
		nextIndex = 0;
	} else if (nextIndex < 0) {
		nextIndex = buttons.size() - 1;
	}
	const nextName = buttons[nextIndex].Name;
	if (nextName === "Body" || nextName === "Colors" || nextName === "CarHorn" || nextName === "BoostTrail") {
		openTab(nextName);
	}
}

UserInputService.InputBegan.Connect((input) => {
	if (input.UserInputType !== Enum.UserInputType.Gamepad1 || !garage.Enabled) {
		return;
	}
	if (input.KeyCode === Enum.KeyCode.ButtonR1 && inventory.Visible) {
		cycleTab(1);
	} else if (input.KeyCode === Enum.KeyCode.ButtonL1 && inventory.Visible) {
		cycleTab(-1);
	} else if (input.KeyCode === Enum.KeyCode.ButtonX) {
		if (cashPurchace.Visible) {
			returnUiSelectedValues();
			cashPurchace.Visible = false;
		} else if (inventory.Visible) {
			openShopPage();
		} else if (cratePage.Visible) {
			openShopPage();
		} else if (shop.Visible) {
			openInventoryPage();
		}
	} else if (input.KeyCode === Enum.KeyCode.ButtonY) {
		if (inventory.Visible) {
			// (The garage Spawn button is retired — Y only unlocks now.)
			if (inventory.BuyButton.Visible) {
				unlockButtonPressed();
			}
		} else if (cratePage.Visible) {
			pressOpenCrate();
		}
	} else if (input.KeyCode === Enum.KeyCode.ButtonR2) {
		makeAllUisNotSelectable(cashPurchace);
		openCashMenu();
	}
});

// ---- NextSelection wirings (old PlayerGuiManager.applyNextSelectionWirings) -

for (const [sourcePath, propName, targetPath] of NEXT_SELECTION_WIRINGS) {
	const source = resolvePath(playerGui, sourcePath);
	const target = resolvePath(playerGui, targetPath);
	if (source && target) {
		(source as unknown as Record<string, unknown>)[propName] = target;
	}
}

// ---- flow routing -----------------------------------------------------------

let wasInGarage = false;

function applyFlowState() {
	const inGarage = flowState() === "garage";
	if (inGarage && !wasInGarage) {
		// Fresh entry: reset transient chrome (a persistent client gui keeps
		// state across visits, unlike the old per-mount server tree).
		returnUiSelectedValues();
		cashPurchace.Visible = false;
		enableEquipState();
		refreshTeamControls();
		garage.Enabled = true;
		openInventoryPage(true);
	} else if (!inGarage) {
		garage.Enabled = false;
		if (wasInGarage) {
			returnUiSelectedValues();
			cashPurchace.Visible = false;
		}
	}
	wasInGarage = inGarage;
}

LocalPlayer.GetAttributeChangedSignal("CB_FlowState").Connect(applyFlowState);

// ---- boot -------------------------------------------------------------------

// The garage Spawn button stays retired (Top Table: play starts from the
// landing page / shop countdown) — old initialisePlayerUi hid it per mount.
pcall(() => {
	inventory.SpawnButton.Visible = false;
	inventory.SpawnButton.Button.Visible = false;
});

buildGarageMenuButtons();
watchTeamForStrip();
renderMoney();
renderTrophies();
refetchProfile();
applyFlowState();
