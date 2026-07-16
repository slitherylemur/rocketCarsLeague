// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/Keyboard (ModuleScript)
//
// Keyboard Character Control - This module handles controlling your avatar from a keyboard
//
// 2018 PlayerScripts Update - AllYourBlox

import BaseCharacterController from "./BaseCharacterController";

// Roblox Services
const UserInputService = game.GetService("UserInputService");
const ContextActionService = game.GetService("ContextActionService");

// Constants
const ZERO_VECTOR3 = new Vector3(0, 0, 0);

// The Module
class Keyboard extends BaseCharacterController {
	CONTROL_ACTION_PRIORITY: number;

	textFocusReleasedConn?: RBXScriptConnection;
	textFocusGainedConn?: RBXScriptConnection;
	windowFocusReleasedConn?: RBXScriptConnection;

	forwardValue = 0;
	backwardValue = 0;
	leftValue = 0;
	rightValue = 0;

	jumpEnabled = true;
	jumpRequested = false;

	constructor(CONTROL_ACTION_PRIORITY: number) {
		super();

		this.CONTROL_ACTION_PRIORITY = CONTROL_ACTION_PRIORITY;
	}

	Enable(enable: boolean): boolean {
		if (!UserInputService.KeyboardEnabled) {
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
		this.jumpRequested = false;
		this.UpdateJump();

		if (enable) {
			this.BindContextActions();
			this.ConnectFocusEventListeners();
		} else {
			this.UnbindContextActions();
			this.DisconnectFocusEventListeners();
		}

		this.enabled = enable;
		return true;
	}

	UpdateMovement(inputState: Enum.UserInputState): void {
		if (inputState === Enum.UserInputState.Cancel) {
			this.moveVector = ZERO_VECTOR3;
		} else {
			this.moveVector = new Vector3(this.leftValue + this.rightValue, 0, this.forwardValue + this.backwardValue);
		}
	}

	UpdateJump(): void {
		this.isJumping = this.jumpRequested;
	}

	BindContextActions(): void {
		// Note: In the previous version of this code, the movement values were not zeroed-out on UserInputState. Cancel, now they are,
		// which fixes them from getting stuck on.
		// We return ContextActionResult.Pass here for legacy reasons.
		// Many games rely on gameProcessedEvent being false on UserInputService.InputBegan for these control actions.
		const handleMoveForward = (actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
			this.forwardValue = inputState === Enum.UserInputState.Begin ? -1 : 0;
			this.UpdateMovement(inputState);
			return Enum.ContextActionResult.Pass;
		};

		const handleMoveBackward = (actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
			this.backwardValue = inputState === Enum.UserInputState.Begin ? 1 : 0;
			this.UpdateMovement(inputState);
			return Enum.ContextActionResult.Pass;
		};

		const handleMoveLeft = (actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
			this.leftValue = inputState === Enum.UserInputState.Begin ? -1 : 0;
			this.UpdateMovement(inputState);
			return Enum.ContextActionResult.Pass;
		};

		const handleMoveRight = (actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
			this.rightValue = inputState === Enum.UserInputState.Begin ? 1 : 0;
			this.UpdateMovement(inputState);
			return Enum.ContextActionResult.Pass;
		};

		const handleJumpAction = (actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
			this.jumpRequested = this.jumpEnabled && inputState === Enum.UserInputState.Begin;
			this.UpdateJump();
			return Enum.ContextActionResult.Pass;
		};

		// TODO: Revert to KeyCode bindings so that in the future the abstraction layer from actual keys to
		// movement direction is done in Lua
		ContextActionService.BindActionAtPriority(
			"moveForwardAction",
			handleMoveForward,
			false,
			this.CONTROL_ACTION_PRIORITY,
			Enum.PlayerActions.CharacterForward,
		);
		ContextActionService.BindActionAtPriority(
			"moveBackwardAction",
			handleMoveBackward,
			false,
			this.CONTROL_ACTION_PRIORITY,
			Enum.PlayerActions.CharacterBackward,
		);
		ContextActionService.BindActionAtPriority(
			"moveLeftAction",
			handleMoveLeft,
			false,
			this.CONTROL_ACTION_PRIORITY,
			Enum.PlayerActions.CharacterLeft,
		);
		ContextActionService.BindActionAtPriority(
			"moveRightAction",
			handleMoveRight,
			false,
			this.CONTROL_ACTION_PRIORITY,
			Enum.PlayerActions.CharacterRight,
		);
		ContextActionService.BindActionAtPriority(
			"jumpAction",
			handleJumpAction,
			false,
			this.CONTROL_ACTION_PRIORITY,
			Enum.PlayerActions.CharacterJump,
		);
	}

	UnbindContextActions(): void {
		ContextActionService.UnbindAction("moveForwardAction");
		ContextActionService.UnbindAction("moveBackwardAction");
		ContextActionService.UnbindAction("moveLeftAction");
		ContextActionService.UnbindAction("moveRightAction");
		ContextActionService.UnbindAction("jumpAction");
	}

	ConnectFocusEventListeners(): void {
		const onFocusReleased = () => {
			this.moveVector = ZERO_VECTOR3;
			this.forwardValue = 0;
			this.backwardValue = 0;
			this.leftValue = 0;
			this.rightValue = 0;
			this.jumpRequested = false;
			this.UpdateJump();
		};

		const onTextFocusGained = (textboxFocused: TextBox) => {
			this.jumpRequested = false;
			this.UpdateJump();
		};

		this.textFocusReleasedConn = UserInputService.TextBoxFocusReleased.Connect(onFocusReleased);
		this.textFocusGainedConn = UserInputService.TextBoxFocused.Connect(onTextFocusGained);
		this.windowFocusReleasedConn = UserInputService.WindowFocused.Connect(onFocusReleased);
	}

	DisconnectFocusEventListeners(): void {
		if (this.textFocusReleasedConn) {
			this.textFocusReleasedConn.Disconnect();
			this.textFocusReleasedConn = undefined;
		}
		if (this.textFocusGainedConn) {
			this.textFocusGainedConn.Disconnect();
			this.textFocusGainedConn = undefined;
		}
		if (this.windowFocusReleasedConn) {
			this.windowFocusReleasedConn.Disconnect();
			this.windowFocusReleasedConn = undefined;
		}
	}
}

export = Keyboard;
