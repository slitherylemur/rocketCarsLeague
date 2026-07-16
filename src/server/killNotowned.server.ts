// Original: ServerScriptService/killNotowned (Script)

import { legacyWait } from "shared/LegacyTiming";

const Players = game.GetService("Players");

// Original: while wait(10) do ... end (legacy wait keeps its throttled timing)
while (legacyWait(10) !== undefined) {
	const vehicleModels = (game.Workspace as unknown as { Vehicles: Folder }).Vehicles.GetChildren();
	for (const model of vehicleModels) {
		if (
			(model as Model & { Seats: Folder & { VehicleSeat: VehicleSeat } }).Seats.VehicleSeat.Occupant === undefined
		) {
			model.Destroy();
		}
	}
}
