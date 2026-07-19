// Original: ServerStorage/Modules/UiModules/setTab (ModuleScript)

//Variables

//Modules
import itemPopulateSpecifics from "./itemPopulateSpecifics";
import itemSelectedFunctions from "./itemSelectedFunctions";
import DataUtilities from "../DataUtilities";
import GeneralUtils from "../../GeneralUtils";
import spawnVehicle from "../spawnVehicle";
import { Globals } from "../../Globals";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";

const ReplicatedStorage = game.GetService("ReplicatedStorage");
const ServerStorage = game.GetService("ServerStorage");

// ---- Instance shape types (per-player UI rendered into PlayerGui, plus the
// non-script template instances that stay in the place file) ----

// PlayerGui.Garage.Inventory — also the "mainUI" handed to the
// itemSelectedFunctions callbacks.
interface Inventory extends Frame {
	Content: Frame & {
		CarList: Frame & { Scroll: ScrollingFrame };
		List: Frame & { Scroll: ScrollingFrame };
	};
}

// Per-tab frame under Inventory.Content.List.Scroll (indexed dynamically by
// tab name).
interface TabFrame extends Frame {
	List: ScrollingFrame;
}

// ServerStorage.CarCategory template — cloned ONCE as the single flat car
// grid (categories removed: cars sort by trophy cost via LayoutOrder).
type CategoryBlock = Frame & { UIGridLayout: UIGridLayout };

// The itemPopulateSpecifics / itemSelectedFunctions entries are dispatched
// dynamically by tab name (`module[Tab]` in the original) — the modules are
// indexed through Record casts with these signatures.
type PopulateSpecificsFn = (uiFrame: GuiButton, Value: string, player: Player) => void;
type ItemSelectedCallback = (
	player: Player,
	Value: string,
	locked: boolean,
	mainUI: Inventory,
	uiFrame: GuiButton,
) => void;

//Utility fucnctions

function SetOnlyVisibleFrameOfParent(visibleFrameName: string, Parent: Instance) {
	for (const ui of Parent.GetChildren()) {
		if (ui.IsA("Frame")) {
			if (ui.Name === visibleFrameName) {
				ui.Visible = true;
			} else {
				ui.Visible = false;
			}
		}
	}
}

function populateScrollFrame(
	player: Player,
	scrollFrame: ScrollingFrame,
	content: string[],
	template: GuiButton,
	populateSpecifics: PopulateSpecificsFn,
	callBackFunction: ItemSelectedCallback,
	lockedContent?: string[],
	tab?: string,
) {
	GeneralUtils.RemoveChildrenOfType(scrollFrame, "GuiObject");
	// Keys replicate the original uiFrames table's integer indices exactly
	// (i from pairs(content), then k+i for the locked buttons) — the
	// NextSelection wiring below does uiFrames[i+2]/uiFrames[i-2] neighbor
	// lookups on those same keys.
	const uiFrames = new Map<number, GuiButton>();
	let k = 0;
	for (const [i, Value] of pairs(content)) {
		uiFrames.set(i, template.Clone());
		uiFrames.get(i)!.Parent = scrollFrame;
		uiFrames.get(i)!.MouseButton1Click.Connect(() => {
			callBackFunction(
				player,
				Value,
				false,
				scrollFrame.Parent!.Parent!.Parent!.Parent!.Parent as Inventory,
				uiFrames.get(i)!,
			);
		});

		populateSpecifics(uiFrames.get(i)!, Value, player);
		k += 1;
	}
	if (lockedContent) {
		for (const [i, Value] of pairs(lockedContent)) {
			uiFrames.set(
				k + i,
				(
					(ReplicatedStorage as unknown as { Ui: { LockedButtons: Folder } }).Ui.LockedButtons.FindFirstChild(
						tab!,
					) as GuiButton
				).Clone(),
			);
			uiFrames.get(k + i)!.Parent = scrollFrame;
			uiFrames.get(k + i)!.MouseButton1Click.Connect(() => {
				callBackFunction(
					player,
					Value,
					true,
					scrollFrame.Parent!.Parent!.Parent!.Parent!.Parent as Inventory,
					uiFrames.get(k + i)!,
				);
			});

			populateSpecifics(uiFrames.get(k + i)!, Value, player);
		}
	}

	for (const [i, uiFrame] of pairs(uiFrames)) {
		if (uiFrames.get(i + 2)) {
			uiFrame.NextSelectionDown = uiFrames.get(i + 2)!;
		}
		if (uiFrames.get(i - 2)) {
			uiFrame.NextSelectionUp = uiFrames.get(i - 2)!;
		}
	}
}

function populateScrollFrameCar(
	player: Player,
	inventory: Inventory,
	content: string[],
	template: GuiButton,
	populateSpecifics: PopulateSpecificsFn,
	callBackFunction: ItemSelectedCallback,
	lockedContent: string[] | undefined,
	tab: string,
	carBlock: CategoryBlock,
) {
	// Owned and locked cars interleave in the ONE grid: the UIGridLayout sorts
	// by LayoutOrder, which itemPopulateSpecifics sets to the trophy cost.
	for (const car of content) {
		const uiFrame = template.Clone();
		uiFrame.Parent = carBlock;
		uiFrame.MouseButton1Click.Connect(() => {
			callBackFunction(player, car, false, inventory, uiFrame);
		});

		populateSpecifics(uiFrame, car, player);
	}

	if (lockedContent) {
		for (const car of lockedContent) {
			const uiFrame = (
				(ReplicatedStorage as unknown as { Ui: { LockedButtons: Folder } }).Ui.LockedButtons.FindFirstChild(
					tab,
				) as GuiButton
			).Clone();
			uiFrame.Parent = carBlock;
			uiFrame.MouseButton1Click.Connect(() => {
				callBackFunction(player, car, true, inventory, uiFrame);
			});

			populateSpecifics(uiFrame, car, player);
		}
	}

	const absoluteFrameSize = carBlock.AbsoluteSize;
	const absoluteContentSize = carBlock.UIGridLayout.AbsoluteContentSize;
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

//Module fucnctions

function getTabLockedContent(Tab: string, Unlocked: string[]): string[] | undefined {
	if (Tab === "Body") {
		const Content: string[] = [];
		for (const car of (ServerStorage as unknown as { VehicleModels: Folder }).VehicleModels.GetChildren()) {
			if (Unlocked.indexOf(car.Name) === -1) {
				Content.push(car.Name);
			}
		}

		return Content;
	}

	if (Tab === "Colors") {
		const Content: string[] = [];
		for (const color of (ServerStorage as unknown as { Colors: Folder }).Colors.GetChildren()) {
			if (Unlocked.indexOf(color.Name) === -1) {
				Content.push(color.Name);
			}
		}

		return Content;
	}

	if (Tab === "BoostTrail") {
		const Content: string[] = [];
		for (const color of (ServerStorage as unknown as { BoostTrails: Folder }).BoostTrails.GetChildren()) {
			if (Unlocked.indexOf(color.Name) === -1) {
				Content.push(color.Name);
			}
		}

		return Content;
	}

	if (Tab === "CarHorn") {
		const Content: string[] = [];
		for (const color of (ServerStorage as unknown as { CarHorns: Folder }).CarHorns.GetChildren()) {
			if (Unlocked.indexOf(color.Name) === -1) {
				Content.push(color.Name);
			}
		}

		return Content;
	}

	return undefined;
}

function TurnOnCarsMenu(player: Player, Tab: string, inventory: Inventory) {
	const playerItems = DataUtilities.GetPlayersItemsFromTabName(player, Tab) as string[];

	const carList = inventory.WaitForChild("Content", 10)!.WaitForChild("CarList") as Frame & {
		Scroll: ScrollingFrame;
	};
	carList.Visible = true;
	inventory.Content.List.Visible = false;

	GeneralUtils.RemoveChildrenOfType(carList.Scroll, "GuiObject");

	// Categories removed: ONE grid block holds every car, ordered by trophy
	// cost (LayoutOrder). No CarTitle headers.
	const carBlock = (ServerStorage as unknown as { CarCategory: CategoryBlock }).CarCategory.Clone();
	carBlock.Parent = carList.Scroll;
	carBlock.LayoutOrder = 1;

	populateScrollFrameCar(
		player,
		inventory, //ScrollFrame
		playerItems, //List
		(ReplicatedStorage as unknown as { Ui: { DisplayButtons: Record<string, GuiButton> } }).Ui.DisplayButtons[
			Tab
		], //UiTemplate
		(itemPopulateSpecifics as unknown as Record<string, PopulateSpecificsFn>)[Tab], //button population specifics
		(itemSelectedFunctions as unknown as Record<string, ItemSelectedCallback>)[Tab], //button pressed callback function
		getTabLockedContent(Tab, playerItems),
		Tab,
		carBlock,
	);
}

const setTab = {
	Inventory: (player: Player, Tab: string) => {
		const playerGarage = Globals.findPlayerGarage(player);
		FunctionsAndEvents.SetMenuCameraCFrame.FireClient(
			player,
			(playerGarage!.Cameras.FindFirstChild(Tab) as BasePart).CFrame,
		);

		const inventory = (player as unknown as { PlayerGui: { Garage: { Inventory: Inventory } } }).PlayerGui.Garage
			.Inventory;

		const equipedVehicle = DataUtilities.getPlayerEquippedVehicle(player);
		spawnVehicle.SpawnVehicle(player, false, equipedVehicle, playerGarage!.spawnPlate.CFrame, true);

		if (Tab === "Body") {
			TurnOnCarsMenu(player, Tab, inventory);
		} else {
			if (Tab === "BoostTrail") {
				const equipedBoost = DataUtilities.GetEquippedItemOnVehicle(player, "boostTrail") as string;
				itemSelectedFunctions.createMenuBoostTrail(
					(ServerStorage as unknown as { BoostTrails: Folder }).BoostTrails.FindFirstChild(equipedBoost)!,
					Globals.vehiclesTable[player.UserId]!.model,
				);
			}

			inventory.Content.CarList.Visible = false;
			inventory.Content.List.Visible = true;

			SetOnlyVisibleFrameOfParent(Tab, inventory.Content.List.Scroll);
			const playerItems = DataUtilities.GetPlayersItemsFromTabName(player, Tab) as string[];

			populateScrollFrame(
				player,
				(inventory.Content.List.Scroll as unknown as Record<string, TabFrame>)[Tab].List, //ScrollFrame
				playerItems, //List
				(ReplicatedStorage as unknown as { Ui: { DisplayButtons: Record<string, GuiButton> } }).Ui
					.DisplayButtons[Tab], //UiTemplate
				(itemPopulateSpecifics as unknown as Record<string, PopulateSpecificsFn>)[Tab], //button population specifics
				(itemSelectedFunctions as unknown as Record<string, ItemSelectedCallback>)[Tab], //button pressed callback function
				getTabLockedContent(Tab, playerItems),
				Tab,
			);
		}
	},

	Shop: (player: Player, Tab: string) => {
		const inventory = (player as unknown as { PlayerGui: { Garage: { Inventory: Inventory } } }).PlayerGui.Garage
			.Inventory;

		const equipedVehicle = DataUtilities.getPlayerEquippedVehicle(player);
		spawnVehicle.SpawnVehicle(
			player,
			false,
			equipedVehicle,
			(game.Workspace as unknown as { garageModel: { spawnPlate: BasePart } }).garageModel.spawnPlate.CFrame,
		);

		SetOnlyVisibleFrameOfParent(Tab, inventory.Content.List.Scroll);
		const playerItems = DataUtilities.GetPlayersItemsFromTabName(player, Tab) as string[];

		populateScrollFrame(
			player,
			(inventory.Content.List.Scroll as unknown as Record<string, TabFrame>)[Tab].List, //ScrollFrame
			playerItems, //List
			(ReplicatedStorage as unknown as { Ui: { DisplayButtons: Record<string, GuiButton> } }).Ui.DisplayButtons[
				Tab
			], //UiTemplate
			(itemPopulateSpecifics as unknown as Record<string, PopulateSpecificsFn>)[Tab], //button population specifics
			(itemSelectedFunctions as unknown as Record<string, ItemSelectedCallback>)[Tab], //button pressed callback function
		);
	},
};

export = setTab;
