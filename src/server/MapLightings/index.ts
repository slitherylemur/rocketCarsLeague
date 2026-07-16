// Registry replacing the original dynamic require of
// game.ServerStorage.MapLightings:FindFirstChild(mapName) in roundHandler.
// Keys match the original ModuleScript names exactly. The per-map modules are
// pure data (no side effects), so eager loading here cannot change behaviour.

import MudDerby from "./MudDerby";
import DesertIsland from "./DesertIsland";
import BaseplateMap from "./BaseplateMap";
import StadiumMap from "./StadiumMap";
import ApocalypticCity from "./ApocalypticCity";
import ShipIsland from "./ShipIsland";
import type { MapLightingEntry } from "./types";

const MapLightings: Record<string, MapLightingEntry | undefined> = {
	MudDerby: MudDerby,
	DesertIsland: DesertIsland,
	BaseplateMap: BaseplateMap,
	StadiumMap: StadiumMap,
	ApocalypticCity: ApocalypticCity,
	ShipIsland: ShipIsland,
};

export = MapLightings;
