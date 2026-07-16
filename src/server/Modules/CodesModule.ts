// Original: ServerStorage/Modules/CodesModule (ModuleScript)

import DataUtilities from "./DataUtilities";
import DataStore2 from "./DataStore2";
import DSDefaultValues from "./DataStoreDefaults";

const codes: Record<string, ((player: Player) => boolean) | undefined> = {};

const BETA_TESTER = 50000;

// codes["SPEED"] = function(player)
//     local itemType
//     local item
//     DataUtilities.GivePlayerItem(player, ItemType, Item)
// end

// codes["beggingsimulator"] = function(player)
//     if DataUtilities.PlayerHasItem(player, "codes", "BeggingSimulator") then
//         return false
//     end

//     local playerMoneyDS = DataStore2("money", player)
//     playerMoneyDS:Increment(BETA_TESTER , 0)

//     DataUtilities.GivePlayerItem(player, "vehicles", "APC")
//     DataUtilities.EquipItemIfOwned(player, "APC", "equippedVehicle", "vehicles")

//     DataUtilities.GivePlayerItem(player, "codes", "BeggingSimulator")

//     return true
// end

//Skins

codes["flamingo"] = (player) => {
	if (DataUtilities.PlayerHasItem(player, "codes", "FLAMINGO")) {
		return false;
	}

	DataUtilities.GivePlayerItem(player, "colors", "Flamingo");
	DataUtilities.EquipItemOnVehicleIfOwned(player, "Flamingo", "colors", "color");

	DataUtilities.GivePlayerItem(player, "codes", "FLAMINGO");

	return true;
};

//Vehicles

codes["heist"] = (player) => {
	if (DataUtilities.PlayerHasItem(player, "codes", "HEIST")) {
		return false;
	}

	DataUtilities.GivePlayerItem(player, "vehicles", "ArmouredTruck");
	DataUtilities.EquipItemIfOwned(player, "ArmouredTruck", "equippedVehicle", "vehicles");

	DataUtilities.GivePlayerItem(player, "codes", "HEIST");

	return true;
};

codes["discord101"] = (player) => {
	if (DataUtilities.PlayerHasItem(player, "codes", "DISCORD101")) {
		return false;
	}

	DataUtilities.GivePlayerItem(player, "vehicles", "Police");
	DataUtilities.EquipItemIfOwned(player, "Police", "equippedVehicle", "vehicles");

	DataUtilities.GivePlayerItem(player, "codes", "DISCORD101");

	return true;
};

//Like goals

//30 likes
codes["ilovebumpercars"] = (player) => {
	if (DataUtilities.PlayerHasItem(player, "codes", "ilovebumpercars")) {
		return false;
	}

	DataUtilities.GivePlayerItem(player, "vehicles", "Wambulance");
	DataUtilities.EquipItemIfOwned(player, "Wambulance", "equippedVehicle", "vehicles");

	DataUtilities.GivePlayerItem(player, "codes", "ilovebumpercars");

	return true;
};

//100 likes
codes["goal100"] = (player) => {
	if (DataUtilities.PlayerHasItem(player, "codes", "goal100")) {
		return false;
	}

	DataUtilities.GivePlayerItem(player, "vehicles", "MarketTruck");
	DataUtilities.EquipItemIfOwned(player, "MarketTruck", "equippedVehicle", "vehicles");

	DataUtilities.GivePlayerItem(player, "codes", "goal100");

	return true;
};

//500 likes
codes["trail500"] = (player) => {
	if (DataUtilities.PlayerHasItem(player, "codes", "trail500")) {
		return false;
	}

	DataUtilities.GivePlayerItem(player, "boostTrails", "PoopTrail");
	DataUtilities.EquipItemOnVehicleIfOwned(player, "PoopTrail", "boostTrails", "boostTrail");

	DataUtilities.GivePlayerItem(player, "codes", "trail500");

	return true;
};

//1k likes
codes["welcome1k"] = (player) => {
	if (DataUtilities.PlayerHasItem(player, "codes", "welcome1k")) {
		return false;
	}

	DataUtilities.GivePlayerItem(player, "vehicles", "BmvV8");
	DataUtilities.EquipItemIfOwned(player, "BmvV8", "equippedVehicle", "vehicles");

	DataUtilities.GivePlayerItem(player, "codes", "welcome1k");

	return true;
};

//itemTypes = {["Colors"] = "colors", ["CarHorns"] = "hornSounds",["BoostTrails"] = "boostTrails",["VehicleModels"] = "vehicles"}

// codes["soccergame69420"] = function(player)
//     if DataUtilities.PlayerHasItem(player, "codes", "soccergame69420") then
//         return false
//     end

//     for i, v in pairs(itemTypes) do
//         for k, j in pairs(game.ServerStorage[i]:GetChildren()) do
//             DataUtilities.GivePlayerItem(player, v, j.Name)
//         end
//     end

//     local playerMoneyDS = DataStore2("money", player)
//     playerMoneyDS:Increment(999999999 , 0)

//     DataUtilities.GivePlayerItem(player, "codes", "soccergame69420")

//     return true
// end

export = codes;
