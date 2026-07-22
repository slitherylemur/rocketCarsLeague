// Vehicle façade — routes gameplay calls to the system that owns the model
// (legacy VehicleSim vs V2 CarSim, keyed on the V2 model attribute). Match
// code (footballMatch, FeelHarness, VehicleClass, remotes) calls THIS module
// so the two systems can never both drive one vehicle (gate G-14) and the
// legacy path stays byte-identical while it exists.

import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import * as CarSim from "shared/vehicleV2/CarSim";

export const isV2Model = CarSim.isV2Model;

export function setInputLocked(model: Model, locked: boolean) {
	if (CarSim.isV2Model(model)) {
		CarSim.setInputLocked(model, locked);
	} else {
		VehicleSim.setInputLocked(model, locked);
	}
}

export function markTeleport(model: Model) {
	if (CarSim.isV2Model(model)) {
		CarSim.markTeleport(model);
	} else {
		VehicleSim.markTeleport(model);
	}
}

export function setThrottleSteer(model: Model, throttle: number, steer: number) {
	if (CarSim.isV2Model(model)) {
		CarSim.setThrottleSteer(model, throttle, steer);
	} else {
		VehicleSim.setThrottleSteer(model, throttle, steer);
	}
}

export function setDriftHeld(model: Model, held: boolean) {
	if (CarSim.isV2Model(model)) {
		CarSim.setDriftHeld(model, held);
	} else {
		VehicleSim.setDriftHeld(model, held);
	}
}

export function setBoostHeld(model: Model, held: boolean) {
	if (CarSim.isV2Model(model)) {
		CarSim.setBoostHeld(model, held);
	} else {
		VehicleSim.setBoostHeld(model, held);
	}
}

export function grantBoost(model: Model, amount: number) {
	if (CarSim.isV2Model(model)) {
		CarSim.grantBoost(model, amount);
	} else {
		VehicleSim.grantBoost(model, amount);
	}
}

export function requestJump(model: Model) {
	if (CarSim.isV2Model(model)) {
		CarSim.requestJump(model);
	} else {
		VehicleSim.requestJump(model);
	}
}

export function requestFlip(model: Model) {
	if (CarSim.isV2Model(model)) {
		CarSim.requestFlip(model);
	} else {
		VehicleSim.requestFlip(model);
	}
}

export function setScriptedInput(model: Model, scripted: boolean) {
	if (CarSim.isV2Model(model)) {
		CarSim.setScriptedInput(model, scripted);
	} else {
		VehicleSim.setScriptedInput(model, scripted);
	}
}

export function setRoll(model: Model, direction: -1 | 1, begin: boolean) {
	if (CarSim.isV2Model(model)) {
		// V2 reads roll held-state live from IAS each tick; scripted rolls are
		// not part of the V2 harness surface (document in FeelHarness).
		return;
	}
	VehicleSim.setRoll(model, direction, begin);
}

/** Showcase X/Z pin. V2 takes the model; legacy resolved by Base part — this
 * façade accepts the model and resolves the legacy base itself. */
export function setShowcaseLock(model: Model, lockPosition: Vector3 | undefined) {
	if (CarSim.isV2Model(model)) {
		CarSim.setShowcaseLock(model, lockPosition);
	} else {
		const base = model.FindFirstChild("Base");
		if (base && base.IsA("BasePart")) {
			VehicleSim.setShowcaseLock(base, lockPosition);
		}
	}
}

/** External velocity-delta impulse (goal blast, scripted launches). Legacy
 * path applies the raw impulse like footballMatch always did. */
export function applyBlast(model: Model, velocityDelta: Vector3) {
	if (CarSim.isV2Model(model)) {
		CarSim.applyBlast(model, velocityDelta);
	} else {
		const base = model.FindFirstChild("Base");
		if (base && base.IsA("BasePart")) {
			base.ApplyImpulse(velocityDelta.mul(base.AssemblyMass));
		}
	}
}

/** Cosmetic-change mass refresh. V2 mass is a preset constant (gate G-10),
 * so this is deliberately a no-op there; legacy re-measures SimMass. */
export function refreshMass(model: Model) {
	if (!CarSim.isV2Model(model)) {
		VehicleSim.refreshMass(model);
	}
}

export function unregister(model: Model) {
	if (CarSim.isV2Model(model)) {
		CarSim.unregister(model);
	} else {
		VehicleSim.unregister(model);
	}
}

export function isOnGround(model: Model): boolean {
	return CarSim.isV2Model(model) ? CarSim.isOnGround(model) : VehicleSim.isOnGround(model);
}

/** The car's simulated rigid body: V2 VehicleRoot or legacy Base. */
export function rootOf(model: Model): BasePart | undefined {
	const name = CarSim.isV2Model(model) ? "VehicleRoot" : "Base";
	const part = model.FindFirstChild(name);
	return part && part.IsA("BasePart") ? part : undefined;
}
