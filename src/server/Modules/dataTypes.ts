// Shared data-shape types for the DataStore2-backed player data.
// (Type-only module; no runtime counterpart in the original game.)

export type SerializedEnum = [string, string];

export interface VehicleCustomization {
	color?: string;
	hornSound?: string;
	boostTrail?: string;
	skin?: string;
}

// [multiplier, expiryUnixTime]
export type MultiplierEntry = [number, number];

export interface DataStoreDefaultsType {
	money: number;
	trophies: number;
	wins: number;
	kills: number;
	deaths: number;
	equippedVehicle: string;
	colors: string[];
	hornSounds: string[];
	boostTrails: string[];
	vehicles: string[];
	vehicleCustomization: Record<string, VehicleCustomization | undefined>;
	crates: number[];
	multipliers: MultiplierEntry[];
	keyBinds: Record<string, SerializedEnum | undefined>;
	codes: string[];
}

// LootManager slot shape (Weight- or Chance-based).
export interface LootSlot {
	Weight?: number;
	Chance?: number;
	[key: string]: unknown;
}

// Item shapes used by the crate catalog and UI populate functions — the
// catalog moved to shared (Phase 5), so the canonical definitions live there;
// re-exported here for the server modules that import them from dataTypes.
export type { CrateItem, CrateContent } from "shared/CrateCatalog";
