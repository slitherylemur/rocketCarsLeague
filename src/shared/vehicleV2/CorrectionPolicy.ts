// Render-correction policy — pure decision logic for the corrected-present
// error offset (VEHICLE_V2_ADR.md §3, budgets in VEHICLE_V2_ACCEPTANCE.md §3
// — keep the two in sync). No Instance access; unit-tested off-platform.

export enum Severity {
	Noise = 0,
	Small = 1,
	Medium = 2,
	Large = 3,
	Catastrophic = 4,
}

export interface CorrectionContext {
	/** Vehicle length (studs) for normalization. */
	vehicleLength: number;
	/** Current speed (studs/s). */
	speed: number;
	airborne: boolean;
	/** True within the landing window (just regained contact). */
	landing: boolean;
	/** Within 25 studs of ball or goal plane — truth matters more. */
	nearBall: boolean;
	/** External impulse event (BlastGen bumped) — correct fast. */
	blastEvent: boolean;
}

export interface CorrectionDecision {
	severity: Severity;
	/** Half-lives (seconds); 0 = snap this component. */
	posHalfLife: number;
	rotHalfLife: number;
}

// Band thresholds (fractions of vehicle length / radians) — acceptance §3.
const NOISE_POS = 0.015;
const NOISE_ROT = math.rad(0.5);
const SMALL_POS = 0.1;
const SMALL_ROT = math.rad(6);
const MEDIUM_POS = 0.45;
const MEDIUM_ROT = math.rad(25);
const LARGE_POS = 2.5;
const LARGE_ROT = math.rad(90);

const HALF_LIVES: Record<number, { pos: number; rot: number }> = {
	[Severity.Noise]: { pos: 0.06, rot: 0.05 }, // (held, not engaged — see deadzone)
	[Severity.Small]: { pos: 0.06, rot: 0.05 },
	[Severity.Medium]: { pos: 0.11, rot: 0.09 },
	[Severity.Large]: { pos: 0.18, rot: 0.14 },
	[Severity.Catastrophic]: { pos: 0, rot: 0 },
};

/** Hard cap on visual-to-sim divergence (× vehicle length) before snapping. */
export const MAX_DIVERGENCE_LENGTHS = 3;

/** Classify a correction and choose decay half-lives. `posError` in studs,
 * `rotError` in radians — magnitudes of the recomputed offset. */
export function decideCorrection(posError: number, rotError: number, ctx: CorrectionContext): CorrectionDecision {
	const L = ctx.vehicleLength > 0 ? ctx.vehicleLength : 12;
	const posN = posError / L;

	let severity: Severity;
	if (posN >= LARGE_POS || rotError >= LARGE_ROT || posN >= MAX_DIVERGENCE_LENGTHS) {
		severity = Severity.Catastrophic;
	} else if (posN >= MEDIUM_POS || rotError >= MEDIUM_ROT) {
		severity = Severity.Large;
	} else if (posN >= SMALL_POS || rotError >= SMALL_ROT) {
		severity = Severity.Medium;
	} else if (posN >= NOISE_POS || rotError >= NOISE_ROT) {
		severity = Severity.Small;
	} else {
		severity = Severity.Noise;
	}

	const base = HALF_LIVES[severity];
	let pos = base.pos;
	let rot = base.rot;
	// Context multipliers (acceptance §3): airborne has no ground reference so
	// corrections can glide longer; landing + ball/goal proximity + blast
	// events need truth fast; a small forward error at speed is less visible,
	// so high speed relaxes position slightly.
	if (severity !== Severity.Catastrophic) {
		if (ctx.airborne) {
			pos *= 1.4;
			rot *= 1.4;
		}
		if (ctx.landing) {
			pos *= 0.6;
			rot *= 0.6;
		}
		if (ctx.nearBall) {
			pos *= 0.5;
			rot *= 0.5;
		}
		if (ctx.blastEvent) {
			pos *= 0.5;
			rot *= 0.5;
		}
		if (ctx.speed > 60) {
			pos *= 1.15;
		}
	}
	return { severity, posHalfLife: pos, rotHalfLife: rot };
}

/** Dead-zone with hysteresis: an offset below the release threshold clears
 * outright; corrections in the noise band do not (re-)engage smoothing. */
export function isNoise(posError: number, rotError: number, vehicleLength: number): boolean {
	const L = vehicleLength > 0 ? vehicleLength : 12;
	return posError / L < NOISE_POS && rotError < NOISE_ROT;
}

/** Discontinuity thresholds for detecting a sim correction from frame-to-
 * frame extrapolation error: base plus a speed-proportional allowance (the
 * engine integrates nonlinearly; fast motion accrues honest divergence). */
export function discontinuityThresholds(speed: number, dt: number): { pos: number; rot: number } {
	return {
		// Velocity integration is predicted with a trapezoidal estimate in the
		// renderer. Only retain a small allowance for solver/contact error;
		// scaling by most of a frame's travel hid 1-3 stud corrections at race
		// speed and allowed them to snap straight into the presentation.
		pos: 0.08 + math.min(speed * dt * 0.04, 0.12),
		rot: math.rad(0.75) + dt * math.rad(15),
	};
}
