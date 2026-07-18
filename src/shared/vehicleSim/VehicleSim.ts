// Shared vehicle simulation core (SERVER_AUTHORITY_PLAN.md Phase 2).
//
// Owns everything that determines the car's MOTION: the drive tick, drift,
// jump, aerial controls, flip, Ackermann steering and the ground raycasts —
// ported verbatim from the server VehicleClass drive loop (a5318d46 lineage).
// The math must not change here without a /feel harness parity check.
//
// Phase 2: initialized on the SERVER only (initVehicleSim.server.ts), ticked
// on Heartbeat — the same cadence as the old per-vehicle while-loops.
// Phase 4: this same module additionally gets initialized on the client under
// RunService:BindToSimulation() so the local car can be predicted.
//
// Rules for code in this module:
//   - no server-only imports (DataStore, economy, ServerStorage, ...)
//   - no sounds, no GUI, no particles — rendering happens in
//     client/vehicleRenderer.client.ts from the attributes written here
//   - no task.wait/task.delay — every timer is sim-time state
//
// State split: anything gameplay/rendering reads lives in ATTRIBUTES on the
// Base (see VehicleAttr). Per-tick micro-state (lastThrottle, stabilize
// timers, flip target, ...) lives on the registry entry for now and moves to
// attributes in Phase 4, when rollback needs to snapshot it.

const RunService = game.GetService("RunService");
const Players = game.GetService("Players");

const IS_SERVER = RunService.IsServer();
// On the client, only the local player's own car is stepped (predicted);
// remote cars render authoritative server state (Phase 5 may extrapolate
// them from the replicated input attributes).
const LOCAL_PLAYER = IS_SERVER ? undefined : Players.LocalPlayer;

// ---- feel tuning knobs (a5318d46 baseline: 1.0 / 3 / 3 / 1.6 / uncapped / 0.01) ----
const DRIVE_FORCE_MULT = 1.25; // overall engine force, forward and reverse
const BOOST_FORCE_MULT = 3; // boost punch on the ground (baseline 3)
const BOOST_AIR_FORCE_MULT = 4.5; // boost authority in the air — nose-up boosting sustains airtime
const BOOST_TARGET_MULT = 1.6; // boost top speed as a fraction of targetVelocity
// Drift = powerslide (Rocket League style): wheels lose lateral grip so momentum
// keeps traveling while the body rotates, a yaw mover turns the nose into the
// corner faster than grip steering could, and a small side thrust keeps the
// slide cornering instead of washing wide. Releasing Space restores grip and
// the forward drive bites along the new facing.
const DRIFT_MAX_SIDE_SPEED = 0.45; // cap on sideways drift speed (× targetVelocity); uncapped it outran boost
const DRIFT_MIN_PROP_VEL = 0.15; // below this fraction of top speed drift disengages (no stationary launches)
const DRIFT_SIDE_FORCE_FWD = 20; // centripetal assist per unit mass while drifting forward
const DRIFT_SIDE_FORCE_REV = 15; // centripetal assist per unit mass while drifting in reverse
const DRIFT_YAW_RATE = 3; // rad/s of commanded yaw at full steer and full speed (grip turning peaks ~2.5)
const DRIFT_YAW_TORQUE = 60; // yaw authority per unit total mass — how hard the slide rotation is enforced
// Wheel grip defaults (per-vehicle tunable). Normal grip raised 0.75 → 1.2:
// cars were skidding out of grip turns at speed.
const DRIVE_WHEEL_FRICTION = 1.2;
const DRIFT_WHEEL_FRICTION = 0.15; // wheel friction while sliding; normal grip is restored on release
const JUMP_FORCE_TIME = 0.18; // seconds the jump force stays on (default; per-vehicle tunable)
const JUMP_FORCE_GRAVITY_MULT = 4; // jump force as a multiple of gravity; net upward accel = (mult - 1) × g (default; per-vehicle tunable)
const JUMP_DEBOUNCE_TIME = 2; // seconds after the force window before the next jump is allowed
const JUMP_UPRIGHT_MAX_TIME = 2; // seconds the post-jump upright hold may last
const JUMP_UPRIGHT_LAND_GRACE = 0.3; // grounded frames within this window after takeoff don't clear the hold
const FLIP_HOLD_TIME = 1; // seconds the flip lift + righting hold stays on
const FLIP_DEBOUNCE_TIME = 3; // seconds from flip start until the next flip is allowed (old wait(1)+wait(2))
const BOOST_TICK_INTERVAL = 0.2; // boost meter cadence
const BOOST_REGEN_DELAY = 3; // seconds after boost release (or depletion) before regen resumes
const AERIAL_TORQUE_PER_MASS = 378; // aerial control authority per unit total mass

// ---- modern-constraint servo tuning (replaces BodyGyro/BodyPosition P/D gains) ----
const UPRIGHT_RESPONSIVENESS = 20; // slope hug + post-jump upright hold
const FLIP_RESPONSIVENESS = 15; // flip righting rotation
const FLIP_LIFT_RESPONSIVENESS = 15; // flip vertical lift (old BodyPosition P/D)

// ---- gears (percentage of max speed) ----
const GEAR_LIMITS = [0.4, 0.7, 1];
const GEAR_TORQUES = [0.8, 0.55, 0.3];

// Engine sound curve — consumed by the client renderer, kept next to the gear
// data it mirrors.
export const ENGINE_SOUND = {
	gearLimits: GEAR_LIMITS,
	playbackSpeeds: [1.3, 1.7, 2.3],
	gearSpeedDrop: 0.6,
};

// ---- Instance shape types (structural; the models live in the place file) ----

export interface VehicleWheel extends Model {
	WheelMount: BasePart & { SpringConstraint: SpringConstraint };
	turn: BasePart & {
		trail: Attachment;
		trail2: Attachment;
		HingeConstraint: HingeConstraint;
	};
	Wheel: BasePart;
	DisplayWheel: BasePart;
}

export interface VehicleBase extends BasePart {
	IdleSound: Sound;
	hornSound: Sound;
	driftSound: Sound;
	jumpSound: Sound;
	LinearVelocity: LinearVelocity;
	slopeCounterVelocity: LinearVelocity;
	DriftThrust: VectorForce;
	HealthBar: BillboardGui & { Green: Frame; PlayerTag: TextLabel };
}

export interface VehicleModel extends Model {
	Base: VehicleBase;
	Model: Model;
	Wheels: Folder & Record<"FL" | "FR" | "BL" | "BR", VehicleWheel>;
	Seats: Folder & { VehicleSeat: VehicleSeat };
	Hitboxes: Folder & { damageBlock: BasePart };
	BoostEffectPart: BasePart & {
		Attachment: Attachment;
		Attachment2: Attachment;
		ParticleEmitter: ParticleEmitter;
		Trail: Trail;
		boostSound: Sound;
	};
}

export interface VehicleTuning {
	mass: number;
	acceleration: number;
	targetVelocity: number;
	minTurnRadius: number;
	maxTurnRadius: number;
	maxAngularSpeed: number;
	minAngularSpeed: number;
	boostAmount: number;
	driftingMult: number;
	// Optional (tuning-HUD era): subclasses don't set these, so registration
	// falls back to the module defaults above.
	driveWheelFriction?: number;
	driftWheelFriction?: number;
	jumpForceTime?: number;
	jumpGravityMult?: number;
}

// ---- synchronized state: attributes on the vehicle Base ----

export const VehicleAttr = {
	Throttle: "Throttle",
	Steer: "Steer",
	Driving: "Driving",
	DriftHeld: "DriftHeld",
	DriftEngaged: "DriftEngaged",
	BoostHeld: "BoostHeld",
	BoostAmount: "BoostAmount",
	BoostBlockedUntil: "BoostBlockedUntil",
	JumpForceUntil: "JumpForceUntil",
	JumpReadyAt: "JumpReadyAt",
	TargetVelocity: "TargetVelocity",
	ScriptedInput: "ScriptedInput", // FeelHarness: both peers skip IAS reads while set
	// Rollback-safe sim state (Phase 4). EVERY value the sim carries across
	// ticks lives in an attribute on the predicted Base: a rollback restores
	// attributes to the server snapshot before resimulating, and any
	// client/server mismatch in one of them is what TRIGGERS a rollback in the
	// first place. Plain Lua fields neither roll back nor compare. All times
	// are SIM time (SimTime, advanced by the fixed simulation deltaTime while
	// driving) — wall-clock time() differs between peers, so a time()-stamped
	// attribute could never match and would force a rollback every frame.
	SimTime: "SimTime",
	LastThrottle: "LastThrottle",
	ReleasedThrottle: "ReleasedThrottle",
	JumpStabilizing: "JumpStabilizing",
	JumpStabilizeStart: "JumpStabilizeStart",
	BoostLastInc: "BoostLastInc",
	FlipActive: "FlipActive",
	FlipUntil: "FlipUntil",
	FlipReadyAt: "FlipReadyAt",
	FlipTarget: "FlipTarget", // CFrame
	FlipLiftPos: "FlipLiftPos", // Vector3
	PrevBoostHeld: "PrevBoostHeld",
	PrevJumpHeld: "PrevJumpHeld",
	PrevRollLeft: "PrevRollLeft",
	PrevRollRight: "PrevRollRight",
} as const;

// Tuning attributes written at server registration so the client sim can
// rebuild the same tuning from the replicated model (Phase 4).
export const VehicleTuningAttr = {
	Mass: "TuneMass",
	Acceleration: "TuneAcceleration",
	MinTurnRadius: "TuneMinTurnRadius",
	MaxTurnRadius: "TuneMaxTurnRadius",
	MaxAngularSpeed: "TuneMaxAngularSpeed",
	MinAngularSpeed: "TuneMinAngularSpeed",
	BoostAmount: "TuneBoostAmount",
	DriftingMult: "TuneDriftingMult",
	DriveWheelFriction: "TuneDriveWheelFriction",
	DriftWheelFriction: "TuneDriftWheelFriction",
	JumpForceTime: "TuneJumpForceTime",
	JumpGravityMult: "TuneJumpGravityMult",
} as const;

// Attributes on the vehicle MODEL (game state, written by the server
// VehicleClass; the renderer reads them).
export const VehicleModelAttr = {
	Health: "Health",
	MaxHealth: "MaxHealth",
	OwnerUserId: "OwnerUserId",
} as const;

// ---- Input Action System naming (Phase 3) ----
// The per-player InputContext is built server-side (vehicleInputActions.ts)
// and lives under the Player; the sim reads the actions by these names on
// whichever peer it runs on. IAS is the only client-authoritative data the
// rollback system replays, which is why all sim-affecting input goes here.
export const VehicleInput = {
	ContextName: "VehicleControls",
	// One Bool action PER KEY: IAS resolves multiple bindings on one action as
	// "latest binding event wins", so releasing A while D is held zeroed the
	// whole axis. Per-key held-state combined in the sim restores the old
	// (right?1:0)-(left?1:0) semantics: both held cancels, releasing one
	// resumes the other.
	ThrottleForward: "ThrottleForward", // Bool: W
	ThrottleBackward: "ThrottleBackward", // Bool: S
	SteerRight: "SteerRight", // Bool: D
	SteerLeft: "SteerLeft", // Bool: A
	ThrottleAxis: "ThrottleAxis", // Direction1D: gamepad triggers R2 +1 / L2 -1 (analog)
	SteerStick: "SteerStick", // Direction2D: Thumbstick1 (X used, 0.3 deadzone)
	ThrottleTouch: "ThrottleTouch", // Direction1D: fired by the mobile joystick code
	SteerTouch: "SteerTouch", // Direction1D: fired by the mobile joystick code
	Drift: "Drift",
	Boost: "Boost",
	Jump: "Jump",
	RollLeft: "RollLeft",
	RollRight: "RollRight",
	PrimaryBinding: "Primary", // the rebindable keyboard binding
	GamepadBinding: "Gamepad",
	TouchBinding: "Touch", // client assigns UIButton locally on touch devices
} as const;

// ---- registry ----

interface SimEntry {
	model: VehicleModel;
	base: VehicleBase;
	seat?: VehicleSeat;
	tuning: VehicleTuning;
	owner?: Player;
	wheels: VehicleWheel[];
	flHinge: HingeConstraint;
	frHinge: HingeConstraint;
	aerial: AngularVelocity;
	driftYaw: AngularVelocity;
	upright: AlignOrientation;
	flipAlign: AlignOrientation;
	flipLift: AlignPosition;
	jumpThrust: VectorForce;
	driftThrust: VectorForce;
	// Ackermann geometry
	t: number;
	l: number;
	// Bounding box, precomputed at registration: Model.GetBoundingBox() is
	// not allowed inside simulation callbacks, and the model is rigid so the
	// size and the box center's Base-local offset are constant.
	boundingSizeX: number;
	boundingCenterOffset: Vector3;
	// mass cache: recomputed on occupant change instead of every tick
	baseMass: number;
	totalMass: number;
	// Recomputed from physics state at the top of every drive tick — never
	// carried across ticks, so plain fields are rollback-safe here.
	velocity: number;
	propVelocity: number;
	errorLogged: boolean;
	diagTickCounter: number; // diagnostics only — not sim state
	// Server-only pending ops from OUTSIDE the simulation (FeelHarness, the
	// FlipVehicle remote): queued here and consumed INSIDE the next sim step,
	// because attributes on predicted instances may only be written from
	// within BindToSimulation. The client never sets these; it learns of the
	// resulting attribute changes through rollback.
	pendingBoostHeld?: boolean;
	pendingJump?: boolean;
	pendingFlip?: boolean;
	pendingRolls?: Array<{ direction: -1 | 1; begin: boolean }>;
	pendingTuning?: Partial<VehicleTuning>; // tuning HUD edits, applied inside the next sim step
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

const registry = new Map<Model, SimEntry>();

// ---- small helpers ----

const groundRaycastParams = new RaycastParams();
groundRaycastParams.FilterType = Enum.RaycastFilterType.Blacklist;
groundRaycastParams.IgnoreWater = true;

function getMassOfModel(model: Instance): number {
	let totalMass = 0;
	for (const part of model.GetDescendants()) {
		if (part.IsA("BasePart")) {
			totalMass += part.GetMass();
		}
	}
	return totalMass;
}

// Occupant mass via the seats — the second half of the old GetTotalMass().
function occupantsMass(model: Model): number {
	let mass = 0;
	const seats = model.FindFirstChild("Seats");
	if (seats) {
		for (const seat of seats.GetChildren()) {
			const occupant = (seat as VehicleSeat).Occupant;
			if (occupant && occupant.Parent) {
				mass += getMassOfModel(occupant.Parent);
			}
		}
	}
	return mass;
}

// The old code read Base.Velocity — the velocity at the part, not at the
// assembly's center of mass. GetVelocityAtPosition reproduces that exactly
// (they differ while the car rotates, which feeds propVelocity and the
// drift math).
function baseVelocity(entry: SimEntry): Vector3 {
	return entry.base.GetVelocityAtPosition(entry.base.Position);
}

function attrNumber(instance: Instance, name: string, fallback: number): number {
	const value = instance.GetAttribute(name);
	return typeIs(value, "number") ? value : fallback;
}

function attrBool(instance: Instance, name: string): boolean {
	return instance.GetAttribute(name) === true;
}

function Vector3ComponentSetter(vector: Vector3, axis: string, value: number): Vector3 | undefined {
	if (axis === "X") {
		return new Vector3(value, vector.Y, vector.Z);
	} else if (axis === "Y") {
		return new Vector3(vector.X, value, vector.Z);
	} else if (axis === "Z") {
		return new Vector3(vector.X, vector.Y, value);
	}
	return undefined;
}

function Vector3ComponentChecker(vector: Vector3, axis: string, value: number): boolean {
	if (axis === "X" && vector === new Vector3(value, vector.Y, vector.Z)) {
		return true;
	} else if (axis === "Y" && vector === new Vector3(vector.X, value, vector.Z)) {
		return true;
	} else if (axis === "Z" && vector === new Vector3(vector.X, vector.Y, value)) {
		return true;
	}
	return false;
}

// Builds a rotation whose X axis points along `x`. AlignOrientation in
// PrimaryAxisOnly mode aligns Attachment0's X axis to the CFrame property's
// X axis — with UpAxisAttachment's X lying along the car's up, this expresses
// "make the car's up axis point along n, yaw free".
function cframeFromXAxis(x: Vector3): CFrame {
	const xUnit = x.Unit;
	const helper = math.abs(xUnit.Y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
	const zUnit = xUnit.Cross(helper).Unit;
	const yUnit = zUnit.Cross(xUnit).Unit;
	return CFrame.fromMatrix(new Vector3(0, 0, 0), xUnit, yUnit, zUnit);
}

// ---- movers (modern constraint replacements for the legacy BodyMovers) ----

function createMovers(base: VehicleBase) {
	// Clear ALL legacy BodyMovers (the model's DriftThrust turned out to be a
	// legacy BodyThrust — legacy movers cannot be written inside simulation
	// callbacks) and any hand-added replacement constraints — all
	// configuration lives here so nothing in the model can fight the sim.
	for (const child of base.GetChildren()) {
		if (
			child.IsA("BodyMover") ||
			child.IsA("AngularVelocity") ||
			child.IsA("AlignOrientation") ||
			child.IsA("AlignPosition")
		) {
			child.Destroy();
		}
	}
	const existingJump = base.FindFirstChild("JumpThrust");
	if (existingJump) {
		existingJump.Destroy();
	}

	const centerAttachment = new Instance("Attachment");
	centerAttachment.Name = "MoverAttachment";
	centerAttachment.Parent = base;

	// X axis rotated onto the car's up axis — see cframeFromXAxis.
	const upAxisAttachment = new Instance("Attachment");
	upAxisAttachment.Name = "UpAxisAttachment";
	upAxisAttachment.CFrame = CFrame.Angles(0, 0, math.rad(90));
	upAxisAttachment.Parent = base;

	// Aerial controls (roll/pitch/yaw while airborne), world-relative like the
	// old BodyAngularVelocity. The commanded vector on the instance IS the
	// aerial control state.
	const aerial = new Instance("AngularVelocity");
	aerial.Name = "Aerial";
	aerial.Attachment0 = centerAttachment;
	aerial.RelativeTo = Enum.ActuatorRelativeTo.World;
	aerial.ReactionTorqueEnabled = false;
	aerial.MaxTorque = 0;
	aerial.AngularVelocity = new Vector3(0, 0, 0);
	aerial.Parent = base;

	// Drift yaw mover: commands the slide rotation while wheel grip is reduced.
	const driftYaw = new Instance("AngularVelocity");
	driftYaw.Name = "DriftYaw";
	driftYaw.Attachment0 = centerAttachment;
	driftYaw.RelativeTo = Enum.ActuatorRelativeTo.World;
	driftYaw.ReactionTorqueEnabled = false;
	driftYaw.MaxTorque = 0;
	driftYaw.AngularVelocity = new Vector3(0, 0, 0);
	driftYaw.Parent = base;

	// Roll/pitch servo (yaw free): slope hug + post-jump upright hold.
	const upright = new Instance("AlignOrientation");
	upright.Name = "UprightAlign";
	upright.Mode = Enum.OrientationAlignmentMode.OneAttachment;
	upright.Attachment0 = upAxisAttachment;
	upright.PrimaryAxisOnly = true;
	upright.RigidityEnabled = false;
	upright.MaxTorque = 0;
	upright.MaxAngularVelocity = math.huge;
	upright.Responsiveness = UPRIGHT_RESPONSIVENESS;
	upright.Parent = base;

	// Full-orientation servo for the flip righting hold.
	const flipAlign = new Instance("AlignOrientation");
	flipAlign.Name = "FlipAlign";
	flipAlign.Mode = Enum.OrientationAlignmentMode.OneAttachment;
	flipAlign.Attachment0 = centerAttachment;
	flipAlign.RigidityEnabled = false;
	flipAlign.MaxTorque = 0;
	flipAlign.MaxAngularVelocity = math.huge;
	flipAlign.Responsiveness = FLIP_RESPONSIVENESS;
	flipAlign.Parent = base;

	// Vertical-only lift for the flip (old FlipMover BodyPosition (0,huge,0)).
	const flipLift = new Instance("AlignPosition");
	flipLift.Name = "FlipLift";
	flipLift.Mode = Enum.PositionAlignmentMode.OneAttachment;
	flipLift.Attachment0 = centerAttachment;
	flipLift.ApplyAtCenterOfMass = true;
	flipLift.ForceLimitMode = Enum.ForceLimitMode.PerAxis;
	flipLift.MaxAxesForce = new Vector3(0, 0, 0);
	flipLift.MaxVelocity = math.huge;
	flipLift.Responsiveness = FLIP_LIFT_RESPONSIVENESS;
	flipLift.Parent = base;

	// Torque-free jump force: applied at the center of mass so an off-center
	// vertical push can't flip the car.
	const jumpAttachment = new Instance("Attachment");
	jumpAttachment.Name = "JumpAttachment";
	jumpAttachment.Parent = base;
	const jumpThrust = new Instance("VectorForce");
	jumpThrust.Name = "JumpThrust";
	jumpThrust.Attachment0 = jumpAttachment;
	jumpThrust.ApplyAtCenterOfMass = true;
	jumpThrust.RelativeTo = Enum.ActuatorRelativeTo.World;
	jumpThrust.Force = new Vector3(0, 0, 0);
	jumpThrust.Parent = base;

	// Drift centripetal assist. Replaces the model's legacy BodyThrust of the
	// same name: force in the BASE-LOCAL frame (RelativeTo Attachment0, with
	// the attachment axis-aligned at the Base origin) applied at the origin —
	// BodyThrust's exact semantics.
	const driftThrust = new Instance("VectorForce");
	driftThrust.Name = "DriftThrust";
	driftThrust.Attachment0 = centerAttachment;
	driftThrust.ApplyAtCenterOfMass = false;
	driftThrust.RelativeTo = Enum.ActuatorRelativeTo.Attachment0;
	driftThrust.Force = new Vector3(0, 0, 0);
	driftThrust.Parent = base;

	return { aerial, driftYaw, upright, flipAlign, flipLift, jumpThrust, driftThrust };
}

// ---- registration ----

interface MoverSet {
	aerial: AngularVelocity;
	driftYaw: AngularVelocity;
	upright: AlignOrientation;
	flipAlign: AlignOrientation;
	flipLift: AlignPosition;
	jumpThrust: VectorForce;
	driftThrust: VectorForce;
}

function buildEntry(model: VehicleModel, tuning: VehicleTuning, movers: MoverSet, owner?: Player): SimEntry {
	const wheels = model.Wheels.GetChildren() as VehicleWheel[];
	const fl = model.Wheels.FL.WheelMount;
	const fr = model.Wheels.FR.WheelMount;
	const bl = model.Wheels.BL.WheelMount;
	const [bbCFrame, bbSize] = model.GetBoundingBox();

	const entry: SimEntry = {
		model,
		base: model.Base,
		boundingSizeX: bbSize.X,
		boundingCenterOffset: model.Base.CFrame.PointToObjectSpace(bbCFrame.Position),
		seat: model.Seats.FindFirstChild("VehicleSeat") as VehicleSeat | undefined,
		tuning,
		owner,
		wheels,
		flHinge: model.Wheels.FL.turn.HingeConstraint,
		frHinge: model.Wheels.FR.turn.HingeConstraint,
		aerial: movers.aerial,
		driftYaw: movers.driftYaw,
		upright: movers.upright,
		flipAlign: movers.flipAlign,
		flipLift: movers.flipLift,
		jumpThrust: movers.jumpThrust,
		driftThrust: movers.driftThrust,
		t: fl.Position.sub(fr.Position).Magnitude,
		l: fl.Position.sub(bl.Position).Magnitude,
		baseMass: getMassOfModel(model),
		totalMass: 0,
		velocity: 0,
		propVelocity: 0,
		errorLogged: false,
		diagTickCounter: 0,
	};
	entry.totalMass = entry.baseMass;
	return entry;
}

// Server-side registration: creates the movers, writes tuning + initial
// state attributes, applies wheel friction.
export function register(model: VehicleModel, tuning: VehicleTuning, owner?: Player) {
	const base = model.Base;
	const movers = createMovers(base);
	const entry = buildEntry(model, tuning, movers, owner);

	base.SetAttribute(VehicleAttr.Throttle, 0);
	base.SetAttribute(VehicleAttr.Steer, 0);
	base.SetAttribute(VehicleAttr.Driving, false);
	base.SetAttribute(VehicleAttr.DriftHeld, false);
	base.SetAttribute(VehicleAttr.DriftEngaged, false);
	base.SetAttribute(VehicleAttr.BoostHeld, false);
	base.SetAttribute(VehicleAttr.BoostAmount, tuning.boostAmount);
	base.SetAttribute(VehicleAttr.BoostBlockedUntil, 0);
	base.SetAttribute(VehicleAttr.JumpForceUntil, 0);
	base.SetAttribute(VehicleAttr.JumpReadyAt, 0);
	base.SetAttribute(VehicleAttr.TargetVelocity, tuning.targetVelocity);
	base.SetAttribute(VehicleAttr.ScriptedInput, false);
	base.SetAttribute(VehicleAttr.SimTime, 0);
	base.SetAttribute(VehicleAttr.LastThrottle, 0);
	base.SetAttribute(VehicleAttr.ReleasedThrottle, false);
	base.SetAttribute(VehicleAttr.JumpStabilizing, false);
	base.SetAttribute(VehicleAttr.JumpStabilizeStart, 0);
	base.SetAttribute(VehicleAttr.BoostLastInc, 0);
	base.SetAttribute(VehicleAttr.FlipActive, false);
	base.SetAttribute(VehicleAttr.FlipUntil, 0);
	base.SetAttribute(VehicleAttr.FlipReadyAt, 0);
	base.SetAttribute(VehicleAttr.PrevBoostHeld, false);
	base.SetAttribute(VehicleAttr.PrevJumpHeld, false);
	base.SetAttribute(VehicleAttr.PrevRollLeft, false);
	base.SetAttribute(VehicleAttr.PrevRollRight, false);
	base.SetAttribute(VehicleTuningAttr.Mass, tuning.mass);
	base.SetAttribute(VehicleTuningAttr.Acceleration, tuning.acceleration);
	base.SetAttribute(VehicleTuningAttr.MinTurnRadius, tuning.minTurnRadius);
	base.SetAttribute(VehicleTuningAttr.MaxTurnRadius, tuning.maxTurnRadius);
	base.SetAttribute(VehicleTuningAttr.MaxAngularSpeed, tuning.maxAngularSpeed);
	base.SetAttribute(VehicleTuningAttr.MinAngularSpeed, tuning.minAngularSpeed);
	base.SetAttribute(VehicleTuningAttr.BoostAmount, tuning.boostAmount);
	base.SetAttribute(VehicleTuningAttr.DriftingMult, tuning.driftingMult);
	base.SetAttribute(VehicleTuningAttr.DriveWheelFriction, tuning.driveWheelFriction ?? DRIVE_WHEEL_FRICTION);
	base.SetAttribute(VehicleTuningAttr.DriftWheelFriction, tuning.driftWheelFriction ?? DRIFT_WHEEL_FRICTION);
	base.SetAttribute(VehicleTuningAttr.JumpForceTime, tuning.jumpForceTime ?? JUMP_FORCE_TIME);
	base.SetAttribute(VehicleTuningAttr.JumpGravityMult, tuning.jumpGravityMult ?? JUMP_FORCE_GRAVITY_MULT);
	model.SetAttribute(VehicleModelAttr.OwnerUserId, owner ? owner.UserId : 0);

	setWheelFriction(entry, false);

	registry.set(model, entry);
}

// Client-side registration (Phase 4): adopts the replicated movers and
// rebuilds the tuning from attributes. Never writes state — the server owns
// initial state; the client sim only writes attributes while predicting.
// Returns false while the replica is still incomplete (caller retries).
export function registerReplica(model: VehicleModel, owner: Player): boolean {
	if (registry.has(model)) {
		return true;
	}
	const base = model.FindFirstChild("Base") as VehicleBase | undefined;
	if (!base || !model.FindFirstChild("Wheels") || !model.FindFirstChild("Seats")) {
		return false;
	}
	const findMover = <T extends Instance>(name: string) => base.FindFirstChild(name) as T | undefined;
	const aerial = findMover<AngularVelocity>("Aerial");
	const driftYaw = findMover<AngularVelocity>("DriftYaw");
	const upright = findMover<AlignOrientation>("UprightAlign");
	const flipAlign = findMover<AlignOrientation>("FlipAlign");
	const flipLift = findMover<AlignPosition>("FlipLift");
	const jumpThrust = findMover<VectorForce>("JumpThrust");
	const driftThrust = findMover<VectorForce>("DriftThrust");
	if (!aerial || !driftYaw || !upright || !flipAlign || !flipLift || !jumpThrust || !driftThrust) {
		return false;
	}
	if (!driftThrust.IsA("VectorForce")) {
		// Still the model's legacy BodyThrust — the server-created replacement
		// hasn't replicated yet.
		return false;
	}
	const targetVelocity = attrNumber(base, VehicleAttr.TargetVelocity, 0);
	const mass = attrNumber(base, VehicleTuningAttr.Mass, 0);
	if (targetVelocity === 0 || mass === 0) {
		return false; // tuning attributes not replicated yet
	}
	const tuning: VehicleTuning = {
		mass,
		acceleration: attrNumber(base, VehicleTuningAttr.Acceleration, 0),
		targetVelocity,
		minTurnRadius: attrNumber(base, VehicleTuningAttr.MinTurnRadius, 30),
		maxTurnRadius: attrNumber(base, VehicleTuningAttr.MaxTurnRadius, 60),
		maxAngularSpeed: attrNumber(base, VehicleTuningAttr.MaxAngularSpeed, math.pi),
		minAngularSpeed: attrNumber(base, VehicleTuningAttr.MinAngularSpeed, 0.6),
		boostAmount: attrNumber(base, VehicleTuningAttr.BoostAmount, 100),
		driftingMult: attrNumber(base, VehicleTuningAttr.DriftingMult, 1),
		driveWheelFriction: attrNumber(base, VehicleTuningAttr.DriveWheelFriction, DRIVE_WHEEL_FRICTION),
		driftWheelFriction: attrNumber(base, VehicleTuningAttr.DriftWheelFriction, DRIFT_WHEEL_FRICTION),
		jumpForceTime: attrNumber(base, VehicleTuningAttr.JumpForceTime, JUMP_FORCE_TIME),
		jumpGravityMult: attrNumber(base, VehicleTuningAttr.JumpGravityMult, JUMP_FORCE_GRAVITY_MULT),
	};
	const [ok, err] = pcall(() => {
		const movers: MoverSet = { aerial, driftYaw, upright, flipAlign, flipLift, jumpThrust, driftThrust };
		registry.set(model, buildEntry(model, tuning, movers, owner));
	});
	if (!ok) {
		warn(`[VehicleSim] registerReplica(${model.Name}) failed: ${err}`);
		return false;
	}
	return true;
}

export function unregister(model: Model) {
	const entry = registry.get(model);
	if (entry) {
		registry.delete(model);
		pcall(() => {
			entry.base.SetAttribute(VehicleAttr.Driving, false);
			setOwnerContextEnabled(entry, false);
		});
	}
}

// ---- input & ability entry points (called by the server VehicleClass; in
// Phase 4 the client sim reads the same attributes) ----

export function setThrottleSteer(model: Model, throttle: number, steer: number) {
	const entry = registry.get(model);
	if (!entry) {
		return;
	}
	// NaN guard (NaN ~= NaN) — a NaN float would poison every force computation.
	if (throttle !== throttle || steer !== steer) {
		return;
	}
	entry.base.SetAttribute(VehicleAttr.Throttle, math.clamp(throttle, -1, 1));
	entry.base.SetAttribute(VehicleAttr.Steer, math.clamp(steer, -1, 1));
}

export function setDriftHeld(model: Model, held: boolean) {
	const entry = registry.get(model);
	if (entry) {
		entry.base.SetAttribute(VehicleAttr.DriftHeld, held);
	}
}

function applyBoostHeld(entry: SimEntry, held: boolean, now: number) {
	entry.base.SetAttribute(VehicleAttr.BoostHeld, held);
	if (!held) {
		// Releasing (or depleting) boost blocks regen for a spell — the old
		// boostDelay + task.delay(3).
		entry.base.SetAttribute(VehicleAttr.BoostBlockedUntil, now + BOOST_REGEN_DELAY);
	}
}

export function setBoostHeld(model: Model, held: boolean) {
	const entry = registry.get(model);
	if (entry) {
		entry.pendingBoostHeld = held; // consumed inside the next sim step
	}
}

function tryJump(entry: SimEntry, now: number) {
	if (now >= attrNumber(entry.base, VehicleAttr.JumpReadyAt, 0)) {
		const forceTime = entry.tuning.jumpForceTime ?? JUMP_FORCE_TIME;
		entry.base.SetAttribute(VehicleAttr.JumpForceUntil, now + forceTime);
		entry.base.SetAttribute(VehicleAttr.JumpReadyAt, now + forceTime + JUMP_DEBOUNCE_TIME);
		// Arm the post-jump upright hold.
		entry.base.SetAttribute(VehicleAttr.JumpStabilizing, true);
		entry.base.SetAttribute(VehicleAttr.JumpStabilizeStart, now);
	}
}

export function requestJump(model: Model) {
	const entry = registry.get(model);
	if (entry) {
		entry.pendingJump = true; // consumed inside the next sim step (drive-gated there)
	}
}

// FeelHarness override: while set, the sim does not read the owner's
// InputActions, so scripted attribute writes stay in force. Stored as an
// attribute so the client's predicted sim honors it too.
export function setScriptedInput(model: Model, scripted: boolean) {
	const entry = registry.get(model);
	if (entry) {
		entry.base.SetAttribute(VehicleAttr.ScriptedInput, scripted);
	}
}

export function requestFlip(model: Model) {
	const entry = registry.get(model);
	if (entry) {
		entry.pendingFlip = true; // eligibility checked inside the next sim step
	}
}

// Tuning HUD (server only): queue tuning edits for the player's registered
// vehicle. Applied inside the next sim step — attributes on predicted
// instances may only be written from within BindToSimulation — and picked up
// by both sims through the per-tick refreshTuning read.
export function applyTuningForPlayer(player: Player, partial: Partial<VehicleTuning>): boolean {
	for (const [, entry] of registry) {
		if (entry.owner === player) {
			const pending = entry.pendingTuning ?? {};
			for (const [key, value] of pairs(partial)) {
				pending[key] = value;
			}
			entry.pendingTuning = pending;
			return true;
		}
	}
	return false;
}

// The old requestFlip body, run INSIDE the sim step so the flip state
// attributes are written where rollback can track them.
function tryFlip(entry: SimEntry, now: number) {
	const base = entry.base;
	if (attrBool(base, VehicleAttr.FlipActive) || now < attrNumber(base, VehicleAttr.FlipReadyAt, 0)) {
		return;
	}
	if (math.abs(entry.velocity) >= 5) {
		return;
	}
	const [closeGroundBool] = closeGroundQuery(entry);
	if (!closeGroundBool) {
		return;
	}
	const primary = entry.model.PrimaryPart;
	if (!primary) {
		return;
	}
	if (
		primary.Orientation.X > 60 ||
		primary.Orientation.X < -60 ||
		primary.Orientation.Z > 60 ||
		primary.Orientation.Z < -60
	) {
		const vehicleLV = primary.CFrame.LookVector;
		const upVector = new Vector3(0, 1, 0);
		const newRV = vehicleLV.Cross(upVector).Unit;
		const newUV = newRV.Cross(vehicleLV).Unit;
		base.SetAttribute(
			VehicleAttr.FlipTarget,
			CFrame.fromMatrix(primary.Position.add(new Vector3(0, 10, 0)), newRV, newUV, vehicleLV.mul(-1)),
		);
		base.SetAttribute(VehicleAttr.FlipLiftPos, primary.Position.add(new Vector3(0, 10, 0)));
		base.SetAttribute(VehicleAttr.FlipActive, true);
		base.SetAttribute(VehicleAttr.FlipUntil, now + FLIP_HOLD_TIME);
		base.SetAttribute(VehicleAttr.FlipReadyAt, now + FLIP_DEBOUNCE_TIME);
	}
}

// Aerial roll input (event-driven, exactly like the old RollLeft/RollRight:
// Begin engages only when airborne; anything else resets that component).
function applyRoll(entry: SimEntry, direction: -1 | 1, begin: boolean) {
	const value = direction * 6;
	if (begin && !closeGroundQuery(entry)[0]) {
		// A deliberate roll takes over from the upright hold.
		entry.base.SetAttribute(VehicleAttr.JumpStabilizing, false);
		aerialControls(entry, "X", value);
	} else if (!begin) {
		aerialControlsReset(entry, "X", value);
	}
}

export function setRoll(model: Model, direction: -1 | 1, begin: boolean) {
	const entry = registry.get(model);
	if (entry) {
		const pending = entry.pendingRolls ?? [];
		pending.push({ direction, begin });
		entry.pendingRolls = pending; // consumed inside the next sim step
	}
}

// ---- IAS input reading (Phase 3) ----

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

function getInputActions(entry: SimEntry) {
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

function setOwnerContextEnabled(entry: SimEntry, enabled: boolean) {
	// Server only (the property replicates), and deferred out of the
	// simulation step — InputContext.Enabled is not simulation-access.
	if (!IS_SERVER || !entry.owner) {
		return;
	}
	const owner = entry.owner;
	task.defer(() => {
		const context = owner.FindFirstChild(VehicleInput.ContextName);
		if (context && context.IsA("InputContext")) {
			context.Enabled = enabled;
		}
	});
}

// Reads the owner's InputActions and applies them exactly like the old
// remote handlers did: floats into the attributes, held-abilities on edges.
function readPlayerInputs(entry: SimEntry, now: number) {
	if (attrBool(entry.base, VehicleAttr.ScriptedInput)) {
		return;
	}
	const actions = getInputActions(entry);
	if (!actions) {
		return; // no context (yet) — attributes keep their last values
	}
	const base = entry.base;

	// Movement floats: per-key held-state combined like the old client code —
	// (positive?1:0)-(negative?1:0), so both-held cancels and releasing one
	// resumes the other. Digital keys win, else the analog sources (gamepad
	// triggers/stick with the old 0.3 deadzone, else the mobile joystick).
	const digitalThrottle =
		(stateBool(actions.throttleForward) ? 1 : 0) - (stateBool(actions.throttleBackward) ? 1 : 0);
	const axisThrottle = stateNumber(actions.throttleAxis);
	const touchThrottle = stateNumber(actions.throttleTouch);
	const throttle = digitalThrottle !== 0 ? digitalThrottle : axisThrottle !== 0 ? axisThrottle : touchThrottle;

	const digitalSteer = (stateBool(actions.steerRight) ? 1 : 0) - (stateBool(actions.steerLeft) ? 1 : 0);
	const stickX = stateVector2X(actions.steerStick);
	const stickSteer = math.abs(stickX) < 0.3 ? 0 : stickX;
	const touchSteer = stateNumber(actions.steerTouch);
	const steer = digitalSteer !== 0 ? digitalSteer : stickSteer !== 0 ? stickSteer : touchSteer;

	// Same NaN/clamp choke point as the old remote path.
	if (throttle === throttle && steer === steer) {
		base.SetAttribute(VehicleAttr.Throttle, math.clamp(throttle, -1, 1));
		base.SetAttribute(VehicleAttr.Steer, math.clamp(steer, -1, 1));
	}

	base.SetAttribute(VehicleAttr.DriftHeld, stateBool(actions.drift));

	// Edge detection against the PREVIOUS SIM STEP's input, stored in
	// attributes (the docs' pattern) so a resimulation replays the same edges.
	const boostHeld = stateBool(actions.boost);
	if (boostHeld !== attrBool(base, VehicleAttr.PrevBoostHeld)) {
		base.SetAttribute(VehicleAttr.PrevBoostHeld, boostHeld);
		applyBoostHeld(entry, boostHeld, now);
	}

	const jumpHeld = stateBool(actions.jump);
	if (jumpHeld && !attrBool(base, VehicleAttr.PrevJumpHeld)) {
		tryJump(entry, now);
	}
	base.SetAttribute(VehicleAttr.PrevJumpHeld, jumpHeld);

	const rollLeft = stateBool(actions.rollLeft);
	if (rollLeft !== attrBool(base, VehicleAttr.PrevRollLeft)) {
		base.SetAttribute(VehicleAttr.PrevRollLeft, rollLeft);
		applyRoll(entry, -1, rollLeft);
	}
	const rollRight = stateBool(actions.rollRight);
	if (rollRight !== attrBool(base, VehicleAttr.PrevRollRight)) {
		base.SetAttribute(VehicleAttr.PrevRollRight, rollRight);
		applyRoll(entry, 1, rollRight);
	}
}

// ---- queries ----

export function isOnGround(model: Model): boolean {
	const entry = registry.get(model);
	return entry !== undefined && onGroundQuery(entry);
}

export function isRegistered(model: Model): boolean {
	return registry.has(model);
}

// ---- physics internals (verbatim ports) ----

function onGroundQuery(entry: SimEntry): boolean {
	if (entry.model.Parent !== undefined && entry.model.FindFirstChild("Wheels") !== undefined) {
		// Filter the whole car + driver.
		const filter: Instance[] = [entry.model];
		if (entry.owner && entry.owner.Character) {
			filter.push(entry.owner.Character);
		}
		groundRaycastParams.FilterDescendantsInstances = filter;

		for (const wheel of entry.wheels) {
			const raycaster = wheel.turn;
			const up = raycaster.CFrame.UpVector;
			// Start 1 stud above the hub: a ray that starts inside a surface
			// never hits it (hard landings can bury the hub).
			const raycastResult = game.Workspace.Raycast(
				raycaster.Position.add(up),
				up.mul(-(1 + wheel.Wheel.Size.Y / 2 + 0.5)),
				groundRaycastParams,
			);
			if (raycastResult) {
				return true;
			}
		}
	}
	return false;
}

function closeGroundQuery(entry: SimEntry): LuaTuple<[boolean, CFrame?]> {
	const filter: Instance[] = [entry.model];
	if (entry.owner && entry.owner.Character) {
		filter.push(entry.owner.Character);
	}
	groundRaycastParams.FilterDescendantsInstances = filter;
	// Precomputed bounding box (GetBoundingBox is banned in sim callbacks).
	const boxCenter = entry.base.CFrame.PointToWorldSpace(entry.boundingCenterOffset);
	const raycastResult = game.Workspace.Raycast(
		boxCenter,
		new Vector3(0, -entry.boundingSizeX / 2, 0),
		groundRaycastParams,
	);
	if (raycastResult) {
		const vehicleLV = entry.base.CFrame.LookVector;
		const upVector = raycastResult.Normal;
		const newRV = vehicleLV.Cross(upVector).Unit;
		const newUV = newRV.Cross(vehicleLV).Unit;
		const GyroCFrame = CFrame.fromMatrix(entry.base.Position, newRV, newUV, vehicleLV.mul(-1));
		return $tuple(true, GyroCFrame);
	} else {
		return $tuple(false, undefined);
	}
}

// Swap the wheels between normal grip and sliding grip. frictionWeight 100
// makes the wheel's friction dominate whatever ground material it touches.
// Called EVERY drive tick (not just on the engage/disengage edge): a rollback
// restores the DriftEngaged attribute but not this physical property, so the
// friction must be re-asserted from the attribute. The compare keeps the
// steady state write-free.
function setWheelFriction(entry: SimEntry, sliding: boolean) {
	const friction = sliding
		? entry.tuning.driftWheelFriction ?? DRIFT_WHEEL_FRICTION
		: entry.tuning.driveWheelFriction ?? DRIVE_WHEEL_FRICTION;
	for (const wheel of entry.wheels) {
		const part = wheel.FindFirstChild("Wheel") as BasePart | undefined;
		if (!part) {
			continue;
		}
		const cur = part.CurrentPhysicalProperties;
		if (math.abs(cur.Friction - friction) < 1e-4 && cur.FrictionWeight === 100) {
			continue;
		}
		part.CustomPhysicalProperties = new PhysicalProperties(
			cur.Density,
			friction,
			cur.Elasticity,
			100,
			cur.ElasticityWeight,
		);
	}
}

function aerialControls(entry: SimEntry, axis: string, value: number) {
	const aerial = entry.aerial;
	aerial.MaxTorque = entry.totalMass * AERIAL_TORQUE_PER_MASS;
	aerial.AngularVelocity = Vector3ComponentSetter(aerial.AngularVelocity, axis, value)!;
}

function aerialControlsReset(entry: SimEntry, axis: string, compValue: number) {
	if (entry.model.Parent !== undefined && entry.model.FindFirstChild("Base") !== undefined) {
		const aerial = entry.aerial;
		if (Vector3ComponentChecker(aerial.AngularVelocity, axis, compValue)) {
			aerial.AngularVelocity = Vector3ComponentSetter(aerial.AngularVelocity, axis, 0)!;
			if (aerial.AngularVelocity === new Vector3(0, 0, 0)) {
				aerial.MaxTorque = 0;
			}
		}
	}
}

function yaw(entry: SimEntry, steerFloat: number) {
	aerialControls(entry, "Y", -steerFloat * 6);
	if (entry.aerial.AngularVelocity === new Vector3(0, 0, 0)) {
		entry.aerial.MaxTorque = 0;
	}
}

function pitch(entry: SimEntry, throttle: number) {
	aerialControls(entry, "Z", -throttle * 3);
	if (entry.aerial.AngularVelocity === new Vector3(0, 0, 0)) {
		entry.aerial.MaxTorque = 0;
	}
}

function drift(entry: SimEntry, steerFloat: number) {
	// Too slow to slide — behave as normal grip.
	if (entry.propVelocity < DRIFT_MIN_PROP_VEL) {
		undrift(entry);
		return;
	}

	entry.base.SetAttribute(VehicleAttr.DriftEngaged, true);
	setWheelFriction(entry, true);

	const dir = entry.velocity >= 0 ? 1 : -1;

	// Commanded slide rotation, Y-only. (Scalar torque budget — see Phase 1
	// notes: may also damp roll/pitch spin, but drift only runs on the ground
	// where the suspension dominates those axes.)
	entry.driftYaw.MaxTorque = entry.totalMass * DRIFT_YAW_TORQUE;
	entry.driftYaw.AngularVelocity = new Vector3(
		0,
		-steerFloat * DRIFT_YAW_RATE * dir * math.min(entry.propVelocity * 2, 1),
		0,
	);

	// Centripetal assist, capped so lateral speed can never run away.
	let sideForce = 0;
	if (entry.velocity >= 0) {
		sideForce = steerFloat * entry.tuning.mass * DRIFT_SIDE_FORCE_FWD * entry.tuning.driftingMult;
	} else {
		sideForce = -steerFloat * entry.tuning.mass * DRIFT_SIDE_FORCE_REV * entry.tuning.driftingMult;
	}
	const sideVelocity = entry.base.CFrame.VectorToObjectSpace(baseVelocity(entry)).X;
	const maxSideSpeed = DRIFT_MAX_SIDE_SPEED * entry.tuning.targetVelocity;
	if ((sideForce > 0 && sideVelocity > maxSideSpeed) || (sideForce < 0 && sideVelocity < -maxSideSpeed)) {
		sideForce = 0;
	}
	entry.driftThrust.Force = new Vector3(sideForce, 0, 0);
}

function undrift(entry: SimEntry) {
	entry.base.SetAttribute(VehicleAttr.DriftEngaged, false);
	setWheelFriction(entry, false);

	entry.driftYaw.MaxTorque = 0;
	entry.driftYaw.AngularVelocity = new Vector3(0, 0, 0);
	entry.driftThrust.Force = new Vector3(0, 0, 0);
}

function turnWheels(entry: SimEntry, throttle: number, steerFloat: number, onGround: boolean) {
	//https://datagenetics.com/blog/december12016/index.html
	if (attrBool(entry.base, VehicleAttr.DriftHeld) && onGround) {
		drift(entry, steerFloat);
	} else {
		undrift(entry);
	}

	const fl = entry.flHinge;
	const fr = entry.frHinge;

	let turnRadius = entry.tuning.minTurnRadius;
	fl.AngularSpeed = entry.tuning.maxAngularSpeed;
	fr.AngularSpeed = entry.tuning.maxAngularSpeed;

	if (entry.propVelocity > 0.5) {
		turnRadius += math.clamp(
			entry.propVelocity * (entry.tuning.maxTurnRadius - turnRadius),
			0,
			2 * (entry.tuning.maxTurnRadius - turnRadius),
		);

		fl.AngularSpeed -= math.clamp(
			entry.propVelocity * (fl.AngularSpeed - entry.tuning.minAngularSpeed),
			0,
			fl.AngularSpeed - entry.tuning.minAngularSpeed,
		);
		fr.AngularSpeed -= math.clamp(
			entry.propVelocity * (fr.AngularSpeed - entry.tuning.minAngularSpeed),
			0,
			fr.AngularSpeed - entry.tuning.minAngularSpeed,
		);
	}

	//ANTI ACKERMAN
	const gammaE = math.deg(math.atan(entry.l / (turnRadius - entry.t / 2))); //internal wheel
	const gammaI = math.deg(math.atan(entry.l / (turnRadius + entry.t / 2))); //external wheel

	if (steerFloat > 0) {
		fl.TargetAngle = steerFloat * gammaI;
		fr.TargetAngle = steerFloat * gammaE;
	} else if (steerFloat < 0) {
		fl.TargetAngle = steerFloat * gammaE;
		fr.TargetAngle = steerFloat * gammaI;
	} else {
		fl.TargetAngle = 0;
		fr.TargetAngle = 0;
	}
}

// Boost meter cadence — the old boostIncrement, on sim time.
function boostTick(entry: SimEntry, increase: boolean, now: number) {
	if (now - attrNumber(entry.base, VehicleAttr.BoostLastInc, 0) >= BOOST_TICK_INTERVAL) {
		const amount = attrNumber(entry.base, VehicleAttr.BoostAmount, 0);
		if (increase) {
			entry.base.SetAttribute(VehicleAttr.BoostAmount, math.clamp(amount + 1, 0, 100));
		} else {
			if (amount === 0) {
				// Depleted: force the boost off and block regen — the old
				// internal Boost(End) call.
				entry.base.SetAttribute(VehicleAttr.BoostHeld, false);
				entry.base.SetAttribute(VehicleAttr.BoostBlockedUntil, now + BOOST_REGEN_DELAY);
			} else {
				entry.base.SetAttribute(VehicleAttr.BoostAmount, math.clamp(amount - 4, 0, 100));
			}
		}
		entry.base.SetAttribute(VehicleAttr.BoostLastInc, now);
	}
}

// ---- the tick ----

function stepVehicle(entry: SimEntry, dt: number) {
	const model = entry.model;
	const base = entry.base;

	// Tuning HUD edits (server only), written into the Tune* attributes from
	// inside the sim step so the writes are legal on a predicted instance and
	// replicate to the predicting client.
	if (IS_SERVER && entry.pendingTuning) {
		const t = entry.pendingTuning;
		entry.pendingTuning = undefined;
		if (t.mass !== undefined) base.SetAttribute(VehicleTuningAttr.Mass, t.mass);
		if (t.acceleration !== undefined) base.SetAttribute(VehicleTuningAttr.Acceleration, t.acceleration);
		if (t.targetVelocity !== undefined) base.SetAttribute(VehicleAttr.TargetVelocity, t.targetVelocity);
		if (t.minTurnRadius !== undefined) base.SetAttribute(VehicleTuningAttr.MinTurnRadius, t.minTurnRadius);
		if (t.maxTurnRadius !== undefined) base.SetAttribute(VehicleTuningAttr.MaxTurnRadius, t.maxTurnRadius);
		if (t.maxAngularSpeed !== undefined) base.SetAttribute(VehicleTuningAttr.MaxAngularSpeed, t.maxAngularSpeed);
		if (t.minAngularSpeed !== undefined) base.SetAttribute(VehicleTuningAttr.MinAngularSpeed, t.minAngularSpeed);
		if (t.boostAmount !== undefined) base.SetAttribute(VehicleTuningAttr.BoostAmount, t.boostAmount);
		if (t.driftingMult !== undefined) base.SetAttribute(VehicleTuningAttr.DriftingMult, t.driftingMult);
		if (t.driveWheelFriction !== undefined)
			base.SetAttribute(VehicleTuningAttr.DriveWheelFriction, t.driveWheelFriction);
		if (t.driftWheelFriction !== undefined)
			base.SetAttribute(VehicleTuningAttr.DriftWheelFriction, t.driftWheelFriction);
		if (t.jumpForceTime !== undefined) base.SetAttribute(VehicleTuningAttr.JumpForceTime, t.jumpForceTime);
		if (t.jumpGravityMult !== undefined) base.SetAttribute(VehicleTuningAttr.JumpGravityMult, t.jumpGravityMult);
	}

	// Both peers rebuild the tuning from the attributes every tick so live
	// tuning edits reach the server sim and the predicting client alike
	// (attributes are rollback-restored, so resimulation reads stay
	// consistent). Falls back to the register-time values per field.
	const prevTuning = entry.tuning;
	entry.tuning = {
		mass: attrNumber(base, VehicleTuningAttr.Mass, prevTuning.mass),
		acceleration: attrNumber(base, VehicleTuningAttr.Acceleration, prevTuning.acceleration),
		targetVelocity: attrNumber(base, VehicleAttr.TargetVelocity, prevTuning.targetVelocity),
		minTurnRadius: attrNumber(base, VehicleTuningAttr.MinTurnRadius, prevTuning.minTurnRadius),
		maxTurnRadius: attrNumber(base, VehicleTuningAttr.MaxTurnRadius, prevTuning.maxTurnRadius),
		maxAngularSpeed: attrNumber(base, VehicleTuningAttr.MaxAngularSpeed, prevTuning.maxAngularSpeed),
		minAngularSpeed: attrNumber(base, VehicleTuningAttr.MinAngularSpeed, prevTuning.minAngularSpeed),
		boostAmount: attrNumber(base, VehicleTuningAttr.BoostAmount, prevTuning.boostAmount),
		driftingMult: attrNumber(base, VehicleTuningAttr.DriftingMult, prevTuning.driftingMult),
		driveWheelFriction: attrNumber(
			base,
			VehicleTuningAttr.DriveWheelFriction,
			prevTuning.driveWheelFriction ?? DRIVE_WHEEL_FRICTION,
		),
		driftWheelFriction: attrNumber(
			base,
			VehicleTuningAttr.DriftWheelFriction,
			prevTuning.driftWheelFriction ?? DRIFT_WHEEL_FRICTION,
		),
		jumpForceTime: attrNumber(base, VehicleTuningAttr.JumpForceTime, prevTuning.jumpForceTime ?? JUMP_FORCE_TIME),
		jumpGravityMult: attrNumber(
			base,
			VehicleTuningAttr.JumpGravityMult,
			prevTuning.jumpGravityMult ?? JUMP_FORCE_GRAVITY_MULT,
		),
	};

	// Occupancy gate — the old drive() while-condition, evaluated per tick.
	// The Driving ATTRIBUTE is the previous step's value (rollback-safe), so
	// the sit/exit edges replay identically during a resimulation.
	const seat = entry.seat;
	const occupant = seat ? seat.Occupant : undefined;
	const ownerCharacter = entry.owner ? entry.owner.Character : undefined;
	const ownerHumanoid = ownerCharacter ? ownerCharacter.FindFirstChildOfClass("Humanoid") : undefined;
	const drivingNow =
		occupant !== undefined && ownerHumanoid !== undefined && occupant === ownerHumanoid && model.Parent !== undefined;
	const drivingWas = attrBool(base, VehicleAttr.Driving);

	// The sit/exit EDGES run on the SERVER only. They are game-flow decisions,
	// not physics: if the client ran them off its own (possibly not yet
	// replicated) view of seat.Occupant, a Driving=true attribute arriving
	// before the Occupant property would fire the drive-end edge and pin the
	// predicted car with the parking brake — a constraint property write that
	// rollback does NOT restore. The client instead trusts the replicated
	// Driving attribute below and mispredicts only the single flip step.
	if (!IS_SERVER) {
		if (!drivingWas) {
			return;
		}
	} else if (drivingNow && !drivingWas) {
		// Fresh sit: never inherit input or ability state from a previous drive.
		base.SetAttribute(VehicleAttr.Throttle, 0);
		base.SetAttribute(VehicleAttr.Steer, 0);
		base.SetAttribute(VehicleAttr.DriftHeld, false);
		base.SetAttribute(VehicleAttr.BoostHeld, false); // no regen-block: matches the old fresh-sit reset
		base.SetAttribute(VehicleAttr.Driving, true);
		base.SetAttribute(VehicleAttr.LastThrottle, 0);
		base.SetAttribute(VehicleAttr.ReleasedThrottle, false);
		base.SetAttribute(VehicleAttr.BoostLastInc, attrNumber(base, VehicleAttr.SimTime, 0));
		base.SetAttribute(VehicleAttr.PrevBoostHeld, false);
		base.SetAttribute(VehicleAttr.PrevJumpHeld, false);
		base.SetAttribute(VehicleAttr.PrevRollLeft, false);
		base.SetAttribute(VehicleAttr.PrevRollRight, false);
		entry.errorLogged = false;
		setOwnerContextEnabled(entry, true);
		// Diagnostic: live mass vs the register-time snapshot. A large gap
		// means post-spawn changes (paint→Metal, skins) moved the mass — the
		// reason the sim must measure per tick, never cache.
		if (IS_SERVER) {
			warn(
				`[VehicleSim] ${model.Name}: drive start; totalMass=${string.format(
					"%.0f",
					getMassOfModel(model) + occupantsMass(model),
				)} (register-time=${string.format("%.0f", entry.baseMass)})`,
			);
		}
	} else if (!drivingNow && drivingWas) {
		// Drive ended: parking brake, exactly like the old loop exit.
		warn(
			`[VehicleSim] ${model.Name}: drive end (occupant=${occupant !== undefined} ownerHumanoid=${
				ownerHumanoid !== undefined
			} parent=${model.Parent !== undefined})`,
		);
		base.SetAttribute(VehicleAttr.Driving, false);
		base.LinearVelocity.MaxForce = 100000;
		base.LinearVelocity.LineVelocity = 0;
		entry.velocity = 0;
		entry.propVelocity = 0;
		turnWheels(entry, 0, 0, false);
		setOwnerContextEnabled(entry, false);
	}

	if (IS_SERVER && !drivingNow) {
		return;
	}

	// Sim clock: advances by the fixed simulation delta while driving. Stored
	// as an attribute so a rollback rewinds it with everything else — every
	// timer below compares against THIS clock, never wall time, because the
	// two peers' wall clocks can never agree.
	const now = attrNumber(base, VehicleAttr.SimTime, 0) + dt;
	base.SetAttribute(VehicleAttr.SimTime, now);

	readPlayerInputs(entry, now);

	// Server-side pending ops queued outside the sim (FeelHarness, remotes).
	if (entry.pendingBoostHeld !== undefined) {
		const held = entry.pendingBoostHeld;
		entry.pendingBoostHeld = undefined;
		base.SetAttribute(VehicleAttr.PrevBoostHeld, held);
		applyBoostHeld(entry, held, now);
	}
	if (entry.pendingJump) {
		entry.pendingJump = undefined;
		tryJump(entry, now);
	}
	if (entry.pendingRolls) {
		const rolls = entry.pendingRolls;
		entry.pendingRolls = undefined;
		for (const roll of rolls) {
			applyRoll(entry, roll.direction, roll.begin);
		}
	}
	if (entry.pendingFlip) {
		entry.pendingFlip = undefined;
		tryFlip(entry, now);
	}

	// Mass is measured EVERY tick — exactly the old GetTotalMass(). It must
	// track post-spawn changes (PaintVehicle swaps body pieces to Metal at
	// ~11× plastic density, skins, occupant changes): every force in the
	// tuned math scales with this number, so a stale register-time snapshot
	// rescales the whole car's physics.
	entry.totalMass = getMassOfModel(model) + occupantsMass(model);

	// ---- timers (sim-time state machines replacing task.wait/task.delay) ----

	// Jump force window.
	if (now < attrNumber(base, VehicleAttr.JumpForceUntil, 0)) {
		entry.jumpThrust.Force = new Vector3(
			0,
			entry.totalMass * game.Workspace.Gravity * (entry.tuning.jumpGravityMult ?? JUMP_FORCE_GRAVITY_MULT),
			0,
		);
	} else {
		entry.jumpThrust.Force = new Vector3(0, 0, 0);
	}

	// Flip hold window.
	if (attrBool(base, VehicleAttr.FlipActive)) {
		if (now >= attrNumber(base, VehicleAttr.FlipUntil, 0)) {
			base.SetAttribute(VehicleAttr.FlipActive, false);
			entry.flipLift.MaxAxesForce = new Vector3(0, 0, 0);
			entry.flipAlign.MaxTorque = 0;
		} else {
			const flipTarget = base.GetAttribute(VehicleAttr.FlipTarget);
			const flipLiftPos = base.GetAttribute(VehicleAttr.FlipLiftPos);
			if (typeIs(flipTarget, "CFrame") && typeIs(flipLiftPos, "Vector3")) {
				entry.flipLift.Position = flipLiftPos;
				entry.flipLift.MaxAxesForce = new Vector3(0, math.huge, 0);
				entry.flipAlign.CFrame = flipTarget;
				entry.flipAlign.MaxTorque = math.huge;
			}
		}
	}

	// ---- the drive tick (verbatim port of the old loop body) ----

	const steerFloat = attrNumber(base, VehicleAttr.Steer, 0);
	const throttle = attrNumber(base, VehicleAttr.Throttle, 0);

	let targetVelocity = throttle * entry.tuning.targetVelocity;
	const totalMass = entry.totalMass;
	const onGround = onGroundQuery(entry);
	const [closeGroundBool, gyroCFrame] = closeGroundQuery(entry);
	// Propulsion fallback: if the wheel rays miss but the chassis is hugging
	// the ground, the engine keeps power instead of dropping to zero force.
	const grounded = onGround || closeGroundBool;

	const forceAtt = entry.tuning.acceleration * totalMass * DRIVE_FORCE_MULT;
	let force = forceAtt;
	entry.velocity = -base.CFrame.VectorToObjectSpace(baseVelocity(entry)).Z;
	entry.propVelocity = math.abs(entry.velocity) / entry.tuning.targetVelocity;

	//Aerial Correction and controls
	const jumpStabilizeStart = attrNumber(base, VehicleAttr.JumpStabilizeStart, 0);
	if (onGround) {
		// Landed (the grace period skips the still-grounded takeoff frames).
		if (attrBool(base, VehicleAttr.JumpStabilizing) && now - jumpStabilizeStart > JUMP_UPRIGHT_LAND_GRACE) {
			base.SetAttribute(VehicleAttr.JumpStabilizing, false);
		}
		entry.aerial.MaxTorque = 0;
		entry.upright.MaxTorque = 0;
		if (attrBool(base, VehicleAttr.ReleasedThrottle)) {
			pitch(entry, 0);
		}
		base.SetAttribute(VehicleAttr.ReleasedThrottle, false);
	} else if (!closeGroundBool) {
		if (attrBool(base, VehicleAttr.JumpStabilizing) && now - jumpStabilizeStart > JUMP_UPRIGHT_MAX_TIME) {
			base.SetAttribute(VehicleAttr.JumpStabilizing, false);
		}
		if (attrBool(base, VehicleAttr.JumpStabilizing)) {
			// Post-jump upright hold: level roll+pitch, yaw free.
			entry.upright.CFrame = cframeFromXAxis(new Vector3(0, 1, 0));
			entry.upright.MaxTorque = math.huge;
		} else {
			entry.upright.MaxTorque = 0;
		}
		yaw(entry, steerFloat);

		if (attrBool(base, VehicleAttr.ReleasedThrottle)) {
			// A deliberate pitch input takes over from the upright hold.
			if (throttle !== 0) {
				base.SetAttribute(VehicleAttr.JumpStabilizing, false);
			}
			pitch(entry, throttle);
		}

		if (attrNumber(base, VehicleAttr.LastThrottle, 0) === 0 && throttle !== 0) {
			base.SetAttribute(VehicleAttr.ReleasedThrottle, true);
		}
	} else {
		//closeGround
		entry.aerial.MaxTorque = 0;
		// Slope hug: align the car's up axis to the surface normal, yaw free.
		entry.upright.CFrame = cframeFromXAxis(gyroCFrame!.YVector);
		entry.upright.MaxTorque = math.huge;
		if (attrNumber(base, VehicleAttr.LastThrottle, 0) === 0 && throttle !== 0) {
			base.SetAttribute(VehicleAttr.ReleasedThrottle, true);
		}
	}
	base.SetAttribute(VehicleAttr.LastThrottle, throttle);

	turnWheels(entry, throttle, steerFloat, grounded);

	const lookVector = base.CFrame.LookVector;
	const rightVector = base.CFrame.RightVector;

	let slopeCounterForce = 0;
	if (math.abs(rightVector.Y) > 0.1 && math.abs(rightVector.Y) < math.sin(math.rad(50))) {
		slopeCounterForce = totalMass * game.Workspace.Gravity * math.abs(rightVector.Y);
	}

	if (throttle > 0 && grounded) {
		//holding W
		if (entry.velocity >= 0) {
			//moving forwards (gears)
			for (const [i, gear] of ipairs(GEAR_LIMITS)) {
				if (entry.propVelocity <= gear) {
					force *= GEAR_TORQUES[i - 1] + gear - entry.propVelocity;
					break;
				}
			}
		} else {
			//moving backwards
			force *= 2.6;
		}

		if (lookVector.Y > 0.1 && lookVector.Y < math.sin(math.rad(50))) {
			//ensures forwards driving on upwards slope
			force += totalMass * game.Workspace.Gravity * lookVector.Y;
		}
	} else if (throttle < 0 && grounded) {
		//holding S
		if (entry.velocity <= 0) {
			//moving backwards
			targetVelocity *= 0.3;
			force *= 0.6;
		} else {
			//moving forwards
			targetVelocity *= 0.1;
			force *= 2.6;
		}

		if (lookVector.Y < -0.1 && lookVector.Y > -math.sin(math.rad(50))) {
			//ensures backwards driving on downward slope
			force -= totalMass * game.Workspace.Gravity * lookVector.Y;
		}
	} else if (!grounded) {
		force = 0;
	}

	const boostHeld = attrBool(base, VehicleAttr.BoostHeld);
	if (boostHeld && attrNumber(base, VehicleAttr.BoostAmount, 0) >= 0) {
		//if boosting go back to gear 1 accel
		boostTick(entry, false, now); //decrease boostAmount
		// Re-read AFTER the decrement, matching the old boostIncrement ordering.
		if (attrNumber(base, VehicleAttr.BoostAmount, 0) > 0) {
			// Aerial boost gets extra force so nose-up boosting can fight
			// gravity and extend airtime.
			force = forceAtt * (grounded ? BOOST_FORCE_MULT : BOOST_AIR_FORCE_MULT); //resets force
			force += totalMass * game.Workspace.Gravity * lookVector.Y;
			targetVelocity = BOOST_TARGET_MULT * entry.tuning.targetVelocity;
		}
	} else if (now >= attrNumber(base, VehicleAttr.BoostBlockedUntil, 0)) {
		boostTick(entry, true, now); //increase boostAmount
	}

	if (entry.propVelocity > 1 && !boostHeld) {
		//if faster than max velocity, slow down
		force = forceAtt;
	}

	base.LinearVelocity.MaxForce = force;
	base.LinearVelocity.LineVelocity = targetVelocity;
	base.slopeCounterVelocity.MaxForce = slopeCounterForce;

	// Phase 4 diagnostics: throttled drive-state line on both peers (first
	// driven tick prints immediately, then every ~150 sim steps).
	entry.diagTickCounter += 1;
	if (entry.diagTickCounter % 150 === 1) {
		const rootPart = base.AssemblyRootPart;
		const assemblyVel = base.AssemblyLinearVelocity;
		print(
			string.format(
				"[VehicleSim][%s] %s t=%.2f thr=%d gnd=%s F=%.0f v=%.1f mass=%.0f y=%.1f velY=%.1f root=%s anch=%s",
				IS_SERVER ? "S" : "C",
				model.Name,
				now,
				throttle,
				tostring(grounded),
				force,
				entry.velocity,
				totalMass,
				base.Position.Y,
				assemblyVel.Y,
				rootPart ? rootPart.Name : "nil",
				tostring(rootPart ? rootPart.Anchored : false),
			),
		);
	}
}

let diagFirstTick = true;

function tick(dt: number) {
	if (diagFirstTick) {
		diagFirstTick = false;
		print(`[VehicleSim] ${IS_SERVER ? "server" : "client"} first sim tick dt=${dt}`);
	}
	for (const [model, entry] of registry) {
		if (entry.model.Parent === undefined || entry.base.Parent === undefined) {
			registry.delete(model);
			continue;
		}
		// Client prediction covers only the local player's own car. (No status
		// gating: GetPredictionStatus outside a resimulation pass reports
		// Authoritative even for instances the engine predicts — the
		// visualizer's predicted-instance count is the ground truth, and it
		// confirms the car. The docs pattern is simply "run the same sim in
		// BindToSimulation on both peers".)
		if (!IS_SERVER && entry.owner !== LOCAL_PLAYER) {
			continue;
		}
		const [ok, err] = pcall(() => stepVehicle(entry, dt));
		if (!ok && !entry.errorLogged) {
			// One log per drive session — the old loop swallowed these silently,
			// which hid real breakage.
			entry.errorLogged = true;
			warn(`[VehicleSim] ${model.Name}: ${err}`);
		}
	}
}

// ---- lifecycle ----

let initialized = false;

export function initialize() {
	if (initialized) {
		return;
	}
	initialized = true;
	// Phase 4: the tick is bound through BindToSimulation on BOTH peers — on
	// the client this is what makes the engine re-run the vehicle logic
	// during rollback-resimulation. Falls back to Heartbeat (Phase 2/3
	// behavior) if the API is unavailable.
	const [ok, err] = pcall(() => {
		RunService.BindToSimulation((deltaTime: number) => tick(deltaTime));
	});
	// Guard against silent netcode regressions: EVERYTHING in Phase 4 assumes
	// AuthorityMode=Server. If this ever prints Client, the place property has
	// reverted and the whole prediction architecture is inert (and spawnVehicle
	// falls back to the classic anchor + SetNetworkOwner choreography).
	const [modeOk, mode] = pcall(() => tostring((game.Workspace as unknown as Record<string, unknown>).AuthorityMode));
	warn(
		`[VehicleSim] ${IS_SERVER ? "server" : "client"} Workspace.AuthorityMode=${
			modeOk ? mode : "unreadable from Lua (expected under current beta; code assumes Server)"
		}`,
	);
	if (ok) {
		print(`[VehicleSim] ${IS_SERVER ? "server" : "client"} bound via BindToSimulation`);
	} else {
		// Fallback ONLY for engines without the server-authority beta — under
		// AuthorityMode=Server this branch must never run (Heartbeat code is
		// invisible to rollback-resimulation).
		warn(`[VehicleSim] BindToSimulation unavailable (${err}); falling back to Heartbeat`);
		RunService.Heartbeat.Connect((deltaTime) => tick(deltaTime));
	}
}
