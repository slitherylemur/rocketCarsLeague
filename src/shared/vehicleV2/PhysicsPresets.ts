// Vehicle V2 physics presets — the ONLY source of physics-affecting numbers.
//
// A preset determines movement tuning: mass, suspension, tires, drive, boost,
// jump, aerial and recovery constants. Each vehicle template's authored
// Hitboxes/HitboxMain determines its collision size; both peers resolve the
// matching contact geometry from the replicated VehicleRoot.Size.
//
// Values are seeded from the tuned legacy feel (see VEHICLE_V2_ADR.md §1 and
// the legacy constants in vehicleSim/VehicleSim.ts): top speed 120 (150×0.8),
// boost ceiling 240, accel ≈ 62.5 studs/s² at launch, turn radius 48, jump
// gravity-mult 3.37 over 0.16 s, aerial authority 378 rad·mass units. The
// ENVELOPE is preserved; the implementation is not (ADR §3).
//
// Units: studs, seconds, radians. "Accel" values are studs/s² applied to the
// whole car (mass-independent by construction — forces are computed as
// mass × accel, so presets tune in acceleration space).

export interface ContactPoint {
	/** Hardpoint in VehicleRoot-local space (Y = suspension anchor height). */
	readonly local: Vector3;
	/** True for contacts that steer with the front axle. */
	readonly steers: boolean;
}

export interface PhysicsPreset {
	readonly id: string;

	// ---- rigid body ----
	/** Collision box size (X width, Y height, Z length). */
	readonly boxSize: Vector3;
	/** Total assembly mass (constant; cosmetics never change it). */
	readonly mass: number;
	/** Engine friction of the box itself — kept LOW so box-vs-ground contact
	 * never fights the scripted tire model (tires provide all grip). */
	readonly boxFriction: number;

	// ---- suspension (per contact) ----
	/** Four canonical contacts, stable order FL, FR, BL, BR. */
	readonly contacts: readonly [ContactPoint, ContactPoint, ContactPoint, ContactPoint];
	/** Wheel radius used for ray length and visual spin. */
	readonly wheelRadius: number;
	/** Suspension rest length below the hardpoint (ray = rest + radius). */
	readonly suspensionRest: number;
	/** Natural frequency (rad/s) of the spring at full compression share. */
	readonly suspensionOmega: number;
	/** Damping ratio (1 = critical). */
	readonly suspensionZeta: number;
	/** Per-tick suspension Δv cap as a multiple of compression/dt (anti-slam). */
	readonly suspensionMaxDvScale: number;
	/** Suspension impulse torque arm is shrunk toward the COM by this factor
	 * (0 = pure central force / no pitch-roll, 1 = true hardpoint). Lower =
	 * more stable, less body roll. */
	readonly suspensionTorqueArmScale: number;

	// ---- tires ----
	/** Peak lateral grip acceleration (studs/s²) at full load, all contacts. */
	readonly lateralGripAccel: number;
	/** Lateral grip multiplier while drifting (near-ice, legacy 0.05/1.2). */
	readonly driftGripMult: number;
	/** Friction-budget cap for combined longitudinal+lateral tire accel. */
	readonly frictionBudgetAccel: number;

	// ---- drive ----
	/** Non-boost target speed (legacy targetVelocity × 0.8). */
	readonly topSpeed: number;
	/** Base drive acceleration at standstill. */
	readonly driveAccel: number;
	/** Gear-style force multipliers: [propVelocity limit, torque mult]. */
	readonly gearCurve: readonly (readonly [number, number])[];
	/** Reverse target speed as a fraction of topSpeed (legacy 0.3). */
	readonly reverseSpeedFrac: number;
	/** Brake (throttle against motion) accel multiplier (legacy 2.6). */
	readonly brakeAccelMult: number;
	/** Overspeed bleed accel multiplier once above target (legacy 2×). */
	readonly overspeedBrakeMult: number;
	/** Turn radius commanded at full steer (legacy minTurnRadius + 5). */
	readonly turnRadius: number;
	/** Yaw-rate servo acceleration budget (rad/s²), grip mode. */
	readonly gripYawAccel: number;
	/** Yaw budget while boosting (slightly looser, legacy 100 vs 112). */
	readonly boostYawAccel: number;

	// ---- drift / handbrake ----
	/** Commanded yaw rate at full steer + full speed while sliding (rad/s). */
	readonly driftYawRate: number;
	/** Yaw servo accel budget while sliding (decisively above grip). */
	readonly driftYawAccel: number;
	/** Engine force multiplier while sliding (a handbrake brakes). */
	readonly driftEngineMult: number;
	/** Speed scrub per unit travel speed while sliding (1/s). */
	readonly driftSpeedScrub: number;
	/** Centripetal side assist accel while sliding forward (studs/s²). */
	readonly driftSideAccel: number;
	/** Side-speed cap as a fraction of topSpeed (legacy 0.45). */
	readonly driftMaxSideFrac: number;
	/** Below this fraction of topSpeed the slide disengages (legacy 0.15). */
	readonly driftMinPropVel: number;

	// ---- boost ----
	readonly boostMax: number;
	/** Meter drained per second while boosting (legacy 4 per 0.2 s). */
	readonly boostDrainPerSecond: number;
	/** Ground boost accel as a multiple of driveAccel (legacy 4×1.25). */
	readonly boostAccelMult: number;
	/** Airborne boost accel multiple (legacy 4.5×1.25). */
	readonly boostAirAccelMult: number;
	/** Boost speed ceiling as a multiple of topSpeed (legacy 2.0). */
	readonly boostTargetMult: number;

	// ---- jump ----
	/** Seconds the jump force window stays on. */
	readonly jumpForceTime: number;
	/** Jump force as a multiple of gravity during the window. */
	readonly jumpGravityMult: number;
	/** Max tilt of the launch direction from vertical (rad). */
	readonly jumpMaxTilt: number;
	/** Seconds after the window before the next jump. */
	readonly jumpDebounce: number;
	/** Post-jump upright hold duration cap / landing grace. */
	readonly jumpUprightMaxTime: number;
	readonly jumpUprightLandGrace: number;

	// ---- aerial ----
	/** Angular acceleration budget for aerial control (rad/s²). */
	readonly aerialAccel: number;
	/** Commanded aerial rates: roll, yaw, pitch (rad/s). */
	readonly aerialRollRate: number;
	readonly aerialYawRate: number;
	readonly aerialPitchRate: number;

	// ---- upright / recovery ----
	/** Angular accel budget for slope-hug / post-jump upright hold. */
	readonly uprightAccel: number;
	/** Recovery flip: hold time, debounce, lift accel. */
	readonly flipHoldTime: number;
	readonly flipDebounce: number;
	readonly flipLiftAccel: number;

	// ---- coyote / external events ----
	/** Grounded grace after losing contact (jump eligibility, mode blend). */
	readonly coyoteTime: number;
	/** Seconds after a blast during which overspeed control is suppressed. */
	readonly blastControlHoldoff: number;

	// ---- ball interaction ----
	/** Ball-contact hitbox size (the analytic box BallSim reads). */
	readonly hitboxSize: Vector3;
	/** Hitbox center offset in root-local space. */
	readonly hitboxOffset: Vector3;
	/** Reciprocal ball-hit recoil on the car, as a fraction of the ball's
	 * velocity change scaled by ball/car mass ratio. 0 = RL rules (none). */
	readonly ballRecoil: number;
}

// Shared baseline every family derives from (legacy default car envelope).
const BASE = {
	mass: 400,
	boxFriction: 0.3,
	wheelRadius: 1.5,
	suspensionRest: 2.0,
	suspensionOmega: 12,
	suspensionZeta: 0.95,
	suspensionMaxDvScale: 0.6,
	suspensionTorqueArmScale: 0.5,
	lateralGripAccel: 240,
	driftGripMult: 0.06,
	frictionBudgetAccel: 390, // μ=2 engine ceiling ≈ 392 studs/s² (legacy note)
	topSpeed: 120,
	driveAccel: 62.5, // legacy acceleration 50 × DRIVE_FORCE_MULT 1.25
	gearCurve: [
		[0.4, 0.8],
		[0.7, 0.55],
		[1, 0.3],
	] as readonly (readonly [number, number])[],
	reverseSpeedFrac: 0.3,
	brakeAccelMult: 2.6,
	overspeedBrakeMult: 2,
	turnRadius: 48,
	gripYawAccel: 112,
	boostYawAccel: 100,
	driftYawRate: 8,
	driftYawAccel: 270,
	driftEngineMult: 0.25,
	driftSpeedScrub: 0.35,
	driftSideAccel: 30,
	driftMaxSideFrac: 0.45,
	driftMinPropVel: 0.15,
	boostMax: 100,
	boostDrainPerSecond: 20,
	boostAccelMult: 5, // legacy BOOST_FORCE_MULT 4 × DRIVE_FORCE_MULT 1.25
	boostAirAccelMult: 5.6,
	boostTargetMult: 2.0,
	jumpForceTime: 0.16,
	jumpGravityMult: 3.37,
	jumpMaxTilt: math.rad(60),
	jumpDebounce: 2,
	jumpUprightMaxTime: 2,
	jumpUprightLandGrace: 0.3,
	aerialAccel: 378,
	aerialRollRate: 6,
	aerialYawRate: 6,
	aerialPitchRate: 3,
	uprightAccel: 60,
	flipHoldTime: 1,
	flipDebounce: 3,
	flipLiftAccel: 80,
	coyoteTime: 0.1,
	blastControlHoldoff: 1.2,
	ballRecoil: 0, // Rocket League rules: the car feels nothing (BALL_PHYSICS.md)
};

function contacts(halfTrack: number, frontZ: number, backZ: number, y: number) {
	return [
		{ local: new Vector3(-halfTrack, y, -frontZ), steers: true }, // FL (forward = -Z)
		{ local: new Vector3(halfTrack, y, -frontZ), steers: true }, // FR
		{ local: new Vector3(-halfTrack, y, backZ), steers: false }, // BL
		{ local: new Vector3(halfTrack, y, backZ), steers: false }, // BR
	] as const;
}

function preset(id: string, over: Partial<PhysicsPreset> & Pick<PhysicsPreset, "boxSize">): PhysicsPreset {
	const box = over.boxSize;
	const defaults: Omit<PhysicsPreset, "id" | "boxSize"> = {
		...BASE,
		contacts: contacts(box.X * 0.42, box.Z * 0.36, box.Z * 0.36, -box.Y * 0.5),
		hitboxSize: new Vector3(box.X * 1.05, box.Y * 1.6, box.Z * 1.02),
		hitboxOffset: new Vector3(0, box.Y * 0.35, 0),
	};
	return { id, ...defaults, ...over };
}

// Preset families. Box sizes chosen from the catalogue's real footprint
// classes (compact cars, standard cars, sports cars, 6-wheel trucks, 8-wheel
// heavies) — VehicleDefs maps every template onto one of these.
export const PHYSICS_PRESETS: Record<string, PhysicsPreset> = {
	Standard: preset("Standard", {
		boxSize: new Vector3(7, 3, 14),
	}),
	Sport: preset("Sport", {
		boxSize: new Vector3(7, 2.6, 14),
		topSpeed: 140, // Lambo-class targetVelocity 175-200 × 0.8 envelope
		driveAccel: 70,
		turnRadius: 44,
	}),
	Compact: preset("Compact", {
		boxSize: new Vector3(6, 2.8, 11),
		topSpeed: 116,
		turnRadius: 42,
	}),
	Heavy: preset("Heavy", {
		boxSize: new Vector3(8, 3.6, 16),
		topSpeed: 104, // Abrams/APC class 100-130 × 0.8 envelope
		driveAccel: 55,
		turnRadius: 54,
		driftYawRate: 6.5,
	}),
	Truck: preset("Truck", {
		boxSize: new Vector3(8, 4, 18),
		topSpeed: 108,
		driveAccel: 55,
		turnRadius: 56,
		driftYawRate: 6.5,
	}),
};

export const DEFAULT_PRESET_ID = "Standard";

export function getPreset(id: unknown): PhysicsPreset {
	if (typeIs(id, "string")) {
		const found = PHYSICS_PRESETS[id];
		if (found !== undefined) {
			return found;
		}
	}
	return PHYSICS_PRESETS[DEFAULT_PRESET_ID];
}

/** Resolve the geometry-dependent portion of a tuning preset from a vehicle's
 * authored main hitbox. This must run identically on server and predicting
 * client using the replicated VehicleRoot.Size. */
export function getPresetForBox(id: unknown, boxSize: Vector3): PhysicsPreset {
	const base = getPreset(id);
	if (boxSize.X <= 0 || boxSize.Y <= 0 || boxSize.Z <= 0) {
		return base;
	}
	return {
		...base,
		boxSize,
		contacts: contacts(boxSize.X * 0.42, boxSize.Z * 0.36, boxSize.Z * 0.36, -boxSize.Y * 0.5),
		// VehicleRoot is placed directly at the authored HitboxMain pose, so
		// BallSim's query twin has the same exact envelope and zero offset.
		hitboxSize: boxSize,
		hitboxOffset: new Vector3(),
	};
}
