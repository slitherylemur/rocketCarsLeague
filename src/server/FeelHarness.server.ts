// Studio-only feel-parity harness (SERVER_AUTHORITY_PLAN.md, Phase 0).
//
// Spawn into a car, then chat "/feel". The harness overrides the vehicle's
// inputs with scripted sequences, measures the car's response, and prints a
// metrics block plus one JSON line. Run it before and after every migration
// phase and diff the numbers — feel parity is judged on data, not vibes.
//
// Keep hands off the controls while it runs: client input still arrives and
// a held steer key mid-test invalidates the run. Run on flat, open ground.

import { Globals } from "./Globals";
import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import { VehicleAttr } from "shared/vehicleSim/VehicleSim";
import type { VehicleClass } from "./Classes/VehicleClass";

const RunService = game.GetService("RunService");
const Players = game.GetService("Players");
const HttpService = game.GetService("HttpService");

let running = false;

function round2(n: number): number {
	return math.floor(n * 100 + 0.5) / 100;
}

function speedOf(vehicle: VehicleClass): number {
	const base = vehicle.model.Base;
	return -base.CFrame.VectorToObjectSpace(base.AssemblyLinearVelocity).Z;
}

function sideSpeedOf(vehicle: VehicleClass): number {
	const base = vehicle.model.Base;
	return base.CFrame.VectorToObjectSpace(base.AssemblyLinearVelocity).X;
}

function yawRateOf(vehicle: VehicleClass): number {
	return vehicle.model.Base.AssemblyAngularVelocity.Y;
}

// Inputs go through the same sim entry points the remotes use. The client can
// overwrite them if keys are pressed mid-suite — hence "hands off".
function setInputs(vehicle: VehicleClass, throttle: number, steer: number) {
	VehicleSim.setThrottleSteer(vehicle.model, throttle, steer);
}

function resetCar(vehicle: VehicleClass, pose: CFrame) {
	setInputs(vehicle, 0, 0);
	VehicleSim.setDriftHeld(vehicle.model, false);
	vehicle.model.PivotTo(pose);
	const base = vehicle.model.Base;
	base.AssemblyLinearVelocity = new Vector3(0, 0, 0);
	base.AssemblyAngularVelocity = new Vector3(0, 0, 0);
	for (let i = 0; i < 45; i++) {
		RunService.Heartbeat.Wait(); // let the suspension settle (~0.75 s)
	}
}

function sampleFor(durationSecs: number, fn: (elapsed: number) => void) {
	const t0 = os.clock();
	let elapsed = 0;
	while (elapsed < durationSecs) {
		RunService.Heartbeat.Wait();
		elapsed = os.clock() - t0;
		fn(elapsed);
	}
}

function waitForSpeedFraction(vehicle: VehicleClass, fraction: number, timeoutSecs: number) {
	const t0 = os.clock();
	while (speedOf(vehicle) < vehicle.targetVelocity * fraction && os.clock() - t0 < timeoutSecs) {
		RunService.Heartbeat.Wait();
	}
}

function measureTurn(vehicle: VehicleClass, pose: CFrame, throttle: number, label: string, metrics: Record<string, number>) {
	resetCar(vehicle, pose);
	setInputs(vehicle, throttle, 0);
	waitForSpeedFraction(vehicle, throttle * 0.85, 10);
	setInputs(vehicle, throttle, 1);
	let yawSum = 0;
	let speedSum = 0;
	let n = 0;
	sampleFor(4, (elapsed) => {
		if (elapsed > 1.5) {
			// skip the transient; average the steady-state circle
			yawSum += math.abs(yawRateOf(vehicle));
			speedSum += math.abs(speedOf(vehicle));
			n += 1;
		}
	});
	const yawAvg = yawSum / math.max(n, 1);
	const speedAvg = speedSum / math.max(n, 1);
	metrics[`${label}_speed`] = round2(speedAvg);
	metrics[`${label}_yaw_rate`] = round2(yawAvg);
	metrics[`${label}_radius`] = round2(speedAvg / math.max(yawAvg, 0.001));
}

function runSuite(player: Player) {
	const vehicle = Globals.vehiclesTable[player.UserId];
	if (!vehicle) {
		warn("[feel] no spawned vehicle for " + player.Name);
		return;
	}
	if (running) {
		warn("[feel] a suite is already running");
		return;
	}
	running = true;

	const metrics: Record<string, number> = {};
	const pose = vehicle.model.GetPivot();
	const vehicleName = vehicle.model.Name;
	warn(`[feel] ==== suite start: ${vehicleName} (targetVelocity=${vehicle.targetVelocity}) ====`);

	// 1. acceleration + top speed
	resetCar(vehicle, pose);
	setInputs(vehicle, 1, 0);
	let t95 = -1;
	let topSpeed = 0;
	sampleFor(12, (elapsed) => {
		const v = speedOf(vehicle);
		topSpeed = math.max(topSpeed, v);
		if (t95 < 0 && v >= vehicle.targetVelocity * 0.95) {
			t95 = elapsed;
		}
	});
	metrics.accel_t95 = round2(t95);
	metrics.top_speed = round2(topSpeed);

	// 2. brake from top speed, then reverse top speed
	setInputs(vehicle, -1, 0);
	let brakeTime = -1;
	let reverseMax = 0;
	sampleFor(6, (elapsed) => {
		const v = speedOf(vehicle);
		if (brakeTime < 0 && v <= 2) {
			brakeTime = elapsed;
		}
		reverseMax = math.min(reverseMax, v);
	});
	metrics.brake_time = round2(brakeTime);
	metrics.reverse_top_speed = round2(math.abs(reverseMax));

	// 3. steady-state turn radius at half and full speed
	measureTurn(vehicle, pose, 0.5, "turn_half", metrics);
	measureTurn(vehicle, pose, 1, "turn_full", metrics);

	// 4. drift: yaw rate and lateral speed cap
	resetCar(vehicle, pose);
	setInputs(vehicle, 1, 0);
	waitForSpeedFraction(vehicle, 0.7, 10);
	VehicleSim.setDriftHeld(vehicle.model, true);
	setInputs(vehicle, 1, 1);
	let driftYawSum = 0;
	let driftN = 0;
	let driftSideMax = 0;
	sampleFor(3, () => {
		driftYawSum += math.abs(yawRateOf(vehicle));
		driftN += 1;
		driftSideMax = math.max(driftSideMax, math.abs(sideSpeedOf(vehicle)));
	});
	VehicleSim.setDriftHeld(vehicle.model, false);
	metrics.drift_yaw_rate = round2(driftYawSum / math.max(driftN, 1));
	metrics.drift_side_speed_max = round2(driftSideMax);

	// 5. boost: top speed, 100→0 drain time, regen (+10 incl. the 3 s delay)
	resetCar(vehicle, pose);
	const readBoost = () => {
		const value = vehicle.model.Base.GetAttribute(VehicleAttr.BoostAmount);
		return typeIs(value, "number") ? value : 0;
	};
	vehicle.model.Base.SetAttribute(VehicleAttr.BoostAmount, 100);
	setInputs(vehicle, 1, 0);
	vehicle.Boost(Enum.UserInputState.Begin);
	let boostTop = 0;
	let drainTime = -1;
	const boostT0 = os.clock();
	while (os.clock() - boostT0 < 30) {
		RunService.Heartbeat.Wait();
		boostTop = math.max(boostTop, speedOf(vehicle));
		if (readBoost() <= 0) {
			drainTime = os.clock() - boostT0;
			break;
		}
	}
	vehicle.Boost(Enum.UserInputState.End);
	metrics.boost_top_speed = round2(boostTop);
	metrics.boost_drain_time = round2(drainTime);
	setInputs(vehicle, 0, 0);
	const regenStartAmount = readBoost();
	const regenT0 = os.clock();
	let regen10 = -1;
	while (os.clock() - regenT0 < 15) {
		RunService.Heartbeat.Wait();
		if (readBoost() >= regenStartAmount + 10) {
			regen10 = os.clock() - regenT0;
			break;
		}
	}
	metrics.boost_regen10 = round2(regen10);

	// 6. jump: apex height and airtime
	resetCar(vehicle, pose);
	const startY = vehicle.model.Base.Position.Y;
	vehicle.Jump(Enum.UserInputState.Begin); // non-blocking now: the sim runs the force window
	let apex = 0;
	let airtime = -1;
	let leftGround = false;
	const jumpT0 = os.clock();
	while (os.clock() - jumpT0 < 4) {
		RunService.Heartbeat.Wait();
		apex = math.max(apex, vehicle.model.Base.Position.Y - startY);
		const grounded = VehicleSim.isOnGround(vehicle.model);
		if (!leftGround && !grounded) {
			leftGround = true;
		} else if (leftGround && grounded && airtime < 0) {
			airtime = os.clock() - jumpT0;
			break;
		}
	}
	metrics.jump_apex = round2(apex);
	metrics.jump_airtime = round2(airtime);

	// hand control back to the client (next real key change overwrites these)
	resetCar(vehicle, pose);
	running = false;

	warn(`[feel] ==== results: ${vehicleName} ====`);
	for (const [k, v] of pairs(metrics)) {
		print(`[feel] ${k} = ${v}`);
	}
	print(`[feel] JSON ${HttpService.JSONEncode(metrics)}`);
	warn(`[feel] ==== suite end (save the JSON line next to the phase it was measured on) ====`);
}

if (RunService.IsStudio()) {
	const hook = (player: Player) => {
		player.Chatted.Connect((message) => {
			if (message.lower() === "/feel") {
				task.spawn(() => runSuite(player));
			}
		});
	};
	Players.PlayerAdded.Connect(hook);
	for (const player of Players.GetPlayers()) {
		hook(player);
	}
}
