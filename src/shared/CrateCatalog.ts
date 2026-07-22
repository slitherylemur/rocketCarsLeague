// Original: ServerStorage/Modules/Content (ModuleScript) — moved to shared in
// migration Phase 5: the crate catalog is pure display/pricing data and the
// CLIENT-owned garage renders the shop + crate pages from it. The server
// remains the authority for grants (CrateModule re-validates price/policy).
//Types: CarHorns, Colors, BoostTrails

// Item shapes (previously src/server/Modules/dataTypes.ts, which now
// re-exports these for the server-side modules that import them from there).
export interface CrateItem {
	name: string;
	type: string;
	rarity: number;
}

export interface CrateContent {
	price: number;
	robuxPurchaceId?: number;
	content: CrateItem[];
}

/** Crate display names (previously Globals.CrateNames, assigned in
 * initializePlayer). Keyed by crate id; -1 = OverDRIVE / Robux crate. */
export const CRATE_NAMES = new Map<number, string>([
	[1, "Lightning Crate"],
	[2, "Interceptor Crate"],
	[3, "Apex Crate"],
	[-1, "OverDRIVE Crate"],
]);

// Keyed by crate id (-1 = OverDRIVE / Robux crate). Mixed negative/positive
// integer keys — a Map preserves the original `Content[crateName]` access.
const Content = new Map<number, CrateContent>([
	[
		-1,
		{
			price: 60,
			robuxPurchaceId: undefined,
			content: [
				{ name: "loud", type: "CarHorns", rarity: 0 },
				{ name: "Bark", type: "CarHorns", rarity: 0 },
				{ name: "Cat", type: "CarHorns", rarity: 0 },
				{ name: "Longgggg", type: "CarHorns", rarity: 0 },

				{ name: "Clown", type: "CarHorns", rarity: 1 },
				{ name: "Rainbow", type: "BoostTrails", rarity: 1 },
				{ name: "GetOutTheWay", type: "CarHorns", rarity: 1 },
				{ name: "Jazzzzz", type: "CarHorns", rarity: 1 },

				{ name: "Meow", type: "CarHorns", rarity: 2 },
				{ name: "Boat", type: "CarHorns", rarity: 2 },
				{ name: "PoopTrail", type: "BoostTrails", rarity: 2 },
				{ name: "Ambulance", type: "CarHorns", rarity: 2 },
				{ name: "IceCream", type: "CarHorns", rarity: 2 },

				{ name: "Sus", type: "Colors", rarity: 3 },
				{ name: "Murder", type: "CarHorns", rarity: 3 },
				{ name: "KoolAid", type: "BoostTrails", rarity: 3 },
				{ name: "Scary", type: "CarHorns", rarity: 3 },
				{ name: "Yum", type: "CarHorns", rarity: 3 },

				{ name: "Swamp", type: "CarHorns", rarity: 4 },
				{ name: "LaCucaracha", type: "CarHorns", rarity: 4 },
			],
		},
	],
	[
		1,
		{
			price: 3500,
			robuxPurchaceId: undefined,
			content: [
				{ name: "Red", type: "Colors", rarity: 0 },
				{ name: "Green", type: "Colors", rarity: 0 },
				{ name: "DarkBlue", type: "Colors", rarity: 0 },
				{ name: "Yellow", type: "Colors", rarity: 0 },

				{ name: "BlueMetallic", type: "Colors", rarity: 1 },
				{ name: "OrangeMetallic", type: "Colors", rarity: 1 },
				{ name: "MagentaMetallic", type: "Colors", rarity: 1 },

				{ name: "BlueFlame", type: "BoostTrails", rarity: 2 },
				{ name: "RedMetallic", type: "Colors", rarity: 2 },
				{ name: "Dalmation", type: "Colors", rarity: 2 },

				{ name: "CrazyCheckers", type: "Colors", rarity: 3 },
				{ name: "DeveloperBoost", type: "BoostTrails", rarity: 3 },
				{ name: "GoldMetallic", type: "Colors", rarity: 3 },

				{ name: "Chroma", type: "Colors", rarity: 4 },
				{ name: "Galaxy", type: "BoostTrails", rarity: 4 },
			],
		},
	],
	[
		2,
		{
			price: 6250,
			robuxPurchaceId: undefined,
			content: [
				{ name: "Cyan", type: "Colors", rarity: 0 },
				{ name: "Orange", type: "Colors", rarity: 0 },
				{ name: "Magenta", type: "Colors", rarity: 0 },
				{ name: "Purple", type: "Colors", rarity: 0 },

				{ name: "MatteBlack", type: "Colors", rarity: 1 },
				{ name: "PurpleMetallic", type: "Colors", rarity: 1 },
				{ name: "GreenFlame", type: "BoostTrails", rarity: 1 },

				{ name: "PinkFlame", type: "BoostTrails", rarity: 2 },
				{ name: "Checkers", type: "Colors", rarity: 2 },
				{ name: "Candy", type: "BoostTrails", rarity: 2 },
				{ name: "Horn2", type: "CarHorns", rarity: 2 },

				{ name: "Tiger", type: "Colors", rarity: 3 },
				{ name: "Lightning", type: "Colors", rarity: 3 },
				{ name: "RoyalZigZag", type: "Colors", rarity: 3 },

				{ name: "Galaxy", type: "Colors", rarity: 4 },
				{ name: "StarLight", type: "BoostTrails", rarity: 4 },
			],
		},
	],
	[
		3,
		{
			price: 10000,
			robuxPurchaceId: undefined,
			content: [
				{ name: "Crimson", type: "Colors", rarity: 0 },
				{ name: "DarkGreen", type: "Colors", rarity: 0 },
				{ name: "LightBlue", type: "Colors", rarity: 0 },
				{ name: "YellowFlame", type: "BoostTrails", rarity: 0 },

				{ name: "White", type: "Colors", rarity: 1 },
				{ name: "BlackMetallic", type: "Colors", rarity: 1 },
				{ name: "RedFlame", type: "BoostTrails", rarity: 1 },

				{ name: "WaterTrail", type: "BoostTrails", rarity: 2 },
				{ name: "SilverMetallic", type: "Colors", rarity: 2 },
				{ name: "SnowBlizzard", type: "BoostTrails", rarity: 2 },
				{ name: "Truck", type: "CarHorns", rarity: 2 },

				{ name: "DirtHut", type: "Colors", rarity: 3 },
				{ name: "HackerBoost", type: "BoostTrails", rarity: 3 },
				{ name: "CreeperAwwwwwMan", type: "CarHorns", rarity: 3 },
				{ name: "FireTruck", type: "CarHorns", rarity: 3 },

				{ name: "AwMan", type: "Colors", rarity: 4 },
				{ name: "Noir", type: "BoostTrails", rarity: 4 },
				{ name: "rar", type: "CarHorns", rarity: 4 },
			],
		},
	],
]);

export const CrateCatalog = Content;
export default Content;
