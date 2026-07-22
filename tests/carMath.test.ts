// Pure-math tests for shared/vehicleV2/CarMath.ts (run by tools/runTests.js
// under the tests/robloxShim.js Roblox datatype shims).

/* eslint-disable */
declare const check: (condition: boolean, label: string) => void;
declare const checkNear: (actual: number, expected: number, tolerance: number, label: string) => void;

import {
	boxInertiaDiag,
	contactMassShare,
	composeVisible,
	decayOffset,
	decayRemaining,
	directedThrustAccel,
	gearMultiplier,
	impulseAtPoint,
	offsetMagnitudes,
	recomputeOffset,
	servoDeltaOmega,
	signedPlanarAngle,
	suspensionImpulse,
	tireAccel,
} from "shared/vehicleV2/CarMath";

// ---- inertia ---------------------------------------------------------------
{
	const inertia = boxInertiaDiag(400, new Vector3(7, 3, 14));
	check(inertia.X > 0 && inertia.Y > 0 && inertia.Z > 0, "box inertia positive");
	// Long axis (Z) resists rotation least about itself: Iz uses X,Y only.
	check(inertia.Y > inertia.Z, "yaw inertia (Y) exceeds roll inertia (Z) for a long box");
}

// ---- impulse application ---------------------------------------------------
{
	const rot = CFrame.Angles(0, math.rad(30), 0);
	const inertia = boxInertiaDiag(400, new Vector3(7, 3, 14));
	const com = new Vector3(10, 5, -3);
	// Central impulse: pure linear response.
	const central = impulseAtPoint(new Vector3(0, 400, 0), com, com, rot, 400, inertia, 1);
	checkNear(central.dv.Y, 1, 1e-9, "central impulse dv = J/m");
	checkNear(central.dw.Magnitude, 0, 1e-9, "central impulse has no angular response");
	// Offset impulse with armScale 0: torque suppressed entirely.
	const flat = impulseAtPoint(new Vector3(0, 400, 0), com.add(new Vector3(3, 0, 0)), com, rot, 400, inertia, 0);
	checkNear(flat.dw.Magnitude, 0, 1e-9, "armScale 0 suppresses torque");
	// Offset impulse (up at +X arm): torque about -Z (roll), right-hand rule r×J.
	const rolled = impulseAtPoint(new Vector3(0, 400, 0), com.add(new Vector3(3, 0, 0)), com, new CFrame(), 400, inertia, 1);
	check(rolled.dw.Z > 0, "up impulse at +X arm rolls about +Z (r cross J)");
	check(math.abs(rolled.dw.X) < 1e-9 && math.abs(rolled.dw.Y) < 1e-9, "no spurious pitch/yaw from X-arm up impulse");
}

// ---- suspension ------------------------------------------------------------
{
	const base = {
		compression: 0,
		normalVelocity: 0,
		restLength: 2,
		omega: 12,
		zeta: 0.95,
		massShare: 100,
		dt: 1 / 30,
		maxDvScale: 0.6,
	};
	check(suspensionImpulse(base) === 0, "zero compression => zero impulse");
	check(suspensionImpulse({ ...base, compression: 0.5 }) > 0, "compression produces impulse");
	// Fast separation: damping cancels spring, clamps at zero (never pulls).
	check(suspensionImpulse({ ...base, compression: 0.2, normalVelocity: 100 }) === 0, "suspension never pulls");
	// Anti-slam cap: deep compression cannot exceed maxDvScale × x/dt.
	const deep = suspensionImpulse({ ...base, compression: 1 });
	const capDv = (1 * base.restLength / base.dt) * base.maxDvScale;
	check(deep <= capDv * base.massShare + 1e-6, "anti-slam dv cap respected");
}

// ---- tires -----------------------------------------------------------------
{
	const dt = 1 / 30;
	const res = tireAccel({
		forwardVel: 30,
		lateralVel: 15,
		driveAccel: 300,
		lateralGripAccel: 240,
		frictionBudgetAccel: 390,
		dt,
	});
	const combined = math.sqrt(res.forwardAccel * res.forwardAccel + res.lateralAccel * res.lateralAccel);
	check(combined <= 390 + 1e-6, "friction circle bounds combined accel");
	check(res.lateralAccel < 0, "lateral accel opposes lateral slip");
	// Small slip is killed exactly within the tick.
	const gentle = tireAccel({ forwardVel: 0, lateralVel: 0.5, driveAccel: 0, lateralGripAccel: 240, frictionBudgetAccel: 390, dt });
	checkNear(gentle.lateralAccel, -0.5 / dt, 1e-6, "small lateral slip killed within dt");
	// Lateral saturation scales back onto the circle rim.
	const saturated = tireAccel({ forwardVel: 0, lateralVel: 1000, driveAccel: 200, lateralGripAccel: 800, frictionBudgetAccel: 390, dt });
	checkNear(math.abs(saturated.lateralAccel), 390, 1e-6, "saturated lateral clamps to budget");
	checkNear(saturated.forwardAccel, 0, 1e-6, "no longitudinal budget left when lateral saturates");
}

// Contact force distribution: active shares always conserve the chassis mass.
checkNear(contactMassShare(400, 4) * 4, 400, 1e-9, "four tire shares conserve mass");
checkNear(contactMassShare(400, 2) * 2, 400, 1e-9, "two tire shares conserve mass");
checkNear(contactMassShare(400, 1), 400, 1e-9, "belly fallback carries full mass");
checkNear(contactMassShare(400, 0), 0, 1e-9, "zero contacts has zero share");

// Air boost only thrusts toward its signed target; overspeed never becomes
// more acceleration through an absolute-value sign loss.
checkNear(directedThrustAccel(80, 1, 100), 80, 1e-9, "forward boost thrusts below target");
checkNear(directedThrustAccel(-20, 1, 100), 0, 1e-9, "forward boost stops above target");
checkNear(directedThrustAccel(-80, -1, 100), 80, 1e-9, "reverse boost thrusts below target");
checkNear(directedThrustAccel(20, -1, 100), 0, 1e-9, "reverse boost stops above target");
checkNear(directedThrustAccel(200, 1, 100), 100, 1e-9, "boost respects acceleration budget");

// ---- gear curve ------------------------------------------------------------
{
	const curve: readonly (readonly [number, number])[] = [
		[0.4, 0.8],
		[0.7, 0.55],
		[1, 0.3],
	];
	// Legacy formula: mult = torque + limit - propVelocity for first gear match.
	checkNear(gearMultiplier(curve, 0), 0.8 + 0.4, 1e-9, "gear curve at standstill");
	checkNear(gearMultiplier(curve, 0.5), 0.55 + 0.7 - 0.5, 1e-9, "gear curve mid");
	checkNear(gearMultiplier(curve, 1), 0.3, 1e-9, "gear curve at top speed");
	checkNear(gearMultiplier(curve, 2), 0.3, 1e-9, "beyond top speed uses last gear torque");
}

// ---- slip angle (drift model) ----------------------------------------------
{
	const up = new Vector3(0, 1, 0);
	const north = new Vector3(0, 0, -1);
	checkNear(signedPlanarAngle(north, north, up), 0, 1e-9, "aligned vectors have zero slip");
	// Nose 30° right of travel (clockwise from above) = NEGATIVE angle about +Y.
	const noseRight = new Vector3(math.sin(math.rad(30)), 0, -math.cos(math.rad(30)));
	checkNear(signedPlanarAngle(north, noseRight, up), -math.rad(30), 1e-9, "nose right of travel is negative");
	checkNear(signedPlanarAngle(noseRight, north, up), math.rad(30), 1e-9, "swapping arguments flips the sign");
	// Out-of-plane components are projected away before measuring.
	const tilted = noseRight.add(up.mul(5));
	checkNear(signedPlanarAngle(north, tilted, up), -math.rad(30), 1e-9, "axis component is projected out");
	checkNear(signedPlanarAngle(north, north.mul(-1), up), math.pi, 1e-6, "opposed vectors measure pi");
	checkNear(signedPlanarAngle(north, up, up), 0, 1e-9, "degenerate projection returns 0");
}

// ---- servo -----------------------------------------------------------------
{
	checkNear(servoDeltaOmega(0, 10, 30, 0.1), 3, 1e-9, "servo clamps to accel*dt");
	checkNear(servoDeltaOmega(9.9, 10, 30, 0.1), 0.1, 1e-9, "servo does not overshoot");
	checkNear(servoDeltaOmega(12, 10, 30, 0.1), -2, 1e-9, "servo brakes overshoot");
}

// ---- decay & offsets -------------------------------------------------------
{
	checkNear(decayRemaining(0.1, 0.1), 0.5, 1e-9, "half-life is exact");
	// Frame-rate invariance: two half-steps equal one full step.
	const twoSteps = decayRemaining(0.05, 0.1) * decayRemaining(0.05, 0.1);
	checkNear(twoSteps, decayRemaining(0.1, 0.1), 1e-9, "decay is frame-rate invariant");
	check(decayRemaining(0.1, 0) === 0, "zero half-life snaps");
}

{
	// Corrected-present invariant: compose(Snew, recompute(Snew, V)) == V,
	// under simultaneous translation AND rotation.
	const V = CFrame.Angles(0.3, -0.8, 0.2).add(new Vector3(12, 5, -40));
	const Snew = CFrame.Angles(-0.1, 0.5, 0.05).add(new Vector3(14, 4.5, -38));
	const offset = recomputeOffset(Snew, V);
	const restored = composeVisible(Snew, offset);
	checkNear(restored.Position.sub(V.Position).Magnitude, 0, 1e-6, "offset recompute preserves visible position");
	const [, angleErr] = restored.Rotation.ToObjectSpace(V.Rotation).ToAxisAngle();
	checkNear(math.abs(angleErr), 0, 1e-6, "offset recompute preserves visible rotation");

	// Decay converges to identity and halves position at the half-life.
	const half = decayOffset(offset, 0.1, 0.1, 0.1);
	checkNear(half.Position.Magnitude, offset.Position.Magnitude * 0.5, 1e-6, "position halves at half-life");
	let settled = offset;
	for (let i = 0; i < 200; i++) {
		settled = decayOffset(settled, 1 / 60, 0.06, 0.05);
	}
	const mags = offsetMagnitudes(settled);
	check(mags.pos < 1e-6 && mags.rot < 1e-4, "offset decays to identity");
}
