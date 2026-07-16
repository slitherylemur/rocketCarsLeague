// Original: ServerStorage/Modules/LootManager (ModuleScript)

import type { LootSlot } from "./dataTypes";

type Slots = Record<string, LootSlot>;

function usingWeights(slots: Slots): boolean | undefined {
	// NOTE(original quirk preserved): the loop returns on the FIRST entry, so
	// only one (arbitrary) slot is ever inspected — exactly as the Lua did.
	for (const [i, v] of pairs(slots)) {
		// Lua truthiness: `if v.Weight then` — false only for nil (Weight is never boolean false)
		if (v.Weight !== undefined) {
			return true;
		}
		return false;
	}
	return undefined;
}

interface LootManagerModule {
	GetTotalWeight(slots: Slots): number;
	GetRandomSlot(slots: Slots): LootSlot | undefined;
	GetChances(slots: Slots): Record<string, LootSlot> | undefined;
}

const module: LootManagerModule = {
	/**
	 * Gets total weight between all slots
	 */
	GetTotalWeight(this: LootManagerModule, slots: Slots): number {
		let total = 0;
		for (const [_, slot] of pairs(slots)) {
			total = total + (slot.Weight as number);
		}
		return total;
	},

	/**
	 * Selects a random slot from the table for you.
	 */
	GetRandomSlot(this: LootManagerModule, slots: Slots): LootSlot | undefined {
		//get total weight/chances
		const total = usingWeights(slots) ? this.GetTotalWeight(slots) : 1;
		//get a random number based on total weight/chances
		let randomNumber = math.random() * total;

		//iterate through all slots and select a random one based on weights/chances
		for (const [_, slot] of pairs(slots)) {
			const n = (slot.Weight ?? slot.Chance) as number;
			if (randomNumber <= n) {
				return slot;
			} else {
				randomNumber = randomNumber - n;
			}
		}
		return undefined;
	},

	/**
	 * Convert Weights into percentages (for debugging purposes / visualization purposes)
	 * You DONT need this function to create a table based on perctanges.
	 */
	GetChances(this: LootManagerModule, slots: Slots): Record<string, LootSlot> | undefined {
		const chances: Record<string, LootSlot> = {};
		const total = this.GetTotalWeight(slots);
		for (const [key, slot] of pairs(slots)) {
			if (slot.Weight === undefined) {
				return undefined;
			}

			chances[key as string] = { Chance: (slot.Weight as number) / total };

			for (const [i, v] of pairs(slot)) {
				if (i !== "Weight") {
					chances[key as string][i as string] = v;
				}
			}
		}
		return chances;
	},
};

export = module;
