// Car tuning field metadata shared by the tuning HUD (row labels, reading
// current values off the vehicle Base) and the server remote (validation
// clamps). Order here is the display order.
//
// Every field maps 1:1 onto VehicleTuning; the attr column is where the live
// value is stored on the vehicle Base (VehicleSim writes it at registration
// and re-reads it every sim tick).

import { VehicleAttr, VehicleTuning, VehicleTuningAttr } from "shared/vehicleSim/VehicleSim";

export interface CarFieldSpec {
	key: keyof VehicleTuning;
	label: string;
	attr: string;
	min: number;
	max: number;
}

export const CAR_FIELDS: ReadonlyArray<CarFieldSpec> = [
	{ key: "mass", label: "Mass (design)", attr: VehicleTuningAttr.Mass, min: 1, max: 100000 },
	{ key: "acceleration", label: "Acceleration", attr: VehicleTuningAttr.Acceleration, min: 0, max: 10000 },
	{ key: "targetVelocity", label: "Target velocity", attr: VehicleAttr.TargetVelocity, min: 1, max: 500 },
	{ key: "minTurnRadius", label: "Min turn radius", attr: VehicleTuningAttr.MinTurnRadius, min: 1, max: 200 },
	{ key: "maxTurnRadius", label: "Max turn radius", attr: VehicleTuningAttr.MaxTurnRadius, min: 1, max: 400 },
	{ key: "maxAngularSpeed", label: "Max angular speed", attr: VehicleTuningAttr.MaxAngularSpeed, min: 0.01, max: 50 },
	{ key: "minAngularSpeed", label: "Min angular speed", attr: VehicleTuningAttr.MinAngularSpeed, min: 0.01, max: 50 },
	{ key: "boostAmount", label: "Boost amount", attr: VehicleTuningAttr.BoostAmount, min: 0, max: 100 },
	{ key: "driftingMult", label: "Drifting mult", attr: VehicleTuningAttr.DriftingMult, min: 0, max: 10 },
];
