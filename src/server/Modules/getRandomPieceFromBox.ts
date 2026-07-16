// Original: ServerStorage/Modules/getRandomPieceFromBox (ModuleScript)

import lootManager from "./LootManager";
import type { LootSlot } from "./dataTypes";

interface BoxPiece extends Instance {
	rarity: IntValue;
}

interface Box extends Instance {
	pieces: Folder;
}

const rarityJar = {
	common: { Name: "0", Chance: 0.7 },
	uncommon: { Name: "1", Chance: 0.179 },
	rare: { Name: "2", Chance: 0.1 },
	epic: { Name: "3", Chance: 0.018 },
	legendary: { Name: "4", Chance: 0.003 },
};

function picPieceFromRarity(rarity: LootSlot, box: Box): BoxPiece {
	const rarityNumber = tonumber(rarity.Name as string);
	const piecesOfRarity: BoxPiece[] = [];

	for (const piece of box.pieces.GetChildren()) {
		if ((piece as BoxPiece).rarity.Value === rarityNumber) {
			piecesOfRarity.push(piece as BoxPiece);
		}
	}

	const randomIndex = math.random(1, piecesOfRarity.size());
	return piecesOfRarity[randomIndex - 1];
}

const module = {
	GetRandomPiece: (box: Box): BoxPiece => {
		const rarity = lootManager.GetRandomSlot(rarityJar)!;
		return picPieceFromRarity(rarity, box);
	},
};

export = module;
