// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VehicleCamera/VehicleCameraCore (ModuleScript)

import Util from "../CameraUtils";
import VehicleCameraConfig from "./VehicleCameraConfig";

const map = Util.map;
const mapClamp = Util.mapClamp;
const sanitizeAngle = Util.sanitizeAngle;

// extract sanitized yaw from a CFrame rotation
function getYaw(cf: CFrame): number {
	const [, yaw] = cf.ToEulerAnglesYXZ();
	return sanitizeAngle(yaw);
}

// extract sanitized pitch from a CFrame rotation
function getPitch(cf: CFrame): number {
	const [pitch] = cf.ToEulerAnglesYXZ();
	return sanitizeAngle(pitch);
}

// step a damped angular spring axis
function stepSpringAxis(dt: number, f: number, g: number, p: number, v: number): LuaTuple<[number, number]> {
	const offset = sanitizeAngle(p - g);
	const decay = math.exp(-f * dt);

	const p1 = sanitizeAngle((offset * (1 + f * dt) + v * dt) * decay + g);
	const v1 = (v * (1 - f * dt) - offset * (f * f * dt)) * decay;

	return $tuple(p1, v1);
}

// value damper with separate response frequencies for rising and falling values
class VariableEdgeSpring {
	fRising: number;
	fFalling: number;
	g: number;
	p: number;
	v: number;

	constructor(fRising: number, fFalling: number, position: number) {
		this.fRising = fRising;
		this.fFalling = fFalling;
		this.g = position;
		this.p = position;
		this.v = position * 0;
	}

	step(dt: number): number {
		const fRising = this.fRising;
		const fFalling = this.fFalling;
		const g = this.g;
		const p0 = this.p;
		const v0 = this.v;

		const f = 2 * math.pi * (v0 > 0 ? fRising : fFalling);

		const offset = p0 - g;
		const decay = math.exp(-f * dt);

		const p1 = (offset * (1 + f * dt) + v0 * dt) * decay + g;
		const v1 = (v0 * (1 - f * dt) - offset * (f * f * dt)) * decay;

		this.p = p1;
		this.v = v1;

		return p1;
	}
}

// damps a 3D rotation in Tait-Bryan YXZ space, filtering out Z
class YawPitchSpring {
	yawG: number; // yaw goal
	yawP: number; // yaw position
	yawV: number; // yaw velocity

	pitchG: number; // pitch goal
	pitchP: number; // pitch position
	pitchV: number; // pitch velocity

	// yaw/pitch response springs
	fSpringYaw: VariableEdgeSpring;
	fSpringPitch: VariableEdgeSpring;

	constructor(cf: CFrame) {
		assert(typeOf(cf) === "CFrame");

		this.yawG = getYaw(cf);
		this.yawP = getYaw(cf);
		this.yawV = 0;

		this.pitchG = getPitch(cf);
		this.pitchP = getPitch(cf);
		this.pitchV = 0;

		this.fSpringYaw = new VariableEdgeSpring(
			VehicleCameraConfig.yawReponseDampingRising,
			VehicleCameraConfig.yawResponseDampingFalling,
			0,
		);
		this.fSpringPitch = new VariableEdgeSpring(
			VehicleCameraConfig.pitchReponseDampingRising,
			VehicleCameraConfig.pitchResponseDampingFalling,
			0,
		);
	}

	// Extract Tait-Bryan angles from a CFrame rotation
	setGoal(goalCFrame: CFrame): void {
		assert(typeOf(goalCFrame) === "CFrame");

		this.yawG = getYaw(goalCFrame);
		this.pitchG = getPitch(goalCFrame);
	}

	getCFrame(): CFrame {
		return CFrame.fromEulerAnglesYXZ(this.pitchP, this.yawP, 0);
	}

	step(dt: number, pitchVel: number, yawVel: number, firstPerson: number): CFrame {
		assert(typeOf(dt) === "number");
		assert(typeOf(yawVel) === "number");
		assert(typeOf(pitchVel) === "number");
		assert(typeOf(firstPerson) === "number");

		const fSpringYaw = this.fSpringYaw;
		const fSpringPitch = this.fSpringPitch;

		// calculate the frequency spring
		fSpringYaw.g = mapClamp(
			map(firstPerson, 0, 1, yawVel, 0),
			math.rad(VehicleCameraConfig.cutoffMinAngularVelYaw),
			math.rad(VehicleCameraConfig.cutoffMaxAngularVelYaw),
			1,
			0,
		);

		fSpringPitch.g = mapClamp(
			map(firstPerson, 0, 1, pitchVel, 0),
			math.rad(VehicleCameraConfig.cutoffMinAngularVelPitch),
			math.rad(VehicleCameraConfig.cutoffMaxAngularVelPitch),
			1,
			0,
		);

		// calculate final frequencies
		let fYaw = 2 * math.pi * VehicleCameraConfig.yawStiffness * fSpringYaw.step(dt);
		let fPitch = 2 * math.pi * VehicleCameraConfig.pitchStiffness * fSpringPitch.step(dt);

		// adjust response for first person
		fPitch *= map(firstPerson, 0, 1, 1, VehicleCameraConfig.firstPersonResponseMul);
		fYaw *= map(firstPerson, 0, 1, 1, VehicleCameraConfig.firstPersonResponseMul);

		// step yaw
		[this.yawP, this.yawV] = stepSpringAxis(dt, fYaw, this.yawG, this.yawP, this.yawV);

		// step pitch
		[this.pitchP, this.pitchV] = stepSpringAxis(dt, fPitch, this.pitchG, this.pitchP, this.pitchV);

		return this.getCFrame();
	}
}

class VehicleCameraCore {
	vrs: YawPitchSpring;

	constructor(transform: CFrame) {
		this.vrs = new YawPitchSpring(transform);
	}

	step(dt: number, pitchVel: number, yawVel: number, firstPerson: number): CFrame {
		return this.vrs.step(dt, pitchVel, yawVel, firstPerson);
	}

	setTransform(transform: CFrame): void {
		this.vrs.setGoal(transform);
	}
}

export = VehicleCameraCore;
