// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/BaseCamera (ModuleScript)
//
// BaseCamera - Abstract base class for camera control modules
// 2018 Camera Update - AllYourBlox
//
// Note: the original carries a `--!nolint DeprecatedApi` pragma and relies throughout on
// deprecated lowercase CFrame/Vector2/Vector3 aliases (.p, .lookVector, .x, .y, .z,
// :vectorToWorldSpace, :vectorToObjectSpace, .magnitude, `workspace` global) which are not
// present in @rbxts/types. Every such reference below has been mechanically rewritten to its
// modern, behaviorally-identical equivalent (.Position, .LookVector, .X, .Y, .Z,
// VectorToWorldSpace, VectorToObjectSpace, .Magnitude, game.Workspace) — these are pure aliases
// in real Roblox, so there is no behavior change.

import CameraUtils from "./CameraUtils";
import ZoomController from "./ZoomController";
import CameraToggleStateController from "./CameraToggleStateController";
import CameraInput from "./CameraInput";
import CameraUI from "./CameraUI";

//[[ Local Constants ]]
const UNIT_Z = new Vector3(0, 0, 1);
const X1_Y0_Z1 = new Vector3(1, 0, 1); // Note: not a unit vector, used for projecting onto XZ plane

const DEFAULT_DISTANCE = 12.5; // Studs
const PORTRAIT_DEFAULT_DISTANCE = 25; // Studs
const FIRST_PERSON_DISTANCE_THRESHOLD = 1.0; // Below this value, snap into first person

// Note: DotProduct check in CoordinateFrame::lookAt() prevents using values within about
// 8.11 degrees of the +/- Y axis, that's why these limits are currently 80 degrees
const MIN_Y = math.rad(-80);
const MAX_Y = math.rad(80);

const VR_ANGLE = math.rad(15);
const VR_LOW_INTENSITY_ROTATION = new Vector2(math.rad(15), 0);
const VR_HIGH_INTENSITY_ROTATION = new Vector2(math.rad(45), 0);
const VR_LOW_INTENSITY_REPEAT = 0.1;
const VR_HIGH_INTENSITY_REPEAT = 0.4;

const ZERO_VECTOR2 = Vector2.zero;
const ZERO_VECTOR3 = Vector3.zero;

const SEAT_OFFSET = new Vector3(0, 5, 0);
const VR_SEAT_OFFSET = new Vector3(0, 4, 0);
const HEAD_OFFSET = new Vector3(0, 1.5, 0);
const R15_HEAD_OFFSET = new Vector3(0, 1.5, 0);
const R15_HEAD_OFFSET_NO_SCALING = new Vector3(0, 2, 0);
const HUMANOID_ROOT_PART_SIZE = new Vector3(2, 2, 1);

const GAMEPAD_ZOOM_STEP_1 = 0;
const GAMEPAD_ZOOM_STEP_2 = 10;
const GAMEPAD_ZOOM_STEP_3 = 20;

const ZOOM_SENSITIVITY_CURVATURE = 0.5;
const FIRST_PERSON_DISTANCE_MIN = 0.5;

//[[ Roblox Services ]]
const Players = game.GetService("Players");
const UserInputService = game.GetService("UserInputService");
const StarterGui = game.GetService("StarterGui");
const VRService = game.GetService("VRService");
const UserGameSettings = UserSettings().GetService("UserGameSettings");

const player = Players.LocalPlayer;

let FFlagUserFlagEnableNewVRSystem: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserFlagEnableNewVRSystem"));
	FFlagUserFlagEnableNewVRSystem = success && (result as boolean);
}

let FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame: boolean;
{
	const [success, value] = pcall(() =>
		UserSettings().IsUserFeatureEnabled("UserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame"),
	);
	FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame = success && (value as boolean);
}

type VRRotationIntensity = "Low" | "High" | "Smooth";

//[[ The Module ]]
class BaseCamera {
	// So that derived classes have access to this
	readonly FIRST_PERSON_DISTANCE_THRESHOLD = FIRST_PERSON_DISTANCE_THRESHOLD;

	cameraType?: Enum.CameraType;
	cameraMovementMode?: Enum.ComputerCameraMovementMode | Enum.DevComputerCameraMovementMode;

	lastCameraTransform?: CFrame;
	lastUserPanCamera = tick();

	humanoidRootPart?: BasePart;
	humanoidCache = new Map<Player, Humanoid>();

	// Subject and position on last update call
	lastSubject?: Humanoid | BasePart | Model;
	lastSubjectPosition: Vector3 = new Vector3(0, 5, 0);
	lastSubjectCFrame: CFrame | undefined = new CFrame(this.lastSubjectPosition);

	// These subject distance members refer to the nominal camera-to-subject follow distance that the camera
	// is trying to maintain, not the actual measured value.
	// The default is updated when screen orientation or the min/max distances change,
	// to be sure the default is always in range and appropriate for the orientation.
	defaultSubjectDistance = math.clamp(DEFAULT_DISTANCE, player.CameraMinZoomDistance, player.CameraMaxZoomDistance);
	currentSubjectDistance = math.clamp(DEFAULT_DISTANCE, player.CameraMinZoomDistance, player.CameraMaxZoomDistance);

	inFirstPerson = false;
	inMouseLockedMode = false;
	portraitMode = false;
	isSmallTouchScreen = false;

	// Used by modules which want to reset the camera angle on respawn.
	resetCameraAngle = true;

	enabled = false;

	// Input Event Connections

	PlayerGui?: PlayerGui;

	cameraChangedConn?: RBXScriptConnection;
	viewportSizeChangedConn?: RBXScriptConnection;

	// VR Support
	shouldUseVRRotation = false;
	VRRotationIntensityAvailable = false;
	lastVRRotationIntensityCheckTime = 0;
	lastVRRotationTime = 0;
	vrRotateKeyCooldown = new Map<Enum.KeyCode, boolean>();
	cameraTranslationConstraints = new Vector3(1, 1, 1);
	humanoidJumpOrigin?: Vector3;
	trackingHumanoid?: Humanoid;
	cameraFrozen = false;
	subjectStateChangedConn?: RBXScriptConnection;

	gamepadZoomPressConnection?: RBXScriptConnection;

	// Mouse locked formerly known as shift lock mode
	mouseLockOffset: Vector3 = ZERO_VECTOR3;

	// Fields assigned dynamically outside of the constructor (nil-initialized in the original)
	playerCameraModeChangeConn?: RBXScriptConnection;
	minDistanceChangeConn?: RBXScriptConnection;
	maxDistanceChangeConn?: RBXScriptConnection;
	playerDevTouchMoveModeChangeConn?: RBXScriptConnection;
	gameSettingsTouchMoveMoveChangeConn?: RBXScriptConnection;
	hasGameLoaded = false;
	gameLoadedConn?: RBXScriptConnection;
	isAToolEquipped?: boolean;
	isDynamicThumbstickEnabled?: boolean;
	isCameraToggle?: boolean;
	// Never assigned within BaseCamera itself; set by derived classes (e.g. ClassicCamera).
	LastCameraFocus?: Vector3;

	constructor() {
		// Initialization things used to always execute at game load time, but now these camera modules are instantiated
		// when needed, so the code here may run well after the start of the game

		if (player.Character) {
			this.OnCharacterAdded(player.Character);
		}

		player.CharacterAdded.Connect((char) => {
			this.OnCharacterAdded(char);
		});

		if (this.cameraChangedConn) {
			this.cameraChangedConn.Disconnect();
		}
		this.cameraChangedConn = game.Workspace.GetPropertyChangedSignal("CurrentCamera").Connect(() => {
			this.OnCurrentCameraChanged();
		});
		this.OnCurrentCameraChanged();

		if (this.playerCameraModeChangeConn) {
			this.playerCameraModeChangeConn.Disconnect();
		}
		this.playerCameraModeChangeConn = player.GetPropertyChangedSignal("CameraMode").Connect(() => {
			this.OnPlayerCameraPropertyChange();
		});

		if (this.minDistanceChangeConn) {
			this.minDistanceChangeConn.Disconnect();
		}
		this.minDistanceChangeConn = player.GetPropertyChangedSignal("CameraMinZoomDistance").Connect(() => {
			this.OnPlayerCameraPropertyChange();
		});

		if (this.maxDistanceChangeConn) {
			this.maxDistanceChangeConn.Disconnect();
		}
		this.maxDistanceChangeConn = player.GetPropertyChangedSignal("CameraMaxZoomDistance").Connect(() => {
			this.OnPlayerCameraPropertyChange();
		});

		if (this.playerDevTouchMoveModeChangeConn) {
			this.playerDevTouchMoveModeChangeConn.Disconnect();
		}
		this.playerDevTouchMoveModeChangeConn = player.GetPropertyChangedSignal("DevTouchMovementMode").Connect(() => {
			this.OnDevTouchMovementModeChanged();
		});
		this.OnDevTouchMovementModeChanged(); // Init

		if (this.gameSettingsTouchMoveMoveChangeConn) {
			this.gameSettingsTouchMoveMoveChangeConn.Disconnect();
		}
		this.gameSettingsTouchMoveMoveChangeConn = UserGameSettings.GetPropertyChangedSignal(
			"TouchMovementMode",
		).Connect(() => {
			this.OnGameSettingsTouchMovementModeChanged();
		});
		this.OnGameSettingsTouchMovementModeChanged(); // Init

		UserGameSettings.SetCameraYInvertVisible();
		UserGameSettings.SetGamepadCameraSensitivityVisible();

		this.hasGameLoaded = game.IsLoaded();
		if (!this.hasGameLoaded) {
			this.gameLoadedConn = game.Loaded.Connect(() => {
				this.hasGameLoaded = true;
				this.gameLoadedConn!.Disconnect();
				this.gameLoadedConn = undefined;
			});
		}

		this.OnPlayerCameraPropertyChange();
	}

	GetModuleName(): string {
		return "BaseCamera";
	}

	OnCharacterAdded(char: Model): void {
		this.resetCameraAngle = this.resetCameraAngle || this.GetEnabled();
		this.humanoidRootPart = undefined;
		if (UserInputService.TouchEnabled) {
			this.PlayerGui = player.WaitForChild("PlayerGui") as PlayerGui;
			for (const child of char.GetChildren()) {
				if (child.IsA("Tool")) {
					this.isAToolEquipped = true;
				}
			}
			char.ChildAdded.Connect((child) => {
				if (child.IsA("Tool")) {
					this.isAToolEquipped = true;
				}
			});
			char.ChildRemoved.Connect((child) => {
				if (child.IsA("Tool")) {
					this.isAToolEquipped = false;
				}
			});
		}
	}

	GetHumanoidRootPart(): BasePart | undefined {
		if (!this.humanoidRootPart) {
			if (player.Character) {
				const humanoid = player.Character.FindFirstChildOfClass("Humanoid");
				if (humanoid) {
					this.humanoidRootPart = humanoid.RootPart;
				}
			}
		}
		return this.humanoidRootPart;
	}

	GetBodyPartToFollow(humanoid: Humanoid, isDead: boolean): Instance | undefined {
		// If the humanoid is dead, prefer the head part if one still exists as a sibling of the humanoid
		if (humanoid.GetState() === Enum.HumanoidStateType.Dead) {
			const character = humanoid.Parent;
			if (character && character.IsA("Model")) {
				return character.FindFirstChild("Head") ?? humanoid.RootPart;
			}
		}

		return humanoid.RootPart;
	}

	GetSubjectCFrame(): CFrame {
		let result = this.lastSubjectCFrame!;
		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;

		if (!cameraSubject) {
			return result;
		}

		if (cameraSubject.IsA("Humanoid")) {
			const humanoid = cameraSubject;
			const humanoidIsDead = humanoid.GetState() === Enum.HumanoidStateType.Dead;

			if (VRService.VREnabled && !FFlagUserFlagEnableNewVRSystem && humanoidIsDead && humanoid === this.lastSubject) {
				result = this.lastSubjectCFrame!;
			} else {
				let bodyPartToFollow: Instance | undefined = humanoid.RootPart;

				// If the humanoid is dead, prefer their head part as a follow target, if it exists
				if (humanoidIsDead) {
					if (humanoid.Parent && humanoid.Parent.IsA("Model")) {
						bodyPartToFollow = humanoid.Parent.FindFirstChild("Head") ?? bodyPartToFollow;
					}
				}

				if (bodyPartToFollow && bodyPartToFollow.IsA("BasePart")) {
					let heightOffset: Vector3;
					if (humanoid.RigType === Enum.HumanoidRigType.R15) {
						if (humanoid.AutomaticScalingEnabled) {
							heightOffset = R15_HEAD_OFFSET;

							const rootPart = humanoid.RootPart;
							if (bodyPartToFollow === rootPart && rootPart) {
								const rootPartSizeOffset = (rootPart.Size.Y - HUMANOID_ROOT_PART_SIZE.Y) / 2;
								heightOffset = heightOffset.add(new Vector3(0, rootPartSizeOffset, 0));
							}
						} else {
							heightOffset = R15_HEAD_OFFSET_NO_SCALING;
						}
					} else {
						heightOffset = HEAD_OFFSET;
					}

					if (humanoidIsDead) {
						heightOffset = ZERO_VECTOR3;
					}

					result = bodyPartToFollow.CFrame.mul(new CFrame(heightOffset.add(humanoid.CameraOffset)));
				}
			}
		} else if (cameraSubject.IsA("BasePart")) {
			result = cameraSubject.CFrame;
		} else if (cameraSubject.IsA("Model")) {
			// Model subjects are expected to have a PrimaryPart to determine orientation
			if (cameraSubject.PrimaryPart) {
				result = cameraSubject.GetPrimaryPartCFrame();
			} else {
				result = new CFrame();
			}
		}

		if (result) {
			this.lastSubjectCFrame = result;
		}

		return result;
	}

	GetSubjectVelocity(): Vector3 {
		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;

		if (!cameraSubject) {
			return ZERO_VECTOR3;
		}

		if (cameraSubject.IsA("BasePart")) {
			return cameraSubject.Velocity;
		} else if (cameraSubject.IsA("Humanoid")) {
			const rootPart = cameraSubject.RootPart;

			if (rootPart) {
				return rootPart.Velocity;
			}
		} else if (cameraSubject.IsA("Model")) {
			const primaryPart = cameraSubject.PrimaryPart;

			if (primaryPart) {
				return primaryPart.Velocity;
			}
		}

		return ZERO_VECTOR3;
	}

	GetSubjectRotVelocity(): Vector3 {
		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;

		if (!cameraSubject) {
			return ZERO_VECTOR3;
		}

		if (cameraSubject.IsA("BasePart")) {
			return cameraSubject.RotVelocity;
		} else if (cameraSubject.IsA("Humanoid")) {
			const rootPart = cameraSubject.RootPart;

			if (rootPart) {
				return rootPart.RotVelocity;
			}
		} else if (cameraSubject.IsA("Model")) {
			const primaryPart = cameraSubject.PrimaryPart;

			if (primaryPart) {
				return primaryPart.RotVelocity;
			}
		}

		return ZERO_VECTOR3;
	}

	StepZoom(): number {
		const zoom: number = this.currentSubjectDistance;
		const zoomDelta: number = CameraInput.getZoomDelta();

		if (math.abs(zoomDelta) > 0) {
			let newZoom: number;

			if (zoomDelta > 0) {
				newZoom = zoom + zoomDelta * (1 + zoom * ZOOM_SENSITIVITY_CURVATURE);
				newZoom = math.max(newZoom, this.FIRST_PERSON_DISTANCE_THRESHOLD);
			} else {
				newZoom = (zoom + zoomDelta) / (1 - zoomDelta * ZOOM_SENSITIVITY_CURVATURE);
				newZoom = math.max(newZoom, FIRST_PERSON_DISTANCE_MIN);
			}

			if (newZoom < this.FIRST_PERSON_DISTANCE_THRESHOLD) {
				newZoom = FIRST_PERSON_DISTANCE_MIN;
			}

			this.SetCameraToSubjectDistance(newZoom);
		}

		return ZoomController.GetZoomRadius();
	}

	GetSubjectPosition(): Vector3 | undefined {
		let result: Vector3 | undefined = this.lastSubjectPosition;
		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;

		if (cameraSubject) {
			if (cameraSubject.IsA("Humanoid")) {
				const humanoid = cameraSubject;
				const humanoidIsDead = humanoid.GetState() === Enum.HumanoidStateType.Dead;

				if (
					VRService.VREnabled &&
					!FFlagUserFlagEnableNewVRSystem &&
					humanoidIsDead &&
					humanoid === this.lastSubject
				) {
					result = this.lastSubjectPosition;
				} else {
					let bodyPartToFollow: Instance | undefined = humanoid.RootPart;

					// If the humanoid is dead, prefer their head part as a follow target, if it exists
					if (humanoidIsDead) {
						if (humanoid.Parent && humanoid.Parent.IsA("Model")) {
							bodyPartToFollow = humanoid.Parent.FindFirstChild("Head") ?? bodyPartToFollow;
						}
					}

					if (bodyPartToFollow && bodyPartToFollow.IsA("BasePart")) {
						let heightOffset: Vector3;
						if (humanoid.RigType === Enum.HumanoidRigType.R15) {
							if (humanoid.AutomaticScalingEnabled) {
								heightOffset = R15_HEAD_OFFSET;
								if (bodyPartToFollow === humanoid.RootPart && humanoid.RootPart) {
									const rootPartSizeOffset =
										humanoid.RootPart.Size.Y / 2 - HUMANOID_ROOT_PART_SIZE.Y / 2;
									heightOffset = heightOffset.add(new Vector3(0, rootPartSizeOffset, 0));
								}
							} else {
								heightOffset = R15_HEAD_OFFSET_NO_SCALING;
							}
						} else {
							heightOffset = HEAD_OFFSET;
						}

						if (humanoidIsDead) {
							heightOffset = ZERO_VECTOR3;
						}

						result = bodyPartToFollow.CFrame.Position.add(
							bodyPartToFollow.CFrame.VectorToWorldSpace(heightOffset.add(humanoid.CameraOffset)),
						);
					}
				}
			} else if (cameraSubject.IsA("VehicleSeat")) {
				let offset = SEAT_OFFSET;
				if (VRService.VREnabled && !FFlagUserFlagEnableNewVRSystem) {
					offset = VR_SEAT_OFFSET;
				}
				result = cameraSubject.CFrame.Position.add(cameraSubject.CFrame.VectorToWorldSpace(offset));
			} else if (cameraSubject.IsA("SkateboardPlatform")) {
				result = cameraSubject.CFrame.Position.add(SEAT_OFFSET);
			} else if (cameraSubject.IsA("BasePart")) {
				result = cameraSubject.CFrame.Position;
			} else if (cameraSubject.IsA("Model")) {
				if (cameraSubject.PrimaryPart) {
					result = cameraSubject.GetPrimaryPartCFrame().Position;
				} else {
					result = cameraSubject.GetModelCFrame().Position;
				}
			}
		} else {
			// cameraSubject is nil
			// Note: Previous RootCamera did not have this else case and let self.lastSubject and self.lastSubjectPosition
			// both get set to nil in the case of cameraSubject being nil. This function now exits here to preserve the
			// last set valid values for these, as nil values are not handled cases
			return undefined;
		}

		this.lastSubject = cameraSubject as Humanoid | BasePart | Model | undefined;
		this.lastSubjectPosition = result!;

		return result;
	}

	UpdateDefaultSubjectDistance(): void {
		if (this.portraitMode) {
			this.defaultSubjectDistance = math.clamp(
				PORTRAIT_DEFAULT_DISTANCE,
				player.CameraMinZoomDistance,
				player.CameraMaxZoomDistance,
			);
		} else {
			this.defaultSubjectDistance = math.clamp(
				DEFAULT_DISTANCE,
				player.CameraMinZoomDistance,
				player.CameraMaxZoomDistance,
			);
		}
	}

	OnViewportSizeChanged(): void {
		const camera = game.Workspace.CurrentCamera!;
		const size = camera.ViewportSize;
		this.portraitMode = size.X < size.Y;
		this.isSmallTouchScreen = UserInputService.TouchEnabled && (size.Y < 500 || size.X < 700);

		this.UpdateDefaultSubjectDistance();
	}

	// Listener for changes to workspace.CurrentCamera
	OnCurrentCameraChanged(): void {
		if (UserInputService.TouchEnabled) {
			if (this.viewportSizeChangedConn) {
				this.viewportSizeChangedConn.Disconnect();
				this.viewportSizeChangedConn = undefined;
			}

			const newCamera = game.Workspace.CurrentCamera;

			if (newCamera) {
				this.OnViewportSizeChanged();
				this.viewportSizeChangedConn = newCamera.GetPropertyChangedSignal("ViewportSize").Connect(() => {
					this.OnViewportSizeChanged();
				});
			}
		}

		// VR support additions
		if (this.subjectStateChangedConn) {
			this.subjectStateChangedConn.Disconnect();
			this.subjectStateChangedConn = undefined;
		}

		const camera = game.Workspace.CurrentCamera;
		if (camera) {
			this.subjectStateChangedConn = camera.GetPropertyChangedSignal("CameraSubject").Connect(() => {
				this.OnNewCameraSubject();
			});
			this.OnNewCameraSubject();
		}
	}

	OnDynamicThumbstickEnabled(): void {
		if (UserInputService.TouchEnabled) {
			this.isDynamicThumbstickEnabled = true;
		}
	}

	OnDynamicThumbstickDisabled(): void {
		this.isDynamicThumbstickEnabled = false;
	}

	OnGameSettingsTouchMovementModeChanged(): void {
		if (player.DevTouchMovementMode === Enum.DevTouchMovementMode.UserChoice) {
			if (
				UserGameSettings.TouchMovementMode === Enum.TouchMovementMode.DynamicThumbstick ||
				UserGameSettings.TouchMovementMode === Enum.TouchMovementMode.Default
			) {
				this.OnDynamicThumbstickEnabled();
			} else {
				this.OnDynamicThumbstickDisabled();
			}
		}
	}

	OnDevTouchMovementModeChanged(): void {
		if (player.DevTouchMovementMode === Enum.DevTouchMovementMode.DynamicThumbstick) {
			this.OnDynamicThumbstickEnabled();
		} else {
			this.OnGameSettingsTouchMovementModeChanged();
		}
	}

	OnPlayerCameraPropertyChange(): void {
		// This call forces re-evaluation of player.CameraMode and clamping to min/max distance which may have changed
		this.SetCameraToSubjectDistance(this.currentSubjectDistance);
	}

	InputTranslationToCameraAngleChange(translationVector: Vector2, sensitivity: number): Vector2 {
		return translationVector.mul(sensitivity);
	}

	GamepadZoomPress(): void {
		const dist = this.GetCameraToSubjectDistance();

		if (dist > (GAMEPAD_ZOOM_STEP_2 + GAMEPAD_ZOOM_STEP_3) / 2) {
			this.SetCameraToSubjectDistance(GAMEPAD_ZOOM_STEP_2);
		} else if (dist > (GAMEPAD_ZOOM_STEP_1 + GAMEPAD_ZOOM_STEP_2) / 2) {
			this.SetCameraToSubjectDistance(GAMEPAD_ZOOM_STEP_1);
		} else {
			this.SetCameraToSubjectDistance(GAMEPAD_ZOOM_STEP_3);
		}
	}

	Enable(enable: boolean): void {
		if (this.enabled !== enable) {
			this.enabled = enable;
			if (this.enabled) {
				CameraInput.setInputEnabled(true);

				this.gamepadZoomPressConnection = CameraInput.gamepadZoomPress.Connect(() => {
					this.GamepadZoomPress();
				});

				if (player.CameraMode === Enum.CameraMode.LockFirstPerson) {
					this.currentSubjectDistance = 0.5;
					if (!this.inFirstPerson) {
						this.EnterFirstPerson();
					}
				}
			} else {
				CameraInput.setInputEnabled(false);

				if (this.gamepadZoomPressConnection) {
					this.gamepadZoomPressConnection.Disconnect();
					this.gamepadZoomPressConnection = undefined;
				}
				// Clean up additional event listeners and reset a bunch of properties
				this.Cleanup();
			}

			this.OnEnable(enable);
		}
	}

	// for derived camera
	OnEnable(enable: boolean): void {}

	GetEnabled(): boolean {
		return this.enabled;
	}

	Cleanup(): void {
		if (this.subjectStateChangedConn) {
			this.subjectStateChangedConn.Disconnect();
			this.subjectStateChangedConn = undefined;
		}
		if (this.viewportSizeChangedConn) {
			this.viewportSizeChangedConn.Disconnect();
			this.viewportSizeChangedConn = undefined;
		}

		this.lastCameraTransform = undefined;
		this.lastSubjectCFrame = undefined;

		// Unlock mouse for example if right mouse button was being held down
		if (FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame) {
			CameraUtils.restoreMouseBehavior();
		} else {
			if (UserInputService.MouseBehavior !== Enum.MouseBehavior.LockCenter) {
				UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
			}
		}
	}

	UpdateMouseBehavior(): void {
		const blockToggleDueToClickToMove = UserGameSettings.ComputerMovementMode === Enum.ComputerMovementMode.ClickToMove;

		if (this.isCameraToggle && !blockToggleDueToClickToMove) {
			CameraUI.setCameraModeToastEnabled(true);
			CameraInput.enableCameraToggleInput();
			CameraToggleStateController(this.inFirstPerson);
		} else {
			CameraUI.setCameraModeToastEnabled(false);
			CameraInput.disableCameraToggleInput();

			// first time transition to first person mode or mouse-locked third person
			if (this.inFirstPerson || this.inMouseLockedMode) {
				if (FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame) {
					CameraUtils.setRotationTypeOverride(Enum.RotationType.CameraRelative);
					CameraUtils.setMouseBehaviorOverride(Enum.MouseBehavior.LockCenter);
				} else {
					UserGameSettings.RotationType = Enum.RotationType.CameraRelative;
					UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter;
				}
			} else {
				if (FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame) {
					CameraUtils.restoreRotationType();
					CameraUtils.restoreMouseBehavior();
				} else {
					UserGameSettings.RotationType = Enum.RotationType.MovementRelative;
					UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
				}
			}
		}
	}

	UpdateForDistancePropertyChange(): void {
		// Calling this setter with the current value will force checking that it is still
		// in range after a change to the min/max distance limits
		this.SetCameraToSubjectDistance(this.currentSubjectDistance);
	}

	SetCameraToSubjectDistance(desiredSubjectDistance: number): number {
		const lastSubjectDistance = this.currentSubjectDistance;

		// By default, camera modules will respect LockFirstPerson and override the currentSubjectDistance with 0
		// regardless of what Player.CameraMinZoomDistance is set to, so that first person can be made
		// available by the developer without needing to allow players to mousewheel dolly into first person.
		// Some modules will override this function to remove or change first-person capability.
		if (player.CameraMode === Enum.CameraMode.LockFirstPerson) {
			this.currentSubjectDistance = 0.5;
			if (!this.inFirstPerson) {
				this.EnterFirstPerson();
			}
		} else {
			const newSubjectDistance = math.clamp(
				desiredSubjectDistance,
				player.CameraMinZoomDistance,
				player.CameraMaxZoomDistance,
			);
			if (newSubjectDistance < FIRST_PERSON_DISTANCE_THRESHOLD) {
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
		}

		// Pass target distance and zoom direction to the zoom controller
		ZoomController.SetZoomParameters(this.currentSubjectDistance, math.sign(desiredSubjectDistance - lastSubjectDistance));

		// Returned only for convenience to the caller to know the outcome
		return this.currentSubjectDistance;
	}

	// Used by derived classes
	SetCameraType(cameraType: Enum.CameraType): void {
		this.cameraType = cameraType;
	}

	GetCameraType(): Enum.CameraType | undefined {
		return this.cameraType;
	}

	// Movement mode standardized to Enum.ComputerCameraMovementMode values
	SetCameraMovementMode(
		cameraMovementMode: Enum.ComputerCameraMovementMode | Enum.DevComputerCameraMovementMode,
	): void {
		this.cameraMovementMode = cameraMovementMode;
	}

	GetCameraMovementMode(): Enum.ComputerCameraMovementMode | Enum.DevComputerCameraMovementMode | undefined {
		return this.cameraMovementMode;
	}

	SetIsMouseLocked(mouseLocked: boolean): void {
		this.inMouseLockedMode = mouseLocked;
	}

	GetIsMouseLocked(): boolean {
		return this.inMouseLockedMode;
	}

	SetMouseLockOffset(offsetVector: Vector3): void {
		this.mouseLockOffset = offsetVector;
	}

	GetMouseLockOffset(): Vector3 {
		return this.mouseLockOffset;
	}

	InFirstPerson(): boolean {
		return this.inFirstPerson;
	}

	// Overridden in ClassicCamera, the only module which supports FirstPerson
	EnterFirstPerson(): void {}

	// Overridden in ClassicCamera, the only module which supports FirstPerson
	LeaveFirstPerson(): void {}

	// Nominal distance, set by dollying in and out with the mouse wheel or equivalent, not measured distance
	GetCameraToSubjectDistance(): number {
		return this.currentSubjectDistance;
	}

	// Actual measured distance to the camera Focus point, which may be needed in special circumstances, but should
	// never be used as the starting point for updating the nominal camera-to-subject distance (self.currentSubjectDistance)
	// since that is a desired target value set only by mouse wheel (or equivalent) input, PopperCam, and clamped to min max camera distance
	GetMeasuredDistanceToFocus(): number | undefined {
		const camera = game.Workspace.CurrentCamera;
		if (camera) {
			return camera.CoordinateFrame.Position.sub(camera.Focus.Position).Magnitude;
		}
		return undefined;
	}

	GetCameraLookVector(): Vector3 {
		return game.Workspace.CurrentCamera ? game.Workspace.CurrentCamera.CFrame.LookVector : UNIT_Z;
	}

	CalculateNewLookCFrameFromArg(suppliedLookVector: Vector3 | undefined, rotateInput: Vector2): CFrame {
		const currLookVector: Vector3 = suppliedLookVector ?? this.GetCameraLookVector();
		const currPitchAngle = math.asin(currLookVector.Y);
		const yTheta = math.clamp(rotateInput.Y, -MAX_Y + currPitchAngle, -MIN_Y + currPitchAngle);
		const constrainedRotateInput = new Vector2(rotateInput.X, yTheta);
		const startCFrame = new CFrame(ZERO_VECTOR3, currLookVector);
		const newLookCFrame = CFrame.Angles(0, -constrainedRotateInput.X, 0)
			.mul(startCFrame)
			.mul(CFrame.Angles(-constrainedRotateInput.Y, 0, 0));
		return newLookCFrame;
	}

	CalculateNewLookVectorFromArg(suppliedLookVector: Vector3 | undefined, rotateInput: Vector2): Vector3 {
		const newLookCFrame = this.CalculateNewLookCFrameFromArg(suppliedLookVector, rotateInput);
		return newLookCFrame.LookVector;
	}

	CalculateNewLookVectorVRFromArg(rotateInput: Vector2): Vector3 {
		const subjectPosition: Vector3 = this.GetSubjectPosition()!;
		const vecToSubject: Vector3 = subjectPosition.sub(game.Workspace.CurrentCamera!.CFrame.Position);
		const currLookVector: Vector3 = vecToSubject.mul(X1_Y0_Z1).Unit;
		const vrRotateInput: Vector2 = new Vector2(rotateInput.X, 0);
		const startCFrame: CFrame = new CFrame(ZERO_VECTOR3, currLookVector);
		const yawRotatedVector: Vector3 = CFrame.Angles(0, -vrRotateInput.X, 0)
			.mul(startCFrame)
			.mul(CFrame.Angles(-vrRotateInput.Y, 0, 0)).LookVector;
		return yawRotatedVector.mul(X1_Y0_Z1).Unit;
	}

	GetHumanoid(): Humanoid | undefined {
		const character = player.Character;
		if (character) {
			const resultHumanoid = this.humanoidCache.get(player);
			if (resultHumanoid && resultHumanoid.Parent === character) {
				return resultHumanoid;
			} else {
				this.humanoidCache.delete(player); // Bust Old Cache
				const humanoid = character.FindFirstChildOfClass("Humanoid");
				if (humanoid) {
					this.humanoidCache.set(player, humanoid);
				}
				return humanoid;
			}
		}
		return undefined;
	}

	GetHumanoidPartToFollow(humanoid: Humanoid, humanoidStateType: Enum.HumanoidStateType): Instance | undefined {
		if (humanoidStateType === Enum.HumanoidStateType.Dead) {
			const character = humanoid.Parent;
			if (character) {
				return character.FindFirstChild("Head") ?? humanoid.Torso;
			} else {
				return humanoid.Torso;
			}
		} else {
			return humanoid.Torso;
		}
	}

	OnNewCameraSubject(): void {
		if (this.subjectStateChangedConn) {
			this.subjectStateChangedConn.Disconnect();
			this.subjectStateChangedConn = undefined;
		}

		if (!FFlagUserFlagEnableNewVRSystem) {
			const humanoid = game.Workspace.CurrentCamera && game.Workspace.CurrentCamera.CameraSubject;
			if (this.trackingHumanoid !== humanoid) {
				this.CancelCameraFreeze();
			}

			if (humanoid && humanoid.IsA("Humanoid")) {
				this.subjectStateChangedConn = humanoid.StateChanged.Connect((oldState, newState) => {
					if (VRService.VREnabled && newState === Enum.HumanoidStateType.Jumping && !this.inFirstPerson) {
						this.StartCameraFreeze(this.GetSubjectPosition()!, humanoid);
					} else if (
						newState !== Enum.HumanoidStateType.Jumping &&
						newState !== Enum.HumanoidStateType.Freefall
					) {
						this.CancelCameraFreeze(true);
					}
				});
			}
		}
	}

	IsInFirstPerson(): boolean {
		return this.inFirstPerson;
	}

	Update(dt: number): LuaTuple<[CFrame, CFrame]> {
		error("BaseCamera:Update() This is a virtual function that should never be getting called.", 2);
	}

	// [[ VR Support Section ]] --
	GetCameraHeight(): number {
		if (VRService.VREnabled && !this.inFirstPerson) {
			return math.sin(VR_ANGLE) * this.currentSubjectDistance;
		}
		return 0;
	}

	// Virtual function; overridden by derived classes that support gamepad VR rotation input
	// (never defined in the original BaseCamera.lua either — calling this on a bare BaseCamera
	// instance would error there too).
	GetActivateValue(): number {
		return error(
			"BaseCamera:GetActivateValue() This is a virtual function that should never be getting called.",
			2,
		);
	}

	// these are support functions for the "old VR code" -- always defined here (rather than only
	// when `not FFlagUserFlagEnableNewVRSystem`, as in the original) since every call site, both
	// within this file and in derived classes, re-checks that same flag before calling them; the
	// net observable behavior is identical.
	CancelCameraFreeze(keepConstraints?: boolean): void {
		if (!keepConstraints) {
			this.cameraTranslationConstraints = new Vector3(
				this.cameraTranslationConstraints.X,
				1,
				this.cameraTranslationConstraints.Z,
			);
		}
		if (this.cameraFrozen) {
			this.trackingHumanoid = undefined;
			this.cameraFrozen = false;
		}
	}

	StartCameraFreeze(subjectPosition: Vector3, humanoidToTrack: Humanoid): void {
		if (!this.cameraFrozen) {
			this.humanoidJumpOrigin = subjectPosition;
			this.trackingHumanoid = humanoidToTrack;
			this.cameraTranslationConstraints = new Vector3(this.cameraTranslationConstraints.X, 0, this.cameraTranslationConstraints.Z);
			this.cameraFrozen = true;
		}
	}

	ApplyVRTransform(): void {
		if (!VRService.VREnabled) {
			return;
		}

		// we only want this to happen in first person VR
		const rootJoint = this.humanoidRootPart && (this.humanoidRootPart.FindFirstChild("RootJoint") as Motor6D | undefined);
		if (!rootJoint) {
			return;
		}

		const cameraSubject = game.Workspace.CurrentCamera!.CameraSubject;
		const isInVehicle = cameraSubject !== undefined && cameraSubject.IsA("VehicleSeat");

		if (this.inFirstPerson && !isInVehicle) {
			const vrFrame = VRService.GetUserCFrame(Enum.UserCFrame.Head);
			const vrRotation = vrFrame.sub(vrFrame.Position);
			rootJoint.C0 = new CFrame(vrRotation.VectorToObjectSpace(vrFrame.Position)).mul(
				new CFrame(0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0),
			);
		} else {
			rootJoint.C0 = new CFrame(0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0);
		}
	}

	ShouldUseVRRotation(): boolean {
		if (!VRService.VREnabled) {
			return false;
		}

		if (!this.VRRotationIntensityAvailable && tick() - this.lastVRRotationIntensityCheckTime < 1) {
			return false;
		}

		const [success, vrRotationIntensity] = pcall(() => StarterGui.GetCore("VRRotationIntensity"));
		this.VRRotationIntensityAvailable = success && vrRotationIntensity !== undefined;
		this.lastVRRotationIntensityCheckTime = tick();

		this.shouldUseVRRotation = success && vrRotationIntensity !== undefined && vrRotationIntensity !== "Smooth";

		return this.shouldUseVRRotation;
	}

	GetVRRotationInput(): Vector2 | undefined {
		let vrRotateSum = ZERO_VECTOR2;
		const [success, vrRotationIntensity] = pcall(() => StarterGui.GetCore("VRRotationIntensity"));

		if (!success) {
			return undefined;
		}

		const vrGamepadRotation = ZERO_VECTOR2;
		const delayExpired =
			tick() - this.lastVRRotationTime >= this.GetRepeatDelayValue(vrRotationIntensity as VRRotationIntensity);

		if (math.abs(vrGamepadRotation.X) >= this.GetActivateValue()) {
			if (delayExpired || !this.vrRotateKeyCooldown.get(Enum.KeyCode.Thumbstick2)) {
				let sign = 1;
				if (vrGamepadRotation.X < 0) {
					sign = -1;
				}
				vrRotateSum = vrRotateSum.add(
					this.GetRotateAmountValue(vrRotationIntensity as VRRotationIntensity).mul(sign),
				);
				this.vrRotateKeyCooldown.set(Enum.KeyCode.Thumbstick2, true);
			}
		} else if (math.abs(vrGamepadRotation.X) < this.GetActivateValue() - 0.1) {
			this.vrRotateKeyCooldown.delete(Enum.KeyCode.Thumbstick2);
		}

		this.vrRotateKeyCooldown.delete(Enum.KeyCode.Left);
		this.vrRotateKeyCooldown.delete(Enum.KeyCode.Right);

		if (vrRotateSum !== ZERO_VECTOR2) {
			this.lastVRRotationTime = tick();
		}

		return vrRotateSum;
	}

	GetVRFocus(subjectPosition: Vector3, timeDelta: number): CFrame {
		const lastFocus = this.LastCameraFocus ?? subjectPosition;
		if (!this.cameraFrozen) {
			this.cameraTranslationConstraints = new Vector3(
				this.cameraTranslationConstraints.X,
				math.min(1, this.cameraTranslationConstraints.Y + 0.42 * timeDelta),
				this.cameraTranslationConstraints.Z,
			);
		}

		let newFocus: CFrame;
		if (this.cameraFrozen && this.humanoidJumpOrigin && this.humanoidJumpOrigin.Y > lastFocus.Y) {
			newFocus = new CFrame(
				new Vector3(subjectPosition.X, math.min(this.humanoidJumpOrigin.Y, lastFocus.Y + 5 * timeDelta), subjectPosition.Z),
			);
		} else {
			newFocus = new CFrame(
				new Vector3(subjectPosition.X, lastFocus.Y, subjectPosition.Z).Lerp(
					subjectPosition,
					this.cameraTranslationConstraints.Y,
				),
			);
		}

		if (this.cameraFrozen) {
			// No longer in 3rd person
			if (this.inFirstPerson) {
				// not VRService.VREnabled
				this.CancelCameraFreeze();
			}
			// This case you jumped off a cliff and want to keep your character in view
			// 0.5 is to fix floating point error when not jumping off cliffs
			if (this.humanoidJumpOrigin && subjectPosition.Y < this.humanoidJumpOrigin.Y - 0.5) {
				this.CancelCameraFreeze();
			}
		}

		return newFocus;
	}

	// Note: unlike ShouldUseVRRotation/GetVRRotationInput, the original does NOT pcall-wrap the
	// GetCore fallback fetch here — callers within this file always pass an already-fetched,
	// pcall-verified value, but a caller that omits the argument would propagate any GetCore
	// error exactly as the original does.
	GetRotateAmountValue(vrRotationIntensity?: VRRotationIntensity): Vector2 {
		const intensity = vrRotationIntensity ?? StarterGui.GetCore("VRRotationIntensity");
		if (intensity) {
			if (intensity === "Low") {
				return VR_LOW_INTENSITY_ROTATION;
			} else if (intensity === "High") {
				return VR_HIGH_INTENSITY_ROTATION;
			}
		}
		return ZERO_VECTOR2;
	}

	GetRepeatDelayValue(vrRotationIntensity?: VRRotationIntensity): number {
		const intensity = vrRotationIntensity ?? StarterGui.GetCore("VRRotationIntensity");
		if (intensity) {
			if (intensity === "Low") {
				return VR_LOW_INTENSITY_REPEAT;
			} else if (intensity === "High") {
				return VR_HIGH_INTENSITY_REPEAT;
			}
		}
		return 0;
	}
}
// [[ End VR Support Section ]] --

export = BaseCamera;
