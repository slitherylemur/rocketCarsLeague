// Replacement for server-side `_G` (roblox-ts has no `_G`).
// Every field mirrors an original `_G.<name>` — same names, and each field is
// assigned from the same module/script (at the same point in its execution)
// as the original assignment, so cross-script visibility timing is preserved.
//
// Original assignment sites:
//   spawnVehicle.lua        -> vehiclesTable
//   VehicleClass.lua        -> CarCategorys
//   roundHandler.lua        -> gamemode, roundTime, FFA_GAME_TIME, TDM_GAME_TIME,
//                              FFA_MAX_KILLS, TDM_MAX_KILLS, BASE_MONEY, KILL_MONEY,
//                              DAMAGE_MONEY_MULT, VIP_PASS_ID, killstreak,
//                              calculateMultMoney, getPlayerIcon
//   initializePlayer.lua    -> CrateNames, PlayerJoinedTimes, findEmptyGarage,
//                              findPlayerGarage, addPlayerToGarage, clearPlayerGarage,
//                              openCrateMenu, SpawnInPlayer

import type { VehicleClass } from "./Classes/VehicleClass";

export interface PlayerGarage extends Model {
	Player: NumberValue;
	Cameras: Folder & { CrateMenu: BasePart } & Record<string, BasePart>;
	spawnPlate: BasePart;
	spawnPlateModel: BasePart;
}

interface GlobalsTable {
	// spawnVehicle.lua
	vehiclesTable: Record<number, VehicleClass | undefined>;

	// VehicleClass.lua
	CarCategorys: string[];

	// roundHandler.lua
	gamemode: string;
	roundTime: number;
	FFA_GAME_TIME: number;
	TDM_GAME_TIME: number;
	FFA_MAX_KILLS: number;
	TDM_MAX_KILLS: number;
	BASE_MONEY: number;
	KILL_MONEY: number;
	DAMAGE_MONEY_MULT: number;
	VIP_PASS_ID: number;
	killstreak: Map<Player, number>;
	calculateMultMoney: (player: Player, amount: number) => number;
	getPlayerIcon: (player: Player) => string;

	// initializePlayer.lua
	// (CrateNames moved to shared/CrateCatalog.CRATE_NAMES and openCrateMenu
	// was deleted in migration Phase 5 — the crate page is client-rendered.)
	PlayerJoinedTimes: Record<number, number | undefined>;
	findEmptyGarage: () => PlayerGarage | undefined;
	findPlayerGarage: (player: Player) => PlayerGarage | undefined;
	addPlayerToGarage: (player: Player) => PlayerGarage;
	clearPlayerGarage: (player: Player) => void;
	SpawnInPlayer: (player: Player) => boolean;

	// MatchDirector (Top Table): true during the between-rounds shop window —
	// menu re-inits open the Cars page instead of the landing page.
	shopPhaseActive?: boolean;
}

// Fields are populated by the modules listed above as they run — identical to
// how `_G` was populated lazily. Reading a field before its owning module ran
// yields nil, exactly as `_G` did.
export const Globals = {} as GlobalsTable;
