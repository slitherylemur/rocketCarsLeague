// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/MouseLockController (ModuleScript)
//
// MouseLockController - Replacement for ShiftLockController, manages use of mouse-locked mode
// 2018 Camera Update - AllYourBlox

// Note: the original only requires CameraUtils when FFlagUserCameraToggleDontSetMouseIconEveryFrame
// is set (it is otherwise left nil, and never referenced). Requiring it unconditionally here is
// behaviorally identical since module require has no side effects and every use below remains
// guarded by that same flag, exactly as in the original.
import CameraUtils from "./CameraUtils";

const DEFAULT_MOUSE_LOCK_CURSOR = "rbxasset://textures/MouseLockedCursor.png";

const CONTEXT_ACTION_NAME = "MouseLockSwitchAction";
const MOUSELOCK_ACTION_PRIORITY = Enum.ContextActionPriority.Default.Value;

let FFlagUserCameraToggleDontSetMouseIconEveryFrame: boolean;
{
	const [success, value] = pcall(() => UserSettings().IsUserFeatureEnabled("UserCameraToggleDontSetMouseIconEveryFrame"));
	FFlagUserCameraToggleDontSetMouseIconEveryFrame = success && (value as boolean);
}

//[[ Services ]]
const PlayersService = game.GetService("Players");
const ContextActionService = game.GetService("ContextActionService");
const Settings = UserSettings(); // ignore warning
const GameSettings = (Settings as unknown as { GameSettings: UserGameSettings }).GameSettings;
const Mouse: PlayerMouse | undefined = FFlagUserCameraToggleDontSetMouseIconEveryFrame
	? undefined
	: PlayersService.LocalPlayer.GetMouse();

//[[ The Module ]]
class MouseLockController {
	isMouseLocked = false;
	savedMouseCursor: string | undefined = undefined;
	boundKeys: Enum.KeyCode[] = [Enum.KeyCode.LeftShift, Enum.KeyCode.RightShift]; // defaults
	mouseLockToggledEvent = new Instance("BindableEvent");
	enabled?: boolean;

	constructor() {
		let boundKeysObjInstance: Instance | undefined = script.FindFirstChild("BoundKeys");
		if (!boundKeysObjInstance || !boundKeysObjInstance.IsA("StringValue")) {
			// If object with correct name was found, but it's not a StringValue, destroy and replace
			if (boundKeysObjInstance) {
				boundKeysObjInstance.Destroy();
			}

			const newBoundKeysObj = new Instance("StringValue");
			newBoundKeysObj.Name = "BoundKeys";
			newBoundKeysObj.Value = "LeftShift,RightShift";
			newBoundKeysObj.Parent = script;
			boundKeysObjInstance = newBoundKeysObj;
		}
		const boundKeysObj = boundKeysObjInstance as StringValue | undefined;

		if (boundKeysObj) {
			boundKeysObj.Changed.Connect((value) => {
				this.OnBoundKeysObjectChanged(value);
			});
			this.OnBoundKeysObjectChanged(boundKeysObj.Value); // Initial setup call
		}

		// Watch for changes to user's ControlMode and ComputerMovementMode settings and update the feature availability accordingly
		(GameSettings as unknown as { Changed: RBXScriptSignal<(property: string) => void> }).Changed.Connect(
			(property) => {
				if (property === "ControlMode" || property === "ComputerMovementMode") {
					this.UpdateMouseLockAvailability();
				}
			},
		);

		// Watch for changes to DevEnableMouseLock and update the feature availability accordingly
		PlayersService.LocalPlayer.GetPropertyChangedSignal("DevEnableMouseLock").Connect(() => {
			this.UpdateMouseLockAvailability();
		});

		// Watch for changes to DevEnableMouseLock and update the feature availability accordingly
		PlayersService.LocalPlayer.GetPropertyChangedSignal("DevComputerMovementMode").Connect(() => {
			this.UpdateMouseLockAvailability();
		});

		this.UpdateMouseLockAvailability();
	}

	GetIsMouseLocked(): boolean {
		return this.isMouseLocked;
	}

	GetBindableToggleEvent(): RBXScriptSignal<() => void> {
		return this.mouseLockToggledEvent.Event;
	}

	GetMouseLockOffset(): Vector3 {
		let offsetValueObjInstance: Instance | undefined = script.FindFirstChild("CameraOffset");
		if (offsetValueObjInstance && offsetValueObjInstance.IsA("Vector3Value")) {
			return offsetValueObjInstance.Value;
		} else {
			// If CameraOffset object was found but not correct type, destroy
			if (offsetValueObjInstance) {
				offsetValueObjInstance.Destroy();
			}
			const newOffsetValueObj = new Instance("Vector3Value");
			newOffsetValueObj.Name = "CameraOffset";
			newOffsetValueObj.Value = new Vector3(1.75, 0, 0); // Legacy Default Value
			newOffsetValueObj.Parent = script;
			offsetValueObjInstance = newOffsetValueObj;
		}

		const offsetValueObj = offsetValueObjInstance as Vector3Value | undefined;
		if (offsetValueObj && offsetValueObj.Value) {
			return offsetValueObj.Value;
		}

		return new Vector3(1.75, 0, 0);
	}

	UpdateMouseLockAvailability(): void {
		const devAllowsMouseLock = PlayersService.LocalPlayer.DevEnableMouseLock;
		const devMovementModeIsScriptable =
			PlayersService.LocalPlayer.DevComputerMovementMode === Enum.DevComputerMovementMode.Scriptable;
		const userHasMouseLockModeEnabled = GameSettings.ControlMode === Enum.ControlMode.MouseLockSwitch;
		const userHasClickToMoveEnabled = GameSettings.ComputerMovementMode === Enum.ComputerMovementMode.ClickToMove;
		const MouseLockAvailable =
			devAllowsMouseLock && userHasMouseLockModeEnabled && !userHasClickToMoveEnabled && !devMovementModeIsScriptable;

		if (MouseLockAvailable !== this.enabled) {
			this.EnableMouseLock(MouseLockAvailable);
		}
	}

	OnBoundKeysObjectChanged(newValue: string): void {
		this.boundKeys = []; // Overriding defaults, note: possibly with nothing at all if boundKeysObj.Value is "" or contains invalid values
		for (const [token] of string.gmatch(newValue, "[^%s,]+")) {
			for (const keyEnum of Enum.KeyCode.GetEnumItems()) {
				if (token === keyEnum.Name) {
					this.boundKeys[this.boundKeys.size()] = keyEnum;
					break;
				}
			}
		}
		this.UnbindContextActions();
		this.BindContextActions();
	}

	//[[ Local Functions ]]
	OnMouseLockToggled(): void {
		this.isMouseLocked = !this.isMouseLocked;

		if (this.isMouseLocked) {
			const cursorImageValueObjInstance: Instance | undefined = script.FindFirstChild("CursorImage");
			if (
				cursorImageValueObjInstance &&
				cursorImageValueObjInstance.IsA("StringValue") &&
				cursorImageValueObjInstance.Value
			) {
				if (FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
					CameraUtils.setMouseIconOverride(cursorImageValueObjInstance.Value);
				} else {
					this.savedMouseCursor = Mouse!.Icon;
					Mouse!.Icon = cursorImageValueObjInstance.Value;
				}
			} else {
				if (cursorImageValueObjInstance) {
					cursorImageValueObjInstance.Destroy();
				}
				const newCursorImageValueObj = new Instance("StringValue");
				newCursorImageValueObj.Name = "CursorImage";
				newCursorImageValueObj.Value = DEFAULT_MOUSE_LOCK_CURSOR;
				newCursorImageValueObj.Parent = script;
				if (FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
					CameraUtils.setMouseIconOverride(DEFAULT_MOUSE_LOCK_CURSOR);
				} else {
					this.savedMouseCursor = Mouse!.Icon;
					Mouse!.Icon = DEFAULT_MOUSE_LOCK_CURSOR;
				}
			}
		} else {
			if (FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
				CameraUtils.restoreMouseIcon();
			} else {
				if (this.savedMouseCursor) {
					Mouse!.Icon = this.savedMouseCursor;
					this.savedMouseCursor = undefined;
				}
			}
		}

		this.mouseLockToggledEvent.Fire();
	}

	DoMouseLockSwitch(name: string, state: Enum.UserInputState, input: InputObject): Enum.ContextActionResult {
		if (state === Enum.UserInputState.Begin) {
			this.OnMouseLockToggled();
			return Enum.ContextActionResult.Sink;
		}
		return Enum.ContextActionResult.Pass;
	}

	BindContextActions(): void {
		ContextActionService.BindActionAtPriority(
			CONTEXT_ACTION_NAME,
			(name, state, input) => {
				return this.DoMouseLockSwitch(name, state, input);
			},
			false,
			MOUSELOCK_ACTION_PRIORITY,
			...this.boundKeys,
		);
	}

	UnbindContextActions(): void {
		ContextActionService.UnbindAction(CONTEXT_ACTION_NAME);
	}

	IsMouseLocked(): boolean {
		return this.enabled === true && this.isMouseLocked;
	}

	EnableMouseLock(enable: boolean): void {
		if (enable !== this.enabled) {
			this.enabled = enable;

			if (this.enabled) {
				// Enabling the mode
				this.BindContextActions();
			} else {
				// Disabling
				// Restore mouse cursor
				if (FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
					CameraUtils.restoreMouseIcon();
				} else {
					if (Mouse!.Icon !== "") {
						Mouse!.Icon = "";
					}
				}

				this.UnbindContextActions();

				// If the mode is disabled while being used, fire the event to toggle it off
				if (this.isMouseLocked) {
					this.mouseLockToggledEvent.Fire();
				}

				this.isMouseLocked = false;
			}
		}
	}
}

export = MouseLockController;
