// Testing/tuning HUD backend (tuningUi.client.ts is the front end).
//
// Creates ReplicatedStorage.TuningRemotes with two RemoteEvents:
//   ApplyBallTuning(values)    — clamp + write into the shared ballTunables
//                                table, then respawn the ball on the current
//                                map so the physics fields take effect.
//   ApplyVehicleTuning(values) — clamp + queue onto the sender's registered
//                                vehicle (VehicleSim.applyTuningForPlayer);
//                                the sim applies it inside the next step.
//
// Only Studio sessions and the game creator may apply — this is a balance
// testing tool, not a player feature.

import { BALL_FIELDS, ballTunables } from "shared/ballSim/BallConfig";
import * as BallSim from "shared/ballSim/BallSim";
import { applyTuningForPlayer, VehicleTuning } from "shared/vehicleSim/VehicleSim";
import { CAR_FIELDS } from "shared/vehicleSim/VehicleTuningFields";
import ballSpawner from "./Modules/ballSpawner";

const ReplicatedStorage = game.GetService("ReplicatedStorage");
const RunService = game.GetService("RunService");

const folder = new Instance("Folder");
folder.Name = "TuningRemotes";
folder.Parent = ReplicatedStorage;

const applyBall = new Instance("RemoteEvent");
applyBall.Name = "ApplyBallTuning";
applyBall.Parent = folder;

const applyVehicle = new Instance("RemoteEvent");
applyVehicle.Name = "ApplyVehicleTuning";
applyVehicle.Parent = folder;

function isAuthorized(player: Player): boolean {
	return RunService.IsStudio() || (game.CreatorType === Enum.CreatorType.User && player.UserId === game.CreatorId);
}

// Pull the finite-number fields we know about out of an untrusted payload,
// clamped to each field's declared range.
function sanitize(
	payload: unknown,
	fields: ReadonlyArray<{ key: string; min: number; max: number }>,
): Map<string, number> {
	const result = new Map<string, number>();
	if (!typeIs(payload, "table")) {
		return result;
	}
	const values = payload as Record<string, unknown>;
	for (const field of fields) {
		const value = values[field.key];
		// number check also rejects NaN via the self-inequality below
		if (typeIs(value, "number") && value === value && value !== math.huge && value !== -math.huge) {
			result.set(field.key, math.clamp(value, field.min, field.max));
		}
	}
	return result;
}

applyBall.OnServerEvent.Connect((player, payload) => {
	if (!isAuthorized(player)) {
		warn(`[Tuning] ${player.Name} is not authorized to tune`);
		return;
	}
	const values = sanitize(payload, BALL_FIELDS);
	if (values.isEmpty()) {
		return;
	}
	// Route by field scope: live fields go to the ball's attributes via the
	// sim (no respawn needed — they replicate to every predicting client);
	// respawn-scoped fields (size) rebuild the part. The server table is
	// updated for ALL fields so a later respawn re-seeds the same values.
	const tunables = ballTunables as unknown as Record<string, number>;
	const liveValues = new Map<string, number>();
	let needsRespawn = false;
	for (const field of BALL_FIELDS) {
		const value = values.get(field.key);
		if (value === undefined) {
			continue;
		}
		if (field.scope === "respawn" && tunables[field.key] !== value) {
			needsRespawn = true;
		}
		tunables[field.key] = value;
		if (field.scope === "live") {
			liveValues.set(field.key, value);
		}
	}
	let respawned = false;
	if (needsRespawn) {
		// The fresh ball is seeded from the updated table, live edits included.
		respawned = ballSpawner.RespawnBall();
	} else if (!liveValues.isEmpty()) {
		BallSim.queueTunables(liveValues);
	}
	warn(`[Tuning] ${player.Name} applied ball tuning (${values.size()} fields); respawned=${respawned}`);
});

applyVehicle.OnServerEvent.Connect((player, payload) => {
	if (!isAuthorized(player)) {
		warn(`[Tuning] ${player.Name} is not authorized to tune`);
		return;
	}
	const values = sanitize(payload, CAR_FIELDS);
	if (values.isEmpty()) {
		return;
	}
	const partial: Partial<VehicleTuning> = {};
	for (const [key, value] of values) {
		(partial as unknown as Record<string, number>)[key] = value;
	}
	const applied = applyTuningForPlayer(player, partial);
	if (applied) {
		warn(`[Tuning] ${player.Name} applied vehicle tuning (${values.size()} fields)`);
	} else {
		warn(`[Tuning] ${player.Name} has no registered vehicle to tune`);
	}
});
