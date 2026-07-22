// Pure collision helpers for BallSim. Kept Instance-free so swept-contact
// behavior can be regression-tested off-platform.

export interface PointAabbHit {
	/** Segment time in the inclusive range 0..1. */
	time: number;
	/** Outward normal of the expanded AABB face entered by the point. */
	normal: Vector3;
}

/** Sweep a point from start through delta against an axis-aligned box centered
 * at the origin. The caller expands halfSize by the sphere radius (Minkowski
 * sum), making this a conservative swept-sphere-vs-box test. */
export function sweepPointAabb(start: Vector3, delta: Vector3, halfSize: Vector3): PointAabbHit | undefined {
	let enter = 0;
	let exit = 1;
	let enterNormal = new Vector3();

	const axis = (s: number, d: number, half: number, positiveAxis: Vector3): boolean => {
		if (math.abs(d) < 1e-8) {
			return s >= -half && s <= half;
		}
		let near: number;
		let far: number;
		let normal: Vector3;
		if (d > 0) {
			near = (-half - s) / d;
			far = (half - s) / d;
			normal = positiveAxis.mul(-1);
		} else {
			near = (half - s) / d;
			far = (-half - s) / d;
			normal = positiveAxis;
		}
		if (near > enter) {
			enter = near;
			enterNormal = normal;
		}
		exit = math.min(exit, far);
		return enter <= exit;
	};

	if (
		!axis(start.X, delta.X, halfSize.X, new Vector3(1, 0, 0)) ||
		!axis(start.Y, delta.Y, halfSize.Y, new Vector3(0, 1, 0)) ||
		!axis(start.Z, delta.Z, halfSize.Z, new Vector3(0, 0, 1))
	) {
		return undefined;
	}
	if (exit < 0 || enter > 1 || enter < 0 || enterNormal.Magnitude < 0.5) {
		return undefined;
	}
	return { time: enter, normal: enterNormal };
}
