// Tests for shared/vehicleV2/CorrectionPolicy.ts severity bands + context.

/* eslint-disable */
declare const check: (condition: boolean, label: string) => void;
declare const checkNear: (actual: number, expected: number, tolerance: number, label: string) => void;

import {
	decideCorrection,
	discontinuityThresholds,
	isNoise,
	Severity,
} from "shared/vehicleV2/CorrectionPolicy";

const CTX = {
	vehicleLength: 12,
	speed: 0,
	airborne: false,
	landing: false,
	nearBall: false,
	blastEvent: false,
};

// Band classification (budgets: VEHICLE_V2_ACCEPTANCE.md §3, L = 12).
check(decideCorrection(0.05, 0, CTX).severity === Severity.Noise, "0.05 studs is noise");
check(decideCorrection(0.5, 0, CTX).severity === Severity.Small, "0.5 studs is small");
check(decideCorrection(2, 0, CTX).severity === Severity.Medium, "2 studs is medium");
check(decideCorrection(8, 0, CTX).severity === Severity.Large, "8 studs is large");
check(decideCorrection(40, 0, CTX).severity === Severity.Catastrophic, "40 studs snaps");
check(decideCorrection(0, math.rad(120), CTX).severity === Severity.Catastrophic, "120 deg snaps");
check(decideCorrection(0, math.rad(10), CTX).severity === Severity.Medium, "10 deg is medium");

// Catastrophic always snaps (0 half-life).
check(decideCorrection(40, 0, CTX).posHalfLife === 0, "catastrophic pos half-life 0");

// Context multipliers.
{
	const base = decideCorrection(2, 0, CTX);
	const air = decideCorrection(2, 0, { ...CTX, airborne: true });
	const ball = decideCorrection(2, 0, { ...CTX, nearBall: true });
	const blast = decideCorrection(2, 0, { ...CTX, blastEvent: true });
	check(air.posHalfLife > base.posHalfLife, "airborne corrections glide longer");
	check(ball.posHalfLife < base.posHalfLife, "near-ball corrections favor truth");
	check(blast.posHalfLife < base.posHalfLife, "blast corrections favor truth");
}

// Severity ordering: bigger error never decays slower.
{
	const small = decideCorrection(0.5, 0, CTX);
	const medium = decideCorrection(2, 0, CTX);
	const large = decideCorrection(8, 0, CTX);
	check(small.posHalfLife <= medium.posHalfLife && medium.posHalfLife <= large.posHalfLife,
		"half-life grows with band, correction rate stays proportionate");
}

// Noise gate.
check(isNoise(0.1, 0, 12), "tiny pos error is noise");
check(!isNoise(0.5, 0, 12), "0.5 studs is not noise");
check(!isNoise(0, math.rad(2), 12), "2 deg is not noise");

// Discontinuity thresholds scale with speed and dt.
{
	const slow = discontinuityThresholds(0, 1 / 60);
	const fast = discontinuityThresholds(120, 1 / 60);
	check(fast.pos > slow.pos, "position threshold grows with speed");
	check(slow.pos > 0 && slow.rot > 0, "thresholds positive");
	check(fast.pos < 0.25, "race-speed 60 FPS threshold cannot hide a visible correction");
	const thirtyFps = discontinuityThresholds(120, 1 / 30);
	check(thirtyFps.pos < 0.25, "race-speed 30 FPS threshold cannot hide a visible correction");
	const bigDt = discontinuityThresholds(120, 1 / 15);
	check(bigDt.pos > fast.pos, "position threshold grows with dt");
}
