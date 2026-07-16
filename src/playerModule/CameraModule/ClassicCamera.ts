// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/ClassicCamera (ModuleScript)
//
// ClassicCamera - Classic Roblox camera control module
// 2018 Camera Update - AllYourBlox
//
// Note: This module also handles camera control types Follow and Track, the
// latter of which is currently not distinguished from Classic

import BaseCamera from "./BaseCamera";
import CameraInput from "./CameraInput";
import Util from "./CameraUtils";

// Local private variables and constants
const ZERO_VECTOR2 = new Vector2(0, 0);

const tweenAcceleration = math.rad(220); // Radians/Second^2
let tweenSpeed = math.rad(0); // Radians/Second
const tweenMaxSpeed = math.rad(250); // Radians/Second
const TIME_BEFORE_AUTO_ROTATE = 2; // Seconds, used when auto-aligning camera with vehicles

const INITIAL_CAMERA_ANGLE = CFrame.fromOrientation(math.rad(-15), 0, 0);
const ZOOM_SENSITIVITY_CURVATURE = 0.5;
const FIRST_PERSON_DISTANCE_MIN = 0.5;

//[[ Services ]]--
const PlayersService = game.GetService("Players");
const VRService = game.GetService("VRService");

// CameraUtils.Spring is written generically enough in the original Lua (it just uses `+`, `-`,
// `*` on whatever payload it's given) to support both Vector3 goals (used elsewhere) and plain
// number goals, which is how ClassicCamera uses it below (`Util.Spring.new(5, 0)`). The
// translated CameraUtils.ts Spring class is typed specifically for Vector3, so we go through an
// `unknown` cast on the constructor itself to recover the numeric usage without touching that
// shared file, per migration conventions (unknown+casts over restructuring).
type NumberSpring = { freq: number; goal: number; pos: number; vel: number; step(dt: number): number };
const NumberSpring = Util.Spring as unknown as new (freq: number, pos: number) => NumberSpring;

//[[ The Module ]]--
class ClassicCamera extends BaseCamera {
	isFollowCamera: boolean;
	isCameraToggle: boolean;
	// Typed as possibly-undefined (even though the constructor always sets it) to mirror the
	// original Lua's `self.lastUpdate == nil` guard below without tripping TypeScript's
	// no-overlap check on a definitely-number field.
	lastUpdate: number | undefined;
	cameraToggleSpring: NumberSpring;

	// Note: `self.isClimbing` is referenced (but never assigned) in the original Lua Update()
	// method below - the local variable computed each frame is named `isClimbing`, not
	// `self.isClimbing`. This looks like a bug in the original source (the intent was almost
	// certainly to read the local), but per migration conventions we preserve behavior exactly:
	// `self.isClimbing` is always nil/falsy in the original, so this field is declared but never
	// written to.
	isClimbing?: boolean;

	constructor() {
		super();

		this.isFollowCamera = false;
		this.isCameraToggle = false;
		this.lastUpdate = tick();
		this.cameraToggleSpring = new NumberSpring(5, 0);
	}

	GetCameraToggleOffset(dt: number): Vector3 {
		if (this.isCameraToggle) {
			const zoom = this.currentSubjectDistance;

			if (CameraInput.getTogglePan()) {
				this.cameraToggleSpring.goal = math.clamp(
					Util.map(zoom, 0.5, this.FIRST_PERSON_DISTANCE_THRESHOLD, 0, 1),
					0,
					1,
				);
			} else {
				this.cameraToggleSpring.goal = 0;
			}

			const distanceOffset: number = math.clamp(Util.map(zoom, 0.5, 64, 0, 1), 0, 1) + 1;
			return new Vector3(0, this.cameraToggleSpring.step(dt) * distanceOffset, 0);
		}

		return new Vector3();
	}

	// Movement mode standardized to Enum.ComputerCameraMovementMode values
	SetCameraMovementMode(cameraMovementMode: Enum.ComputerCameraMovementMode): void {
		super.SetCameraMovementMode(cameraMovementMode);

		this.isFollowCamera = cameraMovementMode === Enum.ComputerCameraMovementMode.Follow;
		this.isCameraToggle = cameraMovementMode === Enum.ComputerCameraMovementMode.CameraToggle;
	}

	Update(): LuaTuple<[CFrame, CFrame]> {
		const now = tick();
		const timeDelta = now - this.lastUpdate;

		const camera = game.Workspace.CurrentCamera as Camera;
		let newCameraCFrame = camera.CFrame;
		let newCameraFocus = camera.Focus;

		let overrideCameraLookVector: Vector3 | undefined = undefined;
		if (this.resetCameraAngle) {
			const rootPart = this.GetHumanoidRootPart();
			if (rootPart) {
				overrideCameraLookVector = rootPart.CFrame.mul(INITIAL_CAMERA_ANGLE).LookVector;
			} else {
				overrideCameraLookVector = INITIAL_CAMERA_ANGLE.LookVector;
			}
			this.resetCameraAngle = false;
		}

		const player = PlayersService.LocalPlayer;
		const humanoid = this.GetHumanoid();
		const cameraSubject = camera.CameraSubject;
		const isInVehicle = cameraSubject !== undefined && cameraSubject.IsA("VehicleSeat");
		const isOnASkateboard = cameraSubject !== undefined && cameraSubject.IsA("SkateboardPlatform");
		const isClimbing = humanoid !== undefined && humanoid.GetState() === Enum.HumanoidStateType.Climbing;

		if (this.lastUpdate === undefined || timeDelta > 1) {
			this.lastCameraTransform = undefined;
		}

		let rotateInput = CameraInput.getRotation();

		this.StepZoom();

		const cameraHeight = this.GetCameraHeight();

		// Reset tween speed if user is panning
		if (CameraInput.getRotation() !== new Vector2()) {
			tweenSpeed = 0;
			this.lastUserPanCamera = tick();
		}

		const userRecentlyPannedCamera = now - this.lastUserPanCamera < TIME_BEFORE_AUTO_ROTATE;
		let subjectPosition: Vector3 | undefined = this.GetSubjectPosition();

		if (subjectPosition !== undefined && player && camera) {
			let zoom = this.GetCameraToSubjectDistance();
			if (zoom < 0.5) {
				zoom = 0.5;
			}

			if (this.GetIsMouseLocked() && !this.IsInFirstPerson()) {
				// We need to use the right vector of the camera after rotation, not before
				const newLookCFrame: CFrame = this.CalculateNewLookCFrameFromArg(overrideCameraLookVector, rotateInput);

				const offset: Vector3 = this.GetMouseLockOffset();
				const cameraRelativeOffset: Vector3 = newLookCFrame.RightVector.mul(offset.X)
					.add(newLookCFrame.UpVector.mul(offset.Y))
					.add(newLookCFrame.LookVector.mul(offset.Z));

				//offset can be NAN, NAN, NAN if newLookVector has only y component
				if (Util.IsFiniteVector3(cameraRelativeOffset)) {
					subjectPosition = subjectPosition.add(cameraRelativeOffset);
				}
			} else {
				const userPanningTheCamera = CameraInput.getRotation() !== new Vector2();

				if (!userPanningTheCamera && this.lastCameraTransform) {
					const isInFirstPerson = this.IsInFirstPerson();

					if (
						(isInVehicle || isOnASkateboard || (this.isFollowCamera && isClimbing)) &&
						this.lastUpdate !== undefined &&
						humanoid &&
						(humanoid as unknown as { Torso?: BasePart }).Torso
					) {
						if (isInFirstPerson) {
							if (
								this.lastSubjectCFrame &&
								(isInVehicle || isOnASkateboard) &&
								cameraSubject!.IsA("BasePart")
							) {
								const y = -Util.GetAngleBetweenXZVectors(
									this.lastSubjectCFrame.LookVector,
									(cameraSubject as BasePart).CFrame.LookVector,
								);
								if (Util.IsFinite(y)) {
									rotateInput = rotateInput.add(new Vector2(y, 0));
								}
								tweenSpeed = 0;
							}
						} else if (!userRecentlyPannedCamera) {
							const forwardVector = (humanoid as unknown as { Torso: BasePart }).Torso.CFrame.LookVector;
							tweenSpeed = math.clamp(tweenSpeed + tweenAcceleration * timeDelta, 0, tweenMaxSpeed);

							let percent = math.clamp(tweenSpeed * timeDelta, 0, 1);
							if (this.IsInFirstPerson() && !(this.isFollowCamera && this.isClimbing)) {
								percent = 1;
							}

							const y = Util.GetAngleBetweenXZVectors(forwardVector, this.GetCameraLookVector());
							if (Util.IsFinite(y) && math.abs(y) > 0.0001) {
								rotateInput = rotateInput.add(new Vector2(y * percent, 0));
							}
						}
					} else if (
						this.isFollowCamera &&
						!(isInFirstPerson || userRecentlyPannedCamera) &&
						!VRService.VREnabled
					) {
						// Logic that was unique to the old FollowCamera module
						const lastVec = this.lastCameraTransform.Position.sub(subjectPosition).mul(-1);

						const y = Util.GetAngleBetweenXZVectors(lastVec, this.GetCameraLookVector());

						// This cutoff is to decide if the humanoid's angle of movement,
						// relative to the camera's look vector, is enough that
						// we want the camera to be following them. The point is to provide
						// a sizable dead zone to allow more precise forward movements.
						const thetaCutoff = 0.4;

						// Check for NaNs
						if (Util.IsFinite(y) && math.abs(y) > 0.0001 && math.abs(y) > thetaCutoff * timeDelta) {
							rotateInput = rotateInput.add(new Vector2(y, 0));
						}
					}
				}
			}

			if (!this.isFollowCamera) {
				const VREnabled = VRService.VREnabled;

				if (VREnabled) {
					newCameraFocus = this.GetVRFocus(subjectPosition, timeDelta);
				} else {
					newCameraFocus = new CFrame(subjectPosition);
				}

				const cameraFocusP = newCameraFocus.Position;
				if (VREnabled && !this.IsInFirstPerson()) {
					let vecToSubject: Vector3 = subjectPosition.sub(camera.CFrame.Position);
					const distToSubject: number = vecToSubject.Magnitude;

					const flaggedRotateInput = rotateInput;

					// Only move the camera if it exceeded a maximum distance to the subject in VR
					if (distToSubject > zoom || flaggedRotateInput.X !== 0) {
						const desiredDist = math.min(distToSubject, zoom);
						vecToSubject = this.CalculateNewLookVectorFromArg(undefined, rotateInput).mul(desiredDist);
						const newPos = cameraFocusP.sub(vecToSubject);
						let desiredLookDir = camera.CFrame.LookVector;
						if (flaggedRotateInput.X !== 0) {
							desiredLookDir = vecToSubject;
						}
						const lookAt = new Vector3(newPos.X + desiredLookDir.X, newPos.Y, newPos.Z + desiredLookDir.Z);

						newCameraCFrame = new CFrame(newPos, lookAt).add(new Vector3(0, cameraHeight, 0));
					}
				} else {
					const newLookVector = this.CalculateNewLookVectorFromArg(overrideCameraLookVector, rotateInput);
					newCameraCFrame = new CFrame(cameraFocusP.sub(newLookVector.mul(zoom)), cameraFocusP);
				}
			} else {
				// is FollowCamera
				const newLookVector = this.CalculateNewLookVectorFromArg(overrideCameraLookVector, rotateInput);

				if (VRService.VREnabled) {
					newCameraFocus = this.GetVRFocus(subjectPosition, timeDelta);
				} else {
					newCameraFocus = new CFrame(subjectPosition);
				}
				newCameraCFrame = new CFrame(newCameraFocus.Position.sub(newLookVector.mul(zoom)), newCameraFocus.Position).add(
					new Vector3(0, cameraHeight, 0),
				);
			}

			const toggleOffset = this.GetCameraToggleOffset(timeDelta);
			newCameraFocus = newCameraFocus.add(toggleOffset);
			newCameraCFrame = newCameraCFrame.add(toggleOffset);

			this.lastCameraTransform = newCameraCFrame;
			this.lastCameraFocus = newCameraFocus;
			if ((isInVehicle || isOnASkateboard) && cameraSubject!.IsA("BasePart")) {
				this.lastSubjectCFrame = (cameraSubject as BasePart).CFrame;
			} else {
				this.lastSubjectCFrame = undefined;
			}
		}

		this.lastUpdate = now;
		return $tuple(newCameraCFrame, newCameraFocus);
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

export = ClassicCamera;
