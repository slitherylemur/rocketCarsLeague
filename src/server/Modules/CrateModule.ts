// Original: ServerStorage/Modules/CrateModule (ModuleScript)

import LootManager from "./LootManager";
import DataUtilities from "./DataUtilities";
import selectedFunctions from "./UiModules/itemSelectedFunctions";
import DataStore2 from "./DataStore2";
import DSDefaultValues from "./DataStoreDefaults";
import Content from "./Content";
import { Globals } from "../Globals";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import type { CrateItem } from "./dataTypes";
import type { LootSlot } from "./dataTypes";
import type { VehicleModel } from "../Classes/VehicleClass";

const MarketplaceService = game.GetService("MarketplaceService");
const ServerStorage = game.GetService("ServerStorage");
const ReplicatedStorage = game.GetService("ReplicatedStorage");

const ShowCrateAnimationEvent = FunctionsAndEvents.ShowCrateAnimationEvent;

// Module-load side effect preserved: copy the color/boost-trail templates into
// ReplicatedStorage so clients can read them.
for (const model of (ServerStorage as unknown as { Colors: Folder }).Colors.GetChildren()) {
	const newModel = model.Clone();
	newModel.Parent = (ReplicatedStorage as unknown as { Colors: Folder }).Colors;
}

for (const model of (ServerStorage as unknown as { BoostTrails: Folder }).BoostTrails.GetChildren()) {
	const newModel = model.Clone();
	newModel.Parent = (ReplicatedStorage as unknown as { BoostTrails: Folder }).BoostTrails;
}

const rarityJar: Record<string, LootSlot> = {
	common: { Index: 0, Chance: 0.55 },
	uncommon: { Index: 1, Chance: 0.28 }, // 80
	rare: { Index: 2, Chance: 0.12 }, // 90
	epic: { Index: 3, Chance: 0.04 }, //
	legendary: { Index: 4, Chance: 0.01 },
};

const cratePrices = [3500, 6250, 10000];

function getItemsOfRarity(rarity: number, lootTable: CrateItem[]): LuaTuple<[CrateItem[], number]> {
	const items: CrateItem[] = [];
	let itemsCount = 0;
	for (const item of lootTable) {
		if (item.rarity === rarity) {
			itemsCount += 1;
			items.push(item);
		}
	}
	return $tuple(items, itemsCount);
}

function pickRandomPieceOfRarity(rarity: number, lootTable: CrateItem[]): CrateItem {
	// print(rarity)
	// print(lootTable)
	const [items, itemsCount] = getItemsOfRarity(rarity, lootTable);
	// print("itemsCount: " .. itemsCount)

	const index = math.random(1, itemsCount);
	// print("index: " .. index)
	return items[index - 1];
}

function GetTableOfXRandomItemsFromLootTable(lootTable: CrateItem[], x: number): CrateItem[] {
	const items: CrateItem[] = [];
	for (let i = 1; i <= x; i++) {
		const rarity = (LootManager.GetRandomSlot(rarityJar)! as unknown as { Index: number }).Index;
		const item = pickRandomPieceOfRarity(rarity, lootTable);
		items.push(item);
	}
	return items;
}

const typeToDataStoreName: Record<string, string> = {
	Colors: "colors",
	CarHorns: "hornSounds",
	BoostTrails: "boostTrails",
};

const crateModule = {
	openCrate: (player: Player, crateName: number) => {
		if (crateName > 0) {
			if (!DataUtilities.PlayerCanAfford(player, cratePrices[crateName - 1])) {
				selectedFunctions.openCashPurchaceMenu(player);
				return;
			}
		} else {
			MarketplaceService.PromptProductPurchase(player, 1625756135);
			return;
		}

		crateModule.actuallyOpen(player, crateName);
	},

	actuallyOpen: (player: Player, crateName: number) => {
		//  print("opening crate")
		// Original: require(game.ServerStorage.Modules.Content)[crateName]
		const crateContent = Content.get(crateName)!;
		let price = crateContent.price;
		const robuxPurchaceId = crateContent.robuxPurchaceId;
		const content = crateContent.content;
		const rarity = (LootManager.GetRandomSlot(rarityJar)! as unknown as { Index: number }).Index;
		const chosenItem = pickRandomPieceOfRarity(rarity, content);
		const Type = typeToDataStoreName[chosenItem.type];
		const paddingItems = GetTableOfXRandomItemsFromLootTable(content, 60);
		//gives player the item
		if (crateName < 0) {
			price = 0;
		}
		if (DataUtilities.PlayerHasItem(player, Type, chosenItem.name)) {
			const playerMoneyDS = DataStore2("money", player);
			playerMoneyDS.Increment(-math.round(price * 0.7), DSDefaultValues.money);
		} else {
			DataUtilities.PurchaceItem(player, price, Type, chosenItem.name);
		}

		//decrease their money
		//fire an event to the client to open the crate
		//  print("firing event")
		const garage = (player as unknown as { PlayerGui: { Garage: ScreenGui } }).PlayerGui.Garage;
		garage.Enabled = false;
		ShowCrateAnimationEvent.InvokeClient(player, chosenItem, paddingItems);
		garage.Enabled = true;

		if (Type === "colors") {
			selectedFunctions.Colors(player, chosenItem.name, true, undefined!);
		} else if (Type === "hornSounds") {
			selectedFunctions.CarHorn(
				player,
				chosenItem.name,
				true,
				(player as unknown as { PlayerGui: { Garage: never } }).PlayerGui.Garage,
				undefined!,
			);
		} else if (Type === "boostTrails") {
			selectedFunctions.BoostTrail(player, chosenItem.name, true, undefined!, undefined!);
		}

		Globals.openCrateMenu(player, crateName);
	},
};

export = crateModule;
