/* eslint-disable */
declare const check: (condition: boolean, label: string) => void;
declare const checkNear: (actual: number, expected: number, tolerance: number, label: string) => void;

import { sweepPointAabb } from "shared/ballSim/BallMath";

{
	const hit = sweepPointAabb(new Vector3(-5, 0, 0), new Vector3(10, 0, 0), new Vector3(1, 1, 1));
	check(hit !== undefined, "fast segment hits expanded box");
	if (hit) {
		checkNear(hit.time, 0.4, 1e-9, "sweep returns first time of impact");
		checkNear(hit.normal.X, -1, 1e-9, "sweep returns entry face normal");
	}
}

check(
	sweepPointAabb(new Vector3(-5, 2, 0), new Vector3(10, 0, 0), new Vector3(1, 1, 1)) === undefined,
	"parallel segment outside a slab misses",
);
check(
	sweepPointAabb(new Vector3(-100, 0, 0), new Vector3(200, 0, 0), new Vector3(2, 2, 2)) !== undefined,
	"continuous sweep cannot tunnel across a thin box",
);
check(
	sweepPointAabb(new Vector3(-5, 0, 0), new Vector3(-10, 0, 0), new Vector3(1, 1, 1)) === undefined,
	"segment moving away from box misses",
);
