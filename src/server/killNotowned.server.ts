// Original: ServerScriptService/killNotowned (Script)

import { legacyWait } from "shared/LegacyTiming";

// Two production hardenings (launch bugs):
//  * A freshly spawned car is occupant-less between being parented into
//    Workspace.Vehicles and SeatPlayer's Sit (a few hundred ms, longer under
//    load). A sweep landing in that window destroyed cars mid-spawn — each
//    affected player was left standing as a raw character at the world origin
//    (the LoadCharacter spawn; the place has no SpawnLocation), and a
//    round-start mass spawn could lose EVERY car at once ("the game
//    completely failed to start"). CB_SpawnedAt (stamped by spawnVehicle at
//    parent time) gives new cars a grace period.
//  * The old direct `model.Seats.VehicleSeat` index threw on any
//    non-conforming child of Workspace.Vehicles, killing this whole loop for
//    the rest of the server — after which abandoned cars were never cleaned
//    up again. Each model is now swept inside its own pcall with
//    FindFirstChildWhichIsA.
const SPAWN_GRACE_SECONDS = 15;

// Original: while wait(10) do ... end (legacy wait keeps its throttled timing)
while (legacyWait(10) !== undefined) {
	const vehiclesFolder = game.Workspace.FindFirstChild("Vehicles");
	if (vehiclesFolder) {
		for (const model of vehiclesFolder.GetChildren()) {
			const [ok, err] = pcall(() => {
				const spawnedAt = model.GetAttribute("CB_SpawnedAt");
				if (typeIs(spawnedAt, "number") && os.clock() - spawnedAt < SPAWN_GRACE_SECONDS) {
					return;
				}
				const seat = model.FindFirstChildWhichIsA("VehicleSeat", true);
				if (seat === undefined || seat.Occupant === undefined) {
					model.Destroy();
				}
			});
			if (!ok) {
				warn(`[killNotowned] sweep failed for ${model.Name}: ${err}`);
			}
		}
	}
}
