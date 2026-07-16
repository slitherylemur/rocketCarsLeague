// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VRVehicleCamera (ModuleScript)
//
// VRVehicleCamera - Roblox VR vehicle camera control module
// 2021 Roblox VR

import Util from "./CameraUtils";
import CameraInput from "./CameraInput";
// Original requires VehicleCamera (the class table) but never actually references the resulting
// value anywhere in the module body - a dead import, preserved here for fidelity. Requiring it
// also runs VehicleCamera/index.ts's own top-level RunService.Stepped connection as a side
// effect, same as the original Lua require() would.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import VehicleCamera from "./VehicleCamera";
import VehicleCameraConfig from "./VehicleCamera/VehicleCameraConfig";
import VehicleCameraCore from "./VehicleCamera/VehicleCameraCore";
import VRBaseCamera from "./VRBaseCamera";
import ZoomController from "./ZoomController";

const EPSILON = 1e-3;
const PITCH_LIMIT = math.rad(80);
const YAW_DEFAULT = math.rad(0);
const ZOOM_MINIMUM = 0.5;
const ZOOM_SENSITIVITY_CURVATURE = 0.5;
const DEFAULT_CAMERA_DIST = 16;
const TP_FOLLOW_DIST = 200;
const TP_FOLLOW_ANGLE_DOT = 0.56;

const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const VRService = game.GetService("VRService");

const localPlayer = Players.LocalPlayer;
const mapClamp = Util.mapClamp;
const sanitizeAngle = Util.sanitizeAngle;

const ZERO_VECTOR3 = new Vector3(0, 0, 0);

// pitch-axis rotational velocity of a part with a given CFrame and total RotVelocity
function pitchVelocity(rotVel: Vector3, cf: CFrame): number {
	return math.abs(cf.XVector.Dot(rotVel));
}

// yaw-axis rotational velocity of a part with a given CFrame and total RotVelocity
function yawVelocity(rotVel: Vector3, cf: CFrame): number {
	return math.abs(cf.YVector.Dot(rotVel));
}

// track physics solver time delta separately from the render loop to correctly synchronize time
// delta. Unlike VehicleCamera.ts, this is wired up inside the constructor below (not once at
// module scope) - preserved verbatim, meaning every VRVehicleCamera instance adds another
// Stepped connection writing to this same shared module-level variable.
let worldDt = 1 / 60;

// CameraUtils.Spring is written generically enough in the original Lua to support both Vector3
// goals (used elsewhere) and plain number goals, which is how VRVehicleCamera uses it below for
// its pitch/yaw springs. The translated CameraUtils.ts Spring class is typed specifically for
// Vector3, so we go through an `unknown` cast on the constructor itself to recover the numeric
// usage without touching that shared file, per migration conventions (unknown+casts over
// restructuring).
type NumberSpring = { freq: number; goal: number; pos: number; vel: number; step(dt: number): number };
const NumberSpring = Util.Spring as unknown as new (freq: number, pos: number) => NumberSpring;

class VRVehicleCamera extends VRBaseCamera {
	vehicleCameraCore!: VehicleCameraCore;
	pitchSpring!: NumberSpring;
	yawSpring!: NumberSpring;
	assemblyRadius!: number;
	assemblyOffset!: Vector3;

	constructor() {
		super();
		this.Reset();

		// track physics solver time delta separately from the render loop to correctly
		// synchronize time delta
		RunService.Stepped.Connect((_time, _worldDt) => {
			worldDt = _worldDt;
		});
	}

	Reset(): void {
		this.vehicleCameraCore = new VehicleCameraCore(this.GetSubjectCFrame());
		this.pitchSpring = new NumberSpring(0, -math.rad(VehicleCameraConfig.pitchBaseAngle));
		this.yawSpring = new NumberSpring(0, YAW_DEFAULT);

		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;

		assert(camera, "VRVehicleCamera initialization error");
		assert(cameraSubject);
		assert(cameraSubject.IsA("VehicleSeat"));

		const assemblyParts = cameraSubject.GetConnectedParts(true); // passing true to recursively get all assembly parts
		const [assemblyPosition, assemblyRadiusResult] = Util.getLooseBoundingSphere(assemblyParts);

		const assemblyRadius = math.max(assemblyRadiusResult, EPSILON);

		this.assemblyRadius = assemblyRadius;
		this.assemblyOffset = cameraSubject.CFrame.Inverse().mul(assemblyPosition); // seat-space offset of the assembly bounding sphere center

		this.lastCameraFocus = undefined;

		this._StepInitialZoom();
	}

	_StepInitialZoom(): void {
		this.SetCameraToSubjectDistance(
			math.max(ZoomController.GetZoomRadius(), this.assemblyRadius * VehicleCameraConfig.initialZoomRadiusMul),
		);
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

		// mix third and first person offsets in local space
		const firstPerson = mapClamp(zoom, ZOOM_MINIMUM, this.assemblyRadius, 1, 0);

		const tpOffset = this._GetThirdPersonLocalOffset();
		const fpOffset = this._GetFirstPersonLocalOffset(subjectCFrame);
		const localOffset = tpOffset.Lerp(fpOffset, firstPerson);

		// step core forward
		vehicleCameraCore.setTransform(subjectCFrame);
		const processedRotation = vehicleCameraCore.step(dt, pitchVel, yawVel, firstPerson);

		// end product of this function
		let focus: CFrame;
		let cf: CFrame;

		// update fade from black
		this.UpdateFadeFromBlack(dt);

		if (!this.IsInFirstPerson()) {
			// third person comfort camera
			focus = new CFrame(subjectCFrame.mul(localOffset)).mul(processedRotation);
			cf = focus.mul(new CFrame(0, 0, zoom));

			if (!this.lastCameraFocus) {
				this.lastCameraFocus = focus;
				this.needsReset = true;
			}

			let curCameraDir = focus.Position.sub(camera.CFrame.Position);
			const curCameraDist = curCameraDir.Magnitude;
			curCameraDir = curCameraDir.Unit;
			const cameraDot = curCameraDir.Dot(camera.CFrame.LookVector);
			if (cameraDot > TP_FOLLOW_ANGLE_DOT && curCameraDist < TP_FOLLOW_DIST && !this.needsReset) {
				// vehicle in view
				// keep old focus
				focus = this.lastCameraFocus;

				// new cf result
				const cameraFocusP = focus.Position;
				let cameraLookVector = this.GetCameraLookVector();
				cameraLookVector = new Vector3(cameraLookVector.X, 0, cameraLookVector.Z).Unit;
				const newLookVector = this.CalculateNewLookVectorFromArg(cameraLookVector, new Vector2(0, 0));
				cf = new CFrame(cameraFocusP.sub(newLookVector.mul(zoom)), cameraFocusP);
			} else {
				// new focus / teleport
				this.currentSubjectDistance = DEFAULT_CAMERA_DIST;
				this.lastCameraFocus = this.GetVRFocus(subjectCFrame.Position, dt);
				this.needsReset = false;
				this.StartFadeFromBlack();
				this.ResetZoom();
			}

			this.UpdateEdgeBlur(localPlayer, dt);
		} else {
			// first person in vehicle : lock orientation for stable camera
			const dir = new Vector3(processedRotation.LookVector.X, 0, processedRotation.LookVector.Z).Unit;
			const planarRotation = new CFrame(processedRotation.Position, dir);

			// this removes the pitch to reduce motion sickness
			focus = new CFrame(subjectCFrame.mul(localOffset)).mul(planarRotation);
			cf = focus.mul(new CFrame(0, 0, zoom));

			this.StartVREdgeBlur(localPlayer);
		}

		return $tuple(cf, focus);
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

export = VRVehicleCamera;
