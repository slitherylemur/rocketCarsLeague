// Recreates the behaviour of the Scripts that were embedded inside ServerStorage
// MODELS (they only ever executed when their model was cloned into Workspace):
//
//  1. ServerStorage/Maps/ShipIsland/water/sea/ocean/"Second Level of Water."/Script
//     — kills vehicles whose VehicleSeat touches the second water level
//  2. ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script (×4 identical)
//     — kills the vehicle of any character whose HumanoidRootPart touches a Hit part
//  3. ServerStorage/VehicleModels/TestVehicle/Seats/VehicleSeat/Script
//     — ProximityPrompt sits the triggering player in the seat
//
// (The Nuke/Light re-adorn script left with the Nuke product's removal.)
//
// Attachment points mirror when the originals started running:
//  - map scripts: when the ShipIsland clone is parented into workspace.Map
//    (roundHandler.loadMap)
//  - TestVehicle: when a TestVehicle clone enters Workspace (spawnVehicle —
//    both the drivable copy under workspace.Vehicles and the garage display
//    copy under workspace.PlayerGarages/*/VehicleFolder)

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
		const water = map.WaitForChild("water", 5);
		if (!water) {
			warn(`[attach] ${map.GetFullName()} has no "water" child — skipping ShipIsland water scripts`);
			return;
		}
		const ocean = water.WaitForChild("sea").WaitForChild("ocean");
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

// ---- 3) TestVehicle seat prompt -------------------------------------------
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
