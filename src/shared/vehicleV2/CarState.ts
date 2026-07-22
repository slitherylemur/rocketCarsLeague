// Vehicle V2 state schema — every cross-tick simulation value, enumerated.
//
// Rollback contract (same as the legacy sim, see SERVER_AUTHORITY_PLAN.md
// Phase 4b): ANY value the sim carries across ticks MUST live in an attribute
// on the predicted VehicleRoot — a rollback restores attributes to the server
// snapshot before resimulating, and an attribute mismatch is what triggers a
// rollback at all. Everything else is recomputed per tick from restored
// physics state + replayed IAS input. All times are SIM time.
//
// Attribute payload on predicted instances is capped (~1024 bytes observed —
// legacy register() died on it). assertSchemaBudget() estimates the maximum
// payload of this schema and warns loudly if it drifts near the cap.

export const CarAttr = {
	// clock
	SimTime: "SimTime",
	// lifecycle
	Driving: "Driving",
	InputLocked: "InputLocked", // written true/REMOVED, never false (payload)
	ScriptedInput: "ScriptedInput",
	TeleportGen: "TeleGen", // renderers snap when this changes
	BlastGen: "BlastGen", // renderers correct FAST when this changes
	BlastHoldUntil: "BlastHold", // overspeed control suppressed until this sim time
	// live input mirror (written from IAS per tick; replicates for remote
	// prediction/eventual input display; rollback-tracked)
	Throttle: "Throttle",
	Steer: "Steer",
	DriftHeld: "DriftHeld",
	BoostHeld: "BoostHeld",
	// input edges (previous tick's held state — resim replays edges identically)
	PrevJump: "PrevJump",
	PrevBoost: "PrevBoost",
	// drift hysteresis
	DriftEngaged: "DriftEngaged",
	// boost meter
	BoostAmount: "BoostAmount",
	// jump machine
	JumpForceUntil: "JumpForceUntil",
	JumpReadyAt: "JumpReadyAt",
	JumpLaunchDir: "JumpLaunchDir", // Vector3, captured floor normal
	JumpStabilizing: "JumpStabilizing",
	JumpStabilizeStart: "JumpStabStart",
	// grounded memory (coyote)
	LastGrounded: "LastGrounded",
	// recovery flip
	FlipUntil: "FlipUntil",
	FlipReadyAt: "FlipReadyAt",
	// showcase pin
	ShowcaseLockActive: "ShowLock",
	ShowcaseLockPos: "ShowLockPos", // Vector3
	// aerial pitch feel state (legacy ReleasedThrottle semantics)
	ReleasedThrottle: "RelThrottle",
	LastThrottle: "LastThrottle",
} as const;

// Attributes on the vehicle MODEL (not predicted; identity + gameplay).
export const CarModelAttr = {
	V2: "V2", // schema version stamp — presence marks a V2 vehicle
	TemplateId: "TemplateId",
	PresetId: "PresetId",
	OwnerUserId: "OwnerUserId", // same name as legacy VehicleModelAttr
	Health: "Health",
	MaxHealth: "MaxHealth",
} as const;

// Attributes on render-source cosmetic wheel parts (never predicted).
export const RigWheelAttr = {
	LocalPos: "RW_LocalPos", // Vector3 hardpoint in root-local space
	Radius: "RW_Radius",
	Steers: "RW_Steers",
	ContactIndex: "RW_Contact", // canonical contact this wheel derives from (0..3)
} as const;

export const V2_SCHEMA_VERSION = 1;

/** Fixed-step input sample the sim consumes each tick. */
export interface CarInput {
	throttle: number; // -1..1
	steer: number; // -1..1
	drift: boolean;
	boost: boolean;
	jump: boolean;
	rollLeft: boolean;
	rollRight: boolean;
}

export const ZERO_INPUT: CarInput = {
	throttle: 0,
	steer: 0,
	drift: false,
	boost: false,
	jump: false,
	rollLeft: false,
	rollRight: false,
};

// ---- payload budget assertion --------------------------------------------
// Rough serialized-size model per attribute: name length + type tag + value
// bytes (number 8, bool 1, Vector3 12, string len). Conservative on purpose.

const NUMBER_ATTRS: readonly string[] = [
	CarAttr.SimTime,
	CarAttr.TeleportGen,
	CarAttr.BlastGen,
	CarAttr.BlastHoldUntil,
	CarAttr.Throttle,
	CarAttr.Steer,
	CarAttr.BoostAmount,
	CarAttr.JumpForceUntil,
	CarAttr.JumpReadyAt,
	CarAttr.JumpStabilizeStart,
	CarAttr.LastGrounded,
	CarAttr.FlipUntil,
	CarAttr.FlipReadyAt,
	CarAttr.LastThrottle,
];
const BOOL_ATTRS: readonly string[] = [
	CarAttr.Driving,
	CarAttr.InputLocked,
	CarAttr.ScriptedInput,
	CarAttr.DriftHeld,
	CarAttr.BoostHeld,
	CarAttr.PrevJump,
	CarAttr.PrevBoost,
	CarAttr.DriftEngaged,
	CarAttr.JumpStabilizing,
	CarAttr.ShowcaseLockActive,
	CarAttr.ReleasedThrottle,
];
const VECTOR_ATTRS: readonly string[] = [CarAttr.JumpLaunchDir, CarAttr.ShowcaseLockPos];

export function estimateSchemaBytes(): number {
	let total = 0;
	const OVERHEAD = 4; // per-attribute framing allowance
	for (const name of NUMBER_ATTRS) {
		total += name.size() + 8 + OVERHEAD;
	}
	for (const name of BOOL_ATTRS) {
		total += name.size() + 1 + OVERHEAD;
	}
	for (const name of VECTOR_ATTRS) {
		total += name.size() + 12 + OVERHEAD;
	}
	return total;
}

/** Warn loudly if the schema drifts near the predicted-attribute payload cap.
 * Called once from CarSim.initialize on each peer. */
export function assertSchemaBudget() {
	const bytes = estimateSchemaBytes();
	const BUDGET = 700; // cap observed ~1024; keep real headroom
	if (bytes > BUDGET) {
		warn(`[CarState] predicted attribute schema estimate ${bytes}B exceeds the ${BUDGET}B budget (cap ~1024B) — trim the schema before shipping`);
	}
	return bytes;
}
