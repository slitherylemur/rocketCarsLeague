// Bootstraps the shared vehicle simulations on the server. Both cores tick
// on the shared fixed-step scheduler; a given car registers with exactly one
// of them (VehicleClass branches on VEHICLE_V2_ENABLED; registration is
// interlocked both ways — gate G-14).

import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import * as CarSim from "shared/vehicleV2/CarSim";
import { VEHICLE_V2_ENABLED } from "shared/vehicleV2/FeatureFlags";
import { validateAllTemplates } from "shared/vehicleV2/VehicleDefs";

VehicleSim.initialize();
CarSim.initialize();

// Startup migration report over the whole catalogue (V2 content pipeline).
if (VEHICLE_V2_ENABLED) {
	task.spawn(() => {
		const vehicleModels = game.GetService("ServerStorage").FindFirstChild("VehicleModels");
		if (vehicleModels) {
			validateAllTemplates(vehicleModels);
		}
	});
}
