// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/LegacyCamera (ModuleScript)
//
// LegacyCamera - Implements legacy controller types: Attach, Fixed, Watch
// 2018 Camera Update - AllYourBlox

import BaseCamera from "./BaseCamera";
import CameraInput from "./CameraInput";
import Util from "./CameraUtils";

const ZERO_VECTOR2 = new Vector2();
const PITCH_LIMIT = math.rad(80);

//[[ Services ]]--
const PlayersService = game.GetService("Players");

//[[ The Module ]]--
class LegacyCamera extends BaseCamera {
	cameraType: Enum.CameraType;
	lastUpdate: number | undefined;
	lastDistanceToSubject: number | undefined;

	constructor() {
		super();

		this.cameraType = Enum.CameraType.Fixed;
		this.lastUpdate = tick();
		this.lastDistanceToSubject = undefined;
	}

	GetModuleName(): string {
		return "LegacyCamera";
	}

	//[[ Functions overridden from BaseCamera ]]--
	SetCameraToSubjectDistance(desiredSubjectDistance: number): number {
		return super.SetCameraToSubjectDistance(desiredSubjectDistance);
	}

	// BaseCamera declares `Update(dt: number): LuaTuple<[CFrame, CFrame]>` (always returns a
	// tuple). The original Lua can fall through the "cameraType not yet set" guard below with a
	// bare `return` (no values) - from a caller's perspective in Lua, returning zero values and
	// returning a single nil are indistinguishable (unlisted destructured locals both become
	// nil), so we preserve that exact runtime behavior via a cast rather than fabricating a
	// placeholder CFrame pair that was never in the original.
	Update(dt: number): LuaTuple<[CFrame, CFrame]> {
		// Cannot update until cameraType has been set
		if (!this.cameraType) {
			return undefined as unknown as LuaTuple<[CFrame, CFrame]>;
		}

		const now = tick();
		const timeDelta = now - (this.lastUpdate as number);
		const camera = game.Workspace.CurrentCamera as Camera;
		let newCameraCFrame = camera.CFrame;
		let newCameraFocus = camera.Focus;
		const player = PlayersService.LocalPlayer;

		if (this.lastUpdate === undefined || timeDelta > 1) {
			this.lastDistanceToSubject = undefined;
		}
		const subjectPosition: Vector3 | undefined = this.GetSubjectPosition();

		if (this.cameraType === Enum.CameraType.Fixed) {
			if (subjectPosition !== undefined && player && camera) {
				const distanceToSubject = this.GetCameraToSubjectDistance();
				const newLookVector = this.CalculateNewLookVectorFromArg(undefined, CameraInput.getRotation());

				newCameraFocus = camera.Focus; // Fixed camera does not change focus
				newCameraCFrame = new CFrame(camera.CFrame.Position, camera.CFrame.Position.add(newLookVector.mul(distanceToSubject)));
			}
		} else if (this.cameraType === Enum.CameraType.Attach) {
			const subjectCFrame = this.GetSubjectCFrame();
			let [cameraPitch] = camera.CFrame.ToEulerAnglesYXZ();
			const [, subjectYaw] = subjectCFrame.ToEulerAnglesYXZ();

			cameraPitch = math.clamp(cameraPitch - CameraInput.getRotation().Y, -PITCH_LIMIT, PITCH_LIMIT);

			newCameraFocus = new CFrame(subjectCFrame.Position).mul(CFrame.fromEulerAnglesYXZ(cameraPitch, subjectYaw, 0));
			newCameraCFrame = newCameraFocus.mul(new CFrame(0, 0, this.StepZoom()));
		} else if (this.cameraType === Enum.CameraType.Watch) {
			if (subjectPosition !== undefined && player && camera) {
				let cameraLook: Vector3 | undefined = undefined;

				if (subjectPosition === camera.CFrame.Position) {
					warn("Camera cannot watch subject in same position as itself");
					return $tuple(camera.CFrame, camera.Focus);
				}

				const humanoid = this.GetHumanoid();
				if (humanoid && humanoid.RootPart) {
					const diffVector = subjectPosition.sub(camera.CFrame.Position);
					cameraLook = diffVector.Unit;

					if (
						this.lastDistanceToSubject !== undefined &&
						this.lastDistanceToSubject === this.GetCameraToSubjectDistance()
					) {
						// Don't clobber the zoom if they zoomed the camera
						const newDistanceToSubject = diffVector.Magnitude;
						this.SetCameraToSubjectDistance(newDistanceToSubject);
					}
				}

				const distanceToSubject: number = this.GetCameraToSubjectDistance();
				const newLookVector: Vector3 = this.CalculateNewLookVectorFromArg(cameraLook, CameraInput.getRotation());

				newCameraFocus = new CFrame(subjectPosition);
				newCameraCFrame = new CFrame(subjectPosition.sub(newLookVector.mul(distanceToSubject)), subjectPosition);

				this.lastDistanceToSubject = distanceToSubject;
			}
		} else {
			// Unsupported type, return current values unchanged
			return $tuple(camera.CFrame, camera.Focus);
		}

		this.lastUpdate = now;
		return $tuple(newCameraCFrame, newCameraFocus);
	}
}

export = LegacyCamera;
