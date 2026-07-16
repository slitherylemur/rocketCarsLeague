// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule (ModuleScript)
//
// ControlModule - This ModuleScript implements a singleton class to manage the
// selection, activation, and deactivation of the current character movement controller.
// This script binds to RenderStepped at Input priority and calls the Update() methods
// on the active controller instances.
//
// The character controller ModuleScripts implement classes which are instantiated and
// activated as-needed, they are no longer all instantiated up front as they were in
// the previous generation of PlayerScripts.
//
// 2018 PlayerScripts Update - AllYourBlox

import { legacyWait } from "shared/LegacyTiming";

// Roblox User Input Control Modules - each returns a new() constructor function used to create controllers as needed
import Keyboard from "./Keyboard";
import Gamepad from "./Gamepad";
import DynamicThumbstick from "./DynamicThumbstick";
import TouchThumbstick from "./TouchThumbstick";
// These controllers handle only walk/run movement, jumping is handled by the
// TouchJump controller if any of these are active
import ClickToMove from "./ClickToMoveController";
import TouchJump from "./TouchJump";
import VehicleController from "./VehicleController";

//[[ Roblox Services ]]--
const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const UserInputService = game.GetService("UserInputService");
const GuiService = game.GetService("GuiService");
const Workspace = game.GetService("Workspace");
const UserGameSettings = UserSettings().GetService("UserGameSettings");
const VRService = game.GetService("VRService");

let FFlagUserFlagEnableNewVRSystem: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserFlagEnableNewVRSystem"));
	FFlagUserFlagEnableNewVRSystem = success && (result as boolean);
}

let FFlagUserCameraControlLastInputTypeUpdate: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserCameraControlLastInputTypeUpdate"));
	FFlagUserCameraControlLastInputTypeUpdate = success && (result as boolean);
}

let FFlagUserUpdatePlayerScriptsTouchControlsEnabled: boolean;
{
	const [success, result] = pcall(() =>
		UserSettings().IsUserFeatureEnabled("UserUpdatePlayerScriptsTouchControlsEnabled"),
	);
	FFlagUserUpdatePlayerScriptsTouchControlsEnabled = success && (result as boolean);
}

const CONTROL_ACTION_PRIORITY = Enum.ContextActionPriority.Default.Value;

// A reference to one of the character-control module classes above (Keyboard, Gamepad,
// DynamicThumbstick, TouchThumbstick, ClickToMove). Used both as Map keys (controllers table)
// and for direct identity comparisons against self.activeControlModule, exactly mirroring the
// original Lua's table-identity comparisons/lookups. Kept as `unknown` (cast at the few call
// sites that construct/invoke through it) rather than trying to unify the divergent
// constructor/Enable() signatures of Keyboard/Gamepad/DynamicThumbstick/TouchThumbstick/ClickToMove
// into a single interface.
type ControlModuleRef = unknown;

// Minimal duck-typed shape of a controller instance (as returned by `new` on one of the
// modules above) used generically by this file. Enable() signatures diverge across controllers
// (ClickToMove/touch controllers accept extra optional arguments -- see EnableActiveControlModule
// below) so it is kept intentionally loose and cast at call sites, per migration convention of
// `unknown` + casts over trying to force a single unified interface onto them.
interface ControllerInstance {
	enabled: boolean;
	Enable(...args: unknown[]): boolean;
	OnRenderStepped(dt: number): void;
	GetMoveVector(): Vector3;
	IsMoveVectorCameraRelative(): boolean;
	GetIsJumping(): boolean;
}

type ControllerCtor = new (priority: number) => ControllerInstance;
type ControllerCtorNoArgs = new () => ControllerInstance;

// Mapping from movement mode and lastInputType enum values to control modules to avoid huge if elseif switching
const movementEnumToModuleMap = new Map<EnumItem, ControlModuleRef>([
	[Enum.TouchMovementMode.DPad, DynamicThumbstick],
	[Enum.DevTouchMovementMode.DPad, DynamicThumbstick],
	[Enum.TouchMovementMode.Thumbpad, DynamicThumbstick],
	[Enum.DevTouchMovementMode.Thumbpad, DynamicThumbstick],
	[Enum.TouchMovementMode.Thumbstick, TouchThumbstick],
	[Enum.DevTouchMovementMode.Thumbstick, TouchThumbstick],
	[Enum.TouchMovementMode.DynamicThumbstick, DynamicThumbstick],
	[Enum.DevTouchMovementMode.DynamicThumbstick, DynamicThumbstick],
	[Enum.TouchMovementMode.ClickToMove, ClickToMove],
	[Enum.DevTouchMovementMode.ClickToMove, ClickToMove],

	// Current default
	[Enum.TouchMovementMode.Default, DynamicThumbstick],

	[Enum.ComputerMovementMode.Default, Keyboard],
	[Enum.ComputerMovementMode.KeyboardMouse, Keyboard],
	[Enum.DevComputerMovementMode.KeyboardMouse, Keyboard],
	// Enum.DevComputerMovementMode.Scriptable intentionally omitted -- absent key means nil/undefined lookup, matching original
	[Enum.ComputerMovementMode.ClickToMove, ClickToMove],
	[Enum.DevComputerMovementMode.ClickToMove, ClickToMove],
]);

// Keyboard controller is really keyboard and mouse controller
const computerInputTypeToModuleMap = new Map<Enum.UserInputType, ControlModuleRef>([
	[Enum.UserInputType.Keyboard, Keyboard],
	[Enum.UserInputType.MouseButton1, Keyboard],
	[Enum.UserInputType.MouseButton2, Keyboard],
	[Enum.UserInputType.MouseButton3, Keyboard],
	[Enum.UserInputType.MouseWheel, Keyboard],
	[Enum.UserInputType.MouseMovement, Keyboard],
	[Enum.UserInputType.Gamepad1, Gamepad],
	[Enum.UserInputType.Gamepad2, Gamepad],
	[Enum.UserInputType.Gamepad3, Gamepad],
	[Enum.UserInputType.Gamepad4, Gamepad],
]);

// Original: `local lastInputType` -- a file-level upvalue (not a field on the ControlModule
// instance -- see also the separate, effectively-unused self.lastInputType field below).
// Initialized to None (rather than left nil) since TS requires a type; this is not a behavior
// change because it is always written by OnLastInputTypeChanged before being read in practice,
// and a lookup miss on None safely yields undefined exactly as a nil-keyed lookup would in Lua.
let lastInputType: Enum.UserInputType = Enum.UserInputType.None;

function calculateRawMoveVector(humanoid: Humanoid, cameraRelativeMoveVector: Vector3): Vector3 {
	const camera = Workspace.CurrentCamera;
	if (!camera) {
		return cameraRelativeMoveVector;
	}

	if (humanoid.GetState() === Enum.HumanoidStateType.Swimming) {
		return camera.CFrame.VectorToWorldSpace(cameraRelativeMoveVector);
	}

	let cameraCFrame = camera.CFrame;

	if (VRService.VREnabled && FFlagUserFlagEnableNewVRSystem && humanoid.RootPart) {
		// movement relative to VR frustum
		const cameraDelta = humanoid.RootPart.CFrame.Position.sub(cameraCFrame.Position);
		if (cameraDelta.Magnitude < 3) {
			// "nearly" first person
			const vrFrame = VRService.GetUserCFrame(Enum.UserCFrame.Head);
			cameraCFrame = cameraCFrame.mul(vrFrame) as CFrame;
		}
	}

	let c: number;
	let s: number;
	const [, , , R00, R01, R02, , , R12, , , R22] = cameraCFrame.GetComponents();
	if (R12 < 1 && R12 > -1) {
		// X and Z components from back vector.
		c = R22;
		s = R02;
	} else {
		// In this case the camera is looking straight up or straight down.
		// Use X components from right and up vectors.
		c = R00;
		s = -R01 * math.sign(R12);
	}
	const norm = math.sqrt(c * c + s * s);
	return new Vector3(
		(c * cameraRelativeMoveVector.X + s * cameraRelativeMoveVector.Z) / norm,
		0,
		(c * cameraRelativeMoveVector.Z - s * cameraRelativeMoveVector.X) / norm,
	);
}

//[[ The Module ]]--
class ControlModule {
	// The Modules above are used to construct controller instances as-needed, and this
	// table is a map from Module to the instance created from it
	controllers = new Map<ControlModuleRef, ControllerInstance>();

	activeControlModule?: ControlModuleRef; // Used to prevent unnecessarily expensive checks on each input event
	activeController?: ControllerInstance;
	touchJumpController?: ControllerInstance;
	// Original: `self.moveFunction = Players.LocalPlayer.Move` -- a raw (unbound) extraction of
	// the method, later invoked with Players.LocalPlayer passed explicitly as the first argument
	// (see OnRenderStepped/Disable/UpdateActiveControlModuleEnabled below). Cast away the `this:
	// Player` method-this typing since it is called here as a plain 3-argument function, exactly
	// mirroring the original's dot (not colon) extraction.
	moveFunction: (player: Player, moveVector: Vector3, relativeToCamera: boolean) => void =
		Players.LocalPlayer.Move as unknown as (player: Player, moveVector: Vector3, relativeToCamera: boolean) => void;
	humanoid?: Humanoid;
	lastInputType: Enum.UserInputType = Enum.UserInputType.None;
	controlsEnabled?: boolean;

	// For Roblox self.vehicleController
	humanoidSeatedConn?: RBXScriptConnection;
	vehicleController?: VehicleController;

	touchControlFrame?: Frame;

	//[[ Touch Device UI ]]--
	playerGui?: PlayerGui;
	touchGui?: ScreenGui;
	playerGuiAddedConn?: RBXScriptConnection;

	constructor() {
		if (FFlagUserCameraControlLastInputTypeUpdate) {
			this.controlsEnabled = true;
		}

		this.vehicleController = new VehicleController(CONTROL_ACTION_PRIORITY);

		Players.LocalPlayer.CharacterAdded.Connect((char) => this.OnCharacterAdded(char));
		Players.LocalPlayer.CharacterRemoving.Connect((char) => this.OnCharacterRemoving(char));
		if (Players.LocalPlayer.Character) {
			this.OnCharacterAdded(Players.LocalPlayer.Character);
		}

		RunService.BindToRenderStep("ControlScriptRenderstep", Enum.RenderPriority.Input.Value, (dt) => {
			this.OnRenderStepped(dt);
		});

		UserInputService.LastInputTypeChanged.Connect((newLastInputType) => {
			this.OnLastInputTypeChanged(newLastInputType);
		});

		UserGameSettings.GetPropertyChangedSignal("TouchMovementMode").Connect(() => {
			this.OnTouchMovementModeChange();
		});
		Players.LocalPlayer.GetPropertyChangedSignal("DevTouchMovementMode").Connect(() => {
			this.OnTouchMovementModeChange();
		});

		UserGameSettings.GetPropertyChangedSignal("ComputerMovementMode").Connect(() => {
			this.OnComputerMovementModeChange();
		});
		Players.LocalPlayer.GetPropertyChangedSignal("DevComputerMovementMode").Connect(() => {
			this.OnComputerMovementModeChange();
		});

		if (FFlagUserUpdatePlayerScriptsTouchControlsEnabled) {
			GuiService.GetPropertyChangedSignal("TouchControlsEnabled").Connect(() => {
				this.UpdateTouchGuiVisibility();
				this.UpdateActiveControlModuleEnabled();
			});
		} else {
			UserInputService.GetPropertyChangedSignal("ModalEnabled").Connect(() => {
				this.UpdateTouchGuiVisibility();
			});
		}

		if (UserInputService.TouchEnabled) {
			this.playerGui = Players.LocalPlayer.FindFirstChildOfClass("PlayerGui");
			if (this.playerGui) {
				this.CreateTouchGuiContainer();
				this.OnLastInputTypeChanged(UserInputService.GetLastInputType());
			} else {
				this.playerGuiAddedConn = Players.LocalPlayer.ChildAdded.Connect((child) => {
					if (child.IsA("PlayerGui")) {
						this.playerGui = child;
						this.CreateTouchGuiContainer();
						this.playerGuiAddedConn!.Disconnect();
						this.playerGuiAddedConn = undefined;
						this.OnLastInputTypeChanged(UserInputService.GetLastInputType());
					}
				});
			}
		} else {
			this.OnLastInputTypeChanged(UserInputService.GetLastInputType());
		}
	}

	// Convenience function so that calling code does not have to first get the activeController
	// and then call GetMoveVector on it. When there is no active controller, this function returns the
	// zero vector
	GetMoveVector(): Vector3 {
		if (this.activeController) {
			return this.activeController.GetMoveVector();
		}
		return new Vector3(0, 0, 0);
	}

	GetActiveController(): ControllerInstance | undefined {
		return this.activeController;
	}

	// Remove with FFlagUserUpdatePlayerScriptsTouchControlsEnabled
	EnableActiveControlModule(): void {
		if (this.activeControlModule === ClickToMove) {
			// For ClickToMove, when it is the player's choice, we also enable the full keyboard controls.
			// When the developer is forcing click to move, the most keyboard controls (WASD) are not available, only jump.
			this.activeController!.Enable(
				true,
				Players.LocalPlayer.DevComputerMovementMode === Enum.DevComputerMovementMode.UserChoice,
				this.touchJumpController,
			);
		} else if (this.touchControlFrame) {
			this.activeController!.Enable(true, this.touchControlFrame);
		} else {
			this.activeController!.Enable(true);
		}
	}

	// Checks for conditions for enabling/disabling the active controller and updates whether the active controller is enabled/disabled
	UpdateActiveControlModuleEnabled(): void {
		// helpers for disable/enable
		const disable = () => {
			this.activeController!.Enable(false);

			if (this.moveFunction) {
				this.moveFunction(Players.LocalPlayer, new Vector3(0, 0, 0), true);
			}
		};

		const enable = () => {
			if (this.activeControlModule === ClickToMove) {
				// For ClickToMove, when it is the player's choice, we also enable the full keyboard controls.
				// When the developer is forcing click to move, the most keyboard controls (WASD) are not available, only jump.
				this.activeController!.Enable(
					true,
					Players.LocalPlayer.DevComputerMovementMode === Enum.DevComputerMovementMode.UserChoice,
					this.touchJumpController,
				);
			} else if (this.touchControlFrame) {
				this.activeController!.Enable(true, this.touchControlFrame);
			} else {
				this.activeController!.Enable(true);
			}
		};

		// there is no active controller
		if (!this.activeController) {
			return;
		}

		// developer called ControlModule:Disable(), don't turn back on
		if (!this.controlsEnabled) {
			disable();
			return;
		}

		// GuiService.TouchControlsEnabled == false and the active controller is a touch controller,
		// disable controls
		if (
			!GuiService.TouchControlsEnabled &&
			UserInputService.TouchEnabled &&
			(this.activeControlModule === ClickToMove ||
				this.activeControlModule === TouchThumbstick ||
				this.activeControlModule === DynamicThumbstick)
		) {
			disable();
			return;
		}

		// no settings prevent enabling controls
		enable();
	}

	Enable(enable?: boolean): void {
		if (FFlagUserCameraControlLastInputTypeUpdate) {
			if (enable === undefined) {
				enable = true;
			}
			this.controlsEnabled = enable;
		}

		if (!this.activeController) {
			return;
		}

		if (!FFlagUserCameraControlLastInputTypeUpdate) {
			if (enable === undefined) {
				enable = true;
			}
		}

		if (FFlagUserUpdatePlayerScriptsTouchControlsEnabled) {
			this.UpdateActiveControlModuleEnabled();
		} else {
			if (enable) {
				this.EnableActiveControlModule();
			} else {
				this.Disable();
			}
		}
	}

	// For those who prefer distinct functions
	Disable(): void {
		if (FFlagUserCameraControlLastInputTypeUpdate) {
			this.controlsEnabled = false;
		}

		if (FFlagUserUpdatePlayerScriptsTouchControlsEnabled) {
			this.UpdateActiveControlModuleEnabled();
		} else {
			if (this.activeController) {
				this.activeController.Enable(false);

				if (this.moveFunction) {
					this.moveFunction(Players.LocalPlayer, new Vector3(0, 0, 0), true);
				}
			}
		}
	}

	// Returns module (possibly nil) and success code to differentiate returning nil due to error vs Scriptable
	SelectComputerMovementModule(): LuaTuple<[ControlModuleRef, boolean]> {
		if (!(UserInputService.KeyboardEnabled || UserInputService.GamepadEnabled)) {
			return $tuple(undefined, false);
		}

		let computerModule: ControlModuleRef;
		const DevMovementMode = Players.LocalPlayer.DevComputerMovementMode;

		if (DevMovementMode === Enum.DevComputerMovementMode.UserChoice) {
			computerModule = computerInputTypeToModuleMap.get(lastInputType);
			if (
				UserGameSettings.ComputerMovementMode === Enum.ComputerMovementMode.ClickToMove &&
				computerModule === Keyboard
			) {
				// User has ClickToMove set in Settings, prefer ClickToMove controller for keyboard and mouse lastInputTypes
				computerModule = ClickToMove;
			}
		} else {
			// Developer has selected a mode that must be used.
			computerModule = movementEnumToModuleMap.get(DevMovementMode);

			// computerModule is expected to be nil here only when developer has selected Scriptable
			if (!computerModule && DevMovementMode !== Enum.DevComputerMovementMode.Scriptable) {
				warn("No character control module is associated with DevComputerMovementMode ", DevMovementMode);
			}
		}

		if (computerModule) {
			return $tuple(computerModule, true);
		} else if (DevMovementMode === Enum.DevComputerMovementMode.Scriptable) {
			// Special case where nil is returned and we actually want to set self.activeController to nil for Scriptable
			return $tuple(undefined, true);
		} else {
			// This case is for when computerModule is nil because of an error and no suitable control module could
			// be found.
			return $tuple(undefined, false);
		}
	}

	// Choose current Touch control module based on settings (user, dev)
	// Returns module (possibly nil) and success code to differentiate returning nil due to error vs Scriptable
	SelectTouchModule(): LuaTuple<[ControlModuleRef, boolean]> {
		if (!UserInputService.TouchEnabled) {
			return $tuple(undefined, false);
		}
		let touchModule: ControlModuleRef;
		const DevMovementMode = Players.LocalPlayer.DevTouchMovementMode;
		if (DevMovementMode === Enum.DevTouchMovementMode.UserChoice) {
			touchModule = movementEnumToModuleMap.get(UserGameSettings.TouchMovementMode);
		} else if (DevMovementMode === Enum.DevTouchMovementMode.Scriptable) {
			return $tuple(undefined, true);
		} else {
			touchModule = movementEnumToModuleMap.get(DevMovementMode);
		}
		return $tuple(touchModule, true);
	}

	OnRenderStepped(dt: number): void {
		if (this.activeController && this.activeController.enabled && this.humanoid) {
			// Give the controller a chance to adjust its state
			this.activeController.OnRenderStepped(dt);

			// Now retrieve info from the controller
			let moveVector = this.activeController.GetMoveVector();
			let cameraRelative = this.activeController.IsMoveVectorCameraRelative();

			const clickToMoveController = this.GetClickToMoveController();
			if (this.activeController !== clickToMoveController) {
				if (moveVector.Magnitude > 0) {
					// Clean up any developer started MoveTo path
					(clickToMoveController as unknown as { CleanupPath(): void }).CleanupPath();
				} else {
					// Get move vector for developer started MoveTo
					clickToMoveController.OnRenderStepped(dt);
					moveVector = clickToMoveController.GetMoveVector();
					cameraRelative = clickToMoveController.IsMoveVectorCameraRelative();
				}
			}

			// Are we driving a vehicle ?
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			let vehicleConsumedInput = false;
			if (this.vehicleController) {
				[moveVector, vehicleConsumedInput] = this.vehicleController.Update(
					moveVector,
					cameraRelative,
					this.activeControlModule === Gamepad,
				);
			}

			// If not, move the player
			// Verification of vehicleConsumedInput is commented out to preserve legacy behavior,
			// in case some game relies on Humanoid.MoveDirection still being set while in a VehicleSeat
			//if not vehicleConsumedInput then
			if (cameraRelative) {
				moveVector = calculateRawMoveVector(this.humanoid, moveVector);
			}
			this.moveFunction(Players.LocalPlayer, moveVector, false);
			//end

			// And make them jump if needed
			this.humanoid.Jump = this.activeController.GetIsJumping() || (this.touchJumpController?.GetIsJumping() ?? false);
		}
	}

	OnHumanoidSeated(active: boolean, currentSeatPart: BasePart | undefined): void {
		if (active) {
			if (currentSeatPart && currentSeatPart.IsA("VehicleSeat")) {
				if (!this.vehicleController) {
					// Original: `self.vehicleController = self.vehicleController.new(CONTROL_ACTION_PRIORITY)`
					// -- relies on the Lua OOP metatable exposing `.new` through the already-set instance;
					// this branch is unreachable in practice since the constructor always assigns
					// self.vehicleController and nothing here ever clears it, but is preserved faithfully.
					this.vehicleController = new VehicleController(CONTROL_ACTION_PRIORITY);
				}
				this.vehicleController.Enable(true, currentSeatPart);
			}
		} else {
			if (this.vehicleController) {
				// Original passes currentSeatPart (typed BasePart in Lua) straight through
				// regardless of its actual class; harmless since VehicleController:Enable only
				// reads the second argument when enable is true.
				this.vehicleController.Enable(false, currentSeatPart as VehicleSeat | undefined);
			}
		}
	}

	OnCharacterAdded(char: Model): void {
		this.humanoid = char.FindFirstChildOfClass("Humanoid");
		while (!this.humanoid) {
			char.ChildAdded.Wait();
			this.humanoid = char.FindFirstChildOfClass("Humanoid");
		}

		this.UpdateTouchGuiVisibility();

		if (this.humanoidSeatedConn) {
			this.humanoidSeatedConn.Disconnect();
			this.humanoidSeatedConn = undefined;
		}
		this.humanoidSeatedConn = this.humanoid.Seated.Connect((active, currentSeatPart) => {
			this.OnHumanoidSeated(active, currentSeatPart);
		});
	}

	OnCharacterRemoving(char: Model): void {
		this.humanoid = undefined;

		this.UpdateTouchGuiVisibility();
	}

	UpdateTouchGuiVisibility(): void {
		if (this.touchGui) {
			if (FFlagUserUpdatePlayerScriptsTouchControlsEnabled) {
				const doShow = this.humanoid !== undefined && GuiService.TouchControlsEnabled;
				this.touchGui.Enabled = !!doShow; // convert to bool
			} else {
				const doShow = this.humanoid !== undefined && !UserInputService.ModalEnabled;
				this.touchGui.Enabled = !!doShow; // convert to bool
			}
		}
	}

	// Helper function to lazily instantiate a controller if it does not yet exist,
	// disable the active controller if it is different from the on being switched to,
	// and then enable the requested controller. The argument to this function must be
	// a reference to one of the control modules, i.e. Keyboard, Gamepad, etc.

	// This function should handle all controller enabling and disabling without relying on
	// ControlModule:Enable() and Disable()
	SwitchToController(controlModule: ControlModuleRef): void {
		if (FFlagUserCameraControlLastInputTypeUpdate) {
			// controlModule is invalid, just disable current controller
			if (!controlModule) {
				if (this.activeController) {
					this.activeController.Enable(false);
				}
				this.activeController = undefined;
				this.activeControlModule = undefined;
				return;
			}

			// first time switching to this control module, should instantiate it
			if (!this.controllers.has(controlModule)) {
				this.controllers.set(controlModule, new (controlModule as ControllerCtor)(CONTROL_ACTION_PRIORITY));
			}

			// switch to the new controlModule
			if (this.activeController !== this.controllers.get(controlModule)) {
				if (this.activeController) {
					this.activeController.Enable(false);
				}
				this.activeController = this.controllers.get(controlModule);
				this.activeControlModule = controlModule; // Only used to check if controller switch is necessary

				if (
					this.touchControlFrame &&
					(this.activeControlModule === ClickToMove ||
						this.activeControlModule === TouchThumbstick ||
						this.activeControlModule === DynamicThumbstick)
				) {
					if (!this.controllers.has(TouchJump)) {
						this.controllers.set(TouchJump, new (TouchJump as ControllerCtorNoArgs)());
					}
					this.touchJumpController = this.controllers.get(TouchJump);
					this.touchJumpController!.Enable(true, this.touchControlFrame);
				} else {
					if (this.touchJumpController) {
						this.touchJumpController.Enable(false);
					}
				}

				if (FFlagUserUpdatePlayerScriptsTouchControlsEnabled) {
					this.UpdateActiveControlModuleEnabled();
				} else {
					if (this.controlsEnabled) {
						this.EnableActiveControlModule();
					}
				}
			}
		} else {
			if (!controlModule) {
				if (this.activeController) {
					this.activeController.Enable(false);
				}
				this.activeController = undefined;
				this.activeControlModule = undefined;
			} else {
				if (!this.controllers.has(controlModule)) {
					this.controllers.set(controlModule, new (controlModule as ControllerCtor)(CONTROL_ACTION_PRIORITY));
				}

				if (this.activeController !== this.controllers.get(controlModule)) {
					if (this.activeController) {
						this.activeController.Enable(false);
					}
					this.activeController = this.controllers.get(controlModule);
					this.activeControlModule = controlModule; // Only used to check if controller switch is necessary

					if (
						this.touchControlFrame &&
						(this.activeControlModule === ClickToMove ||
							this.activeControlModule === TouchThumbstick ||
							this.activeControlModule === DynamicThumbstick)
					) {
						if (!this.controllers.has(TouchJump)) {
							this.controllers.set(TouchJump, new (TouchJump as ControllerCtorNoArgs)());
						}
						this.touchJumpController = this.controllers.get(TouchJump);
						this.touchJumpController!.Enable(true, this.touchControlFrame);
					} else {
						if (this.touchJumpController) {
							this.touchJumpController.Enable(false);
						}
					}

					this.EnableActiveControlModule();
				}
			}
		}
	}

	OnLastInputTypeChanged(newLastInputType: Enum.UserInputType): void {
		if (lastInputType === newLastInputType) {
			warn("LastInputType Change listener called with current type.");
		}
		lastInputType = newLastInputType;

		if (lastInputType === Enum.UserInputType.Touch) {
			// TODO: Check if touch module already active
			const [touchModule, success] = this.SelectTouchModule();
			if (success) {
				while (!this.touchControlFrame) {
					legacyWait();
				}
				this.SwitchToController(touchModule);
			}
		} else if (computerInputTypeToModuleMap.get(lastInputType) !== undefined) {
			const [computerModule] = this.SelectComputerMovementModule();
			if (computerModule) {
				this.SwitchToController(computerModule);
			}
		}

		this.UpdateTouchGuiVisibility();
	}

	// Called when any relevant values of GameSettings or LocalPlayer change, forcing re-evalulation of
	// current control scheme
	OnComputerMovementModeChange(): void {
		const [controlModule, success] = this.SelectComputerMovementModule();
		if (success) {
			this.SwitchToController(controlModule);
		}
	}

	OnTouchMovementModeChange(): void {
		const [touchModule, success] = this.SelectTouchModule();
		if (success) {
			while (!this.touchControlFrame) {
				legacyWait();
			}
			this.SwitchToController(touchModule);
		}
	}

	CreateTouchGuiContainer(): void {
		if (this.touchGui) {
			this.touchGui.Destroy();
		}

		// Container for all touch device guis
		this.touchGui = new Instance("ScreenGui");
		this.touchGui.Name = "TouchGui";
		this.touchGui.ResetOnSpawn = false;
		this.touchGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
		this.UpdateTouchGuiVisibility();

		this.touchControlFrame = new Instance("Frame");
		this.touchControlFrame.Name = "TouchControlFrame";
		this.touchControlFrame.Size = new UDim2(1, 0, 1, 0);
		this.touchControlFrame.BackgroundTransparency = 1;
		this.touchControlFrame.Parent = this.touchGui;

		this.touchGui.Parent = this.playerGui;
	}

	GetClickToMoveController(): ControllerInstance {
		if (!this.controllers.has(ClickToMove)) {
			this.controllers.set(ClickToMove, new (ClickToMove as ControllerCtor)(CONTROL_ACTION_PRIORITY));
		}
		return this.controllers.get(ClickToMove)!;
	}
}

export = new ControlModule();
