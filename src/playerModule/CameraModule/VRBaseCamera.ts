// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VRBaseCamera (ModuleScript)
//
// VRBaseCamera - Base class for VR camera
// 2021 Roblox VR

import BaseCamera from "./BaseCamera";
import CameraInput from "./CameraInput";
import ZoomController from "./ZoomController";

//[[ Local Constants ]]--
const VR_ANGLE = math.rad(15);
const VR_PANEL_SIZE = 512;
const VR_ZOOM = 7;
const VR_FADE_SPEED = 10; // 1/10 second
const VR_SCREEN_EGDE_BLEND_TIME = 0.14;
const VR_SEAT_OFFSET = new Vector3(0, 4, 0);

const VRService = game.GetService("VRService");

const Players = game.GetService("Players");
const player = Players.LocalPlayer;

const Lighting = game.GetService("Lighting");
const RunService = game.GetService("RunService");

const UserGameSettings = UserSettings().GetService("UserGameSettings");

let FFlagUserVRVignetteToggle: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserVRVignetteToggle"));
	FFlagUserVRVignetteToggle = success && (result as boolean);
}

let FFlagUserFlagEnableVRUpdate2: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserFlagEnableVRUpdate2"));
	FFlagUserFlagEnableVRUpdate2 = success && (result as boolean);
}

//[[ The Module ]]--
class VRBaseCamera extends BaseCamera {
	defaultDistance: number;

	// VR screen effect
	VRFadeResetTimer: number;
	VREdgeBlurTimer: number;

	// initialize vr specific variables
	gamepadResetConnection: RBXScriptConnection | undefined;
	needsReset: boolean;

	// BaseCamera.ts declares a differently-cased `LastCameraFocus?: Vector3` field that isn't
	// what the original Lua's `self.lastCameraFocus` (a CFrame) maps to - declared as our own
	// field here since TypeScript's property names are case-sensitive and the two don't collide.
	// Inherited by VRCamera and VRVehicleCamera below.
	lastCameraFocus: CFrame | undefined;

	constructor() {
		super();

		// distance is different in VR
		this.defaultDistance = VR_ZOOM;
		this.defaultSubjectDistance = math.clamp(
			this.defaultDistance,
			player.CameraMinZoomDistance,
			player.CameraMaxZoomDistance,
		);
		this.currentSubjectDistance = math.clamp(
			this.defaultDistance,
			player.CameraMinZoomDistance,
			player.CameraMaxZoomDistance,
		);

		// VR screen effect
		this.VRFadeResetTimer = 0;
		this.VREdgeBlurTimer = 0;

		// initialize vr specific variables
		this.gamepadResetConnection = undefined;
		this.needsReset = true;
	}

	GetModuleName(): string {
		return "VRBaseCamera";
	}

	GamepadZoomPress(): void {
		const dist = this.GetCameraToSubjectDistance();

		if (dist > VR_ZOOM / 2) {
			this.SetCameraToSubjectDistance(0);
			this.currentSubjectDistance = 0;
		} else {
			this.SetCameraToSubjectDistance(VR_ZOOM);
			this.currentSubjectDistance = VR_ZOOM;
		}

		this.GamepadReset();
		this.ResetZoom();
	}

	GamepadReset(): void {
		this.needsReset = true;
	}

	ResetZoom(): void {
		ZoomController.SetZoomParameters(this.currentSubjectDistance, 0);
		ZoomController.ReleaseSpring();
	}

	OnEnable(enable: boolean): void {
		if (enable) {
			this.gamepadResetConnection = CameraInput.gamepadReset!.Connect(() => {
				this.GamepadReset();
			});
		} else {
			// make sure zoom is reset when switching to another camera
			if (this.inFirstPerson) {
				this.GamepadZoomPress();
			}

			if (this.gamepadResetConnection) {
				this.gamepadResetConnection.Disconnect();
				this.gamepadResetConnection = undefined;
			}

			// reset VR effects
			this.VREdgeBlurTimer = 0;
			this.UpdateEdgeBlur(player, 1);
			const VRFade = Lighting.FindFirstChild("VRFade") as ColorCorrectionEffect | undefined;
			if (VRFade) {
				VRFade.Brightness = 0;
			}
		}
	}

	UpdateDefaultSubjectDistance(): void {
		this.defaultSubjectDistance = math.clamp(VR_ZOOM, player.CameraMinZoomDistance, player.CameraMaxZoomDistance);
	}

	// Nominal distance, set by dollying in and out with the mouse wheel or equivalent, not measured distance
	GetCameraToSubjectDistance(): number {
		return this.currentSubjectDistance;
	}

	// VR only supports 1st person or 3rd person and no overrides
	SetCameraToSubjectDistance(desiredSubjectDistance: number): number {
		const lastSubjectDistance = this.currentSubjectDistance;

		const newSubjectDistance = math.clamp(desiredSubjectDistance, 0, player.CameraMaxZoomDistance);
		if (newSubjectDistance < 1.0) {
			this.currentSubjectDistance = 0.5;
			if (!this.inFirstPerson) {
				this.EnterFirstPerson();
			}
		} else {
			this.currentSubjectDistance = newSubjectDistance;
			if (this.inFirstPerson) {
				this.LeaveFirstPerson();
			}
		}

		// Pass target distance and zoom direction to the zoom controller
		ZoomController.SetZoomParameters(this.currentSubjectDistance, math.sign(desiredSubjectDistance - lastSubjectDistance));

		// Returned only for convenience to the caller to know the outcome
		return this.currentSubjectDistance;
	}

	// defines subject and height of VR camera
	GetVRFocus(subjectPosition: Vector3, timeDelta: number): CFrame {
		const lastFocus: CFrame | Vector3 = this.lastCameraFocus ?? subjectPosition;

		this.cameraTranslationConstraints = new Vector3(
			this.cameraTranslationConstraints.X,
			math.min(1, this.cameraTranslationConstraints.Y + timeDelta),
			this.cameraTranslationConstraints.Z,
		);

		const cameraHeightDelta = new Vector3(0, this.GetCameraHeight(), 0);
		const newFocus = new CFrame(
			new Vector3(subjectPosition.X, lastFocus.Y, subjectPosition.Z).Lerp(
				subjectPosition.add(cameraHeightDelta),
				this.cameraTranslationConstraints.Y,
			),
		);

		return newFocus;
	}

	//-- (VR) Screen effects --------------
	StartFadeFromBlack(): void {
		if (FFlagUserVRVignetteToggle) {
			if (UserGameSettings.VignetteEnabled === false) {
				return;
			}
		}

		let VRFade = Lighting.FindFirstChild("VRFade") as ColorCorrectionEffect | undefined;
		if (!VRFade) {
			VRFade = new Instance("ColorCorrectionEffect");
			VRFade.Name = "VRFade";
			VRFade.Parent = Lighting;
		}
		VRFade.Brightness = -1;
		this.VRFadeResetTimer = 0.1;
	}

	UpdateFadeFromBlack(timeDelta: number): void {
		const VRFade = Lighting.FindFirstChild("VRFade") as ColorCorrectionEffect | undefined;
		if (this.VRFadeResetTimer > 0) {
			this.VRFadeResetTimer = math.max(this.VRFadeResetTimer - timeDelta, 0);

			const VRFade = Lighting.FindFirstChild("VRFade") as ColorCorrectionEffect | undefined;
			if (VRFade && VRFade.Brightness < 0) {
				VRFade.Brightness = math.min(VRFade.Brightness + timeDelta * VR_FADE_SPEED, 0);
			}
		} else {
			if (VRFade) {
				// sanity check, VRFade off
				VRFade.Brightness = 0;
			}
		}
	}

	StartVREdgeBlur(player: Player): void {
		if (FFlagUserVRVignetteToggle) {
			if (UserGameSettings.VignetteEnabled === false) {
				return;
			}
		}

		let blurPart: Part | undefined = undefined;
		if (FFlagUserFlagEnableVRUpdate2) {
			blurPart = game.Workspace.CurrentCamera!.FindFirstChild("VRBlurPart") as Part | undefined;
			if (!blurPart) {
				blurPart = new Instance("Part");
				blurPart.Name = "VRBlurPart";
				blurPart.Parent = game.Workspace.CurrentCamera;
				blurPart.CanTouch = false;
				blurPart.CanCollide = false;
				blurPart.CanQuery = false;
				blurPart.Anchored = true;
				blurPart.Size = new Vector3(0.44, 0.47, 1);
				blurPart.Transparency = 1;
				blurPart.CastShadow = false;

				const capturedBlurPart = blurPart;
				RunService.RenderStepped.Connect((_step) => {
					const userHeadCF = VRService.GetUserCFrame(Enum.UserCFrame.Head);
					// Original indexes `workspace.Camera` here (not `workspace.CurrentCamera`) -
					// preserved verbatim. This looks like it may be a pre-existing typo/dead
					// path in the source (there's normally no instance literally named "Camera"
					// directly under Workspace), but migration conventions call for byte-faithful
					// behavior rather than "fixing" it.
					const vrCF = (game.Workspace as unknown as { Camera: Camera }).Camera.CFrame.mul(userHeadCF);
					capturedBlurPart.CFrame = vrCF.mul(CFrame.Angles(0, math.rad(180), 0)).add(vrCF.LookVector.mul(1.05));
				});
			}
		}

		let VRScreen = (player.WaitForChild("PlayerGui") as PlayerGui).FindFirstChild("VRBlurScreen") as SurfaceGui | ScreenGui | undefined;
		let VRBlur: ImageLabel | undefined = undefined;
		if (VRScreen) {
			VRBlur = VRScreen.FindFirstChild("VRBlur") as ImageLabel | undefined;
		}

		if (!VRBlur) {
			if (!VRScreen) {
				VRScreen = FFlagUserFlagEnableVRUpdate2 ? new Instance("SurfaceGui") : new Instance("ScreenGui");
			}

			VRScreen.Name = "VRBlurScreen";
			VRScreen.Parent = (player.WaitForChild("PlayerGui") as PlayerGui);

			if (FFlagUserFlagEnableVRUpdate2) {
				(VRScreen as SurfaceGui).Adornee = blurPart;
			}

			VRBlur = new Instance("ImageLabel");
			VRBlur.Name = "VRBlur";
			VRBlur.Parent = VRScreen;

			VRBlur.Image = "rbxasset://textures/ui/VR/edgeBlur.png";
			VRBlur.AnchorPoint = new Vector2(0.5, 0.5);
			VRBlur.Position = new UDim2(0.5, 0, 0.5, 0);

			// this computes the ratio between the GUI 3D panel and the VR viewport
			// adding 15% overshoot for edges on 2 screen headsets
			const ratioX = (game.Workspace.CurrentCamera!.ViewportSize.X * 2.3) / VR_PANEL_SIZE;
			const ratioY = (game.Workspace.CurrentCamera!.ViewportSize.Y * 2.3) / VR_PANEL_SIZE;

			VRBlur.Size = UDim2.fromScale(ratioX, ratioY);
			VRBlur.BackgroundTransparency = 1;
			VRBlur.Active = true;
			VRBlur.ScaleType = Enum.ScaleType.Stretch;
		}

		VRBlur.Visible = true;
		VRBlur.ImageTransparency = 0;
		this.VREdgeBlurTimer = VR_SCREEN_EGDE_BLEND_TIME;
	}

	UpdateEdgeBlur(player: Player, timeDelta: number): void {
		const VRScreen = (player.WaitForChild("PlayerGui") as PlayerGui).FindFirstChild("VRBlurScreen");
		let VRBlur: Instance | undefined = undefined;
		if (VRScreen) {
			VRBlur = VRScreen.FindFirstChild("VRBlur");
		}

		if (VRBlur) {
			if (this.VREdgeBlurTimer > 0) {
				this.VREdgeBlurTimer = this.VREdgeBlurTimer - timeDelta;

				const VRScreen = (player.WaitForChild("PlayerGui") as PlayerGui).FindFirstChild("VRBlurScreen");
				if (VRScreen) {
					const VRBlur = VRScreen.FindFirstChild("VRBlur") as ImageLabel | undefined;
					if (VRBlur) {
						VRBlur.ImageTransparency =
							1.0 -
							math.clamp(this.VREdgeBlurTimer, 0.01, VR_SCREEN_EGDE_BLEND_TIME) * (1 / VR_SCREEN_EGDE_BLEND_TIME);
					}
				}
			} else {
				(VRBlur as ImageLabel).Visible = false;
			}
		}
	}

	GetCameraHeight(): number {
		if (!this.inFirstPerson) {
			return math.sin(VR_ANGLE) * this.currentSubjectDistance;
		}
		return 0;
	}

	GetSubjectCFrame(): CFrame {
		let result = super.GetSubjectCFrame();
		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;

		if (!cameraSubject) {
			return result;
		}

		// new VR system overrides
		if (cameraSubject.IsA("Humanoid")) {
			const humanoid = cameraSubject;
			const humanoidIsDead = humanoid.GetState() === Enum.HumanoidStateType.Dead;

			if (humanoidIsDead && humanoid === this.lastSubject) {
				result = this.lastSubjectCFrame as CFrame;
			}
		}

		if (result) {
			this.lastSubjectCFrame = result;
		}

		return result;
	}

	GetSubjectPosition(): Vector3 | undefined {
		let result = super.GetSubjectPosition();

		// new VR system overrides
		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;
		if (cameraSubject) {
			if (cameraSubject.IsA("Humanoid")) {
				const humanoid = cameraSubject;
				const humanoidIsDead = humanoid.GetState() === Enum.HumanoidStateType.Dead;

				if (humanoidIsDead && humanoid === this.lastSubject) {
					result = this.lastSubjectPosition;
				}
			} else if (cameraSubject.IsA("VehicleSeat")) {
				const offset = VR_SEAT_OFFSET;
				result = cameraSubject.CFrame.Position.add(cameraSubject.CFrame.VectorToWorldSpace(offset));
			}
		} else {
			return undefined;
		}

		// By this point `cameraSubject` was truthy above (the `else` branch already returned),
		// so `result` is always a real Vector3 here, matching the original Lua's assumption -
		// same reasoning as BaseCamera's own GetSubjectPosition.
		this.lastSubjectPosition = result as Vector3;

		return result;
	}

	//-----------------------------
}

export = VRBaseCamera;
