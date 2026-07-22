// Network health: high-ping indicator + prediction diagnostics.
//
// UI: a small code-built badge on the RIGHT EDGE of the screen that appears
// when the player's ping is high enough to degrade the server-authority
// experience (yellow ≥ HIGH_PING_MS, red ≥ SEVERE_PING_MS, hidden below —
// with hysteresis so it doesn't flicker at the threshold). Averaged over the
// last few samples.
//
// Diagnostics (temporary while tuning server authority): once every
// DIAG_INTERVAL while seated, ONE warn line that separates the two causes of
// steppy motion:
//   - predicted≈0        → the car is NOT predicted (authoritative): motion
//                          renders at replication cadence and inputs cost a
//                          full round trip. Prediction marking is the problem.
//   - resimTicks high    → the car IS predicted but rollback-storming:
//                          some attribute mismatches every server frame
//                          (see the rollback contract in
//                          server-authority-migration-state / VehicleSim).
//   - both healthy       → steppiness is elsewhere (smoothing/interp).

import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import { VehicleAttr, VehicleInput, VehicleModelAttr } from "shared/vehicleSim/VehicleSim";

const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const UserInputService = game.GetService("UserInputService");
const LocalPlayer = Players.LocalPlayer;

const HIGH_PING_MS = 130;
const SEVERE_PING_MS = 220;
const HIDE_BELOW_MS = 110; // hysteresis: once shown, hide only under this
const PING_SAMPLES = 5; // rolling average, sampled once per second
const DIAG_INTERVAL = 5;

const FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

// ---- ping badge (right edge, vertically centered) ------------------------

function buildBadge() {
	const playerGui = LocalPlayer.WaitForChild("PlayerGui");

	const gui = new Instance("ScreenGui");
	gui.Name = "NetHealth";
	gui.ResetOnSpawn = false;
	gui.DisplayOrder = 50;
	gui.IgnoreGuiInset = true;
	gui.Enabled = false;

	const frame = new Instance("Frame");
	frame.Name = "Badge";
	frame.AnchorPoint = new Vector2(1, 0.5);
	frame.Position = new UDim2(1, -10, 0.5, 0);
	frame.Size = new UDim2(0, 132, 0, 46);
	frame.BackgroundColor3 = Color3.fromRGB(25, 32, 40);
	frame.BackgroundTransparency = 0.25;
	frame.Parent = gui;
	const corner = new Instance("UICorner");
	corner.CornerRadius = new UDim(0, 8);
	corner.Parent = frame;
	const stroke = new Instance("UIStroke");
	stroke.Name = "Stroke";
	stroke.Thickness = 2;
	stroke.Transparency = 0.3;
	stroke.Parent = frame;

	const title = new Instance("TextLabel");
	title.Name = "Title";
	title.BackgroundTransparency = 1;
	title.FontFace = FONT;
	title.TextScaled = true;
	title.Text = "HIGH PING";
	title.Size = new UDim2(1, -12, 0.45, 0);
	title.Position = new UDim2(0, 6, 0, 4);
	title.Parent = frame;

	const value = new Instance("TextLabel");
	value.Name = "Value";
	value.BackgroundTransparency = 1;
	value.FontFace = FONT;
	value.TextScaled = true;
	value.TextColor3 = new Color3(1, 1, 1);
	value.Size = new UDim2(1, -12, 0.4, 0);
	value.Position = new UDim2(0, 6, 0.5, 0);
	value.Parent = frame;

	gui.Parent = playerGui;
	return { gui, title, value, stroke };
}

const badge = buildBadge();
const pingHistory: number[] = [];
let badgeShown = false;

function updateBadge(pingMs: number) {
	if (badgeShown) {
		if (pingMs < HIDE_BELOW_MS) {
			badgeShown = false;
		}
	} else if (pingMs >= HIGH_PING_MS) {
		badgeShown = true;
	}
	badge.gui.Enabled = badgeShown;
	if (!badgeShown) {
		return;
	}
	const severe = pingMs >= SEVERE_PING_MS;
	const color = severe ? Color3.fromRGB(255, 90, 80) : Color3.fromRGB(255, 200, 80);
	badge.title.TextColor3 = color;
	badge.stroke.Color = color;
	badge.value.Text = `${math.round(pingMs)} ms`;
}

// ---- input pipeline probe ------------------------------------------------
// "Input delay" and "stuck keys" on a PREDICTED car mean the pipeline
//   physical key → InputAction.GetState() → sim input attribute
// is breaking at a specific stage. Every frame the probe compares all three
// for the digital drive keys and warns the moment a stage disagrees with the
// hardware for longer than STUCK_AFTER while controls are enabled:
//   hardware UP / action DOWN  → the engine's IAS latch (transitions lost)
//   hardware DOWN / action UP  → key events not reaching the IAS
//   action ≠ attribute         → readPlayerInputs isn't consuming (early-out)
// It also measures true press→attribute latency for throttle; on a healthy
// predicted car this is ≤ one sim tick (~17ms) regardless of ping.

const STUCK_AFTER = 0.4;
const PROBED_ACTIONS = [
	VehicleInput.ThrottleForward,
	VehicleInput.ThrottleBackward,
	VehicleInput.SteerRight,
	VehicleInput.SteerLeft,
	VehicleInput.Drift,
	VehicleInput.Boost,
	VehicleInput.Jump,
] as const;

interface ProbeState {
	mismatchSince?: number;
	warned: boolean;
}
const iasProbe = new Map<string, ProbeState>();
const attrProbe: ProbeState = { warned: false };
let throttleEdgeAt: number | undefined;
let prevHwThrottle = 0;
let maxInputLatencyMs = 0; // reported+reset each DIAG_INTERVAL

function localVehicleBase(): BasePart | undefined {
	const vehicles = game.Workspace.FindFirstChild("Vehicles");
	if (!vehicles) {
		return undefined;
	}
	for (const model of vehicles.GetChildren()) {
		if (model.GetAttribute(VehicleModelAttr.OwnerUserId) === LocalPlayer.UserId) {
			const base = model.FindFirstChild("Base");
			if (base && base.IsA("BasePart")) {
				return base;
			}
		}
	}
	return undefined;
}

function keyboardKeysDown(action: InputAction): boolean | undefined {
	let anyBinding = false;
	for (const child of action.GetChildren()) {
		if (!child.IsA("InputBinding")) {
			continue;
		}
		const keyCode = (child as unknown as { KeyCode?: Enum.KeyCode }).KeyCode;
		if (keyCode === undefined || keyCode === Enum.KeyCode.Unknown) {
			continue;
		}
		anyBinding = true;
		if (UserInputService.IsKeyDown(keyCode)) {
			return true;
		}
	}
	return anyBinding ? false : undefined; // no keyboard binding → not probeable
}

function probeStage(name: string, state: ProbeState, mismatched: boolean, describe: () => string) {
	const now = os.clock();
	if (!mismatched) {
		state.mismatchSince = undefined;
		state.warned = false;
		return;
	}
	state.mismatchSince = state.mismatchSince ?? now;
	if (!state.warned && now - state.mismatchSince > STUCK_AFTER) {
		state.warned = true;
		warn(`[NetHealth] ${name}: ${describe()}`);
	}
}

RunService.Heartbeat.Connect(() => {
	const context = LocalPlayer.FindFirstChild(VehicleInput.ContextName);
	if (!context || !context.IsA("InputContext") || !context.Enabled) {
		// Locked/absent controls freeze GetState by design — not a fault.
		iasProbe.clear();
		attrProbe.mismatchSince = undefined;
		attrProbe.warned = false;
		throttleEdgeAt = undefined;
		return;
	}

	let hwThrottle = 0;
	for (const actionName of PROBED_ACTIONS) {
		const action = context.FindFirstChild(actionName);
		if (!action || !action.IsA("InputAction")) {
			continue;
		}
		const hardwareDown = keyboardKeysDown(action);
		if (hardwareDown === undefined) {
			continue;
		}
		const actionDown = action.GetState() === true;
		if (actionName === VehicleInput.ThrottleForward && hardwareDown) {
			hwThrottle += 1;
		}
		if (actionName === VehicleInput.ThrottleBackward && hardwareDown) {
			hwThrottle -= 1;
		}
		let state = iasProbe.get(actionName);
		if (!state) {
			state = { warned: false };
			iasProbe.set(actionName, state);
		}
		probeStage(
			actionName,
			state,
			actionDown !== hardwareDown,
			() =>
				hardwareDown
					? `key DOWN but action UP for ${STUCK_AFTER}s — key events not reaching the IAS`
					: `key UP but action still DOWN for ${STUCK_AFTER}s — IAS latch (release transition lost)`,
		);
	}

	// Attribute stage + latency (throttle only; -1/0/1 exact values).
	const base = localVehicleBase();
	if (base === undefined) {
		throttleEdgeAt = undefined;
		return;
	}
	if (base.GetAttribute(VehicleAttr.InputLocked) === true) {
		// Match control lock: the sim zeroes inputs on purpose — not a fault.
		attrProbe.mismatchSince = undefined;
		attrProbe.warned = false;
		throttleEdgeAt = undefined;
		return;
	}
	if (hwThrottle !== prevHwThrottle) {
		prevHwThrottle = hwThrottle;
		throttleEdgeAt = os.clock();
	}
	const attrThrottle = base.GetAttribute(VehicleAttr.Throttle);
	const attrMatches = attrThrottle === hwThrottle;
	if (throttleEdgeAt !== undefined && attrMatches) {
		maxInputLatencyMs = math.max(maxInputLatencyMs, (os.clock() - throttleEdgeAt) * 1000);
		throttleEdgeAt = undefined;
	}
	probeStage(
		"Throttle attribute",
		attrProbe,
		!attrMatches && base.GetAttribute(VehicleAttr.Driving) === true,
		() =>
			`keys say ${hwThrottle} but ${VehicleAttr.Throttle}=${tostring(base.GetAttribute(VehicleAttr.Throttle))} for ${STUCK_AFTER}s — readPlayerInputs not consuming (early-out?)`,
	);
});

// ---- diagnostics ---------------------------------------------------------

function isSeated(): boolean {
	const character = LocalPlayer.Character;
	const humanoid = character && character.FindFirstChildOfClass("Humanoid");
	return humanoid !== undefined && humanoid.SeatPart !== undefined;
}

function predictedInstanceCount(): number | undefined {
	let count: number | undefined;
	pcall(() => {
		count = game.GetService("AuroraService").GetPredictedInstances().size();
	});
	return count;
}

task.spawn(() => {
	let diagAccumulator = 0;
	while (true) {
		task.wait(1);

		let pingMs = 0;
		pcall(() => {
			pingMs = LocalPlayer.GetNetworkPing() * 1000;
		});
		pingHistory.push(pingMs);
		if (pingHistory.size() > PING_SAMPLES) {
			pingHistory.remove(0);
		}
		let sum = 0;
		for (const sample of pingHistory) {
			sum += sample;
		}
		updateBadge(sum / pingHistory.size());

		diagAccumulator += 1;
		if (diagAccumulator < DIAG_INTERVAL) {
			continue;
		}
		diagAccumulator = 0;
		const resimTicks = VehicleSim.readResimTicks();
		if (!isSeated()) {
			continue; // nothing meaningful to report from the menu/lobby
		}
		const predicted = predictedInstanceCount();
		// resimTicks > 0 is PROOF the car is predicted: only rollback
		// resimulation replays ticks behind the max sim clock seen. Estimate
		// discrete rollback events from the depth a rollback rewinds (≈ ping
		// worth of 60Hz ticks) — each event is one unsmoothed visual snap,
		// and the snap's size scales with ping.
		let verdict: string;
		if (resimTicks > 0) {
			const depthTicks = math.max(1, (pingMs / 1000) * 60);
			const rollbacksPerSec = resimTicks / DIAG_INTERVAL / depthTicks;
			verdict = `PREDICTING; ~${string.format("%.1f", rollbacksPerSec)} rollback snap(s)/s (unsmoothed corrections, deeper at high ping)`;
		} else if (predicted !== undefined && predicted < 10) {
			verdict = "CAR NOT PREDICTED (authoritative): replication-cadence motion + input round-trip";
		} else if (predicted === undefined) {
			verdict = "no resims observed, predicted-count API unavailable — if inputs feel delayed the car may be authoritative";
		} else {
			verdict = "predicting cleanly — no rollbacks observed";
		}
		const inputLatency = maxInputLatencyMs;
		maxInputLatencyMs = 0;
		warn(
			`[NetHealth] ping=${math.round(pingMs)}ms predicted=${predicted ?? "unavailable"} resimTicks/${DIAG_INTERVAL}s=${resimTicks} inputLat=${math.round(inputLatency)}ms → ${verdict}`,
		);
	}
});
