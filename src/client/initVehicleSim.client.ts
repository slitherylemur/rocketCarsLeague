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
import { noteLatePhysicsMark, notePredictionMarkFailure } from "shared/vehicleV2/ClientPredictionDiagnostics";

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
	const [ok] = pcall(() => {
		if (canPredict(root)) {
			RunService.SetPredictionMode(root, mode);
		}
		for (const descendant of root.GetDescendants()) {
			if (canPredict(descendant)) {
				RunService.SetPredictionMode(descendant, mode);
			}
		}
	});
	if (!ok) {
		notePredictionMarkFailure();
	}
}

interface PredictionGuard {
	connections: RBXScriptConnection[];
}

const predictionGuards = new Map<Model, PredictionGuard>();

function isUnder(instance: Instance, ancestor: Instance | undefined): boolean {
	return ancestor !== undefined && (instance === ancestor || instance.IsDescendantOf(ancestor));
}

/** Apply the V2 policy to the currently streamed hierarchy. Physics is On;
 * the anchored render source is Off. This is deliberately idempotent so it
 * can be reasserted after streaming settles. */
function applyV2PredictionPolicy(model: Model) {
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
}

function stopPredictionGuard(model: Model) {
	const guard = predictionGuards.get(model);
	if (!guard) {
		return;
	}
	predictionGuards.delete(model);
	for (const connection of guard.connections) {
		connection.Disconnect();
	}
}

function startPredictionGuard(model: Model) {
	stopPredictionGuard(model);
	const guard: PredictionGuard = { connections: [] };
	predictionGuards.set(model, guard);

	// Registration only requires VehicleRoot + state attributes. Hitboxes can
	// arrive later under replication pressure, so maintain the policy for the
	// lifetime of the streamed model instead of taking a one-time snapshot.
	guard.connections.push(
		model.DescendantAdded.Connect((descendant) => {
			if (predictionGuards.get(model) !== guard) {
				return;
			}
			const renderSource = model.FindFirstChild("RenderSource");
			if (isUnder(descendant, renderSource)) {
				setPredictionDeep(descendant, Enum.PredictionMode.Off);
				return;
			}
			const root = model.FindFirstChild("VehicleRoot");
			const hitboxes = model.FindFirstChild("Hitboxes");
			if (descendant === root || isUnder(descendant, hitboxes)) {
				noteLatePhysicsMark();
				setPredictionDeep(descendant, Enum.PredictionMode.On);
			}
		}),
	);

	applyV2PredictionPolicy(model);
	for (const delaySeconds of [0.25, 1, 3]) {
		task.delay(delaySeconds, () => {
			if (predictionGuards.get(model) === guard && model.Parent !== undefined) {
				applyV2PredictionPolicy(model);
			}
		});
	}
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
					startPredictionGuard(model);
					return;
				}
			} else if (VehicleSim.registerReplica(model as VehicleModel, LocalPlayer)) {
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
		stopPredictionGuard(model);
		VehicleSim.unregister(model);
		CarSim.unregister(model);
	}
});
for (const child of vehiclesFolder.GetChildren()) {
	onVehicleAdded(child);
}
