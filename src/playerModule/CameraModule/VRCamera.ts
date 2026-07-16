// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VRCamera (ModuleScript)
//
// VRCamera - Roblox VR camera control module
// 2021 Roblox VR

import ControlModule from "../ControlModule";
import CameraInput from "./CameraInput";
import VRBaseCamera from "./VRBaseCamera";

//[[ Services ]]--
const PlayersService = game.GetService("Players");
const VRService = game.GetService("VRService");

// Local private variables and constants
const CAMERA_BLACKOUT_TIME = 0.1;
const FP_ZOOM = 0.5;

//[[ The Module ]]--
class VRCamera extends VRBaseCamera {
	lastUpdate: number | undefined;

	needsBlackout!: boolean;
	motionDetTime!: number;
	blackOutTimer!: number;
	lastCameraResetPosition: Vector3 | undefined;
	stepRotateTimeout!: number;

	// Set the first time UpdateFirstPersonTransform/UpdateThirdPersonTransform run (never
	// initialized in the original Lua constructor either - stays nil/undefined until then).
	VRCameraFocusFrozen: boolean | undefined;

	// Referenced in LeaveFirstPerson but never assigned anywhere in the original module either -
	// preserved as a permanently-unset (nil/undefined) field.
	VRBlur: GuiObject | undefined;

	constructor() {
		super();

		this.lastUpdate = tick();
		this.Reset();
	}

	Reset(): void {
		this.needsReset = true;
		this.needsBlackout = true;
		this.motionDetTime = 0.0;
		this.blackOutTimer = 0;
		this.lastCameraResetPosition = undefined;
		this.stepRotateTimeout = 0.0;
	}

	Update(timeDelta: number): LuaTuple<[CFrame, CFrame]> {
		const camera = game.Workspace.CurrentCamera as Camera;
		let newCameraCFrame = camera.CFrame;
		let newCameraFocus = camera.Focus;

		const player = PlayersService.LocalPlayer;
		const humanoid = this.GetHumanoid();
		const cameraSubject = camera.CameraSubject;

		if (this.lastUpdate === undefined || timeDelta > 1) {
			this.lastCameraTransform = undefined;
		}

		this.StepZoom();

		// update fullscreen effects
		this.UpdateFadeFromBlack(timeDelta);
		this.UpdateEdgeBlur(player, timeDelta);

		const lastSubjPos = this.lastSubjectPosition;
		const subjectPosition: Vector3 | undefined = this.GetSubjectPosition();

		// transition from another camera or from spawn
		if (this.needsBlackout) {
			this.StartFadeFromBlack();

			const dt = math.clamp(timeDelta, 0.0001, 0.1);
			this.blackOutTimer += dt;
			if (this.blackOutTimer > CAMERA_BLACKOUT_TIME && game.IsLoaded()) {
				this.needsBlackout = false;
				this.needsReset = true;
			}
		}

		if (subjectPosition !== undefined && player && camera) {
			newCameraFocus = this.GetVRFocus(subjectPosition, timeDelta);

			if (this.IsInFirstPerson()) {
				// update camera CFrame
				[newCameraCFrame, newCameraFocus] = this.UpdateFirstPersonTransform(
					timeDelta,
					newCameraCFrame,
					newCameraFocus,
					lastSubjPos,
					subjectPosition,
				);
			} else {
				// 3rd person
				// update camera CFrame
				[newCameraCFrame, newCameraFocus] = this.UpdateThirdPersonTransform(
					timeDelta,
					newCameraCFrame,
					newCameraFocus,
					lastSubjPos,
					subjectPosition,
				);
			}

			this.lastCameraTransform = newCameraCFrame;
			this.lastCameraFocus = newCameraFocus;
		}

		this.lastUpdate = tick();
		return $tuple(newCameraCFrame, newCameraFocus);
	}

	UpdateFirstPersonTransform(
		timeDelta: number,
		newCameraCFrame: CFrame,
		newCameraFocus: CFrame,
		lastSubjPos: Vector3,
		subjectPosition: Vector3,
	): LuaTuple<[CFrame, CFrame]> {
		// transition from TP to FP
		if (this.needsReset) {
			this.StartFadeFromBlack();
			this.needsReset = false;
			this.stepRotateTimeout = 0.25;
			this.VRCameraFocusFrozen = true;
		}

		// blur screen edge during movement
		const player = PlayersService.LocalPlayer;
		const subjectDelta = lastSubjPos.sub(subjectPosition);
		if (subjectDelta.Magnitude > 0.01) {
			this.StartVREdgeBlur(player);
		}

		// straight view, not angled down
		const cameraFocusP = newCameraFocus.Position;
		let cameraLookVector = this.GetCameraLookVector();
		cameraLookVector = new Vector3(cameraLookVector.X, 0, cameraLookVector.Z).Unit;

		if (this.stepRotateTimeout > 0) {
			this.stepRotateTimeout -= timeDelta;
		}

		// step rotate in 1st person
		const rotateInput = CameraInput.getRotation();
		let yawDelta = 0;
		if (this.stepRotateTimeout <= 0.0 && math.abs(rotateInput.X) > 0.03) {
			yawDelta = 0.5;
			if (rotateInput.X < 0) {
				yawDelta = -0.5;
			}
			this.needsReset = true;
		}

		const newLookVector = this.CalculateNewLookVectorFromArg(cameraLookVector, new Vector2(yawDelta, 0));
		newCameraCFrame = new CFrame(cameraFocusP.sub(newLookVector.mul(FP_ZOOM)), cameraFocusP);

		return $tuple(newCameraCFrame, newCameraFocus);
	}

	UpdateThirdPersonTransform(
		timeDelta: number,
		newCameraCFrame: CFrame,
		newCameraFocus: CFrame,
		lastSubjPos: Vector3,
		subjectPosition: Vector3,
	): LuaTuple<[CFrame, CFrame]> {
		let zoom = this.GetCameraToSubjectDistance();
		if (zoom < 0.5) {
			zoom = 0.5;
		}

		if (lastSubjPos !== undefined && this.lastCameraFocus !== undefined) {
			// compute delta of subject since last update
			const player = PlayersService.LocalPlayer;
			const subjectDelta = lastSubjPos.sub(subjectPosition);
			const moveVector = (
				ControlModule as unknown as { GetMoveVector(): Vector3 }
			).GetMoveVector();

			// is the subject still moving?
			let isMoving = subjectDelta.Magnitude > 0.01 || moveVector.Magnitude > 0.01;
			if (isMoving) {
				this.motionDetTime = 0.1;
			}

			this.motionDetTime = this.motionDetTime - timeDelta;
			if (this.motionDetTime > 0) {
				isMoving = true;
			}

			if (isMoving && !this.needsReset) {
				// if subject moves keep old camera focus
				newCameraFocus = this.lastCameraFocus;

				// if the focus subject stopped, time to reset the camera
				this.VRCameraFocusFrozen = true;
			} else {
				const subjectMoved =
					this.lastCameraResetPosition === undefined ||
					subjectPosition.sub(this.lastCameraResetPosition).Magnitude > 1;

				// recenter the camera on teleport
				if ((this.VRCameraFocusFrozen && subjectMoved) || this.needsReset) {
					VRService.RecenterUserHeadCFrame();

					this.VRCameraFocusFrozen = false;
					this.needsReset = false;
					this.lastCameraResetPosition = subjectPosition;

					this.ResetZoom();
					this.StartFadeFromBlack();

					// get player facing direction
					const humanoid = this.GetHumanoid();
					const humanoidTorso = (humanoid as unknown as { Torso?: BasePart }).Torso;
					const forwardVector = humanoidTorso ? humanoidTorso.CFrame.LookVector : new Vector3(1, 0, 0);
					// adjust camera height
					const vecToCameraAtHeight = new Vector3(forwardVector.X, 0, forwardVector.Z);
					const newCameraPos = newCameraFocus.Position.sub(vecToCameraAtHeight.mul(zoom));
					// compute new cframe at height level to subject
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					const newFocus = new Vector3(newCameraFocus.X, newCameraPos.Y, newCameraFocus.Z);
					const lookAtPos = new Vector3(newCameraFocus.Position.X, newCameraPos.Y, newCameraFocus.Position.Z);
					newCameraCFrame = new CFrame(newCameraPos, lookAtPos);
				}
			}
		}

		return $tuple(newCameraCFrame, newCameraFocus);
	}

	EnterFirstPerson(): void {
		this.inFirstPerson = true;
		this.UpdateMouseBehavior();
	}

	LeaveFirstPerson(): void {
		this.inFirstPerson = false;
		this.needsReset = true;
		this.UpdateMouseBehavior();

		if (this.VRBlur) {
			this.VRBlur.Visible = false;
		}
	}
}

export = VRCamera;
