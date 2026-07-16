// Shared type for MapLightings entries (see per-map modules).

export interface MapLightingEntry {
	values: Record<string, unknown>;
	createChildren: () => Array<{ instance: Instance; isClouds: boolean }>;
}
