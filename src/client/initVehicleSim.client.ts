// Client-side vehicle sim bootstrap (SERVER_AUTHORITY_PLAN.md Phase 4).
//
// Initializes the shared sim under BindToSimulation on this client and
// registers the LOCAL PLAYER'S car with it (adopting the replicated movers +
// tuning attributes), so the engine can predict the car and re-run the same
// drive logic during rollback-resimulation.
//
// Remote players' cars are explicitly NOT predicted here: they render
// authoritative server state (slightly in the past, but never mispredicting).
// Extrapolating them from the replicated input attributes is the Phase 5
// experiment.

import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import { VehicleModelAttr, VehicleModel } from "shared/vehicleSim/VehicleSim";
import * as CarSim from "shared/vehicleV2/CarSim";

const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const LocalPlayer = Players.LocalPlayer;

VehicleSim.initialize();
CarSim.initialize();

// Only predictable classes — see VehicleKeyHandler.canPredict.
function canPredict(instance: Instance): boolean {
	return (
		instance.IsA("BasePart") ||
		instance.IsA("Model") ||
		instance.IsA("Folder") ||
		instance.IsA("Attachment") ||
		instance.IsA("Constraint") ||
		instance.IsA("JointInstance")
	);
}

function setPredictionDeep(root: Instance, mode: Enum.PredictionMode) {
	pcall(() => {
		if (canPredict(root)) {
			RunService.SetPredictionMode(root, mode);
		}
		for (const descendant of root.GetDescendants()) {
			if (canPredict(descendant)) {
				RunService.SetPredictionMode(descendant, mode);
			}
		}
	});
}

function ownerUserIdOf(model: Instance): number {
	const value = model.GetAttribute(VehicleModelAttr.OwnerUserId);
	return typeIs(value, "number") ? value : 0;
}

function onVehicleAdded(model: Instance) {
	if (!model.IsA("Model")) {
		return;
	}
	task.spawn(() => {
		// Attributes/children stream in over several frames; wait for the
		// owner marker first.
		let ownerId = ownerUserIdOf(model);
		const t0 = os.clock();
		while (ownerId === 0 && os.clock() - t0 < 10 && model.Parent) {
			task.wait(0.1);
			ownerId = ownerUserIdOf(model);
		}

		if (ownerId !== LocalPlayer.UserId) {
			// Remote car: render server truth, never predict — a half-known
			// car predicted by the engine without fresh inputs only jitters.
			if (model.Parent) {
				setPredictionDeep(model, Enum.PredictionMode.Off);
			}
			return;
		}

		// Own car: retry registration until the replica is complete. V2 models
		// register with CarSim; the prediction marking that legacy did on the
		// seat edge (VehicleKeyHandler) happens here because V2 has no seat.
		// The RenderSource is cosmetic-only and explicitly NOT predicted.
		while (model.Parent) {
			if (CarSim.isV2Model(model)) {
				if (CarSim.registerReplica(model, LocalPlayer)) {
					const root = model.FindFirstChild("VehicleRoot");
					if (root) {
						setPredictionDeep(root, Enum.PredictionMode.On);
					}
					const hitboxes = model.FindFirstChild("Hitboxes");
					if (hitboxes) {
						setPredictionDeep(hitboxes, Enum.PredictionMode.On);
					}
					const renderSource = model.FindFirstChild("RenderSource");
					if (renderSource) {
						setPredictionDeep(renderSource, Enum.PredictionMode.Off);
					}
					print(`[CarSim] client registered own V2 car ${model.Name}`);
					return;
				}
			} else if (VehicleSim.registerReplica(model as VehicleModel, LocalPlayer)) {
				print(`[VehicleSim] client registered own car ${model.Name}`);
				return;
			}
			task.wait(0.25);
		}
	});
}

const vehiclesFolder = game.Workspace.WaitForChild("Vehicles");
vehiclesFolder.ChildAdded.Connect(onVehicleAdded);
vehiclesFolder.ChildRemoved.Connect((model) => {
	if (model.IsA("Model")) {
		VehicleSim.unregister(model);
		CarSim.unregister(model);
	}
});
for (const child of vehiclesFolder.GetChildren()) {
	onVehicleAdded(child);
}
