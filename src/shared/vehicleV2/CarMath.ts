// Vehicle V2 pure math — no Instance access, no engine queries, no side
// effects. Everything here is deterministic on identical inputs, which is
// what makes the sim resimulation-safe and lets tests/robloxShim.ts run these
// functions off-platform (tests/carMath.test.ts).

// ---- rigid body -----------------------------------------------------------

/** Diagonal inertia of a uniform box (local frame), kg·stud² per unit mass
 * convention (mass folded in). */
export function boxInertiaDiag(mass: number, size: Vector3): Vector3 {
	const k = mass / 12;
	return new Vector3(
		k * (size.Y * size.Y + size.Z * size.Z),
		k * (size.X * size.X + size.Z * size.Z),
		k * (size.X * size.X + size.Y * size.Y),
	);
}

export interface ImpulseResult {
	dv: Vector3;
	dw: Vector3;
}

/** Velocity deltas from a world-space impulse J applied at world point p on a
 * body at rotation `rot` (CFrame rotation only) with COM at `com`, mass m and
 * local diagonal inertia `inertiaDiag`. The torque arm can be scaled to trade
 * pitch/roll response for stability (preset suspensionTorqueArmScale). */
export function impulseAtPoint(
	impulse: Vector3,
	point: Vector3,
	com: Vector3,
	rot: CFrame,
	mass: number,
	inertiaDiag: Vector3,
	armScale: number,
): ImpulseResult {
	const dv = impulse.div(mass);
	const r = point.sub(com).mul(armScale);
	const torqueWorld = r.Cross(impulse);
	// world torque -> local, divide by diagonal inertia, back to world
	const torqueLocal = rot.VectorToObjectSpace(torqueWorld);
	const dwLocal = new Vector3(
		inertiaDiag.X > 0 ? torqueLocal.X / inertiaDiag.X : 0,
		inertiaDiag.Y > 0 ? torqueLocal.Y / inertiaDiag.Y : 0,
		inertiaDiag.Z > 0 ? torqueLocal.Z / inertiaDiag.Z : 0,
	);
	return { dv, dw: rot.VectorToWorldSpace(dwLocal) };
}

// ---- suspension -----------------------------------------------------------

export interface SuspensionInput {
	/** 0..1 spring compression (1 = fully compressed). */
	compression: number;
	/** Contact-point velocity projected on the contact normal (+ = separating). */
	normalVelocity: number;
	/** Suspension rest length (for converting compression to studs). */
	restLength: number;
	/** Natural frequency ω (rad/s) and damping ratio ζ. */
	omega: number;
	zeta: number;
	/** Mass share carried by this contact (usually mass/4). */
	massShare: number;
	dt: number;
	/** Per-tick Δv cap as multiple of (compression·rest)/dt. */
	maxDvScale: number;
}

/** Impulse magnitude along the contact normal for one suspension contact.
 * Spring-damper on compression + normal velocity; clamped so it never pulls
 * (≥0) and never exceeds the anti-slam Δv cap. Units: impulse (mass·studs/s). */
export function suspensionImpulse(s: SuspensionInput): number {
	const x = s.compression * s.restLength; // studs of compression
	const springAccel = s.omega * s.omega * x;
	const dampAccel = 2 * s.zeta * s.omega * -s.normalVelocity;
	let dvNormal = (springAccel + dampAccel) * s.dt;
	if (dvNormal < 0) {
		dvNormal = 0; // suspension never pulls the car down
	}
	const dvCap = s.dt > 0 ? (x / s.dt) * s.maxDvScale : 0;
	if (dvNormal > dvCap) {
		dvNormal = dvCap;
	}
	return dvNormal * s.massShare;
}

// ---- tires ----------------------------------------------------------------

export interface TireInput {
	/** Velocity along the steered forward axis (contact plane). */
	forwardVel: number;
	/** Velocity along the lateral axis (contact plane). */
	lateralVel: number;
	/** Desired forward accel from the drive model (may be ±). */
	driveAccel: number;
	/** Peak lateral grip accel for this contact. */
	lateralGripAccel: number;
	/** Combined friction budget accel for this contact. */
	frictionBudgetAccel: number;
	dt: number;
}

export interface TireResult {
	/** Accel along forward axis actually applied. */
	forwardAccel: number;
	/** Accel along lateral axis actually applied. */
	lateralAccel: number;
}

/** Mass carried by one of the currently active tire contacts. The returned
 * shares always sum back to the full chassis mass, so losing contacts does
 * not silently quarter the requested drive/grip acceleration. */
export function contactMassShare(totalMass: number, activeContacts: number): number {
	return activeContacts > 0 ? totalMass / activeContacts : 0;
}

/** Convert the signed forward-axis drive servo result into a positive thrust
 * magnitude along the selected boost direction. Past the target speed the
 * result is zero rather than turning a negative speed error into acceleration
 * via abs(). directionSign is +1 for forward and -1 for reverse. */
export function directedThrustAccel(driveAccelWanted: number, directionSign: -1 | 1, budget: number): number {
	return math.clamp(driveAccelWanted * directionSign, 0, math.max(budget, 0));
}

/** Bounded tire response with a friction circle: lateral grip tries to kill
 * lateral slip within dt (capped at the grip accel), then longitudinal drive
 * is fitted into the remaining budget — combined accel can never exceed the
 * friction budget, so braking+turning trades off naturally. */
export function tireAccel(t: TireInput): TireResult {
	// Lateral: kill the slip this tick, capped by grip.
	let lat = t.dt > 0 ? -t.lateralVel / t.dt : 0;
	if (lat > t.lateralGripAccel) {
		lat = t.lateralGripAccel;
	} else if (lat < -t.lateralGripAccel) {
		lat = -t.lateralGripAccel;
	}
	// Longitudinal into the remaining circle.
	const budget = t.frictionBudgetAccel;
	const latAbs = math.abs(lat);
	let remaining = 0;
	if (latAbs < budget) {
		remaining = math.sqrt(budget * budget - latAbs * latAbs);
	} else {
		// Lateral alone saturates the circle: scale it back onto the rim.
		lat = lat > 0 ? budget : -budget;
	}
	let fwd = t.driveAccel;
	if (fwd > remaining) {
		fwd = remaining;
	} else if (fwd < -remaining) {
		fwd = -remaining;
	}
	return { forwardAccel: fwd, lateralAccel: lat };
}

/** Gear-style drive force multiplier from the preset curve. `propVelocity` is
 * |forward speed| / topSpeed. Mirrors the legacy GEAR_LIMITS/GEAR_TORQUES
 * shape: mult = torque + limit − propVelocity for the first matching gear. */
export function gearMultiplier(curve: readonly (readonly [number, number])[], propVelocity: number): number {
	for (const gear of curve) {
		const limit = gear[0];
		if (propVelocity <= limit) {
			return gear[1] + limit - propVelocity;
		}
	}
	return curve.size() > 0 ? curve[curve.size() - 1][1] : 1;
}

/** Signed angle (rad) from `from` to `to` about `axis`, both projected onto
 * the plane perpendicular to `axis`. Positive follows the right-hand rule
 * about `axis`. Returns 0 when either projection is degenerate. */
export function signedPlanarAngle(from: Vector3, to: Vector3, axis: Vector3): number {
	const fromPlane = from.sub(axis.mul(from.Dot(axis)));
	const toPlane = to.sub(axis.mul(to.Dot(axis)));
	if (fromPlane.Magnitude < 1e-6 || toPlane.Magnitude < 1e-6) {
		return 0;
	}
	return math.atan2(fromPlane.Cross(toPlane).Dot(axis), fromPlane.Dot(toPlane));
}

// ---- angular servos -------------------------------------------------------

/** Δ angular velocity toward `targetRate` about an axis, budgeted by
 * `accel` (rad/s²) over dt. */
export function servoDeltaOmega(currentRate: number, targetRate: number, accel: number, dt: number): number {
	const want = targetRate - currentRate;
	const cap = accel * dt;
	if (want > cap) {
		return cap;
	}
	if (want < -cap) {
		return -cap;
	}
	return want;
}

// ---- frame-rate-invariant decay ------------------------------------------

/** Exponential decay factor with an exact half-life, stable across render
 * frame rates: returns the fraction of the error that REMAINS after dt. */
export function decayRemaining(dt: number, halfLife: number): number {
	if (halfLife <= 0) {
		return 0;
	}
	return math.pow(0.5, dt / halfLife);
}

// ---- render error-offset transforms --------------------------------------
// Invariant: visible = sim · offset, with `offset` a LOCAL-space CFrame.
// (See VEHICLE_V2_ADR.md §3 corrected-present reconciliation.)

/** Recompute the offset after a sim discontinuity so the visible pose is
 * unchanged: offset' = simNew⁻¹ · visiblePrev (C0 continuity under
 * simultaneous translation + rotation — covered by tests). */
export function recomputeOffset(simNew: CFrame, visiblePrev: CFrame): CFrame {
	return simNew.Inverse().mul(visiblePrev);
}

/** Compose the visible pose from sim pose and offset. */
export function composeVisible(sim: CFrame, offset: CFrame): CFrame {
	return sim.mul(offset);
}

/** Decay an offset toward identity: position by exponential half-life,
 * rotation by shortest-path slerp with its own half-life. */
export function decayOffset(offset: CFrame, dt: number, posHalfLife: number, rotHalfLife: number): CFrame {
	const remainPos = decayRemaining(dt, posHalfLife);
	const remainRot = decayRemaining(dt, rotHalfLife);
	const pos = offset.Position.mul(remainPos);
	// CFrame.Lerp performs shortest-path spherical interpolation on rotation.
	const rot = offset.Rotation.Lerp(new CFrame(), 1 - remainRot);
	return rot.add(pos);
}

/** Magnitudes of an offset: position studs + rotation radians. */
export function offsetMagnitudes(offset: CFrame): { pos: number; rot: number } {
	const [, angle] = offset.Rotation.ToAxisAngle();
	return { pos: offset.Position.Magnitude, rot: math.abs(angle) };
}
