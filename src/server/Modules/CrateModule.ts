// Original: ServerStorage/Modules/CrateModule (ModuleScript)
//
// Phase 5 (client-side UI migration): the Garage/CrateMenu ScreenGuis are
// CLIENT-owned. actuallyOpen no longer touches PlayerGui or blocks on
// ShowCrateAnimationEvent.InvokeClient (~13 s of server thread per crate) —
// it completes the grant, fires Ui_CrateResult (same chosenItem/paddingItems
// payload the InvokeClient carried), and bumps CB_ProfileVersion; the client
// (crateAnimation.client.ts) hides the Garage locally for the animation.

import LootManager from "./LootManager";
import DataUtilities from "./DataUtilities";
import garageIntents from "../ui/garageIntents";
import profileSnapshot from "../ui/profileSnapshot";
import DataStore2 from "./DataStore2";
import DSDefaultValues from "./DataStoreDefaults";
import Content from "shared/CrateCatalog";
import { getUiIntentEvent } from "shared/UiIntents";
import type { CrateItem } from "./dataTypes";
import type { LootSlot } from "./dataTypes";
import { ProductIds } from "shared/Monetization";
import paidRandomItemsPolicy from "./paidRandomItemsPolicy";

const MarketplaceService = game.GetService("MarketplaceService");
const ServerStorage = game.GetService("ServerStorage");
const ReplicatedStorage = game.GetService("ReplicatedStorage");

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
		// Crates are paid random items (bought with Robux or Robux-purchasable
		// gold) — blocked in countries where lootboxes are illegal. The client
		// blocks its own crate UI from CB_LootboxRestricted; this is the
		// authoritative re-check.
		if (paidRandomItemsPolicy.isRestricted(player)) {
			return;
		}

		if (crateName > 0) {
			if (!DataUtilities.PlayerCanAfford(player, cratePrices[crateName - 1])) {
				// The client pre-checks affordability against CB_Money and opens
				// its cash-purchase menu itself — nothing to do server-side.
				return;
			}
		} else {
			MarketplaceService.PromptProductPurchase(player, ProductIds.OverdriveCrate);
			return;
		}

		crateModule.actuallyOpen(player, crateName);
	},

	actuallyOpen: (player: Player, crateName: number) => {
		//  print("opening crate")
		const crateContent = Content.get(crateName)!;
		let price = crateContent.price;
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

		// Grant complete — hand the reveal to the client. Payload shape matches
		// the old ShowCrateAnimationEvent.InvokeClient(chosenItem, paddingItems);
		// the client hides/restores the Garage around the animation itself, so
		// the server thread no longer blocks for the ~13 s reveal.
		getUiIntentEvent("Ui_CrateResult").FireClient(player, chosenItem, paddingItems);
		profileSnapshot.bumpProfileVersion(player);

		// Preview the won item on the garage display car (world-side halves of
		// the old itemSelectedFunctions calls; the horn SOUND plays client-side
		// after the animation). previewOnly: parity with the old locked=true
		// calls — winning an already-owned item never re-equips it.
		if (Type === "colors") {
			garageIntents.equipColor(player, chosenItem.name, true);
		} else if (Type === "hornSounds") {
			garageIntents.equipHorn(player, chosenItem.name, true);
		} else if (Type === "boostTrails") {
			garageIntents.equipTrail(player, chosenItem.name, true);
		}
	},
};

export = crateModule;
