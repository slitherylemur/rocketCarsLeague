// Recreates the behaviour of the Scripts that were embedded inside ServerStorage
// MODELS (they only ever executed when their model was cloned into Workspace):
//
//  1. ServerStorage/Maps/ShipIsland/water/sea/ocean/"Second Level of Water."/Script
//     — kills vehicles whose VehicleSeat touches the second water level
//  2. ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script (×4 identical)
//     — kills the vehicle of any character whose HumanoidRootPart touches a Hit part
//  3. ServerStorage/Nuke/Light/Script — re-adorns the light every legacy-wait tick
//  4. ServerStorage/VehicleModels/TestVehicle/Seats/VehicleSeat/Script
//     — ProximityPrompt sits the triggering player in the seat
//
// Attachment points mirror when the originals started running:
//  - map scripts: when the ShipIsland clone is parented into workspace.Map
//    (roundHandler.loadMap)
//  - Nuke: when the Nuke clone is parented to Workspace (purchaseHandler)
//  - TestVehicle: when a TestVehicle clone enters Workspace (spawnVehicle —
//    both the drivable copy under workspace.Vehicles and the garage display
//    copy under workspace.PlayerGarages/*/VehicleFolder)

import { legacyWait } from "shared/LegacyTiming";

const Workspace = game.GetService("Workspace");

// ---- 1) "Second Level of Water." ----------------------------------------
function attachSecondLevelOfWater(part: BasePart) {
	part.Touched.Connect((touch) => {
		print(touch);
		if (touch.IsA("VehicleSeat")) {
			touch.Parent!.Parent!.Destroy();
		}
	});
}

// ---- 2) hits/Hit ----------------------------------------------------------
function attachHit(part: BasePart) {
	part.Touched.Connect((touch) => {
		if (touch.Name === "HumanoidRootPart") {
			const humanoid = touch.Parent!.FindFirstChildWhichIsA("Humanoid");
			// (original indexed a possibly-nil humanoid — errors are swallowed by
			// the Touched handler, same as here when humanoid is nil)
			const seat = humanoid!.SeatPart;
			if (seat) {
				seat.Parent!.Parent!.Destroy();
			}
		}
	});
}

function attachShipIslandWaterScripts(map: Instance) {
	task.spawn(() => {
		const ocean = map.WaitForChild("water").WaitForChild("sea").WaitForChild("ocean");
		const secondLevel = ocean.FindFirstChild("Second Level of Water.");
		if (secondLevel) {
			attachSecondLevelOfWater(secondLevel as BasePart);
		}
		const hits = ocean.FindFirstChild("hits");
		if (hits) {
			for (const hit of hits.GetChildren()) {
				if (hit.Name === "Hit") {
					attachHit(hit as BasePart);
				}
			}
		}
	});
}

(Workspace as unknown as { Map: Folder }).Map.ChildAdded.Connect((child) => {
	if (child.Name === "ShipIsland") {
		attachShipIslandWaterScripts(child);
	}
});
for (const child of (Workspace as unknown as { Map: Folder }).Map.GetChildren()) {
	if (child.Name === "ShipIsland") {
		attachShipIslandWaterScripts(child);
	}
}

// ---- 3) Nuke/Light --------------------------------------------------------
function attachNukeLight(nuke: Instance) {
	task.spawn(() => {
		const light = nuke.WaitForChild("Light") as Instance & { Adornee?: Instance };
		// Original: while true do script.Parent.Adornee = script.Parent.Parent wait() end
		// The loop died with the script when the nuke was destroyed; here it exits
		// once the nuke leaves the game.
		while (nuke.IsDescendantOf(game)) {
			(light as unknown as { Adornee: Instance }).Adornee = light.Parent!;
			legacyWait();
		}
	});
}

Workspace.ChildAdded.Connect((child) => {
	if (child.Name === "Nuke") {
		attachNukeLight(child);
	}
});

// ---- 4) TestVehicle seat prompt -------------------------------------------
function attachTestVehicleSeat(seat: VehicleSeat) {
	(seat.WaitForChild("ProximityPrompt") as ProximityPrompt).Triggered.Connect((player) => {
		seat.Sit((player.Character as unknown as { Humanoid: Humanoid }).Humanoid);
	});
}

function isTestVehicleSeat(desc: Instance): boolean {
	if (!desc.IsA("VehicleSeat")) return false;
	if (desc.FindFirstChild("ProximityPrompt") === undefined) return false;
	const model = desc.Parent !== undefined ? desc.Parent!.Parent : undefined;
	// spawned copies are renamed "TestVehicle<userId>"; garage copies keep "TestVehicle"
	return model !== undefined && string.sub(model.Name, 1, 11) === "TestVehicle";
}

Workspace.DescendantAdded.Connect((desc) => {
	if (isTestVehicleSeat(desc)) {
		attachTestVehicleSeat(desc as VehicleSeat);
	}
});
for (const desc of Workspace.GetDescendants()) {
	if (isTestVehicleSeat(desc)) {
		attachTestVehicleSeat(desc as VehicleSeat);
	}
}
