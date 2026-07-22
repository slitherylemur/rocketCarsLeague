// Per-template collision geometry must resolve identically on both peers.

/* eslint-disable */
declare const check: (condition: boolean, label: string) => void;
declare const checkNear: (actual: number, expected: number, tolerance: number, label: string) => void;

import { getPresetForBox } from "shared/vehicleV2/PhysicsPresets";

const authoredBox = new Vector3(9.25, 3.4, 17.75);
const resolved = getPresetForBox("Sport", authoredBox);

check(resolved.boxSize === authoredBox, "resolved preset preserves authored HitboxMain size");
check(resolved.hitboxSize === authoredBox, "ball contact preserves authored HitboxMain size");
checkNear(resolved.hitboxOffset.Magnitude, 0, 1e-9, "root and ball hitbox share the authored pose");
checkNear(resolved.contacts[0].local.X, -authoredBox.X * 0.42, 1e-9, "left contact scales with width");
checkNear(resolved.contacts[1].local.X, authoredBox.X * 0.42, 1e-9, "right contact scales with width");
checkNear(resolved.contacts[0].local.Z, -authoredBox.Z * 0.36, 1e-9, "front contact scales with length");
checkNear(resolved.contacts[2].local.Z, authoredBox.Z * 0.36, 1e-9, "rear contact scales with length");
checkNear(resolved.contacts[0].local.Y, -authoredBox.Y * 0.5, 1e-9, "ray hardpoint scales with height");
checkNear(resolved.topSpeed, 140, 1e-9, "template geometry does not replace family movement tuning");
