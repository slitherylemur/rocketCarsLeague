// Clones/builds the per-player vehicle InputContext on join
// (SERVER_AUTHORITY_PLAN.md Phase 3). task.spawn because building it reads
// the player's saved keybinds from DataStore2, which can yield.

import VehicleInputActions from "./Modules/vehicleInputActions";

const Players = game.GetService("Players");

Players.PlayerAdded.Connect((player) => {
	task.spawn(() => VehicleInputActions.ensureContext(player));
});
for (const player of Players.GetPlayers()) {
	task.spawn(() => VehicleInputActions.ensureContext(player));
}
