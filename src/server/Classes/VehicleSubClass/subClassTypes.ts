// Shared type for the vehicle subclass modules (original: children of
// ServerStorage/Classes/VehicleSubClass). Each module exports the same shape
// the original Lua module table had: displayName, modelTemplate and new().

import type { VehicleClass, VehicleModel } from "../VehicleClass";

export interface VehicleSubClassModule {
	displayName: string;
	modelTemplate: VehicleModel;
	new: (player?: Player) => LuaTuple<[VehicleClass, VehicleModel]>;
}
