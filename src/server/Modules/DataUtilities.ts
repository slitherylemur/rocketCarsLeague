// Original: ServerStorage/Modules/DataUtilities (ModuleScript)

//Modules
import DataStore2 from "./DataStore2";
import DSDefaultValues from "./DataStoreDefaults";
import type { SerializedEnum, VehicleCustomization } from "./dataTypes";

//"BumperCarsPlayerData", "money", "wins", "kills", "deaths", "equippedVehicle", "accessories", "skins", "hornSounds", "boostTrails", "vehicles", "vehicleCustomization"

const TabNamesToItemType: Record<string, string> = {
	Body: "vehicles",
	BoostTrail: "boostTrails",
	CarHorn: "hornSounds",
	Skins: "skins",
	Colors: "colors",
};

//Module Functions

function addValuesFromTableToTable(table1: Record<string, unknown>, table2: Record<string, unknown>) {
	for (const [i, value] of pairs(table2)) {
		table1[i as string] = value;
	}
}

function SerializeEnum(enumItem: EnumItem): SerializedEnum {
	return [tostring(enumItem.EnumType), tostring(enumItem.Name)];
}

function DeserializeEnum(SerialisedEnum: SerializedEnum): EnumItem {
	return (Enum as unknown as Record<string, Record<string, EnumItem>>)[SerialisedEnum[0]][SerialisedEnum[1]];
}

const DSDefaults = DSDefaultValues as unknown as Record<string, unknown>;

const DataUtilities = {
	PlayerHasItem(player: Player, ItemType: string, Item: string): boolean {
		const itemStore = DataUtilities.GetPlayersItems(player, ItemType) as defined[];
		if (itemStore.indexOf(Item as unknown as defined) !== -1) {
			return true;
		} else {
			return false;
		}
	},

	GetKeyBinding(player: Player, action: string): EnumItem | undefined {
		const keyBindsDS = DataStore2("keyBinds", player);
		const bindsTable = keyBindsDS.Get(DSDefaults["keyBinds"]) as Record<string, SerializedEnum | undefined>;
		if (bindsTable[action] !== undefined) {
			return DeserializeEnum(bindsTable[action]!);
		} else {
			return undefined;
		}
	},

	SetKeyBinding(player: Player, action: string, key: EnumItem) {
		const keyBindsDS = DataStore2("keyBinds", player);
		const bindsTable = keyBindsDS.Get(DSDefaults["keyBinds"]) as Record<string, SerializedEnum | undefined>;
		bindsTable[action] = SerializeEnum(key);
		keyBindsDS.Set(bindsTable);
	},

	GetPlayersItems(player: Player, ItemType: string): unknown {
		const vehicleStore = DataStore2(ItemType, player);
		return vehicleStore.Get(DSDefaults[ItemType]);
	},

	PlayerCanAfford(player: Player, price: number): boolean {
		const playerMoneyDS = DataStore2("money", player);
		return (playerMoneyDS.Get(DSDefaults["money"]) as number) >= price;
	},

	GetTrophies(player: Player): number {
		return DataStore2("trophies", player).Get(DSDefaults["trophies"]) as number;
	},

	AddTrophies(player: Player, amount: number) {
		DataStore2("trophies", player).Increment(amount, DSDefaults["trophies"] as number);
		DataStore2.SaveAll(player);
	},

	PurchaceItem(player: Player, price: number, ItemType: string, Item: string, equippedDS?: string) {
		const playerItemsDS = DataStore2(ItemType, player);
		const playerItems = playerItemsDS.Get(DSDefaults[ItemType]) as defined[];
		if (playerItems.indexOf(Item as unknown as defined) === -1) {
			playerItems.push(Item as unknown as defined);

			if (equippedDS !== undefined) {
				const playerEquipedItemDS = DataStore2(equippedDS, player);
				playerEquipedItemDS.Set(Item);
			}

			playerItemsDS.Set(playerItems);

			const playerMoneyDS = DataStore2("money", player);
			playerMoneyDS.Increment(-math.round(price), DSDefaults["money"] as number);
			DataStore2.SaveAll(player);
		}
	},

	GetPlayersItemsFromTabName(player: Player, TabName: string): unknown {
		return DataUtilities.GetPlayersItems(player, TabNamesToItemType[TabName]);
	},

	getPlayerEquippedVehicle(player: Player): string {
		return DataUtilities.GetPlayersItems(player, "equippedVehicle") as string;
	},

	GivePlayerItem(player: Player, ItemType: string, Item: string) {
		const playerItemsDS = DataStore2(ItemType, player);
		const playerItems = playerItemsDS.Get(DSDefaults[ItemType]) as defined[];
		if (playerItems.indexOf(Item as unknown as defined) === -1) {
			playerItems.push(Item as unknown as defined);
			playerItemsDS.Set(playerItems);
			DataStore2.SaveAll(player);
		}
	},

	EquipItemIfOwned(player: Player, item: string, equippedStore: string, contentStore: string): unknown {
		const content = DataUtilities.GetPlayersItems(player, contentStore) as defined[];

		if (content.indexOf(item as unknown as defined) !== -1) {
			const eqquipedStore = DataStore2(equippedStore, player);
			return eqquipedStore.Set(item);
		}
		return undefined;
	},

	EquipItemOnVehicleIfOwned(player: Player, item: string, contentStore: string, itemType: string) {
		const content = DataUtilities.GetPlayersItems(player, contentStore) as defined[];

		if (content.indexOf(item as unknown as defined) !== -1) {
			const equipedVehicle = DataUtilities.getPlayerEquippedVehicle(player);
			const customisationStore = DataStore2("vehicleCustomization", player);

			const customisationTable = customisationStore.GetTable(DSDefaults["vehicleCustomization"]) as Record<
				string,
				VehicleCustomization | undefined
			>;

			if (customisationTable[equipedVehicle] === undefined) {
				customisationTable[equipedVehicle] = {};
				addValuesFromTableToTable(
					customisationTable[equipedVehicle] as unknown as Record<string, unknown>,
					DSDefaultValues.vehicleCustomization.ToyCorolla as unknown as Record<string, unknown>,
				);
			}

			(customisationTable[equipedVehicle] as unknown as Record<string, unknown>)[itemType] = item;

			customisationStore.Set(customisationTable);
			return;
		}
	},

	GetEquippedItemOnVehicle(player: Player, itemType: string, vehicle?: string): unknown {
		let equipedVehicle: string;
		if (vehicle !== undefined) {
			equipedVehicle = vehicle;
		} else {
			equipedVehicle = DataUtilities.getPlayerEquippedVehicle(player);
		}

		const customisationStore = DataStore2("vehicleCustomization", player);

		const customisationTable = customisationStore.GetTable(DSDefaults["vehicleCustomization"]) as Record<
			string,
			VehicleCustomization | undefined
		>;

		if (customisationTable[equipedVehicle] === undefined) {
			customisationTable[equipedVehicle] = {};
			addValuesFromTableToTable(
				customisationTable[equipedVehicle] as unknown as Record<string, unknown>,
				DSDefaultValues.vehicleCustomization.ToyCorolla as unknown as Record<string, unknown>,
			);
		}

		return (customisationTable[equipedVehicle] as unknown as Record<string, unknown>)[itemType];
	},
};

export = DataUtilities;
