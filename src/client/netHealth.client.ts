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
import * as CarSim from "shared/vehicleV2/CarSim";
import { VehicleAttr, VehicleInput, VehicleModelAttr } from "shared/vehicleSim/VehicleSim";
import { SIM_RATE_HZ } from "shared/simScheduler";

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
// predicted car this is ≤ one sim tick (~33ms at the 30 Hz sim rate)
// regardless of ping.

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
	forcedRelease?: boolean;
}
// Active unlatch: when the hardware is definitively UP but a Bool action is
// still DOWN past this, the probe FIRES the action false instead of only
// warning. IAS state is client-authoritative, so the repair replicates and
// unlatches the server sim too — this is what ends a stuck boost. Skipped on
// touch devices (UIButton bindings have no pollable hardware state).
const FORCE_RELEASE_AFTER = 0.3;
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
			// V2 proxies use the same state-attribute names on VehicleRoot.
			const base = model.FindFirstChild("VehicleRoot") ?? model.FindFirstChild("Base");
			if (base && base.IsA("BasePart")) {
				return base;
			}
		}
	}
	return undefined;
}

// Hardware state across keyboard AND gamepad bindings — a held controller
// button must never read as "released" or the unlatch watchdog would cut a
// legitimate gamepad boost.
function isGamepadKeyCode(keyCode: Enum.KeyCode): boolean {
	const name = keyCode.Name;
	return name.sub(1, 6) === "Button" || name.sub(1, 4) === "DPad";
}

function hardwareActionDown(action: InputAction): boolean | undefined {
	let anyBinding = false;
	for (const child of action.GetChildren()) {
		if (!child.IsA("InputBinding")) {
			continue;
		}
		const keyCode = (child as unknown as { KeyCode?: Enum.KeyCode }).KeyCode;
		if (keyCode === undefined || keyCode === Enum.KeyCode.Unknown) {
			continue;
		}
		if (isGamepadKeyCode(keyCode)) {
			anyBinding = true;
			let down = false;
			pcall(() => {
				down = UserInputService.IsGamepadButtonDown(Enum.UserInputType.Gamepad1, keyCode);
			});
			if (down) {
				return true;
			}
		} else {
			anyBinding = true;
			if (UserInputService.IsKeyDown(keyCode)) {
				return true;
			}
		}
	}
	return anyBinding ? false : undefined; // no pollable binding → not probeable
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
		const hardwareDown = hardwareActionDown(action);
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
		// Active unlatch: repair a lost release instead of just reporting it.
		if (!hardwareDown && actionDown) {
			if (
				!UserInputService.TouchEnabled &&
				state.mismatchSince !== undefined &&
				!state.forcedRelease &&
				os.clock() - state.mismatchSince > FORCE_RELEASE_AFTER
			) {
				state.forcedRelease = true;
				pcall(() => action.Fire(false));
				warn(`[NetHealth] ${actionName}: hardware is up but the action latched down — force-released`);
			}
		} else {
			state.forcedRelease = false;
		}
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

// ---- RunService.Misprediction aggregator ---------------------------------
// The exact rollback signal: which INSTANCE diverged, which PROPERTY or
// ATTRIBUTE, and by how much — replacing guesswork about why the car
// corrected. Aggregated (never one log per event: a rollback storm at
// 30 Hz would flood the console and cost more than the storm itself) and
// summarized once per DIAG_INTERVAL alongside the ping/latency line.
//
// The event is part of the server-authority beta, so both its existence and
// its argument shape are probed defensively: args are scanned for the
// instance, the property/attribute name, and the predicted/authoritative
// value pair rather than assuming fixed positions.

interface MispredictStat {
	count: number;
	posDeltaSum: number;
	posDeltaMax: number;
	rotDegSum: number;
	rotDegMax: number;
	nearTeleport: number; // events within TELEPORT_CORRELATE_S of a TeleportGen bump
	nearLock: number; // events within TELEPORT_CORRELATE_S of an InputLocked change
}

const TELEPORT_CORRELATE_S = 0.75;
const mispredictStats = new Map<string, MispredictStat>();
let mispredictEvents = 0;
let mispredictSupported = false;
let lastTeleportAt = -math.huge;
let lastLockChangeAt = -math.huge;

function describeDelta(predicted: unknown, authoritative: unknown): LuaTuple<[number?, number?]> {
	if (typeIs(predicted, "CFrame") && typeIs(authoritative, "CFrame")) {
		const posDelta = predicted.Position.sub(authoritative.Position).Magnitude;
		const [, rotAngle] = predicted.Rotation.ToObjectSpace(authoritative.Rotation).ToAxisAngle();
		return $tuple(posDelta, math.deg(rotAngle));
	}
	if (typeIs(predicted, "Vector3") && typeIs(authoritative, "Vector3")) {
		return $tuple(predicted.sub(authoritative).Magnitude, undefined);
	}
	if (typeIs(predicted, "number") && typeIs(authoritative, "number")) {
		return $tuple(math.abs(predicted - authoritative), undefined);
	}
	return $tuple(undefined, undefined);
}

// Resimulation cost from the stats dictionary (documented: ResimulationTime).
let resimTimeSum = 0;
let resimTimeMax = 0;
let resimTimeCount = 0;

function recordEntryValue(instance: Instance | undefined, name: string, predicted: unknown, authoritative: unknown) {
	const key = `${instance !== undefined ? `${instance.ClassName}:${instance.Name}` : "?"}.${name}`;
	let stat = mispredictStats.get(key);
	if (stat === undefined) {
		stat = { count: 0, posDeltaSum: 0, posDeltaMax: 0, rotDegSum: 0, rotDegMax: 0, nearTeleport: 0, nearLock: 0 };
		mispredictStats.set(key, stat);
	}
	stat.count += 1;
	const [posDelta, rotDeg] = describeDelta(predicted, authoritative);
	if (posDelta !== undefined) {
		stat.posDeltaSum += posDelta;
		stat.posDeltaMax = math.max(stat.posDeltaMax, posDelta);
	}
	if (rotDeg !== undefined) {
		stat.rotDegSum += rotDeg;
		stat.rotDegMax = math.max(stat.rotDegMax, rotDeg);
	}
	const now = os.clock();
	if (now - lastTeleportAt < TELEPORT_CORRELATE_S) {
		stat.nearTeleport += 1;
	}
	if (now - lastLockChangeAt < TELEPORT_CORRELATE_S) {
		stat.nearLock += 1;
	}
}

// Documented shape (creator-docs RunService.yaml):
//   Misprediction(time: double,
//                 instances: Array<{ Instance,
//                                    Properties?:  { [name]: {Predicted, Authoritative} },
//                                    Attributes?:  { [name]: {Predicted, Authoritative} } }>,
//                 stats: { ResimulationTime: number })
// The values describe the FIRST DIVERGENT historical step. A positional-arg
// fallback covers older beta builds the previous parser was written against.
function recordMisprediction(...args: unknown[]) {
	mispredictEvents += 1;

	const entries = args[1];
	if (typeIs(entries, "table")) {
		for (const raw of entries as Array<unknown>) {
			if (!typeIs(raw, "table")) {
				continue;
			}
			const entry = raw as Record<string, unknown>;
			const instanceRaw = entry["Instance"];
			const instance = typeIs(instanceRaw, "Instance") ? instanceRaw : undefined;
			let foundAny = false;
			for (const dictName of ["Properties", "Attributes"]) {
				const dict = entry[dictName];
				if (typeIs(dict, "table")) {
					for (const [name, values] of pairs(dict as Record<string, unknown>)) {
						if (typeIs(values, "table")) {
							const pair = values as { Predicted?: unknown; Authoritative?: unknown };
							recordEntryValue(instance, tostring(name), pair.Predicted, pair.Authoritative);
							foundAny = true;
						}
					}
				}
			}
			if (!foundAny) {
				recordEntryValue(instance, "?", undefined, undefined);
			}
		}
		const stats = args[2];
		if (typeIs(stats, "table")) {
			const resim = (stats as Record<string, unknown>)["ResimulationTime"];
			if (typeIs(resim, "number")) {
				resimTimeSum += resim;
				resimTimeCount += 1;
				resimTimeMax = math.max(resimTimeMax, resim);
			}
		}
		return;
	}

	// Fallback: scan positional args (older event shapes).
	let instance: Instance | undefined;
	let name: string | undefined;
	const values: defined[] = [];
	for (const arg of args) {
		if (instance === undefined && typeIs(arg, "Instance")) {
			instance = arg;
		} else if (name === undefined && typeIs(arg, "string")) {
			name = arg;
		} else if (arg !== undefined) {
			values.push(arg as defined);
		}
	}
	recordEntryValue(instance, name ?? "?", values[0], values[1]);
}

pcall(() => {
	const signal = (RunService as unknown as Record<string, unknown>)["Misprediction"];
	if (typeIs(signal, "RBXScriptSignal")) {
		signal.Connect(recordMisprediction);
		mispredictSupported = true;
	}
});
if (!mispredictSupported) {
	warn("[NetHealth] RunService.Misprediction unavailable on this engine — falling back to the resim-tick heuristic");
}

// Stamp intentional-teleport and lock transitions on the local car so the
// summary can separate "correction after a kickoff/goal reset" (expected,
// snap-rendered) from spontaneous divergence while driving (the real bug).
{
	let lastTeleportGen: number | undefined;
	let lastLocked: boolean | undefined;
	RunService.Heartbeat.Connect(() => {
		const base = localVehicleBase();
		if (base === undefined) {
			return;
		}
		const gen = base.GetAttribute(VehicleAttr.TeleportGen);
		const genNumber = typeIs(gen, "number") ? gen : 0;
		if (lastTeleportGen !== undefined && genNumber !== lastTeleportGen) {
			lastTeleportAt = os.clock();
		}
		lastTeleportGen = genNumber;
		const locked = base.GetAttribute(VehicleAttr.InputLocked) === true;
		if (lastLocked !== undefined && locked !== lastLocked) {
			lastLockChangeAt = os.clock();
		}
		lastLocked = locked;
	});
}

function mispredictSummary(intervalSeconds: number): string | undefined {
	if (!mispredictSupported) {
		return undefined; // warned once at startup — no per-interval spam
	}
	const total = mispredictEvents;
	mispredictEvents = 0;
	if (total === 0) {
		mispredictStats.clear();
		return "0 misprediction events";
	}
	const entries: Array<[string, MispredictStat]> = [];
	for (const [key, stat] of mispredictStats) {
		entries.push([key, stat]);
	}
	mispredictStats.clear();
	table.sort(entries, (a, b) => a[1].count > b[1].count);
	let header = `${total} misprediction events (${string.format("%.1f", total / intervalSeconds)}/s)`;
	if (resimTimeCount > 0) {
		header += `, resim avg=${string.format("%.2f", (resimTimeSum / resimTimeCount) * 1000)}ms max=${string.format(
			"%.2f",
			resimTimeMax * 1000,
		)}ms`;
		resimTimeSum = 0;
		resimTimeMax = 0;
		resimTimeCount = 0;
	}
	const lines: string[] = [`${header}, top offenders:`];
	for (let i = 0; i < math.min(entries.size(), 5); i++) {
		const [key, stat] = entries[i];
		let detail = `${key} x${stat.count}`;
		if (stat.posDeltaMax > 0) {
			detail += ` pos avg=${string.format("%.2f", stat.posDeltaSum / stat.count)} max=${string.format("%.2f", stat.posDeltaMax)}`;
		}
		if (stat.rotDegMax > 0) {
			detail += ` rot avg=${string.format("%.1f", stat.rotDegSum / stat.count)}° max=${string.format("%.1f", stat.rotDegMax)}°`;
		}
		if (stat.nearTeleport > 0) {
			detail += ` [${stat.nearTeleport} near teleport]`;
		}
		if (stat.nearLock > 0) {
			detail += ` [${stat.nearLock} near lock change]`;
		}
		lines.push(`    ${detail}`);
	}
	return lines.join("\n");
}

// ---- diagnostics ---------------------------------------------------------

function isSeated(): boolean {
	const character = LocalPlayer.Character;
	const humanoid = character && character.FindFirstChildOfClass("Humanoid");
	if (humanoid !== undefined && humanoid.SeatPart !== undefined) {
		return true;
	}
	// V2 has no seat — "driving" is the own car's Driving attribute.
	const base = localVehicleBase();
	return base !== undefined && base.GetAttribute(VehicleAttr.Driving) === true;
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
		const resimTicks = VehicleSim.readResimTicks() + CarSim.readResimTicks();
		if (!isSeated()) {
			continue; // nothing meaningful to report from the menu/lobby
		}
		const predicted = predictedInstanceCount();
		// resimTicks > 0 is PROOF the car is predicted: only rollback
		// resimulation replays ticks behind the max sim clock seen. Estimate
		// discrete rollback events from the depth a rollback rewinds (≈ ping
		// worth of SIM_RATE_HZ ticks) — each event is one visual correction,
		// and the correction's size scales with ping. Kept as a fallback;
		// RunService.Misprediction (summary below) is the exact signal.
		let verdict: string;
		if (resimTicks > 0) {
			const depthTicks = math.max(1, (pingMs / 1000) * SIM_RATE_HZ);
			const rollbacksPerSec = resimTicks / DIAG_INTERVAL / depthTicks;
			verdict = `PREDICTING; ~${string.format("%.1f", rollbacksPerSec)} rollback(s)/s (corrections deepen with ping)`;
		} else if (predicted !== undefined && predicted < 10) {
			verdict = "CAR NOT PREDICTED (authoritative): replication-cadence motion + input round-trip";
		} else if (predicted === undefined) {
			verdict = "no resims observed, predicted-count API unavailable — if inputs feel delayed the car may be authoritative";
		} else {
			verdict = "predicting cleanly — no rollbacks observed";
		}
		const inputLatency = maxInputLatencyMs;
		maxInputLatencyMs = 0;
		const summary = mispredictSummary(DIAG_INTERVAL);
		warn(
			`[NetHealth] ping=${math.round(pingMs)}ms predicted=${predicted ?? "unavailable"} resimTicks/${DIAG_INTERVAL}s=${resimTicks} inputLat=${math.round(inputLatency)}ms → ${verdict}${
				summary !== undefined ? `\n[NetHealth] ${summary}` : ""
			}`,
		);
	}
});
