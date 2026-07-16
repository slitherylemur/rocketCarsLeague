// TEMP emit test — delete before finishing.
import type { MultiplierEntry } from "./Modules/dataTypes";

const MarketplaceService = game.GetService("MarketplaceService");

export function testUser(player: Player) {
	let hasVip = false;
	const [success, message] = pcall(() => {
		hasVip = MarketplaceService.UserOwnsGamePassAsync(player.UserId as unknown as User, 243133519);
	});
	return hasVip;
}

export function testMult(MultTable: MultiplierEntry[]) {
	let mult = 0;
	for (const [i, v] of ipairs(MultTable)) {
		if (v[1] > os.time()) {
			mult += v[0];
		} else {
			MultTable.remove(i - 1);
		}
	}
	return mult;
}

const cratePrices = [3500, 6250, 10000];

export function testPrices(crateName: number) {
	return cratePrices[crateName - 1];
}

export function testTeam(player: Player) {
	player.Team = undefined;
	player.Neutral = true;
}

export function testFFC(folder: Folder, i: number) {
	return folder.FindFirstChild(i as unknown as string);
}
