// Personalized developer-product prices must be queried on the client for
// Roblox Managed Pricing / price-optimization tests. The server remains the
// authority for receipt grants; this script only binds regional prices to UI.

import { PassIds, ProductIds } from "shared/Monetization";

const MarketplaceService = game.GetService("MarketplaceService");
const Players = game.GetService("Players");
const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui");

const priceCache = new Map<number, number>();
const loading = new Set<number>();
const watchedOpenLabels = new Set<TextLabel>();

function priceText(price: number): string {
	return `R$ ${price}`;
}

function waitForPath(root: Instance, path: string): Instance | undefined {
	let current: Instance | undefined = root;
	for (const [part] of string.gmatch(path, "[^/]+")) {
		current = current?.FindFirstChild(part as string);
		if (!current) return undefined;
	}
	return current;
}

function setPriceLabelWithin(root: Instance | undefined, price: number) {
	if (!root) return;
	for (const descendant of root.GetDescendants()) {
		if (descendant.IsA("TextLabel") && string.find(descendant.Text.lower(), "r%$")[0] !== undefined) {
			descendant.Text = priceText(price);
		}
	}
}

function applyPrice(productId: number, price: number) {
	const garage = playerGui.FindFirstChild("Garage");
	if (garage) {
		// Currency cards carry their developer-product ID as an IntValue.
		for (const descendant of garage.GetDescendants()) {
			if (descendant.IsA("IntValue") && descendant.Name === "ID" && descendant.Value === productId) {
				setPriceLabelWithin(descendant.Parent, price);
			}
		}

		if (productId === ProductIds.OverdriveCrate) {
			const tilePrice = waitForPath(garage, "Shop/Crates/Robux/-1/Price");
			if (tilePrice?.IsA("TextLabel")) tilePrice.Text = priceText(price);

			const openPrice = waitForPath(garage, "CrateMenu/OpenButton/TextLabel");
			if (openPrice?.IsA("TextLabel")) {
				if (!watchedOpenLabels.has(openPrice)) {
					watchedOpenLabels.add(openPrice);
					openPrice.GetPropertyChangedSignal("Text").Connect(() => {
						if (string.find(openPrice.Text, "…", 1, true)[0] !== undefined) {
							const currentPrice = priceCache.get(ProductIds.OverdriveCrate);
							if (currentPrice !== undefined) openPrice.Text = `OPEN - ${priceText(currentPrice)}`;
						}
					});
				}
				if (string.find(openPrice.Text, "R%$")[0] !== undefined) {
					openPrice.Text = `OPEN - ${priceText(price)}`;
				}
			}
		}

		if (productId === PassIds.Vip) {
			setPriceLabelWithin(waitForPath(garage, "Shop/Purchases/VIP"), price);
		}
	}

	if (productId === ProductIds.RenameTeam) {
		const createTeam = playerGui.FindFirstChild("CreateTeam");
		if (createTeam) {
			for (const descendant of createTeam.GetDescendants()) {
				if (descendant.IsA("TextButton") && descendant.Name === "Rename") {
					descendant.Text = `✎ RENAME (${priceText(price)})`;
				}
			}
		}
	}
}

function loadPrice(productId: number, infoType: Enum.InfoType = Enum.InfoType.Product) {
	const cached = priceCache.get(productId);
	if (cached !== undefined) {
		applyPrice(productId, cached);
		return;
	}
	if (loading.has(productId)) return;
	loading.add(productId);

	task.spawn(() => {
		const [ok, result] = pcall(() => MarketplaceService.GetProductInfoAsync(productId, infoType));
		loading.delete(productId);
		if (!ok) {
			warn(`[Monetization] could not load regional price for product ${productId}: ${result}`);
			return;
		}

		const info = result as { PriceInRobux?: number };
		if (typeIs(info.PriceInRobux, "number")) {
			priceCache.set(productId, info.PriceInRobux);
			applyPrice(productId, info.PriceInRobux);
		}
	});
}

function refreshPrices() {
	for (const [, productId] of pairs(ProductIds)) {
		loadPrice(productId);
	}
	loadPrice(PassIds.Vip, Enum.InfoType.GamePass);
}

refreshPrices();
playerGui.ChildAdded.Connect(() => task.defer(refreshPrices));
