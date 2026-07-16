// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule (ModuleScript)
//
// CameraModule - This ModuleScript implements a singleton class to manage the
// selection, activation, and deactivation of the current camera controller,
// character occlusion controller, and transparency controller. This script binds to
// RenderStepped at Camera priority and calls the Update() methods on the active
// controller instances.
//
// The camera controller ModuleScripts implement classes which are instantiated and
// activated as-needed, they are no longer all instantiated up front as they were in
// the previous generation of PlayerScripts.
//
// 2018 PlayerScripts Update - AllYourBlox

// Static camera utils
import CameraUtils from "./CameraUtils";
import CameraInput from "./CameraInput";

import BaseCamera from "./BaseCamera";

// Load Roblox Camera Controller Modules (outside this batch — other agents are translating
// these; unresolved-module errors on these imports are expected until they land)
import ClassicCamera from "./ClassicCamera";
import OrbitalCamera from "./OrbitalCamera";
import LegacyCamera from "./LegacyCamera";
import VehicleCamera from "./VehicleCamera";
// New VR System Modules
import VRCamera from "./VRCamera";
import VRVehicleCamera from "./VRVehicleCamera";

// Load Roblox Occlusion Modules
import Invisicam from "./Invisicam";
import Poppercam from "./Poppercam";

// Load the near-field character transparency controller and the mouse lock "shift lock" controller
import TransparencyController from "./TransparencyController";
import MouseLockController from "./MouseLockController";

let FFlagUserRemoveTheCameraApi: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserRemoveTheCameraApi"));
	FFlagUserRemoveTheCameraApi = success && (result as boolean);
}

let FFlagUserFixCameraSelectModuleWarning: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserFixCameraSelectModuleWarning"));
	FFlagUserFixCameraSelectModuleWarning = success && (result as boolean);
}

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

let FFlagUserCameraControlLastInputTypeUpdate: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserCameraControlLastInputTypeUpdate"));
	FFlagUserCameraControlLastInputTypeUpdate = success && (result as boolean);
}

// NOTICE: Player property names do not all match their StarterPlayer equivalents,
// with the differences noted in the comments on the right
const PLAYER_CAMERA_PROPERTIES = [
	"CameraMinZoomDistance",
	"CameraMaxZoomDistance",
	"CameraMode",
	"DevCameraOcclusionMode",
	"DevComputerCameraMode", // Corresponds to StarterPlayer.DevComputerCameraMovementMode
	"DevTouchCameraMode", // Corresponds to StarterPlayer.DevTouchCameraMovementMode

	// Character movement mode
	"DevComputerMovementMode",
	"DevTouchMovementMode",
	"DevEnableMouseLock", // Corresponds to StarterPlayer.EnableMouseLockOption
] as const;

const USER_GAME_SETTINGS_PROPERTIES = [
	"ComputerCameraMovementMode",
	"ComputerMovementMode",
	"ControlMode",
	"GamepadCameraSensitivity",
	"MouseSensitivity",
	"RotationType",
	"TouchCameraMovementMode",
	"TouchMovementMode",
] as const;

//[[ Roblox Services ]]
const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const UserInputService = game.GetService("UserInputService");
const VRService = game.GetService("VRService");
const UserGameSettings = UserSettings().GetService("UserGameSettings");

// Structural contract for the occlusion modules (Poppercam / Invisicam); both live outside this
// batch, so this interface exists purely to type-check CameraModule's own use of them.
interface OcclusionModule {
	GetOcclusionMode(): Enum.DevCameraOcclusionMode;
	GetEnabled(): boolean;
	Enable(enabled: boolean): void;
	CharacterAdded(char: Model, player: Player): void;
	CharacterRemoving(char: Model, player: Player): void;
	OnCameraSubjectChanged(newSubject: Humanoid | BasePart | undefined): void;
	Update(dt: number, cameraCFrame: CFrame, cameraFocus: CFrame): LuaTuple<[CFrame, CFrame]>;
}

// Structural contract for TransparencyController (outside this batch).
interface TransparencyControllerLike {
	Enable(enabled: boolean): void;
	SetSubject(subject: Humanoid | BasePart | undefined): void;
	Update(dt: number): void;
}

type CameraCreator = new () => BaseCamera;

// Table of camera controllers that have been instantiated. They are instantiated as they are used.
const instantiatedCameraControllers = new Map<CameraCreator, BaseCamera>();
const instantiatedOcclusionModules = new Map<new () => OcclusionModule, OcclusionModule>();

// Management of which options appear on the Roblox User Settings screen
{
	const PlayerScripts = Players.LocalPlayer.WaitForChild("PlayerScripts") as PlayerScripts;

	PlayerScripts.RegisterTouchCameraMovementMode(Enum.TouchCameraMovementMode.Default);
	PlayerScripts.RegisterTouchCameraMovementMode(Enum.TouchCameraMovementMode.Follow);
	PlayerScripts.RegisterTouchCameraMovementMode(Enum.TouchCameraMovementMode.Classic);

	PlayerScripts.RegisterComputerCameraMovementMode(Enum.ComputerCameraMovementMode.Default);
	PlayerScripts.RegisterComputerCameraMovementMode(Enum.ComputerCameraMovementMode.Follow);
	PlayerScripts.RegisterComputerCameraMovementMode(Enum.ComputerCameraMovementMode.Classic);
	PlayerScripts.RegisterComputerCameraMovementMode(Enum.ComputerCameraMovementMode.CameraToggle);
}

class CameraModule {
	// Current active controller instances
	activeCameraController?: BaseCamera;
	activeOcclusionModule?: OcclusionModule;
	activeTransparencyController?: TransparencyControllerLike;
	activeMouseLockController?: MouseLockController;

	currentComputerCameraMovementMode?: Enum.ComputerCameraMovementMode;

	// Connections to events
	cameraSubjectChangedConn?: RBXScriptConnection;
	cameraTypeChangedConn?: RBXScriptConnection;

	occlusionMode?: Enum.DevCameraOcclusionMode;

	lastInputType?: Enum.UserInputType;

	constructor() {
		// Adds CharacterAdded and CharacterRemoving event handlers for all current players
		for (const player of Players.GetPlayers()) {
			this.OnPlayerAdded(player);
		}

		// Adds CharacterAdded and CharacterRemoving event handlers for all players who join in the future
		Players.PlayerAdded.Connect((player) => {
			this.OnPlayerAdded(player);
		});

		this.activeTransparencyController = new TransparencyController() as unknown as TransparencyControllerLike;
		this.activeTransparencyController.Enable(true);

		if (!UserInputService.TouchEnabled) {
			this.activeMouseLockController = new MouseLockController();
			const toggleEvent = this.activeMouseLockController.GetBindableToggleEvent();
			if (toggleEvent) {
				toggleEvent.Connect(() => {
					this.OnMouseLockToggled();
				});
			}
		}

		this.ActivateCameraController(this.GetCameraControlChoice());
		this.ActivateOcclusionModule(Players.LocalPlayer.DevCameraOcclusionMode);
		this.OnCurrentCameraChanged(); // Does initializations and makes first camera controller
		RunService.BindToRenderStep("cameraRenderUpdate", Enum.RenderPriority.Camera.Value, (dt) => {
			this.Update(dt);
		});

		// Connect listeners to camera-related properties
		for (const propertyName of PLAYER_CAMERA_PROPERTIES) {
			Players.LocalPlayer.GetPropertyChangedSignal(propertyName).Connect(() => {
				this.OnLocalPlayerCameraPropertyChanged(propertyName);
			});
		}

		for (const propertyName of USER_GAME_SETTINGS_PROPERTIES) {
			UserGameSettings.GetPropertyChangedSignal(propertyName).Connect(() => {
				this.OnUserGameSettingsPropertyChanged(propertyName);
			});
		}
		game.Workspace.GetPropertyChangedSignal("CurrentCamera").Connect(() => {
			this.OnCurrentCameraChanged();
		});

		if (!FFlagUserCameraControlLastInputTypeUpdate) {
			this.lastInputType = UserInputService.GetLastInputType();
			UserInputService.LastInputTypeChanged.Connect((newLastInputType) => {
				this.lastInputType = newLastInputType;
			});
		}
	}

	GetCameraMovementModeFromSettings(): Enum.ComputerCameraMovementMode | Enum.DevComputerCameraMovementMode {
		const cameraMode = Players.LocalPlayer.CameraMode;

		// Lock First Person trumps all other settings and forces ClassicCamera
		if (cameraMode === Enum.CameraMode.LockFirstPerson) {
			return CameraUtils.ConvertCameraModeEnumToStandard(Enum.ComputerCameraMovementMode.Classic);
		}

		let devMode: Enum.ComputerCameraMovementMode | Enum.DevComputerCameraMovementMode;
		let userMode: Enum.ComputerCameraMovementMode | Enum.DevComputerCameraMovementMode;
		if (UserInputService.TouchEnabled) {
			devMode = CameraUtils.ConvertCameraModeEnumToStandard(Players.LocalPlayer.DevTouchCameraMode);
			userMode = CameraUtils.ConvertCameraModeEnumToStandard(UserGameSettings.TouchCameraMovementMode);
		} else {
			devMode = CameraUtils.ConvertCameraModeEnumToStandard(Players.LocalPlayer.DevComputerCameraMode);
			userMode = CameraUtils.ConvertCameraModeEnumToStandard(UserGameSettings.ComputerCameraMovementMode);
		}

		if (devMode === Enum.DevComputerCameraMovementMode.UserChoice) {
			// Developer is allowing user choice, so user setting is respected
			return userMode;
		}

		return devMode;
	}

	ActivateOcclusionModule(occlusionMode: Enum.DevCameraOcclusionMode): void {
		let newModuleCreator: (new () => OcclusionModule) | undefined;
		if (occlusionMode === Enum.DevCameraOcclusionMode.Zoom) {
			newModuleCreator = Poppercam;
		} else if (occlusionMode === Enum.DevCameraOcclusionMode.Invisicam) {
			newModuleCreator = Invisicam;
		} else {
			warn("CameraScript ActivateOcclusionModule called with unsupported mode");
			return;
		}

		this.occlusionMode = occlusionMode;

		// First check to see if there is actually a change. If the module being requested is already
		// the currently-active solution then just make sure it's enabled and exit early
		if (this.activeOcclusionModule && this.activeOcclusionModule.GetOcclusionMode() === occlusionMode) {
			if (!this.activeOcclusionModule.GetEnabled()) {
				this.activeOcclusionModule.Enable(true);
			}
			return;
		}

		// Save a reference to the current active module (may be nil) so that we can disable it if
		// we are successful in activating its replacement
		const prevOcclusionModule = this.activeOcclusionModule;

		// If there is no active module, see if the one we need has already been instantiated
		this.activeOcclusionModule = instantiatedOcclusionModules.get(newModuleCreator);

		// If the module was not already instantiated and selected above, instantiate it
		if (!this.activeOcclusionModule) {
			this.activeOcclusionModule = new newModuleCreator();
			if (this.activeOcclusionModule) {
				instantiatedOcclusionModules.set(newModuleCreator, this.activeOcclusionModule);
			}
		}

		// If we were successful in either selecting or instantiating the module,
		// enable it if it's not already the currently-active enabled module
		if (this.activeOcclusionModule) {
			const newModuleOcclusionMode = this.activeOcclusionModule.GetOcclusionMode();
			// Sanity check that the module we selected or instantiated actually supports the desired occlusionMode
			if (newModuleOcclusionMode !== occlusionMode) {
				warn(
					"CameraScript ActivateOcclusionModule mismatch: ",
					this.activeOcclusionModule.GetOcclusionMode(),
					"~=",
					occlusionMode,
				);
			}

			// Deactivate current module if there is one
			if (prevOcclusionModule) {
				// Sanity check that current module is not being replaced by itself (that should have been handled above)
				if (prevOcclusionModule !== this.activeOcclusionModule) {
					prevOcclusionModule.Enable(false);
				} else {
					warn("CameraScript ActivateOcclusionModule failure to detect already running correct module");
				}
			}

			// Occlusion modules need to be initialized with information about characters and cameraSubject
			// Invisicam needs the LocalPlayer's character
			// Poppercam needs all player characters and the camera subject
			if (occlusionMode === Enum.DevCameraOcclusionMode.Invisicam) {
				// Optimization to only send Invisicam what we know it needs
				if (Players.LocalPlayer.Character) {
					this.activeOcclusionModule.CharacterAdded(Players.LocalPlayer.Character, Players.LocalPlayer);
				}
			} else {
				// When Poppercam is enabled, we send it all existing player characters for its raycast ignore list
				for (const player of Players.GetPlayers()) {
					if (player && player.Character) {
						this.activeOcclusionModule.CharacterAdded(player.Character, player);
					}
				}
				this.activeOcclusionModule.OnCameraSubjectChanged(game.Workspace.CurrentCamera!.CameraSubject);
			}

			// Activate new choice
			this.activeOcclusionModule.Enable(true);
		}
	}

	ShouldUseVehicleCamera(): boolean {
		const camera = game.Workspace.CurrentCamera;
		if (!camera) {
			return false;
		}

		const cameraType = camera.CameraType;
		const cameraSubject = camera.CameraSubject;

		const isEligibleType = cameraType === Enum.CameraType.Custom || cameraType === Enum.CameraType.Follow;
		const isEligibleSubject = cameraSubject !== undefined && cameraSubject.IsA("VehicleSeat");
		const isEligibleOcclusionMode = this.occlusionMode !== Enum.DevCameraOcclusionMode.Invisicam;

		return isEligibleSubject && isEligibleType && isEligibleOcclusionMode;
	}

	// When supplied, legacyCameraType is used and cameraMovementMode is ignored (should be nil anyways)
	// Next, if userCameraCreator is passed in, that is used as the cameraCreator
	ActivateCameraController(
		cameraMovementMode: Enum.ComputerCameraMovementMode | Enum.DevComputerCameraMovementMode | undefined,
		legacyCameraType?: Enum.CameraType,
	): void {
		let newCameraCreator: CameraCreator | undefined;

		if (legacyCameraType !== undefined) {
			// This function has been passed a CameraType enum value. Some of these map to the use of
			// the LegacyCamera module, the value "Custom" will be translated to a movementMode enum
			// value based on Dev and User settings, and "Scriptable" will disable the camera controller.

			if (legacyCameraType === Enum.CameraType.Scriptable) {
				if (FFlagUserFixCameraSelectModuleWarning) {
					if (this.activeCameraController) {
						this.activeCameraController.Enable(false);
						this.activeCameraController = undefined;
					}
					return;
				} else {
					if (this.activeCameraController) {
						this.activeCameraController.Enable(false);
						this.activeCameraController = undefined;
						return;
					}
				}
			} else if (legacyCameraType === Enum.CameraType.Custom) {
				cameraMovementMode = this.GetCameraMovementModeFromSettings();
			} else if (legacyCameraType === Enum.CameraType.Track) {
				// Note: The TrackCamera module was basically an older, less fully-featured
				// version of ClassicCamera, no longer actively maintained, but it is re-implemented in
				// case a game was dependent on its lack of ClassicCamera's extra functionality.
				cameraMovementMode = Enum.ComputerCameraMovementMode.Classic;
			} else if (legacyCameraType === Enum.CameraType.Follow) {
				cameraMovementMode = Enum.ComputerCameraMovementMode.Follow;
			} else if (legacyCameraType === Enum.CameraType.Orbital) {
				cameraMovementMode = Enum.ComputerCameraMovementMode.Orbital;
			} else if (
				legacyCameraType === Enum.CameraType.Attach ||
				legacyCameraType === Enum.CameraType.Watch ||
				legacyCameraType === Enum.CameraType.Fixed
			) {
				newCameraCreator = LegacyCamera;
			} else {
				warn("CameraScript encountered an unhandled Camera.CameraType value: ", legacyCameraType);
			}
		}

		if (!newCameraCreator) {
			if (FFlagUserFlagEnableNewVRSystem && VRService.VREnabled) {
				newCameraCreator = VRCamera;
			} else if (
				cameraMovementMode === Enum.ComputerCameraMovementMode.Classic ||
				cameraMovementMode === Enum.ComputerCameraMovementMode.Follow ||
				cameraMovementMode === Enum.ComputerCameraMovementMode.Default ||
				cameraMovementMode === Enum.ComputerCameraMovementMode.CameraToggle
			) {
				newCameraCreator = ClassicCamera;
			} else if (cameraMovementMode === Enum.ComputerCameraMovementMode.Orbital) {
				newCameraCreator = OrbitalCamera;
			} else {
				warn("ActivateCameraController did not select a module.");
				return;
			}
		}

		const isVehicleCamera = this.ShouldUseVehicleCamera();
		if (isVehicleCamera) {
			if (FFlagUserFlagEnableNewVRSystem && VRService.VREnabled) {
				newCameraCreator = VRVehicleCamera;
			} else {
				newCameraCreator = VehicleCamera;
			}
		}

		// Create the camera control module we need if it does not already exist in instantiatedCameraControllers
		let newCameraController = instantiatedCameraControllers.get(newCameraCreator!);
		if (!newCameraController) {
			newCameraController = new newCameraCreator!();
			instantiatedCameraControllers.set(newCameraCreator!, newCameraController);
		} else {
			const resettable = newCameraController as unknown as { Reset?: () => void };
			if (resettable.Reset) {
				resettable.Reset();
			}
		}

		if (this.activeCameraController) {
			// deactivate the old controller and activate the new one
			if (this.activeCameraController !== newCameraController) {
				this.activeCameraController.Enable(false);
				this.activeCameraController = newCameraController;
				this.activeCameraController.Enable(true);
			} else if (!this.activeCameraController.GetEnabled()) {
				this.activeCameraController.Enable(true);
			}
		} else if (newCameraController !== undefined) {
			// only activate the new controller
			this.activeCameraController = newCameraController;
			this.activeCameraController.Enable(true);
		}

		if (this.activeCameraController) {
			if (cameraMovementMode !== undefined) {
				this.activeCameraController.SetCameraMovementMode(cameraMovementMode);
			} else if (legacyCameraType !== undefined) {
				// Note that this is only called when legacyCameraType is not a type that
				// was convertible to a ComputerCameraMovementMode value, i.e. really only applies to LegacyCamera
				this.activeCameraController.SetCameraType(legacyCameraType);
			}
		}
	}

	// Note: The active transparency controller could be made to listen for this event itself.
	OnCameraSubjectChanged(_cameraSubject?: Humanoid | BasePart): void {
		const camera = game.Workspace.CurrentCamera;
		const cameraSubject = camera && camera.CameraSubject;

		if (this.activeTransparencyController) {
			this.activeTransparencyController.SetSubject(cameraSubject);
		}

		if (this.activeOcclusionModule) {
			this.activeOcclusionModule.OnCameraSubjectChanged(cameraSubject);
		}

		this.ActivateCameraController(undefined, camera!.CameraType);
	}

	OnCameraTypeChanged(newCameraType: Enum.CameraType): void {
		if (newCameraType === Enum.CameraType.Scriptable) {
			if (UserInputService.MouseBehavior === Enum.MouseBehavior.LockCenter) {
				if (FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame) {
					CameraUtils.restoreMouseBehavior();
				} else {
					UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
				}
			}
		}

		// Forward the change to ActivateCameraController to handle
		this.ActivateCameraController(undefined, newCameraType);
	}

	// Note: Called whenever workspace.CurrentCamera changes, but also on initialization of this script
	OnCurrentCameraChanged(): void {
		const currentCamera = game.Workspace.CurrentCamera;
		if (!currentCamera) {
			return;
		}

		if (this.cameraSubjectChangedConn) {
			this.cameraSubjectChangedConn.Disconnect();
		}

		if (this.cameraTypeChangedConn) {
			this.cameraTypeChangedConn.Disconnect();
		}

		this.cameraSubjectChangedConn = currentCamera.GetPropertyChangedSignal("CameraSubject").Connect(() => {
			this.OnCameraSubjectChanged(currentCamera.CameraSubject);
		});

		this.cameraTypeChangedConn = currentCamera.GetPropertyChangedSignal("CameraType").Connect(() => {
			this.OnCameraTypeChanged(currentCamera.CameraType);
		});

		this.OnCameraSubjectChanged(currentCamera.CameraSubject);
		this.OnCameraTypeChanged(currentCamera.CameraType);
	}

	OnLocalPlayerCameraPropertyChanged(propertyName: string): void {
		if (propertyName === "CameraMode") {
			// CameraMode is only used to turn on/off forcing the player into first person view. The
			// Note: The case "Classic" is used for all other views and does not correspond only to the ClassicCamera module
			if (Players.LocalPlayer.CameraMode === Enum.CameraMode.LockFirstPerson) {
				// Locked in first person, use ClassicCamera which supports this
				if (!this.activeCameraController || this.activeCameraController.GetModuleName() !== "ClassicCamera") {
					this.ActivateCameraController(
						CameraUtils.ConvertCameraModeEnumToStandard(Enum.DevComputerCameraMovementMode.Classic),
					);
				}

				if (this.activeCameraController) {
					this.activeCameraController.UpdateForDistancePropertyChange();
				}
			} else if (Players.LocalPlayer.CameraMode === Enum.CameraMode.Classic) {
				// Not locked in first person view
				const cameraMovementMode = this.GetCameraMovementModeFromSettings();
				this.ActivateCameraController(CameraUtils.ConvertCameraModeEnumToStandard(cameraMovementMode));
			} else {
				warn("Unhandled value for property player.CameraMode: ", Players.LocalPlayer.CameraMode);
			}
		} else if (propertyName === "DevComputerCameraMode" || propertyName === "DevTouchCameraMode") {
			const cameraMovementMode = this.GetCameraMovementModeFromSettings();
			this.ActivateCameraController(CameraUtils.ConvertCameraModeEnumToStandard(cameraMovementMode));
		} else if (propertyName === "DevCameraOcclusionMode") {
			this.ActivateOcclusionModule(Players.LocalPlayer.DevCameraOcclusionMode);
		} else if (propertyName === "CameraMinZoomDistance" || propertyName === "CameraMaxZoomDistance") {
			if (this.activeCameraController) {
				this.activeCameraController.UpdateForDistancePropertyChange();
			}
		} else if (propertyName === "DevTouchMovementMode") {
			// (no-op, matches original)
		} else if (propertyName === "DevComputerMovementMode") {
			// (no-op, matches original)
		} else if (propertyName === "DevEnableMouseLock") {
			// This is the enabling/disabling of "Shift Lock" mode, not LockFirstPerson (which is a CameraMode)
			// Note: Enabling and disabling of MouseLock mode is normally only a publish-time choice made via
			// the corresponding EnableMouseLockOption checkbox of StarterPlayer, and this script does not have
			// support for changing the availability of MouseLock at runtime (this would require listening to
			// Player.DevEnableMouseLock changes)
		}
	}

	OnUserGameSettingsPropertyChanged(propertyName: string): void {
		if (propertyName === "ComputerCameraMovementMode") {
			const cameraMovementMode = this.GetCameraMovementModeFromSettings();
			this.ActivateCameraController(CameraUtils.ConvertCameraModeEnumToStandard(cameraMovementMode));
		}
	}

	// Main RenderStep Update. The camera controller and occlusion module both have opportunities
	// to set and modify (respectively) the CFrame and Focus before it is set once on CurrentCamera.
	// The camera and occlusion modules should only return CFrames, not set the CFrame property of
	// CurrentCamera directly.
	Update(dt: number): void {
		if (this.activeCameraController) {
			this.activeCameraController.UpdateMouseBehavior();

			let [newCameraCFrame, newCameraFocus] = this.activeCameraController.Update(dt);
			if (!FFlagUserFlagEnableNewVRSystem) {
				this.activeCameraController.ApplyVRTransform();
			}
			if (this.activeOcclusionModule) {
				[newCameraCFrame, newCameraFocus] = this.activeOcclusionModule.Update(dt, newCameraCFrame, newCameraFocus);
			}

			// Here is where the new CFrame and Focus are set for this render frame
			game.Workspace.CurrentCamera!.CFrame = newCameraCFrame;
			game.Workspace.CurrentCamera!.Focus = newCameraFocus;

			// Update to character local transparency as needed based on camera-to-subject distance
			if (this.activeTransparencyController) {
				this.activeTransparencyController.Update(dt);
			}

			if (CameraInput.getInputEnabled()) {
				CameraInput.resetInputForFrameEnd();
			}
		}
	}

	// Formerly getCurrentCameraMode, this function resolves developer and user camera control settings to
	// decide which camera control module should be instantiated. The old method of converting redundant enum types
	GetCameraControlChoice(): Enum.ComputerCameraMovementMode | Enum.DevComputerCameraMovementMode | undefined {
		const player = Players.LocalPlayer;

		if (player) {
			if (
				(FFlagUserCameraControlLastInputTypeUpdate &&
					UserInputService.GetLastInputType() === Enum.UserInputType.Touch) ||
				(!FFlagUserCameraControlLastInputTypeUpdate && this.lastInputType === Enum.UserInputType.Touch) ||
				UserInputService.TouchEnabled
			) {
				// Touch
				if (player.DevTouchCameraMode === Enum.DevTouchCameraMovementMode.UserChoice) {
					return CameraUtils.ConvertCameraModeEnumToStandard(UserGameSettings.TouchCameraMovementMode);
				} else {
					return CameraUtils.ConvertCameraModeEnumToStandard(player.DevTouchCameraMode);
				}
			} else {
				// Computer
				if (player.DevComputerCameraMode === Enum.DevComputerCameraMovementMode.UserChoice) {
					const computerMovementMode = CameraUtils.ConvertCameraModeEnumToStandard(
						UserGameSettings.ComputerCameraMovementMode,
					);
					return CameraUtils.ConvertCameraModeEnumToStandard(computerMovementMode);
				} else {
					return CameraUtils.ConvertCameraModeEnumToStandard(player.DevComputerCameraMode);
				}
			}
		}
		return undefined;
	}

	OnCharacterAdded(char: Model, player: Player): void {
		if (this.activeOcclusionModule) {
			this.activeOcclusionModule.CharacterAdded(char, player);
		}
	}

	OnCharacterRemoving(char: Model, player: Player): void {
		if (this.activeOcclusionModule) {
			this.activeOcclusionModule.CharacterRemoving(char, player);
		}
	}

	OnPlayerAdded(player: Player): void {
		player.CharacterAdded.Connect((char) => {
			this.OnCharacterAdded(char, player);
		});
		player.CharacterRemoving.Connect((char) => {
			this.OnCharacterRemoving(char, player);
		});
	}

	OnMouseLockToggled(): void {
		if (this.activeMouseLockController) {
			const mouseLocked = this.activeMouseLockController.GetIsMouseLocked();
			const mouseLockOffset = this.activeMouseLockController.GetMouseLockOffset();
			if (this.activeCameraController) {
				this.activeCameraController.SetIsMouseLocked(mouseLocked);
				this.activeCameraController.SetMouseLockOffset(mouseLockOffset);
			}
		}
	}
}

const cameraModuleObject = new CameraModule();
const cameraApi = {};

export = (FFlagUserRemoveTheCameraApi ? cameraApi : cameraModuleObject) as CameraModule;
