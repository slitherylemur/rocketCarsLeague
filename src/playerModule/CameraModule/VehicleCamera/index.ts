// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VehicleCamera (ModuleScript)

import BaseCamera from "../BaseCamera";
import CameraInput from "../CameraInput";
import Util from "../CameraUtils";
import ZoomController from "../ZoomController";
import VehicleCameraConfig from "./VehicleCameraConfig";
import VehicleCameraCore from "./VehicleCameraCore";

const EPSILON = 1e-3;
const PITCH_LIMIT = math.rad(80);
const YAW_DEFAULT = math.rad(0);
const ZOOM_MINIMUM = 0.5;
const ZOOM_SENSITIVITY_CURVATURE = 0.5;

const Players = game.GetService("Players");
const RunService = game.GetService("RunService");

const localPlayer = Players.LocalPlayer;

const map = Util.map;
const mapClamp = Util.mapClamp;
const sanitizeAngle = Util.sanitizeAngle;

// pitch-axis rotational velocity of a part with a given CFrame and total RotVelocity
function pitchVelocity(rotVel: Vector3, cf: CFrame): number {
	return math.abs(cf.XVector.Dot(rotVel));
}

// yaw-axis rotational velocity of a part with a given CFrame and total RotVelocity
function yawVelocity(rotVel: Vector3, cf: CFrame): number {
	return math.abs(cf.YVector.Dot(rotVel));
}

// track physics solver time delta separately from the render loop to correctly synchronize time delta
let worldDt = 1 / 60;
RunService.Stepped.Connect((_time, _worldDt) => {
	worldDt = _worldDt;
});

// CameraUtils.Spring is written generically enough in the original Lua to support both Vector3
// goals (used elsewhere) and plain number goals, which is how VehicleCamera uses it below for its
// pitch/yaw springs. The translated CameraUtils.ts Spring class is typed specifically for
// Vector3, so we go through an `unknown` cast on the constructor itself to recover the numeric
// usage without touching that shared file, per migration conventions (unknown+casts over
// restructuring).
type NumberSpring = { freq: number; goal: number; pos: number; vel: number; step(dt: number): number };
const NumberSpring = Util.Spring as unknown as new (freq: number, pos: number) => NumberSpring;

//[[ The Module ]]--
class VehicleCamera extends BaseCamera {
	vehicleCameraCore!: VehicleCameraCore;
	pitchSpring!: NumberSpring;
	yawSpring!: NumberSpring;
	lastPanTick!: number;
	assemblyRadius!: number;
	assemblyOffset!: Vector3;

	constructor() {
		super();
		this.Reset();
	}

	Reset(): void {
		this.vehicleCameraCore = new VehicleCameraCore(this.GetSubjectCFrame());
		this.pitchSpring = new NumberSpring(0, -math.rad(VehicleCameraConfig.pitchBaseAngle));
		this.yawSpring = new NumberSpring(0, YAW_DEFAULT);
		this.lastPanTick = 0;

		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;

		assert(camera);
		assert(cameraSubject);
		assert(cameraSubject.IsA("VehicleSeat"));

		const assemblyParts = cameraSubject.GetConnectedParts(true); // passing true to recursively get all assembly parts
		const [assemblyPosition, assemblyRadiusResult] = Util.getLooseBoundingSphere(assemblyParts);

		const assemblyRadius = math.max(assemblyRadiusResult, EPSILON);

		this.assemblyRadius = assemblyRadius;
		this.assemblyOffset = cameraSubject.CFrame.Inverse().mul(assemblyPosition); // seat-space offset of the assembly bounding sphere center

		this._StepInitialZoom();
	}

	_StepInitialZoom(): void {
		this.SetCameraToSubjectDistance(
			math.max(ZoomController.GetZoomRadius(), this.assemblyRadius * VehicleCameraConfig.initialZoomRadiusMul),
		);
	}

	_StepRotation(dt: number, vdotz: number): CFrame {
		const yawSpring = this.yawSpring;
		const pitchSpring = this.pitchSpring;

		const rotationInput = CameraInput.getRotation(true);
		const dYaw = -rotationInput.X;
		const dPitch = -rotationInput.Y;

		yawSpring.pos = sanitizeAngle(yawSpring.pos + dYaw);
		pitchSpring.pos = sanitizeAngle(math.clamp(pitchSpring.pos + dPitch, -PITCH_LIMIT, PITCH_LIMIT));

		if (CameraInput.getRotationActivated()) {
			this.lastPanTick = os.clock();
		}

		const pitchBaseAngle = -math.rad(VehicleCameraConfig.pitchBaseAngle);
		const pitchDeadzoneAngle = math.rad(VehicleCameraConfig.pitchDeadzoneAngle);

		if (os.clock() - this.lastPanTick > VehicleCameraConfig.autocorrectDelay) {
			// adjust autocorrect response based on forward velocity
			const autocorrectResponse = mapClamp(
				vdotz,
				VehicleCameraConfig.autocorrectMinCarSpeed,
				VehicleCameraConfig.autocorrectMaxCarSpeed,
				0,
				VehicleCameraConfig.autocorrectResponse,
			);

			yawSpring.freq = autocorrectResponse;
			pitchSpring.freq = autocorrectResponse;

			// zero out response under a threshold
			if (yawSpring.freq < EPSILON) {
				yawSpring.vel = 0;
			}

			if (pitchSpring.freq < EPSILON) {
				pitchSpring.vel = 0;
			}

			if (math.abs(sanitizeAngle(pitchBaseAngle - pitchSpring.pos)) <= pitchDeadzoneAngle) {
				// do nothing within the deadzone
				pitchSpring.goal = pitchSpring.pos;
			} else {
				pitchSpring.goal = pitchBaseAngle;
			}
		} else {
			yawSpring.freq = 0;
			yawSpring.vel = 0;

			pitchSpring.freq = 0;
			pitchSpring.vel = 0;

			pitchSpring.goal = pitchBaseAngle;
		}

		return CFrame.fromEulerAnglesYXZ(pitchSpring.step(dt), yawSpring.step(dt), 0);
	}

	_GetThirdPersonLocalOffset(): Vector3 {
		return this.assemblyOffset.add(new Vector3(0, this.assemblyRadius * VehicleCameraConfig.verticalCenterOffset, 0));
	}

	_GetFirstPersonLocalOffset(subjectCFrame: CFrame): Vector3 {
		const character = localPlayer.Character;

		if (character && character.Parent) {
			const head = character.FindFirstChild("Head");

			if (head && head.IsA("BasePart")) {
				return subjectCFrame.Inverse().mul(head.Position);
			}
		}

		return this._GetThirdPersonLocalOffset();
	}

	Update(): LuaTuple<[CFrame, CFrame]> {
		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;
		const vehicleCameraCore = this.vehicleCameraCore;

		assert(camera);
		assert(cameraSubject);
		assert(cameraSubject.IsA("VehicleSeat"));

		// consume the physics solver time delta to account for mismatched physics/render cycles
		const dt = worldDt;
		worldDt = 0;

		// get subject info
		const subjectCFrame: CFrame = this.GetSubjectCFrame();
		const subjectVel: Vector3 = this.GetSubjectVelocity();
		const subjectRotVel = this.GetSubjectRotVelocity();

		// measure the local-to-world-space forward velocity of the vehicle
		const vDotZ = math.abs(subjectVel.Dot(subjectCFrame.ZVector));
		const yawVel = yawVelocity(subjectRotVel, subjectCFrame);
		const pitchVel = pitchVelocity(subjectRotVel, subjectCFrame);

		// step camera components forward
		const zoom = this.StepZoom();
		const objectRotation = this._StepRotation(dt, vDotZ);

		// mix third and first person offsets in local space
		const firstPerson = mapClamp(zoom, ZOOM_MINIMUM, this.assemblyRadius, 1, 0);

		const tpOffset = this._GetThirdPersonLocalOffset();
		const fpOffset = this._GetFirstPersonLocalOffset(subjectCFrame);
		const localOffset = tpOffset.Lerp(fpOffset, firstPerson);

		// step core forward
		vehicleCameraCore.setTransform(subjectCFrame);
		const processedRotation = vehicleCameraCore.step(dt, pitchVel, yawVel, firstPerson);

		// calculate final focus & cframe
		const focus = new CFrame(subjectCFrame.mul(localOffset)).mul(processedRotation).mul(objectRotation);
		const cf = focus.mul(new CFrame(0, 0, zoom));

		return $tuple(cf, focus);
	}

	ApplyVRTransform(): void {
		// no-op override; VR transform is not applied in vehicles
	}

	EnterFirstPerson(): void {
		this.inFirstPerson = true;
		this.UpdateMouseBehavior();
	}

	LeaveFirstPerson(): void {
		this.inFirstPerson = false;
		this.UpdateMouseBehavior();
	}
}

export = VehicleCamera;
