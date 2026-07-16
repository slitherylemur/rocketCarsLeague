// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/Gamepad (ModuleScript)
//
// Gamepad Character Control - This module handles controlling your avatar using a game console-style controller
//
// 2018 PlayerScripts Update - AllYourBlox

import BaseCharacterController from "./BaseCharacterController";

const UserInputService = game.GetService("UserInputService");
const ContextActionService = game.GetService("ContextActionService");

// Constants
const ZERO_VECTOR3 = new Vector3(0, 0, 0);
const NONE = Enum.UserInputType.None;
const thumbstickDeadzone = 0.2;

// The Module
class Gamepad extends BaseCharacterController {
	CONTROL_ACTION_PRIORITY: number;

	forwardValue = 0;
	backwardValue = 0;
	leftValue = 0;
	rightValue = 0;

	activeGamepad: Enum.UserInputType = NONE; // Enum.UserInputType.Gamepad1, 2, 3...
	gamepadConnectedConn?: RBXScriptConnection;
	gamepadDisconnectedConn?: RBXScriptConnection;

	constructor(CONTROL_ACTION_PRIORITY: number) {
		super();

		this.CONTROL_ACTION_PRIORITY = CONTROL_ACTION_PRIORITY;
	}

	Enable(enable: boolean): boolean {
		if (!UserInputService.GamepadEnabled) {
			return false;
		}

		if (enable === this.enabled) {
			// Module is already in the state being requested. True is returned here since the module will be in the state
			// expected by the code that follows the Enable() call. This makes more sense than returning false to indicate
			// no action was necessary. False indicates failure to be in requested/expected state.
			return true;
		}

		this.forwardValue = 0;
		this.backwardValue = 0;
		this.leftValue = 0;
		this.rightValue = 0;
		this.moveVector = ZERO_VECTOR3;
		this.isJumping = false;

		if (enable) {
			this.activeGamepad = this.GetHighestPriorityGamepad();
			if (this.activeGamepad !== NONE) {
				this.BindContextActions();
				this.ConnectGamepadConnectionListeners();
			} else {
				// No connected gamepads, failure to enable
				return false;
			}
		} else {
			this.UnbindContextActions();
			this.DisconnectGamepadConnectionListeners();
			this.activeGamepad = NONE;
		}

		this.enabled = enable;
		return true;
	}

	// This function selects the lowest number gamepad from the currently-connected gamepad
	// and sets it as the active gamepad
	GetHighestPriorityGamepad(): Enum.UserInputType {
		const connectedGamepads = UserInputService.GetConnectedGamepads();
		let bestGamepad: Enum.UserInputType = NONE; // Note that this value is higher than all valid gamepad values
		for (const [, gamepad] of pairs(connectedGamepads)) {
			if (gamepad.Value < bestGamepad.Value) {
				bestGamepad = gamepad;
			}
		}
		return bestGamepad;
	}

	BindContextActions(): boolean {
		if (this.activeGamepad === NONE) {
			// There must be an active gamepad to set up bindings
			return false;
		}

		const handleJumpAction = (actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
			this.isJumping = inputState === Enum.UserInputState.Begin;
			return Enum.ContextActionResult.Sink;
		};

		const handleThumbstickInput = (actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
			if (inputState === Enum.UserInputState.Cancel) {
				this.moveVector = ZERO_VECTOR3;
				return Enum.ContextActionResult.Sink;
			}

			if (this.activeGamepad !== inputObject.UserInputType) {
				return Enum.ContextActionResult.Pass;
			}
			if (inputObject.KeyCode !== Enum.KeyCode.Thumbstick1) {
				return;
			}

			if (inputObject.Position.Magnitude > thumbstickDeadzone) {
				this.moveVector = new Vector3(inputObject.Position.X, 0, -inputObject.Position.Y);
			} else {
				this.moveVector = ZERO_VECTOR3;
			}
			return Enum.ContextActionResult.Sink;
		};

		ContextActionService.BindActivate(this.activeGamepad, Enum.KeyCode.ButtonR2);
		ContextActionService.BindActionAtPriority(
			"jumpAction",
			handleJumpAction,
			false,
			this.CONTROL_ACTION_PRIORITY,
			Enum.KeyCode.ButtonA,
		);
		ContextActionService.BindActionAtPriority(
			"moveThumbstick",
			handleThumbstickInput,
			false,
			this.CONTROL_ACTION_PRIORITY,
			Enum.KeyCode.Thumbstick1,
		);

		return true;
	}

	UnbindContextActions(): void {
		if (this.activeGamepad !== NONE) {
			ContextActionService.UnbindActivate(this.activeGamepad, Enum.KeyCode.ButtonR2);
		}
		ContextActionService.UnbindAction("moveThumbstick");
		ContextActionService.UnbindAction("jumpAction");
	}

	OnNewGamepadConnected(): void {
		// A new gamepad has been connected.
		const bestGamepad: Enum.UserInputType = this.GetHighestPriorityGamepad();

		if (bestGamepad === this.activeGamepad) {
			// A new gamepad was connected, but our active gamepad is not changing
			return;
		}

		if (bestGamepad === NONE) {
			// There should be an active gamepad when GamepadConnected fires, so this should not
			// normally be hit. If there is no active gamepad, unbind actions but leave
			// the module enabled and continue to listen for a new gamepad connection.
			warn("Gamepad:OnNewGamepadConnected found no connected gamepads");
			this.UnbindContextActions();
			return;
		}

		if (this.activeGamepad !== NONE) {
			// Switching from one active gamepad to another
			this.UnbindContextActions();
		}

		this.activeGamepad = bestGamepad;
		this.BindContextActions();
	}

	OnCurrentGamepadDisconnected(): void {
		if (this.activeGamepad !== NONE) {
			ContextActionService.UnbindActivate(this.activeGamepad, Enum.KeyCode.ButtonR2);
		}

		const bestGamepad = this.GetHighestPriorityGamepad();

		if (this.activeGamepad !== NONE && bestGamepad === this.activeGamepad) {
			warn("Gamepad:OnCurrentGamepadDisconnected found the supposedly disconnected gamepad in connectedGamepads.");
			this.UnbindContextActions();
			this.activeGamepad = NONE;
			return;
		}

		if (bestGamepad === NONE) {
			// No active gamepad, unbinding actions but leaving gamepad connection listener active
			this.UnbindContextActions();
			this.activeGamepad = NONE;
		} else {
			// Set new gamepad as active and bind to tool activation
			this.activeGamepad = bestGamepad;
			ContextActionService.BindActivate(this.activeGamepad, Enum.KeyCode.ButtonR2);
		}
	}

	ConnectGamepadConnectionListeners(): void {
		this.gamepadConnectedConn = UserInputService.GamepadConnected.Connect((gamepadEnum) => {
			this.OnNewGamepadConnected();
		});

		this.gamepadDisconnectedConn = UserInputService.GamepadDisconnected.Connect((gamepadEnum) => {
			if (this.activeGamepad === gamepadEnum) {
				this.OnCurrentGamepadDisconnected();
			}
		});
	}

	DisconnectGamepadConnectionListeners(): void {
		if (this.gamepadConnectedConn) {
			this.gamepadConnectedConn.Disconnect();
			this.gamepadConnectedConn = undefined;
		}

		if (this.gamepadDisconnectedConn) {
			this.gamepadDisconnectedConn.Disconnect();
			this.gamepadDisconnectedConn = undefined;
		}
	}
}

export = Gamepad;
