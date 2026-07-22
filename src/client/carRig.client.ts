// Vehicle V2 client renderer — the presentation boundary for every V2 car.
//
//   - Builds a render RIG from the model's RenderSource (server-authored
//     anchored cosmetic parts + RS_Offset root-local poses). The rig IS the
//     RenderSource parts, CFramed locally every frame: there is exactly one
//     copy of the geometry, physics never touches it, and a rendered wheel is
//     a mathematical child of the rendered chassis — body/wheel separation is
//     impossible by construction (gates G-2/G-3).
//
//   - LOCAL CAR: corrected-present reconciliation (VEHICLE_V2_ADR.md §3).
//     Invariant: visible = sim ⋅ offset. A correction is a discontinuity of
//     the sim pose against its velocity-extrapolated continuation; on
//     detection the offset is RECOMPUTED (offset ← simNew⁻¹ ⋅ visiblePrev) so
//     the visible pose stays continuous, then decays to identity with
//     severity-banded frame-rate-invariant half-lives (CorrectionPolicy).
//     It never chases the historical authoritative snapshot and never
//     accumulates Misprediction deltas — Misprediction feeds telemetry only,
//     so nothing here depends on unverified event timing. Zero offset ⇒ the
//     visible pose IS the predicted pose: no added latency (gate G-6).
//
//   - REMOTE CARS: timestamped snapshot buffer at a jitter-adaptive delay,
//     velocity-aware Hermite position interpolation + slerped rotation,
//     bounded extrapolation, hold+recover (no moving-target chase filter).
//
//   - TELEPORTS (TeleportGen) snap; BLASTS (BlastGen) correct fast; visible
//     penetration of world geometry snaps the position component.
//
//   - CAMERA follows a dedicated anchor on the RENDERED pose, never the
//     rollbacked sim proxy.

import { CarAttr, CarModelAttr, RigWheelAttr } from "shared/vehicleV2/CarState";
import { composeVisible, decayOffset, offsetMagnitudes, recomputeOffset } from "shared/vehicleV2/CarMath";
import {
	decideCorrection,
	discontinuityThresholds,
	isNoise,
	MAX_DIVERGENCE_LENGTHS,
	Severity,
} from "shared/vehicleV2/CorrectionPolicy";
import { getPreset } from "shared/vehicleV2/PhysicsPresets";
import * as CarSim from "shared/vehicleV2/CarSim";
import { RENDER_DEBUG_OVERLAY } from "shared/vehicleV2/FeatureFlags";

const RunService = game.GetService("RunService");
const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;

const RENDER_BIND_NAME = "CarRigBeforeCamera";
const RS_OFFSET_ATTR = "RS_Offset";

// Remote interpolation tuning.
const SNAP_BUFFER = 32;
const MIN_DELAY = 0.06; // never render closer to "now" than this
const MAX_DELAY = 0.35;
const MAX_EXTRAPOLATION = 0.25;
const REMOTE_TELEPORT_SNAP = 60;

interface RigPart {
	part: BasePart;
	offset: CFrame;
}

interface RigWheel {
	part: BasePart;
	localPos: Vector3;
	radius: number;
	steers: boolean;
	contactIndex: number;
	spinAngle: number;
	trail?: Trail;
}

interface Snapshot {
	t: number;
	cf: CFrame;
	v: Vector3;
}

interface Rig {
	model: Model;
	root: BasePart;
	preset: ReturnType<typeof getPreset>;
	isLocal: boolean;
	parts: RigPart[];
	wheels: RigWheel[];
	cameraTarget: BasePart;
	connections: RBXScriptConnection[];
	// generation tracking
	lastTeleportGen: number;
	lastBlastGen: number;
	blastFastUntil: number;
	// local correction state
	offset: CFrame;
	posHalfLife: number;
	rotHalfLife: number;
	severity: Severity;
	lastSimCF?: CFrame;
	lastSimVel: Vector3;
	lastSimAngVel: Vector3;
	// remote snapshot state
	snaps: Snapshot[];
	renderDelay: number;
	lastRemoteCF?: CFrame;
	// wheel steering visual state
	steerVisual: number;
	initialized: boolean;
}

const rigs = new Map<Model, Rig>();
let cameraSubjectOwned = false;

// ---- telemetry (read by netHealth) ----------------------------------------

export interface CorrectionTelemetry {
	count: number;
	snapCount: number;
	maxOffset: number;
	lastSeverity: number;
}
const telemetry: CorrectionTelemetry = { count: 0, snapCount: 0, maxOffset: 0, lastSeverity: 0 };

function attrNumber(instance: Instance, name: string, fallback: number): number {
	const value = instance.GetAttribute(name);
	return typeIs(value, "number") ? value : fallback;
}

// ---- rig construction -----------------------------------------------------

function buildRig(model: Model) {
	if (rigs.has(model) || !CarSim.isV2Model(model)) {
		return;
	}
	task.spawn(() => {
		const root = model.WaitForChild("VehicleRoot", 20) as BasePart | undefined;
		const renderSource = model.WaitForChild("RenderSource", 20);
		if (!root || !root.IsA("BasePart") || !renderSource || model.Parent === undefined || rigs.has(model)) {
			return;
		}

		const cameraTarget = new Instance("Part");
		cameraTarget.Name = "CarRigCameraTarget";
		cameraTarget.Size = new Vector3(1, 1, 1);
		cameraTarget.Transparency = 1;
		cameraTarget.Anchored = true;
		cameraTarget.CanCollide = false;
		cameraTarget.CanQuery = false;
		cameraTarget.CanTouch = false;
		cameraTarget.CFrame = root.CFrame;
		cameraTarget.Parent = game.Workspace;

		const rig: Rig = {
			model,
			root,
			preset: getPreset(model.GetAttribute(CarModelAttr.PresetId)),
			isLocal: model.GetAttribute(CarModelAttr.OwnerUserId) === LocalPlayer.UserId,
			parts: [],
			wheels: [],
			cameraTarget,
			connections: [],
			lastTeleportGen: attrNumber(root, CarAttr.TeleportGen, 0),
			lastBlastGen: attrNumber(root, CarAttr.BlastGen, 0),
			blastFastUntil: 0,
			offset: new CFrame(),
			posHalfLife: 0.06,
			rotHalfLife: 0.05,
			severity: Severity.Noise,
			lastSimVel: new Vector3(),
			lastSimAngVel: new Vector3(),
			snaps: [],
			renderDelay: 0.1,
			steerVisual: 0,
			initialized: false,
		};

		const adopt = (child: Instance) => {
			if (!child.IsA("BasePart") || rigs.get(model) !== rig) {
				return;
			}
			const offset = child.GetAttribute(RS_OFFSET_ATTR);
			if (!typeIs(offset, "CFrame")) {
				return;
			}
			const contactIndex = child.GetAttribute(RigWheelAttr.ContactIndex);
			if (typeIs(contactIndex, "number")) {
				const localPos = child.GetAttribute(RigWheelAttr.LocalPos);
				const radius = child.GetAttribute(RigWheelAttr.Radius);
				const trail = child.FindFirstChildOfClass("Trail");
				rig.wheels.push({
					part: child,
					localPos: typeIs(localPos, "Vector3") ? localPos : offset.Position,
					radius: typeIs(radius, "number") ? radius : rig.preset.wheelRadius,
					steers: child.GetAttribute(RigWheelAttr.Steers) === true,
					contactIndex,
					spinAngle: 0,
					trail,
				});
			} else {
				rig.parts.push({ part: child, offset });
			}
		};

		rigs.set(model, rig);
		// Cosmetic parts are stamped with RS_Offset wherever they live in the
		// model (body parts keep their authored hierarchy for the paint/skin
		// code; rig wheels live under RenderSource) — adopt across the model.
		for (const child of model.GetDescendants()) {
			adopt(child);
		}
		rig.connections.push(model.DescendantAdded.Connect(adopt));
		rig.connections.push(
			model.GetAttributeChangedSignal(CarModelAttr.OwnerUserId).Connect(() => {
				rig.isLocal = model.GetAttribute(CarModelAttr.OwnerUserId) === LocalPlayer.UserId;
			}),
		);
	});
}

function destroyRig(model: Model) {
	const rig = rigs.get(model);
	if (!rig) {
		return;
	}
	rigs.delete(model);
	for (const connection of rig.connections) {
		connection.Disconnect();
	}
	// Release the camera only if THIS rig owns it — tearing down a remote car
	// must not yank the subject off the local driven car for a frame.
	const camera = game.Workspace.CurrentCamera;
	if (camera && camera.CameraSubject === rig.cameraTarget) {
		releaseCameraSubject();
	}
	rig.cameraTarget.Destroy();
}

// ---- camera ----------------------------------------------------------------

function releaseCameraSubject() {
	if (!cameraSubjectOwned) {
		return;
	}
	cameraSubjectOwned = false;
	const camera = game.Workspace.CurrentCamera;
	if (!camera) {
		return;
	}
	const character = LocalPlayer.Character;
	const humanoid = character ? character.FindFirstChildOfClass("Humanoid") : undefined;
	camera.CameraSubject = humanoid;
}

function updateCameraSubject(rig: Rig, driving: boolean) {
	const camera = game.Workspace.CurrentCamera;
	if (!camera) {
		return;
	}
	if (driving) {
		if (camera.CameraSubject !== rig.cameraTarget) {
			const character = LocalPlayer.Character;
			const humanoid = character ? character.FindFirstChildOfClass("Humanoid") : undefined;
			if (camera.CameraSubject === humanoid || camera.CameraSubject === undefined || cameraSubjectOwned) {
				camera.CameraSubject = rig.cameraTarget;
				cameraSubjectOwned = true;
			}
		}
	} else if (cameraSubjectOwned && camera.CameraSubject === rig.cameraTarget) {
		releaseCameraSubject();
	}
}

// ---- local car: corrected-present offset ----------------------------------

const penetrationParams = new RaycastParams();
penetrationParams.FilterType = Enum.RaycastFilterType.Exclude;
penetrationParams.RespectCanCollide = true;
let penetrationFilterReady = false;

function localVisiblePose(rig: Rig, dt: number): CFrame {
	const root = rig.root;
	const simCF = root.CFrame;
	const simVel = root.AssemblyLinearVelocity;
	const speed = simVel.Magnitude;
	const now = os.clock();

	// Teleport: snap everything, intentionally (gate G-7).
	const teleportGen = attrNumber(root, CarAttr.TeleportGen, 0);
	if (teleportGen !== rig.lastTeleportGen || !rig.initialized) {
		rig.lastTeleportGen = teleportGen;
		rig.offset = new CFrame();
		rig.lastSimCF = simCF;
		rig.lastSimVel = simVel;
		rig.lastSimAngVel = root.AssemblyAngularVelocity;
		return simCF;
	}

	// Blast event: corrections for the next second decay fast (gate G-8).
	const blastGen = attrNumber(root, CarAttr.BlastGen, 0);
	if (blastGen !== rig.lastBlastGen) {
		rig.lastBlastGen = blastGen;
		rig.blastFastUntil = now + 1.0;
	}

	// Discontinuity detection: compare the sim pose against last frame's pose
	// advanced by last frame's velocities. The engine's own integration is
	// what normally moves the root, so honest motion stays under thresholds;
	// a rollback correction lands far outside them.
	if (rig.lastSimCF !== undefined && dt > 0 && dt < 0.25) {
		const expectedPos = rig.lastSimCF.Position.add(rig.lastSimVel.mul(dt));
		const posJump = simCF.Position.sub(expectedPos).Magnitude;
		const w = rig.lastSimAngVel;
		const wMag = w.Magnitude;
		let expectedRot = rig.lastSimCF.Rotation;
		if (wMag > 1e-4) {
			expectedRot = CFrame.fromAxisAngle(w.div(wMag), wMag * dt).mul(expectedRot);
		}
		const rotJump = math.abs(expectedRot.ToObjectSpace(simCF.Rotation).ToAxisAngle()[1]);
		const thresholds = discontinuityThresholds(speed, dt);
		if (posJump > thresholds.pos || rotJump > thresholds.rot) {
			// Correction: recompute the offset so the visible pose is
			// unchanged this frame (C0 continuity), then pick decay rates.
			// The previous visible pose is advanced by its own velocity so the
			// car keeps moving naturally through the correction instant.
			const visibleCont = composeVisible(rig.lastSimCF, rig.offset).add(rig.lastSimVel.mul(dt));
			const newOffset = recomputeOffset(simCF, visibleCont);
			const mags = offsetMagnitudes(newOffset);
			const L = rig.preset.boxSize.Z;
			if (!isNoise(mags.pos, mags.rot, L)) {
				const grounded = CarSim.getRenderState(rig.model)?.grounded ?? true;
				const decision = decideCorrection(mags.pos, mags.rot, {
					vehicleLength: L,
					speed,
					airborne: !grounded,
					landing: false,
					nearBall: false, // ball proximity folded into blast/goal events for now
					blastEvent: now < rig.blastFastUntil,
				});
				telemetry.count += 1;
				telemetry.lastSeverity = decision.severity;
				telemetry.maxOffset = math.max(telemetry.maxOffset, mags.pos);
				if (decision.severity === Severity.Catastrophic || mags.pos > rig.preset.boxSize.Z * MAX_DIVERGENCE_LENGTHS) {
					telemetry.snapCount += 1;
					rig.offset = new CFrame();
				} else {
					rig.offset = newOffset;
					rig.posHalfLife = decision.posHalfLife;
					rig.rotHalfLife = decision.rotHalfLife;
					rig.severity = decision.severity;
				}
			}
		}
	}

	// Decay the offset (frame-rate invariant).
	const mags = offsetMagnitudes(rig.offset);
	if (mags.pos > 0.005 || mags.rot > math.rad(0.1)) {
		rig.offset = decayOffset(rig.offset, dt, rig.posHalfLife, rig.rotHalfLife);
	} else if (mags.pos > 0 || mags.rot > 0) {
		rig.offset = new CFrame();
	}

	rig.lastSimCF = simCF;
	rig.lastSimVel = simVel;
	rig.lastSimAngVel = root.AssemblyAngularVelocity;

	let visible = composeVisible(simCF, rig.offset);

	// Penetration guard: never draw the car through world geometry the sim
	// says it isn't in. Cast sim→visible; clamp the position component.
	if (rig.offset.Position.Magnitude > 0.5) {
		if (!penetrationFilterReady) {
			const vehicles = game.Workspace.FindFirstChild("Vehicles");
			if (vehicles) {
				penetrationParams.FilterDescendantsInstances = [vehicles];
				penetrationFilterReady = true;
			}
		}
		const delta = visible.Position.sub(simCF.Position);
		const hit = game.Workspace.Raycast(simCF.Position, delta, penetrationParams);
		if (hit) {
			const clamped = hit.Position.sub(delta.Unit.mul(0.5));
			visible = visible.Rotation.add(clamped);
			rig.offset = recomputeOffset(simCF, visible);
		}
	}
	return visible;
}

// ---- remote cars: snapshot interpolation ----------------------------------

function sampleRemote(rig: Rig) {
	const cf = rig.root.CFrame;
	const now = os.clock();
	const last = rig.snaps.size() > 0 ? rig.snaps[rig.snaps.size() - 1] : undefined;
	if (last && cf.Position.sub(last.cf.Position).Magnitude < 1e-3 && now - last.t < 0.2) {
		return; // no new replicated motion
	}
	rig.snaps.push({ t: now, cf, v: rig.root.AssemblyLinearVelocity });
	if (rig.snaps.size() > SNAP_BUFFER) {
		rig.snaps.remove(0);
	}
	// Jitter-adaptive delay: ~2× the median inter-snapshot gap, bounded.
	if (rig.snaps.size() >= 4) {
		const gaps: number[] = [];
		for (let i = rig.snaps.size() - 4; i < rig.snaps.size() - 1; i++) {
			gaps.push(rig.snaps[i + 1].t - rig.snaps[i].t);
		}
		table.sort(gaps);
		const median = gaps[math.floor(gaps.size() / 2)];
		const target = math.clamp(median * 2 + 0.02, MIN_DELAY, MAX_DELAY);
		rig.renderDelay += (target - rig.renderDelay) * 0.05;
	}
}

function hermite(p0: Vector3, v0: Vector3, p1: Vector3, v1: Vector3, span: number, alpha: number): Vector3 {
	const t = alpha;
	const t2 = t * t;
	const t3 = t2 * t;
	const h00 = 2 * t3 - 3 * t2 + 1;
	const h10 = t3 - 2 * t2 + t;
	const h01 = -2 * t3 + 3 * t2;
	const h11 = t3 - t2;
	return p0
		.mul(h00)
		.add(v0.mul(h10 * span))
		.add(p1.mul(h01))
		.add(v1.mul(h11 * span));
}

function remoteVisiblePose(rig: Rig): CFrame {
	const root = rig.root;
	const teleportGen = attrNumber(root, CarAttr.TeleportGen, 0);
	if (teleportGen !== rig.lastTeleportGen) {
		rig.lastTeleportGen = teleportGen;
		rig.snaps.clear();
		rig.lastRemoteCF = root.CFrame;
		return root.CFrame;
	}
	sampleRemote(rig);
	const count = rig.snaps.size();
	if (count === 0) {
		return root.CFrame;
	}
	const renderT = os.clock() - rig.renderDelay;
	const newest = rig.snaps[count - 1];

	let pose: CFrame;
	if (renderT >= newest.t) {
		// Ahead of the buffer: bounded extrapolation, then hold.
		const ahead = math.min(renderT - newest.t, MAX_EXTRAPOLATION);
		pose = newest.cf.Rotation.add(newest.cf.Position.add(newest.v.mul(ahead)));
	} else {
		// Find the bracketing pair (buffer is small; linear scan from the end).
		let older = rig.snaps[0];
		let newer = newest;
		for (let i = count - 1; i >= 1; i--) {
			if (rig.snaps[i - 1].t <= renderT) {
				older = rig.snaps[i - 1];
				newer = rig.snaps[i];
				break;
			}
		}
		const span = math.max(newer.t - older.t, 1e-3);
		const alpha = math.clamp((renderT - older.t) / span, 0, 1);
		const pos = hermite(older.cf.Position, older.v, newer.cf.Position, newer.v, span, alpha);
		pose = older.cf.Rotation.Lerp(newer.cf.Rotation, alpha).add(pos);
	}

	// Unmarked teleport / spawn jump: snap.
	if (rig.lastRemoteCF && pose.Position.sub(rig.lastRemoteCF.Position).Magnitude > REMOTE_TELEPORT_SNAP) {
		rig.snaps.clear();
		pose = root.CFrame;
	}
	rig.lastRemoteCF = pose;
	return pose;
}

// ---- wheels ----------------------------------------------------------------

const MAX_STEER_ANGLE = math.rad(28);

function poseWheels(rig: Rig, visible: CFrame, dt: number) {
	const root = rig.root;
	const steerAttr = attrNumber(root, CarAttr.Steer, 0);
	rig.steerVisual += (steerAttr - rig.steerVisual) * math.clamp(dt * 12, 0, 1);
	const drifting = root.GetAttribute(CarAttr.DriftEngaged) === true;

	// Forward speed for spin (own car: sim state; remote: root velocity).
	const renderState = rig.isLocal ? CarSim.getRenderState(rig.model) : undefined;
	let speed: number;
	if (renderState) {
		speed = renderState.speed;
	} else {
		const localVel = root.CFrame.VectorToObjectSpace(root.AssemblyLinearVelocity);
		speed = -localVel.Z;
	}

	for (const wheel of rig.wheels) {
		if (wheel.part.Parent === undefined) {
			continue;
		}
		// Suspension: predicted compression for the mapped canonical contact
		// (own car); neutral for remote cars. Clamped to the preset range and
		// held plausible when contact data is missing (ADR §3).
		let compression = 0.35;
		if (renderState) {
			compression = renderState.grounded ? math.clamp(renderState.compression[wheel.contactIndex], 0, 1) : 0;
		}
		const drop = rig.preset.suspensionRest * (1 - compression) - rig.preset.suspensionRest * 0.65;
		wheel.spinAngle = (wheel.spinAngle + (speed / math.max(wheel.radius, 0.1)) * dt) % (math.pi * 2);
		const steerAngle = wheel.steers ? -rig.steerVisual * MAX_STEER_ANGLE : 0;
		const wheelCF = visible
			.mul(new CFrame(wheel.localPos.add(new Vector3(0, -drop, 0))))
			.mul(CFrame.Angles(0, steerAngle, 0))
			.mul(CFrame.Angles(-wheel.spinAngle, 0, 0));
		wheel.part.CFrame = wheelCF;
		if (wheel.trail) {
			const wantTrail = drifting && wheel.contactIndex >= 2;
			if (wheel.trail.Enabled !== wantTrail) {
				wheel.trail.Enabled = wantTrail;
			}
		}
	}
}

// ---- frame loop ------------------------------------------------------------

function stepRig(rig: Rig, dt: number) {
	if (rig.model.Parent === undefined || rig.root.Parent === undefined) {
		const model = rig.model;
		destroyRig(model);
		// Streaming can drop VehicleRoot while the model persists — rebuild
		// when it streams back in (buildRig re-waits for the root).
		if (model.Parent !== undefined) {
			task.delay(0.5, () => {
				if (model.Parent !== undefined) {
					buildRig(model);
				}
			});
		}
		return;
	}
	const visible = rig.isLocal ? localVisiblePose(rig, dt) : remoteVisiblePose(rig);
	rig.initialized = true;

	for (const rigPart of rig.parts) {
		if (rigPart.part.Parent !== undefined) {
			rigPart.part.CFrame = visible.mul(rigPart.offset);
		}
	}
	poseWheels(rig, visible, dt);
	rig.cameraTarget.CFrame = visible;

	if (rig.isLocal) {
		updateCameraSubject(rig, rig.root.GetAttribute(CarAttr.Driving) === true);
	}
}

const vehiclesFolder = game.Workspace.WaitForChild("Vehicles");
vehiclesFolder.ChildAdded.Connect((model) => {
	if (model.IsA("Model")) {
		buildRig(model);
	}
});
vehiclesFolder.ChildRemoved.Connect((model) => {
	if (model.IsA("Model")) {
		destroyRig(model);
	}
});
for (const child of vehiclesFolder.GetChildren()) {
	if (child.IsA("Model")) {
		buildRig(child);
	}
}
// V2 models can also gain the attribute after parenting (spawn order).
vehiclesFolder.ChildAdded.Connect((model) => {
	if (model.IsA("Model")) {
		task.delay(1, () => buildRig(model));
	}
});

// Immediately before the camera consumes CameraSubject, so the camera can
// never read a previous-frame target while the rig is already current.
RunService.BindToRenderStep(RENDER_BIND_NAME, Enum.RenderPriority.Camera.Value - 1, (dt) => {
	for (const [model, rig] of rigs) {
		const [ok, err] = pcall(() => stepRig(rig, dt));
		if (!ok) {
			warn(`[CarRig] ${model.Name}: ${err}`);
			destroyRig(model);
		}
	}
});

// Debug overlay (dev builds): draws the sim proxy box + offset readout.
if (RENDER_DEBUG_OVERLAY) {
	task.spawn(() => {
		while (task.wait(0.5)) {
			for (const [model, rig] of rigs) {
				if (rig.isLocal) {
					const mags = offsetMagnitudes(rig.offset);
					print(
						`[CarRig] ${model.Name} offset ${string.format("%.2f", mags.pos)}st ${string.format(
							"%.1f",
							math.deg(mags.rot),
						)}° sev ${rig.severity} corr ${telemetry.count} snaps ${telemetry.snapCount}`,
					);
				}
			}
		}
	});
}

export {};
