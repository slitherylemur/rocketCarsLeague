// Original: ServerScriptService/purchaseHandler (Script)

import DataStore2 from "./Modules/DataStore2";
import crateModule from "./Modules/CrateModule";
import { Globals } from "./Globals";
import TeamRegistry, { RENAME_PRODUCT_ID } from "./Modules/TeamRegistry";

const MarketplaceService = game.GetService("MarketplaceService");
const DataStoreService = game.GetService("DataStoreService");
const TweenService = game.GetService("TweenService");
const Players = game.GetService("Players");

// Data store for tracking purchases that were successfully processed
const purchaseHistoryStore = DataStoreService.GetDataStore("PurchaseHistory");

// Table setup containing product IDs and functions for handling purchases
const productFunctions = new Map<number, (receipt: ReceiptInfo, player: Player) => boolean>();

// Team rename (Top Table D3): grants a rename credit; the popup keeps it
// spendable until a clean (unmoderated) name lands.
if (RENAME_PRODUCT_ID !== 0) {
	productFunctions.set(RENAME_PRODUCT_ID, (receipt, player) => {
		TeamRegistry.grantRenameCredit(player);
		return true;
	});
}

//2k gold
productFunctions.set(1625756130, (receipt, player) => {
	const playerMoneyDS = DataStore2("money", player);
	playerMoneyDS.Increment(2000, 0);
	playerMoneyDS.Save();
	return true;
});

// 6250 gold
productFunctions.set(1625754871, (receipt, player) => {
	const playerMoneyDS = DataStore2("money", player);
	playerMoneyDS.Increment(6250, 0);
	playerMoneyDS.Save();

	return true;
});

//16k gold
productFunctions.set(1625754874, (receipt, player) => {
	const playerMoneyDS = DataStore2("money", player);
	playerMoneyDS.Increment(16000, 0);
	playerMoneyDS.Save();

	return true;
});

//55k gold
productFunctions.set(1625754875, (receipt, player) => {
	const playerMoneyDS = DataStore2("money", player);
	playerMoneyDS.Increment(55000, 0);
	playerMoneyDS.Save();

	return true;
});

//280k gold
productFunctions.set(1625754876, (receipt, player) => {
	const playerMoneyDS = DataStore2("money", player);
	playerMoneyDS.Increment(280000, 0);
	playerMoneyDS.Save();

	return true;
});

// Timed cash-multiplier products removed (progression rework): deactivate
// product ids 1625754877 / 1625756131 / 1625756132 / 1625756133 in the
// Creator Dashboard — with no handler here they would sit NotProcessedYet.

//Respawn
productFunctions.set(1625756134, (receipt, player) => {
	Globals.SpawnInPlayer(player);
	(player.WaitForChild("survivalTime") as NumberValue).Value = -1;
	return true;
});

//Nuke
productFunctions.set(1625756136, (receipt, player) => {
	const nuke = (
		game.GetService("ServerStorage") as unknown as { Nuke: BasePart & { Mesh: SpecialMesh } }
	).Nuke.Clone();
	nuke.Parent = game.Workspace;
	const tweenInfo = new TweenInfo(10, Enum.EasingStyle.Linear);

	const tween = TweenService.Create(nuke.Mesh, tweenInfo, { Scale: new Vector3(2000, 2000, 2000) });
	tween.Play();

	Globals.SpawnInPlayer(player);

	task.wait(3);
	for (const p of Players.GetPlayers()) {
		Globals.vehiclesTable[p.UserId]!.KillVehicle(player, 69420);
	}

	nuke.Destroy();

	return true;
});

productFunctions.set(1625756135, (receipt, player) => {
	task.spawn(() => {
		crateModule.actuallyOpen(player, -1);
	});

	return true;
});

//Low Gravity
productFunctions.set(1625756139, (receipt, player) => {
	game.Workspace.Gravity = 80;

	task.delay(120, () => {
		game.Workspace.Gravity = 196.2;
	});

	return true;
});

// The core 'ProcessReceipt' callback function
function processReceipt(receiptInfo: ReceiptInfo): Enum.ProductPurchaseDecision {
	// Determine if the product was already granted by checking the data store
	const playerProductKey = receiptInfo.PlayerId + "_" + receiptInfo.PurchaseId;
	let purchased: unknown = false;
	const [success, errorMessage] = pcall(() => {
		purchased = purchaseHistoryStore.GetAsync(playerProductKey)[0];
	});
	// If purchase was recorded, the product was already granted
	if (success && purchased) {
		return Enum.ProductPurchaseDecision.PurchaseGranted;
	} else if (!success) {
		error("Data store error:" + errorMessage);
	}

	// Find the player who made the purchase in the server
	const player = Players.GetPlayerByUserId(receiptInfo.PlayerId);
	if (!player) {
		// The player probably left the game
		// If they come back, the callback will be called again
		return Enum.ProductPurchaseDecision.NotProcessedYet;
	}

	// Look up handler function from 'productFunctions' table above
	const handler = productFunctions.get(receiptInfo.ProductId);

	// Call the handler function and catch any errors
	const [success2, result] = pcall(handler!, receiptInfo, player);
	if (!success2 || !result) {
		warn("Error occurred while processing a product purchase");
		print("\nProductId:", receiptInfo.ProductId);
		print("\nPlayer:", player);
		return Enum.ProductPurchaseDecision.NotProcessedYet;
	}

	// Record transaction in data store so it isn't granted again
	const [success3, errorMessage3] = pcall(() => {
		purchaseHistoryStore.SetAsync(playerProductKey, true);
	});
	if (!success3) {
		error("Cannot save purchase data: " + errorMessage3);
	}

	// IMPORTANT: Tell Roblox that the game successfully handled the purchase
	return Enum.ProductPurchaseDecision.PurchaseGranted;
}

// Set the callback; this can only be done once by one script on the server!
MarketplaceService.ProcessReceipt = processReceipt;
