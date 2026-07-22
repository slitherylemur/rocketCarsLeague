// Vehicle V2 shared simulation — one unanchored VehicleRoot rigid box per
// car, driven by explicit ray-contact suspension/tire math. Runs identically
// on the server (every car) and on predicting clients (own car only) inside
// the shared fixed-step scheduler. See VEHICLE_V2_ADR.md §3.
//
// Rollback rules (non-negotiable):
//   - Every cross-tick value lives in an attribute on VehicleRoot (CarState).
//   - All other quantities are recomputed per tick from restored physics
//     state (CFrame/velocities) + replayed IAS input.
//   - Forces are per-tick impulses ACCUMULATED IN CODE and committed as one
//     AssemblyLinearVelocity/AssemblyAngularVelocity write — rollback-aware
//     physics properties, the same pattern BallSim ships on. No persistent
//     constraint movers exist, so there is no "constraint state doesn't roll
//     back" surface at all.
//   - Angular response uses the preset's analytic box inertia (identical
//     constants on both peers) — no engine inertia queries.
//   - No os.clock/task.delay/wall-clock state inside the step; timers compare
//     the SimTime attribute only.
//   - Attribute writes from OUTSIDE the step (match code, remotes) are queued
//     on the entry and consumed INSIDE the next step.

import { registerSimHook, SIM_ORDER_VEHICLE } from "shared/simScheduler";
import { getPreset, PhysicsPreset } from "shared/vehicleV2/PhysicsPresets";
import {
	boxInertiaDiag,
	gearMultiplier,
	impulseAtPoint,
	servoDeltaOmega,
	suspensionImpulse,
	tireAccel,
} from "shared/vehicleV2/CarMath";
import { CarAttr, CarInput, CarModelAttr, ZERO_INPUT, assertSchemaBudget } from "shared/vehicleV2/CarState";
import { VehicleInput } from "shared/vehicleSim/VehicleSim";

const RunService = game.GetService("RunService");
const Players = game.GetService("Players");

const IS_SERVER = RunService.IsServer();
const LOCAL_PLAYER = IS_SERVER ? undefined : Players.LocalPlayer;

const ERROR_WARN_INTERVAL = 5;
const WORLD_UP = new Vector3(0, 1, 0);

// Extra pitch/yaw feel state (legacy ReleasedThrottle semantics: airborne
// pitch control engages only after the throttle has been released once).
const ATTR_RELEASED_THROTTLE = "RelThrottle";
const ATTR_LAST_THROTTLE = "LastThrottle";

// ---- registry -------------------------------------------------------------

interface CarEntry {
	model: Model;
	root: BasePart;
	preset: PhysicsPreset;
	owner?: Player;
	inertiaDiag: Vector3;
	// per-tick derived (never carried across ticks — rollback-safe as fields)
	velocity: number;
	propVelocity: number;
	// cosmetic contact state for the render rig (client, own car): compression
	// per canonical contact + grounded flag. NEVER read by simulation code.
	renderCompression: [number, number, number, number];
	renderGrounded: boolean;
	// impulse accumulator (reset each tick)
	dv: Vector3;
	dw: Vector3;
	// server-only pending ops, consumed inside the next sim step
	pendingDriving?: boolean;
	pendingInputLock?: boolean;
	pendingTeleport?: boolean;
	pendingBlast?: Vector3;
	pendingShowcase?: { position?: Vector3 };
	pendingScripted?: boolean;
	pendingThrottleSteer?: { throttle: number; steer: number };
	pendingDriftHeld?: boolean;
	pendingBoostHeld?: boolean;
	pendingBoostGrant?: number;
	pendingJump?: boolean;
	pendingFlip?: boolean;
	lastErrorWarnAt?: number;
	inputActions?: {
		context: InputContext;
		throttleForward?: InputAction;
		throttleBackward?: InputAction;
		steerRight?: InputAction;
		steerLeft?: InputAction;
		throttleAxis?: InputAction;
		steerStick?: InputAction;
		throttleTouch?: InputAction;
		steerTouch?: InputAction;
		drift?: InputAction;
		boost?: InputAction;
		jump?: InputAction;
		rollLeft?: InputAction;
		rollRight?: InputAction;
	};
}

const registry = new Map<Model, CarEntry>();

// ---- helpers --------------------------------------------------------------

const rayParams = new RaycastParams();
rayParams.FilterType = Enum.RaycastFilterType.Exclude;
rayParams.IgnoreWater = true;
// CanCollide=false surfaces (ball, hitboxes, neutralized characters) are not
// drivable ground; skipping them via RespectCanCollide keeps the exclude list
// to just the vehicles folder — one static, deterministic filter.
rayParams.RespectCanCollide = true;
let rayFilterReady = false;

function ensureRayFilter() {
	if (rayFilterReady) {
		return;
	}
	const vehicles = game.Workspace.FindFirstChild("Vehicles");
	if (vehicles) {
		rayParams.FilterDescendantsInstances = [vehicles];
		rayFilterReady = true;
	}
}

function attrNumber(instance: Instance, name: string, fallback: number): number {
	const value = instance.GetAttribute(name);
	return typeIs(value, "number") ? value : fallback;
}

function attrBool(instance: Instance, name: string): boolean {
	return instance.GetAttribute(name) === true;
}

function attrVector3(instance: Instance, name: string, fallback: Vector3): Vector3 {
	const value = instance.GetAttribute(name);
	return typeIs(value, "Vector3") ? value : fallback;
}

function stateNumber(action: InputAction | undefined): number {
	if (!action) {
		return 0;
	}
	const state = action.GetState();
	return typeIs(state, "number") ? state : 0;
}

function stateBool(action: InputAction | undefined): boolean {
	return action !== undefined && action.GetState() === true;
}

function stateVector2X(action: InputAction | undefined): number {
	if (!action) {
		return 0;
	}
	const state = action.GetState();
	return typeIs(state, "Vector2") ? state.X : 0;
}

// ---- registration ---------------------------------------------------------

export function isV2Model(model: Instance): boolean {
	return model.GetAttribute(CarModelAttr.V2) !== undefined;
}

function buildEntry(model: Model, root: BasePart, preset: PhysicsPreset, owner?: Player): CarEntry {
	return {
		model,
		root,
		preset,
		owner,
		inertiaDiag: boxInertiaDiag(preset.mass, preset.boxSize),
		velocity: 0,
		propVelocity: 0,
		renderCompression: [0, 0, 0, 0],
		renderGrounded: false,
		dv: new Vector3(),
		dw: new Vector3(),
	};
}

/** Server registration. The model must already be a V2 proxy (built by
 * vehicleV2Spawn) with the V2/PresetId attributes stamped. Initial state
 * attributes are written here — before any client predicts the instance. */
export function registerServer(model: Model, root: BasePart, owner?: Player) {
	if (!IS_SERVER) {
		error("[CarSim] registerServer called on a client");
	}
	if (!isV2Model(model)) {
		warn(`[CarSim] refusing to register non-V2 model ${model.Name} (gate G-14)`);
		return;
	}
	const preset = getPreset(model.GetAttribute(CarModelAttr.PresetId));
	const entry = buildEntry(model, root, preset, owner);

	root.SetAttribute(CarAttr.SimTime, 0);
	root.SetAttribute(CarAttr.Driving, false);
	root.SetAttribute(CarAttr.Throttle, 0);
	root.SetAttribute(CarAttr.Steer, 0);
	root.SetAttribute(CarAttr.DriftHeld, false);
	root.SetAttribute(CarAttr.BoostHeld, false);
	root.SetAttribute(CarAttr.PrevJump, false);
	root.SetAttribute(CarAttr.PrevBoost, false);
	root.SetAttribute(CarAttr.DriftEngaged, false);
	root.SetAttribute(CarAttr.BoostAmount, preset.boostMax);
	root.SetAttribute(CarAttr.JumpForceUntil, 0);
	root.SetAttribute(CarAttr.JumpReadyAt, 0);
	root.SetAttribute(CarAttr.JumpLaunchDir, WORLD_UP);
	root.SetAttribute(CarAttr.JumpStabilizing, false);
	root.SetAttribute(CarAttr.JumpStabilizeStart, 0);
	root.SetAttribute(CarAttr.LastGrounded, 0);
	root.SetAttribute(CarAttr.FlipUntil, 0);
	root.SetAttribute(CarAttr.FlipReadyAt, 0);
	root.SetAttribute(ATTR_RELEASED_THROTTLE, false);
	root.SetAttribute(ATTR_LAST_THROTTLE, 0);

	registry.set(model, entry);
}

/** Client registration for the local player's own car (prediction). Reads
 * everything it needs from replicated attributes; never writes state. */
export function registerReplica(model: Model, owner: Player): boolean {
	if (registry.has(model)) {
		return true;
	}
	if (!isV2Model(model)) {
		return false;
	}
	const root = model.FindFirstChild("VehicleRoot");
	if (!root || !root.IsA("BasePart")) {
		return false;
	}
	const presetId = model.GetAttribute(CarModelAttr.PresetId);
	if (!typeIs(presetId, "string")) {
		return false;
	}
	if (root.GetAttribute(CarAttr.SimTime) === undefined) {
		return false; // state attributes not replicated yet
	}
	registry.set(model, buildEntry(model, root, getPreset(presetId), owner));
	return true;
}

export function unregister(model: Model) {
	const entry = registry.get(model);
	if (entry) {
		registry.delete(model);
		diagMaxSimTime.delete(entry.root);
	}
}

export function isRegistered(model: Model): boolean {
	return registry.has(model);
}

// ---- gameplay API (server; all queued, consumed inside the next step) -----

function entryOf(model: Model): CarEntry | undefined {
	return registry.get(model);
}

/** Mark the car as driven (replaces the seat-occupancy lifecycle). */
export function setDriving(model: Model, driving: boolean) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingDriving = driving;
	}
}

export function setInputLocked(model: Model, locked: boolean) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingInputLock = locked;
	}
}

/** Queue BEFORE/right after an intentional relocation so the next step bumps
 * TeleportGen — renderers snap instead of smoothing a map-scale correction. */
export function markTeleport(model: Model) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingTeleport = true;
	}
}

/** External impulse event (goal blast, scripted launch): a velocity delta
 * applied inside the next sim step. Bumps BlastGen (render severity) and
 * suppresses overspeed control for preset.blastControlHoldoff so the drive
 * servo cannot immediately eat the launch (gate G-8). */
export function applyBlast(model: Model, velocityDelta: Vector3) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingBlast = (entry.pendingBlast ?? new Vector3()).add(velocityDelta);
	}
}

export function setShowcaseLock(model: Model, lockPosition: Vector3 | undefined) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingShowcase = { position: lockPosition };
	}
}

export function setScriptedInput(model: Model, scripted: boolean) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingScripted = scripted;
	}
}

export function setThrottleSteer(model: Model, throttle: number, steer: number) {
	const entry = entryOf(model);
	if (!entry) {
		return;
	}
	if (throttle !== throttle || steer !== steer) {
		return; // NaN guard
	}
	entry.pendingThrottleSteer = { throttle: math.clamp(throttle, -1, 1), steer: math.clamp(steer, -1, 1) };
}

export function setDriftHeld(model: Model, held: boolean) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingDriftHeld = held;
	}
}

export function setBoostHeld(model: Model, held: boolean) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingBoostHeld = held;
	}
}

export function grantBoost(model: Model, amount: number) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingBoostGrant = (entry.pendingBoostGrant ?? 0) + amount;
	}
}

export function requestJump(model: Model) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingJump = true;
	}
}

export function requestFlip(model: Model) {
	const entry = entryOf(model);
	if (entry) {
		entry.pendingFlip = true;
	}
}

// ---- client prediction diagnostics (netHealth) ----------------------------
// A tick whose sim clock sits behind the highest clock already seen can only
// be a rollback resimulation replay (module Lua state never rolls back).
const diagMaxSimTime = new Map<BasePart, number>();
let diagResimTicks = 0;

export function readResimTicks(): number {
	const count = diagResimTicks;
	diagResimTicks = 0;
	return count;
}

/** Cosmetic contact state for the render rig (client, predicted own car).
 * Undefined for unregistered models (remote cars use neutral suspension). */
export function getRenderState(
	model: Model,
): { compression: readonly [number, number, number, number]; grounded: boolean; speed: number } | undefined {
	const entry = registry.get(model);
	if (!entry) {
		return undefined;
	}
	return { compression: entry.renderCompression, grounded: entry.renderGrounded, speed: entry.velocity };
}

// ---- input sampling -------------------------------------------------------

function getInputActions(entry: CarEntry) {
	const owner = entry.owner;
	if (!owner) {
		return undefined;
	}
	const context = owner.FindFirstChild(VehicleInput.ContextName) as InputContext | undefined;
	if (!context) {
		return undefined;
	}
	if (entry.inputActions && entry.inputActions.context === context) {
		return entry.inputActions;
	}
	const find = (name: string) => context.FindFirstChild(name) as InputAction | undefined;
	entry.inputActions = {
		context,
		throttleForward: find(VehicleInput.ThrottleForward),
		throttleBackward: find(VehicleInput.ThrottleBackward),
		steerRight: find(VehicleInput.SteerRight),
		steerLeft: find(VehicleInput.SteerLeft),
		throttleAxis: find(VehicleInput.ThrottleAxis),
		steerStick: find(VehicleInput.SteerStick),
		throttleTouch: find(VehicleInput.ThrottleTouch),
		steerTouch: find(VehicleInput.SteerTouch),
		drift: find(VehicleInput.Drift),
		boost: find(VehicleInput.Boost),
		jump: find(VehicleInput.Jump),
		rollLeft: find(VehicleInput.RollLeft),
		rollRight: find(VehicleInput.RollRight),
	};
	return entry.inputActions;
}

/** Sample the fixed-step input record from IAS + the input attributes. The
 * attributes are the rollback-tracked mirror: IAS held state is read live
 * (Roblox replays IAS history during resimulation), scripted/locked modes
 * fall back to the attribute values written by pending ops. */
function sampleInput(entry: CarEntry): CarInput {
	const root = entry.root;
	if (attrBool(root, CarAttr.InputLocked)) {
		return ZERO_INPUT;
	}
	if (attrBool(root, CarAttr.ScriptedInput)) {
		// Scripted (FeelHarness): the attributes ARE the input.
		return {
			throttle: attrNumber(root, CarAttr.Throttle, 0),
			steer: attrNumber(root, CarAttr.Steer, 0),
			drift: attrBool(root, CarAttr.DriftHeld),
			boost: attrBool(root, CarAttr.BoostHeld),
			jump: false,
			rollLeft: false,
			rollRight: false,
		};
	}
	const actions = getInputActions(entry);
	if (!actions) {
		// No context (yet): fall back to the attribute mirror (covers the
		// server stepping a car whose owner left, and pending-op writes).
		return {
			throttle: attrNumber(root, CarAttr.Throttle, 0),
			steer: attrNumber(root, CarAttr.Steer, 0),
			drift: attrBool(root, CarAttr.DriftHeld),
			boost: attrBool(root, CarAttr.BoostHeld),
			jump: false,
			rollLeft: false,
			rollRight: false,
		};
	}
	const digitalThrottle = (stateBool(actions.throttleForward) ? 1 : 0) - (stateBool(actions.throttleBackward) ? 1 : 0);
	const axisThrottle = stateNumber(actions.throttleAxis);
	const touchThrottle = stateNumber(actions.throttleTouch);
	const throttle = digitalThrottle !== 0 ? digitalThrottle : axisThrottle !== 0 ? axisThrottle : touchThrottle;

	const digitalSteer = (stateBool(actions.steerRight) ? 1 : 0) - (stateBool(actions.steerLeft) ? 1 : 0);
	const stickX = stateVector2X(actions.steerStick);
	const stickSteer = math.abs(stickX) < 0.3 ? 0 : stickX;
	const touchSteer = stateNumber(actions.steerTouch);
	const steer = digitalSteer !== 0 ? digitalSteer : stickSteer !== 0 ? stickSteer : touchSteer;

	return {
		throttle: throttle === throttle ? math.clamp(throttle, -1, 1) : 0,
		steer: steer === steer ? math.clamp(steer, -1, 1) : 0,
		drift: stateBool(actions.drift),
		boost: stateBool(actions.boost),
		jump: stateBool(actions.jump),
		rollLeft: stateBool(actions.rollLeft),
		rollRight: stateBool(actions.rollRight),
	};
}

// ---- contact sampling -----------------------------------------------------

interface Contact {
	index: number;
	steers: boolean;
	hit: boolean;
	point: Vector3;
	normal: Vector3;
	/** 0..1 fraction of suspension travel used. */
	compression: number;
}

const RAY_LIFT = 1; // ray origin raised above the hardpoint (buried-hub guard)

function sampleContacts(entry: CarEntry, rootCF: CFrame): { contacts: Contact[]; hitCount: number } {
	const preset = entry.preset;
	const up = rootCF.UpVector;
	const rayLen = RAY_LIFT + preset.suspensionRest + preset.wheelRadius;
	const contacts: Contact[] = [];
	let hitCount = 0;
	for (let i = 0; i < 4; i++) {
		const cp = preset.contacts[i];
		const origin = rootCF.PointToWorldSpace(cp.local).add(up.mul(RAY_LIFT));
		const result = game.Workspace.Raycast(origin, up.mul(-rayLen), rayParams);
		if (result && result.Normal.Dot(up) > 0.15) {
			const d = result.Distance - RAY_LIFT; // hardpoint → ground
			const x = math.clamp(preset.suspensionRest + preset.wheelRadius - d, 0, preset.suspensionRest);
			contacts.push({
				index: i,
				steers: cp.steers,
				hit: true,
				point: result.Position,
				normal: result.Normal,
				compression: preset.suspensionRest > 0 ? x / preset.suspensionRest : 0,
			});
			hitCount += 1;
		} else {
			contacts.push({
				index: i,
				steers: cp.steers,
				hit: false,
				point: origin,
				normal: WORLD_UP,
				compression: 0,
			});
		}
	}
	return { contacts, hitCount };
}

/** Chassis-center probe: slope-hug alignment + propulsion fallback when the
 * corner rays miss but the belly is hugging the ground. */
function closeGroundProbe(entry: CarEntry, rootCF: CFrame): RaycastResult | undefined {
	const preset = entry.preset;
	const range = preset.suspensionRest + preset.wheelRadius + preset.boxSize.Y;
	return game.Workspace.Raycast(rootCF.Position, rootCF.UpVector.mul(-range), rayParams);
}

// ---- angular helpers ------------------------------------------------------

/** Accumulate a budgeted angular-velocity servo about world axis `axis`. */
function addAxisServo(entry: CarEntry, w: Vector3, axis: Vector3, targetRate: number, accel: number, dt: number) {
	const current = w.add(entry.dw).Dot(axis);
	entry.dw = entry.dw.add(axis.mul(servoDeltaOmega(current, targetRate, accel, dt)));
}

/** Budgeted "align car up-axis to targetUp" servo (yaw-free). */
function addUprightServo(entry: CarEntry, rootCF: CFrame, w: Vector3, targetUp: Vector3, accel: number, dt: number) {
	const up = rootCF.UpVector;
	const cross = up.Cross(targetUp);
	const crossMag = cross.Magnitude;
	if (crossMag < 1e-4) {
		// Aligned or exactly inverted; inverted gets a nudge about forward.
		if (up.Dot(targetUp) < 0) {
			addAxisServo(entry, w, rootCF.LookVector, 4, accel, dt);
		}
		return;
	}
	const axis = cross.div(crossMag);
	const angle = math.asin(math.clamp(crossMag, 0, 1));
	const fullAngle = up.Dot(targetUp) >= 0 ? angle : math.pi - angle;
	// Critically-damped-ish rate command: proportional to error, capped.
	const targetRate = math.clamp(fullAngle * 8, 0, 12);
	const current = w.add(entry.dw).Dot(axis);
	entry.dw = entry.dw.add(axis.mul(servoDeltaOmega(current, targetRate, accel, dt)));
	// Damp rotation about the two non-yaw axes perpendicular to the error to
	// stop overshoot oscillation.
	const damp = w.add(entry.dw).sub(axis.mul(w.add(entry.dw).Dot(axis)));
	const dampY = damp.sub(WORLD_UP.mul(damp.Dot(WORLD_UP)));
	entry.dw = entry.dw.sub(dampY.mul(math.clamp(accel * dt * 0.15, 0, 1)));
}

// ---- the step -------------------------------------------------------------

function stepCar(entry: CarEntry, dt: number) {
	const root = entry.root;
	const preset = entry.preset;
	const gravity = game.Workspace.Gravity;

	// ---- server pending ops (legal attribute-write context) ----
	if (IS_SERVER) {
		if (entry.pendingDriving !== undefined) {
			const driving = entry.pendingDriving;
			entry.pendingDriving = undefined;
			root.SetAttribute(CarAttr.Driving, driving);
			if (driving) {
				// Fresh drive: never inherit stale input/ability state.
				root.SetAttribute(CarAttr.Throttle, 0);
				root.SetAttribute(CarAttr.Steer, 0);
				root.SetAttribute(CarAttr.DriftHeld, false);
				root.SetAttribute(CarAttr.BoostHeld, false);
				root.SetAttribute(CarAttr.PrevJump, false);
				root.SetAttribute(CarAttr.PrevBoost, false);
			}
		}
		if (entry.pendingInputLock !== undefined) {
			const locked = entry.pendingInputLock;
			entry.pendingInputLock = undefined;
			// true/REMOVED (never false) — predicted attribute payload cap.
			root.SetAttribute(CarAttr.InputLocked, locked ? true : undefined);
		}
		if (entry.pendingScripted !== undefined) {
			const scripted = entry.pendingScripted;
			entry.pendingScripted = undefined;
			root.SetAttribute(CarAttr.ScriptedInput, scripted ? true : undefined);
		}
		if (entry.pendingTeleport) {
			entry.pendingTeleport = undefined;
			root.SetAttribute(CarAttr.TeleportGen, attrNumber(root, CarAttr.TeleportGen, 0) + 1);
		}
		if (entry.pendingShowcase) {
			const lock = entry.pendingShowcase;
			entry.pendingShowcase = undefined;
			root.SetAttribute(CarAttr.ShowcaseLockActive, lock.position !== undefined ? true : undefined);
			if (lock.position !== undefined) {
				root.SetAttribute(CarAttr.ShowcaseLockPos, lock.position);
			}
		}
		if (entry.pendingThrottleSteer) {
			const ts = entry.pendingThrottleSteer;
			entry.pendingThrottleSteer = undefined;
			root.SetAttribute(CarAttr.Throttle, ts.throttle);
			root.SetAttribute(CarAttr.Steer, ts.steer);
		}
		if (entry.pendingDriftHeld !== undefined) {
			root.SetAttribute(CarAttr.DriftHeld, entry.pendingDriftHeld);
			entry.pendingDriftHeld = undefined;
		}
		if (entry.pendingBoostHeld !== undefined) {
			root.SetAttribute(CarAttr.BoostHeld, entry.pendingBoostHeld);
			root.SetAttribute(CarAttr.PrevBoost, entry.pendingBoostHeld);
			entry.pendingBoostHeld = undefined;
		}
		if (entry.pendingBoostGrant !== undefined) {
			const grant = entry.pendingBoostGrant;
			entry.pendingBoostGrant = undefined;
			root.SetAttribute(
				CarAttr.BoostAmount,
				math.clamp(attrNumber(root, CarAttr.BoostAmount, 0) + grant, 0, preset.boostMax),
			);
		}
	}

	// ---- clock ----
	const now = attrNumber(root, CarAttr.SimTime, 0) + dt;
	root.SetAttribute(CarAttr.SimTime, now);

	if (!IS_SERVER) {
		const prevMax = diagMaxSimTime.get(root);
		if (prevMax !== undefined && now < prevMax - 1e-4) {
			diagResimTicks += 1;
		}
		if (prevMax === undefined || now > prevMax) {
			diagMaxSimTime.set(root, now);
		}
	}

	// ---- external blast (server queues; consumed here, inside the step) ----
	if (IS_SERVER && entry.pendingBlast) {
		const blast = entry.pendingBlast;
		entry.pendingBlast = undefined;
		entry.dv = entry.dv.add(blast);
		root.SetAttribute(CarAttr.BlastGen, attrNumber(root, CarAttr.BlastGen, 0) + 1);
		root.SetAttribute(CarAttr.BlastHoldUntil, now + preset.blastControlHoldoff);
	}

	// ---- physics state ----
	const rootCF = root.CFrame;
	const v = root.AssemblyLinearVelocity;
	const w = root.AssemblyAngularVelocity;
	const com = rootCF.Position; // uniform box: COM = part center
	const rot = rootCF.Rotation;
	const look = rootCF.LookVector;
	const mass = preset.mass;
	const massShare = mass / 4;

	const localVel = rootCF.VectorToObjectSpace(root.GetVelocityAtPosition(rootCF.Position));
	entry.velocity = -localVel.Z; // forward speed (forward = -Z)
	entry.propVelocity = math.abs(entry.velocity) / preset.topSpeed;

	// ---- input ----
	const driving = attrBool(root, CarAttr.Driving);
	const input = driving ? sampleInput(entry) : ZERO_INPUT;

	// Input mirror + edges (attributes so a resim replays identical edges).
	root.SetAttribute(CarAttr.Throttle, input.throttle);
	root.SetAttribute(CarAttr.Steer, input.steer);
	root.SetAttribute(CarAttr.DriftHeld, input.drift);

	const prevBoost = attrBool(root, CarAttr.PrevBoost);
	if (input.boost !== prevBoost) {
		root.SetAttribute(CarAttr.PrevBoost, input.boost);
		root.SetAttribute(CarAttr.BoostHeld, input.boost);
	}
	const prevJump = attrBool(root, CarAttr.PrevJump);
	const jumpPressed = input.jump && !prevJump;
	root.SetAttribute(CarAttr.PrevJump, input.jump);

	// Server pending single-shot ops that need `now`.
	let wantJump = jumpPressed;
	if (IS_SERVER && entry.pendingJump) {
		entry.pendingJump = undefined;
		wantJump = true;
	}
	let wantFlip = false;
	if (IS_SERVER && entry.pendingFlip) {
		entry.pendingFlip = undefined;
		wantFlip = true;
	}

	// ---- contacts ----
	ensureRayFilter();
	const { contacts, hitCount } = sampleContacts(entry, rootCF);
	const closeGround = closeGroundProbe(entry, rootCF);
	const wheelsGrounded = hitCount >= 2;
	const grounded = wheelsGrounded || closeGround !== undefined;
	if (wheelsGrounded) {
		root.SetAttribute(CarAttr.LastGrounded, now);
	}
	const inCoyote = now - attrNumber(root, CarAttr.LastGrounded, -1000) <= preset.coyoteTime;

	// Cosmetic contact mirror for the render rig (never read by sim code).
	for (const c of contacts) {
		entry.renderCompression[c.index] = c.hit ? c.compression : 0;
	}
	entry.renderGrounded = wheelsGrounded;

	// Average contact normal (ground frame for tire math).
	let groundNormal = WORLD_UP;
	if (wheelsGrounded) {
		let sum = new Vector3();
		for (const c of contacts) {
			if (c.hit) {
				sum = sum.add(c.normal);
			}
		}
		groundNormal = sum.Magnitude > 1e-4 ? sum.Unit : WORLD_UP;
	} else if (closeGround) {
		groundNormal = closeGround.Normal;
	}

	// ---- suspension ----
	for (const c of contacts) {
		if (!c.hit) {
			continue;
		}
		const pointVel = root.GetVelocityAtPosition(c.point);
		const nVel = pointVel.Dot(c.normal);
		const j = suspensionImpulse({
			compression: c.compression,
			normalVelocity: nVel,
			restLength: preset.suspensionRest,
			omega: preset.suspensionOmega,
			zeta: preset.suspensionZeta,
			massShare,
			dt,
			maxDvScale: preset.suspensionMaxDvScale,
		});
		if (j > 0) {
			const res = impulseAtPoint(
				c.normal.mul(j),
				c.point,
				com,
				rot,
				mass,
				entry.inertiaDiag,
				preset.suspensionTorqueArmScale,
			);
			entry.dv = entry.dv.add(res.dv);
			entry.dw = entry.dw.add(res.dw);
		}
	}

	// ---- drift state (hysteresis) ----
	const driftHeld = input.drift;
	const wasDrifting = attrBool(root, CarAttr.DriftEngaged);
	let drifting = false;
	if (driftHeld && wheelsGrounded && entry.propVelocity >= preset.driftMinPropVel) {
		drifting = true;
	} else if (wasDrifting && driftHeld && wheelsGrounded && entry.propVelocity >= preset.driftMinPropVel * 0.7) {
		drifting = true; // regrip hysteresis: slides survive briefly below the engage speed
	}
	if (drifting !== wasDrifting) {
		root.SetAttribute(CarAttr.DriftEngaged, drifting);
	}

	// ---- boost meter ----
	const boostHeld = attrBool(root, CarAttr.BoostHeld);
	let boostAmount = attrNumber(root, CarAttr.BoostAmount, 0);
	let boosting = false;
	if (boostHeld && driving) {
		if (boostAmount > 0) {
			boosting = true;
			boostAmount = math.max(0, boostAmount - preset.boostDrainPerSecond * dt);
			root.SetAttribute(CarAttr.BoostAmount, boostAmount);
		}
		if (boostAmount <= 0) {
			root.SetAttribute(CarAttr.BoostHeld, false);
		}
	}

	// ---- drive (longitudinal) ----
	const blastHold = now < attrNumber(root, CarAttr.BlastHoldUntil, 0);
	const throttle = input.throttle;
	let targetSpeed = throttle * preset.topSpeed;
	let accelBudget = preset.driveAccel;

	if (throttle > 0) {
		if (entry.velocity >= 0) {
			accelBudget *= gearMultiplier(preset.gearCurve, entry.propVelocity);
		} else {
			accelBudget *= preset.brakeAccelMult; // braking out of reverse
		}
		if (look.Y > 0.1 && look.Y < math.sin(math.rad(50))) {
			accelBudget += gravity * look.Y; // uphill assist
		}
	} else if (throttle < 0) {
		if (entry.velocity <= 0) {
			targetSpeed = throttle * preset.topSpeed * preset.reverseSpeedFrac;
			accelBudget *= 0.6;
		} else {
			targetSpeed = throttle * preset.topSpeed * 0.1;
			accelBudget *= preset.brakeAccelMult; // braking from forward motion
		}
		if (look.Y < -0.1 && look.Y > -math.sin(math.rad(50))) {
			accelBudget -= gravity * look.Y; // downhill reverse assist
		}
	} else {
		accelBudget = 0;
	}

	if (drifting) {
		accelBudget *= preset.driftEngineMult;
	}

	if (boosting) {
		accelBudget = preset.driveAccel * (grounded ? preset.boostAccelMult : preset.boostAirAccelMult);
		accelBudget += gravity * look.Y; // legacy gravity compensation along look
		targetSpeed = preset.topSpeed * preset.boostTargetMult * (throttle < 0 ? -1 : 1);
	} else if (entry.propVelocity > 1 && !blastHold) {
		// Overspeed bleed toward the non-boost cap — suppressed after a blast
		// so external launches survive normal control (gate G-8).
		targetSpeed = math.clamp(targetSpeed, -preset.topSpeed, preset.topSpeed);
		accelBudget = preset.driveAccel * (grounded ? preset.overspeedBrakeMult : 1);
	}

	// Desired forward accel (servo toward target speed, budgeted).
	let driveAccelWanted = 0;
	if (accelBudget > 0 && (grounded || boosting)) {
		const speedErr = targetSpeed - entry.velocity;
		const maxDv = accelBudget * dt;
		driveAccelWanted = math.clamp(speedErr / dt, -accelBudget, accelBudget);
		// Airborne boost pushes along the car's look axis directly.
		if (!grounded && boosting) {
			const dir = throttle < 0 ? look.mul(-1) : look;
			entry.dv = entry.dv.add(dir.mul(math.min(math.abs(driveAccelWanted), accelBudget) * dt));
			driveAccelWanted = 0;
		}
		void maxDv;
	}

	// ---- tires (grounded contact response) ----
	if (wheelsGrounded || (grounded && closeGround !== undefined)) {
		// Ground-plane basis.
		const fwdOnPlane = look.sub(groundNormal.mul(look.Dot(groundNormal)));
		const fwd = fwdOnPlane.Magnitude > 1e-4 ? fwdOnPlane.Unit : look;
		const lateralGrip = (drifting ? preset.driftGripMult : 1) * preset.lateralGripAccel;
		const activeContacts = wheelsGrounded ? hitCount : 1;
		for (const c of contacts) {
			if (wheelsGrounded && !c.hit) {
				continue;
			}
			if (!wheelsGrounded && c.index !== 0) {
				continue; // belly fallback: single virtual contact at the center
			}
			const point = wheelsGrounded ? c.point : closeGround!.Position;
			const normal = wheelsGrounded ? c.normal : closeGround!.Normal;
			const pointVel = root.GetVelocityAtPosition(point);
			const planarVel = pointVel.sub(normal.mul(pointVel.Dot(normal)));
			const lat = normal.Cross(fwd).Unit;
			const res = tireAccel({
				forwardVel: planarVel.Dot(fwd),
				lateralVel: planarVel.Dot(lat),
				driveAccel: driveAccelWanted / activeContacts,
				lateralGripAccel: lateralGrip / activeContacts,
				frictionBudgetAccel: preset.frictionBudgetAccel / activeContacts,
				dt,
			});
			const impulse = fwd.mul(res.forwardAccel).add(lat.mul(res.lateralAccel)).mul(massShare * dt);
			// Tire impulses act at COM height (vertical arm removed): yaw
			// response is preserved through the yaw servo below while the
			// roll-over moment that made the legacy lateral servo unshippable
			// (VehicleSim.ts:82-90) cannot appear by construction.
			const r = point.sub(com);
			const rFlat = r.sub(rootCF.UpVector.mul(r.Dot(rootCF.UpVector)));
			const res2 = impulseAtPoint(impulse, com.add(rFlat), com, rot, mass, entry.inertiaDiag, 1);
			entry.dv = entry.dv.add(res2.dv);
			entry.dw = entry.dw.add(res2.dw);
		}

		// Drift speed scrub (handbrake drag along travel).
		if (drifting) {
			const travelVel = v.sub(groundNormal.mul(v.Dot(groundNormal)));
			entry.dv = entry.dv.sub(travelVel.mul(math.min(preset.driftSpeedScrub * dt, 1)));
			// Centripetal side assist, capped by side-speed.
			const right = rootCF.RightVector;
			const sideVel = localVel.X;
			const maxSide = preset.driftMaxSideFrac * preset.topSpeed;
			const dir = entry.velocity >= 0 ? 1 : -1;
			let sideAccel = input.steer * preset.driftSideAccel * dir;
			if ((sideAccel > 0 && sideVel > maxSide) || (sideAccel < 0 && sideVel < -maxSide)) {
				sideAccel = 0;
			}
			entry.dv = entry.dv.add(right.mul(sideAccel * dt));
		}
	}

	// ---- yaw control ----
	if (grounded) {
		const dir = entry.velocity >= 0 ? 1 : -1;
		if (drifting) {
			const rate = -input.steer * preset.driftYawRate * dir * math.min(entry.propVelocity * 2, 1);
			addAxisServo(entry, w, WORLD_UP, rate, preset.driftYawAccel, dt);
		} else if (wheelsGrounded) {
			const kinematicYaw = (math.abs(entry.velocity) / preset.turnRadius) * input.steer * dir;
			const yawAccel = boosting ? preset.boostYawAccel : preset.gripYawAccel;
			addAxisServo(entry, w, WORLD_UP, -kinematicYaw, yawAccel, dt);
		}
	}

	// ---- jump ----
	if (wantJump && driving && now >= attrNumber(root, CarAttr.JumpReadyAt, 0) && (wheelsGrounded || inCoyote)) {
		root.SetAttribute(CarAttr.JumpForceUntil, now + preset.jumpForceTime);
		root.SetAttribute(CarAttr.JumpReadyAt, now + preset.jumpForceTime + preset.jumpDebounce);
		// Launch along the floor normal (side ramps launch laterally), capped
		// tilt; world up when airborne-coyote or the normal is degenerate.
		let launch = WORLD_UP;
		if (wheelsGrounded && groundNormal.Y > 0.05) {
			const maxCos = math.cos(preset.jumpMaxTilt);
			if (groundNormal.Y >= maxCos) {
				launch = groundNormal.Unit;
			} else {
				const horizontal = new Vector3(groundNormal.X, 0, groundNormal.Z);
				if (horizontal.Magnitude > 1e-4) {
					launch = horizontal.Unit.mul(math.sin(preset.jumpMaxTilt)).add(new Vector3(0, maxCos, 0)).Unit;
				}
			}
		}
		root.SetAttribute(CarAttr.JumpLaunchDir, launch);
		root.SetAttribute(CarAttr.JumpStabilizing, true);
		root.SetAttribute(CarAttr.JumpStabilizeStart, now);
	}
	if (now < attrNumber(root, CarAttr.JumpForceUntil, 0)) {
		const launchDir = attrVector3(root, CarAttr.JumpLaunchDir, WORLD_UP);
		entry.dv = entry.dv.add(launchDir.mul(gravity * preset.jumpGravityMult * dt));
	}

	// ---- recovery flip ----
	if (wantFlip && now >= attrNumber(root, CarAttr.FlipReadyAt, 0) && math.abs(entry.velocity) < 5) {
		const orientation = rootCF.UpVector.Dot(WORLD_UP);
		if (orientation < 0.5 && closeGround !== undefined) {
			root.SetAttribute(CarAttr.FlipUntil, now + preset.flipHoldTime);
			root.SetAttribute(CarAttr.FlipReadyAt, now + preset.flipDebounce);
		}
	}
	const flipping = now < attrNumber(root, CarAttr.FlipUntil, 0);
	if (flipping) {
		entry.dv = entry.dv.add(WORLD_UP.mul(math.min(preset.flipLiftAccel, gravity * 1.5) * dt));
		addUprightServo(entry, rootCF, w, WORLD_UP, preset.aerialAccel, dt);
	}

	// ---- aerial / upright ----
	const stabStart = attrNumber(root, CarAttr.JumpStabilizeStart, 0);
	const stabilizing = attrBool(root, CarAttr.JumpStabilizing);
	const lastThrottle = attrNumber(root, ATTR_LAST_THROTTLE, 0);
	const releasedThrottle = attrBool(root, ATTR_RELEASED_THROTTLE);

	if (wheelsGrounded) {
		if (stabilizing && now - stabStart > preset.jumpUprightLandGrace) {
			root.SetAttribute(CarAttr.JumpStabilizing, false);
		}
		if (releasedThrottle) {
			root.SetAttribute(ATTR_RELEASED_THROTTLE, false);
		}
	} else if (closeGround === undefined && !flipping) {
		// Fully airborne.
		if (stabilizing && now - stabStart > preset.jumpUprightMaxTime) {
			root.SetAttribute(CarAttr.JumpStabilizing, false);
		}
		const rollCmd = (input.rollRight ? 1 : 0) - (input.rollLeft ? 1 : 0);
		if (rollCmd !== 0 && stabilizing) {
			root.SetAttribute(CarAttr.JumpStabilizing, false);
		}
		if (attrBool(root, CarAttr.JumpStabilizing)) {
			// Hold the launch attitude (yaw free): up axis toward launch dir.
			addUprightServo(
				entry,
				rootCF,
				w,
				attrVector3(root, CarAttr.JumpLaunchDir, WORLD_UP),
				preset.uprightAccel,
				dt,
			);
		}
		// Aerial rates in the car frame.
		if (rollCmd !== 0) {
			addAxisServo(entry, w, look, rollCmd * preset.aerialRollRate, preset.aerialAccel, dt);
		}
		addAxisServo(entry, w, rootCF.UpVector, -input.steer * preset.aerialYawRate, preset.aerialAccel, dt);
		if (releasedThrottle && throttle !== 0) {
			root.SetAttribute(CarAttr.JumpStabilizing, false);
			addAxisServo(entry, w, rootCF.RightVector, -throttle * preset.aerialPitchRate, preset.aerialAccel, dt);
		}
		if (lastThrottle === 0 && throttle !== 0) {
			root.SetAttribute(ATTR_RELEASED_THROTTLE, true);
		}
	} else if (!flipping) {
		// Close ground (belly hugging / landing approach): slope hug.
		addUprightServo(entry, rootCF, w, groundNormal, preset.uprightAccel, dt);
		if (lastThrottle === 0 && throttle !== 0) {
			root.SetAttribute(ATTR_RELEASED_THROTTLE, true);
		}
	}
	root.SetAttribute(ATTR_LAST_THROTTLE, throttle);

	// ---- showcase pin (X/Z hold; Y + rotation free) ----
	if (attrBool(root, CarAttr.ShowcaseLockActive)) {
		const lockPos = attrVector3(root, CarAttr.ShowcaseLockPos, rootCF.Position);
		const err = new Vector3(lockPos.X - rootCF.Position.X, 0, lockPos.Z - rootCF.Position.Z);
		const velXZ = new Vector3(v.X, 0, v.Z);
		// Critically damped hold, budgeted well above drive force.
		const accel = err.mul(120).sub(velXZ.mul(18));
		const capped = accel.Magnitude > 500 ? accel.Unit.mul(500) : accel;
		entry.dv = entry.dv.add(capped.mul(dt));
	}

	// ---- commit ----
	if (entry.dv.Magnitude > 0 || entry.dw.Magnitude > 0) {
		root.AssemblyLinearVelocity = v.add(entry.dv);
		root.AssemblyAngularVelocity = w.add(entry.dw);
	}
	entry.dv = new Vector3();
	entry.dw = new Vector3();
}

// ---- tick -----------------------------------------------------------------

function tick(dt: number) {
	for (const [model, entry] of registry) {
		if (entry.model.Parent === undefined || entry.root.Parent === undefined) {
			registry.delete(model);
			diagMaxSimTime.delete(entry.root);
			continue;
		}
		// Client predicts only the local player's own car.
		if (!IS_SERVER && entry.owner !== LOCAL_PLAYER) {
			continue;
		}
		const [ok, err] = pcall(() => stepCar(entry, dt));
		if (!ok) {
			const clock = os.clock();
			if (entry.lastErrorWarnAt === undefined || clock - entry.lastErrorWarnAt > ERROR_WARN_INTERVAL) {
				entry.lastErrorWarnAt = clock;
				warn(`[CarSim] ${model.Name}: ${err}`);
			}
		}
	}
}

// ---- lifecycle ------------------------------------------------------------

let initialized = false;

export function initialize() {
	if (initialized) {
		return;
	}
	initialized = true;
	const bytes = assertSchemaBudget();
	registerSimHook("CarSim", SIM_ORDER_VEHICLE, (deltaTime) => tick(deltaTime));
	print(`[CarSim] ${IS_SERVER ? "server" : "client"} registered (schema estimate ${bytes}B)`);
}
