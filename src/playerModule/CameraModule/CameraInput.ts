// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/CameraInput (ModuleScript)

const ContextActionService = game.GetService("ContextActionService");
const UserInputService = game.GetService("UserInputService");
const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const UserGameSettings = UserSettings().GetService("UserGameSettings");
const VRService = game.GetService("VRService");
const StarterGui = game.GetService("StarterGui");

const player = Players.LocalPlayer;

const CAMERA_INPUT_PRIORITY = Enum.ContextActionPriority.Default.Value;
const MB_TAP_LENGTH = 0.3; // (s) length of time for a short mouse button tap to be registered

const ROTATION_SPEED_KEYS = math.rad(120); // (rad/s)
const ROTATION_SPEED_MOUSE = new Vector2(1, 0.77).mul(math.rad(0.5)); // (rad/s)
const ROTATION_SPEED_POINTERACTION = new Vector2(1, 0.77).mul(math.rad(7)); // (rad/s)
const ROTATION_SPEED_TOUCH = new Vector2(1, 0.66).mul(math.rad(1)); // (rad/s)
const ROTATION_SPEED_GAMEPAD = new Vector2(1, 0.77).mul(math.rad(4)); // (rad/s)

const ZOOM_SPEED_MOUSE = 1; // (scaled studs/wheel click)
const ZOOM_SPEED_KEYS = 0.1; // (studs/s)
const ZOOM_SPEED_TOUCH = 0.04; // (scaled studs/DIP %)

const MIN_TOUCH_SENSITIVITY_FRACTION = 0.25; // 25% sensitivity at 90°

let FFlagUserFlagEnableNewVRSystem: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserFlagEnableNewVRSystem"));
	FFlagUserFlagEnableNewVRSystem = success && (result as boolean);
}

let FFlagUserFlagEnableVRUpdate2: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserFlagEnableVRUpdate2"));
	FFlagUserFlagEnableVRUpdate2 = success && (result as boolean);
}

// right mouse button up & down events
let rmbDown: RBXScriptSignal<() => void>;
let rmbUp: RBXScriptSignal<() => void>;
{
	const rmbDownBindable = new Instance("BindableEvent");
	const rmbUpBindable = new Instance("BindableEvent");

	rmbDown = rmbDownBindable.Event;
	rmbUp = rmbUpBindable.Event;

	UserInputService.InputBegan.Connect((input, gpe) => {
		if (!gpe && input.UserInputType === Enum.UserInputType.MouseButton2) {
			rmbDownBindable.Fire();
		}
	});

	UserInputService.InputEnded.Connect((input, gpe) => {
		if (input.UserInputType === Enum.UserInputType.MouseButton2) {
			rmbUpBindable.Fire();
		}
	});
}

const K_CURVATURE = 2; // amount of upwards curvature (0 is flat)
const K_DEADZONE = 0.1; // deadzone

function thumbstickCurve(x: number): number {
	// remove sign, apply linear deadzone
	const fDeadzone = (math.abs(x) - K_DEADZONE) / (1 - K_DEADZONE);

	// apply exponential curve and scale to fit in [0, 1]
	const fCurve = (math.exp(K_CURVATURE * fDeadzone) - 1) / (math.exp(K_CURVATURE) - 1);

	// reapply sign and clamp
	return math.sign(x) * math.clamp(fCurve, 0, 1);
}

// Adjust the touch sensitivity so that sensitivity is reduced when swiping up
// or down, but stays the same when swiping towards the middle of the screen
function adjustTouchPitchSensitivity(delta: Vector2): Vector2 {
	const camera = game.Workspace.CurrentCamera;

	if (!camera) {
		return delta;
	}

	// get the camera pitch in world space
	const [pitch] = camera.CFrame.ToEulerAnglesYXZ();

	if (delta.Y * pitch >= 0) {
		// do not reduce sensitivity when pitching towards the horizon
		return delta;
	}

	// set up a line to fit:
	// 1 = f(0)
	// 0 = f(±pi/2)
	const curveY = 1 - ((2 * math.abs(pitch)) / math.pi) ** 0.75;

	// remap curveY from [0, 1] -> [MIN_TOUCH_SENSITIVITY_FRACTION, 1]
	const sensitivity = curveY * (1 - MIN_TOUCH_SENSITIVITY_FRACTION) + MIN_TOUCH_SENSITIVITY_FRACTION;

	return new Vector2(1, sensitivity).mul(delta);
}

function isInDynamicThumbstickArea(pos: Vector3): boolean {
	const playerGui = player.FindFirstChildOfClass("PlayerGui");
	const touchGui = playerGui && (playerGui.FindFirstChild("TouchGui") as ScreenGui | undefined);
	const touchFrame = touchGui && (touchGui.FindFirstChild("TouchControlFrame") as GuiObject | undefined);
	const thumbstickFrame = touchFrame && (touchFrame.FindFirstChild("DynamicThumbstickFrame") as GuiObject | undefined);

	if (!thumbstickFrame) {
		return false;
	}

	if (!touchGui!.Enabled) {
		return false;
	}

	const posTopLeft = thumbstickFrame.AbsolutePosition;
	const posBottomRight = posTopLeft.add(thumbstickFrame.AbsoluteSize);

	return pos.X >= posTopLeft.X && pos.Y >= posTopLeft.Y && pos.X <= posBottomRight.X && pos.Y <= posBottomRight.Y;
}

let worldDt = 1 / 60;
RunService.Stepped.Connect((_time, _worldDt) => {
	worldDt = _worldDt;
});

interface CameraInputModule {
	gamepadZoomPress: RBXScriptSignal<() => void>;
	gamepadReset?: RBXScriptSignal<() => void>;

	getRotationActivated(): boolean;
	getRotation(disableKeyboardRotation?: boolean): Vector2;
	getZoomDelta(): number;

	setInputEnabled(inputEnabled: boolean): void;
	getInputEnabled(): boolean;
	resetInputForFrameEnd(): void;

	getHoldPan(): boolean;
	getTogglePan(): boolean;
	getPanning(): boolean;
	setTogglePan(value: boolean): void;
	enableCameraToggleInput(): void;
	disableCameraToggleInput(): void;
}

let connectionList: RBXScriptConnection[] = [];
let panInputCount = 0;

function incPanInputCount(): void {
	panInputCount = math.max(0, panInputCount + 1);
}

function decPanInputCount(): void {
	panInputCount = math.max(0, panInputCount - 1);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- unused in the original source as well
let touchPitchSensitivity = 1;

const gamepadState: Record<string, Vector2> = {
	Thumbstick2: Vector2.zero,
};
const keyboardState: Record<string, number> = {
	Left: 0,
	Right: 0,
	I: 0,
	O: 0,
};
const mouseState = {
	Movement: Vector2.zero,
	Wheel: 0, // PointerAction
	Pan: Vector2.zero, // PointerAction
	Pinch: 0, // PointerAction
};
const touchState = {
	Move: Vector2.zero,
	Pinch: 0,
};

const gamepadZoomPressBindable = new Instance("BindableEvent");
const gamepadZoomPress: RBXScriptSignal<() => void> = gamepadZoomPressBindable.Event;

const gamepadResetBindable: BindableEvent | undefined =
	VRService.VREnabled && FFlagUserFlagEnableNewVRSystem ? new Instance("BindableEvent") : undefined;
const gamepadReset: RBXScriptSignal<() => void> | undefined =
	VRService.VREnabled && FFlagUserFlagEnableNewVRSystem ? gamepadResetBindable!.Event : undefined;

function getRotationActivated(): boolean {
	return panInputCount > 0 || gamepadState.Thumbstick2.Magnitude > 0;
}

function getRotation(disableKeyboardRotation?: boolean): Vector2 {
	const inversionVector = new Vector2(1, UserGameSettings.GetCameraYInvertValue());

	// keyboard input is non-coalesced, so must account for time delta
	let kKeyboard = new Vector2(keyboardState.Right - keyboardState.Left, 0).mul(worldDt);
	const kGamepad = gamepadState.Thumbstick2;
	const kMouse = mouseState.Movement;
	const kPointerAction = mouseState.Pan;
	const kTouch = adjustTouchPitchSensitivity(touchState.Move);

	if (disableKeyboardRotation) {
		kKeyboard = Vector2.zero;
	}

	const result = kKeyboard
		.mul(ROTATION_SPEED_KEYS)
		.add(kGamepad.mul(ROTATION_SPEED_GAMEPAD))
		.add(kMouse.mul(ROTATION_SPEED_MOUSE))
		.add(kPointerAction.mul(ROTATION_SPEED_POINTERACTION))
		.add(kTouch.mul(ROTATION_SPEED_TOUCH));

	return result.mul(inversionVector);
}

function getZoomDelta(): number {
	const kKeyboard = keyboardState.O - keyboardState.I;
	const kMouse = -mouseState.Wheel + mouseState.Pinch;
	const kTouch = -touchState.Pinch;
	return kKeyboard * ZOOM_SPEED_KEYS + kMouse * ZOOM_SPEED_MOUSE + kTouch * ZOOM_SPEED_TOUCH;
}

function thumbstick(
	action: string,
	state: Enum.UserInputState,
	input: InputObject,
): Enum.ContextActionResult | undefined {
	const position = input.Position;
	gamepadState[input.KeyCode.Name] = new Vector2(thumbstickCurve(position.X), -thumbstickCurve(position.Y));
	if (FFlagUserFlagEnableVRUpdate2) {
		return Enum.ContextActionResult.Pass;
	}
	return undefined;
}

function mouseMovement(input: InputObject): void {
	const delta = input.Delta;
	mouseState.Movement = new Vector2(delta.X, delta.Y);
}

// Note: never actually bound to an action in the original source (mouse wheel is handled via
// PointerAction instead); preserved verbatim as dead code, including the matching UnbindAction
// call below for "RbxCameraMouseWheel".
function mouseWheel(action: string, state: Enum.UserInputState, input: InputObject): Enum.ContextActionResult {
	mouseState.Wheel = input.Position.Z;
	return Enum.ContextActionResult.Pass;
}

function keypress(action: string, state: Enum.UserInputState, input: InputObject): void {
	keyboardState[input.KeyCode.Name] = state === Enum.UserInputState.Begin ? 1 : 0;
}

function gamepadZoomPressHandler(action: string, state: Enum.UserInputState, input: InputObject): void {
	if (state === Enum.UserInputState.Begin) {
		gamepadZoomPressBindable.Fire();
	}
}

function gamepadResetHandler(action: string, state: Enum.UserInputState, input: InputObject): void {
	if (state === Enum.UserInputState.Begin) {
		gamepadResetBindable!.Fire();
	}
}

function resetInputDevices(): void {
	// Note: rewritten from the original's generic `for k, v in pairs(device)` loop (which
	// multiplied every field by zero, or set booleans to false) into explicit per-field resets.
	// The state tables mix Vector2 and number fields with no boolean fields ever actually used,
	// so this produces identical results while staying type-safe.
	gamepadState.Thumbstick2 = Vector2.zero;
	keyboardState.Left = 0;
	keyboardState.Right = 0;
	keyboardState.I = 0;
	keyboardState.O = 0;
	mouseState.Movement = Vector2.zero;
	touchState.Move = Vector2.zero;
	touchState.Pinch = 0;

	mouseState.Wheel = 0; // PointerAction
	mouseState.Pan = Vector2.zero; // PointerAction
	mouseState.Pinch = 0; // PointerAction
}

// Use TouchPan & TouchPinch when they work in the Studio emulator
let touches = new Map<InputObject, boolean>(); // {[InputObject] = sunk}
let dynamicThumbstickInput: InputObject | undefined; // Special-cased
let lastPinchDiameter: number | undefined;

function touchBegan(input: InputObject, sunk: boolean): void {
	assert(input.UserInputType === Enum.UserInputType.Touch);
	assert(input.UserInputState === Enum.UserInputState.Begin);

	if (dynamicThumbstickInput === undefined && isInDynamicThumbstickArea(input.Position) && !sunk) {
		// any finger down starting in the dynamic thumbstick area should always be
		// ignored for camera purposes. these must be handled specially from all other
		// inputs, as the DT does not sink inputs by itself
		dynamicThumbstickInput = input;
		return;
	}

	if (!sunk) {
		incPanInputCount();
	}

	// register the finger
	touches.set(input, sunk);
}

function touchEnded(input: InputObject, sunk: boolean): void {
	assert(input.UserInputType === Enum.UserInputType.Touch);
	assert(input.UserInputState === Enum.UserInputState.End);

	// reset the DT input
	if (input === dynamicThumbstickInput) {
		dynamicThumbstickInput = undefined;
	}

	// reset pinch state if one unsunk finger lifts
	if (touches.get(input) === false) {
		lastPinchDiameter = undefined;
		decPanInputCount();
	}

	// unregister input
	touches.delete(input);
}

function touchChanged(input: InputObject, sunk: boolean): void {
	assert(input.UserInputType === Enum.UserInputType.Touch);
	assert(input.UserInputState === Enum.UserInputState.Change);

	// ignore movement from the DT finger
	if (input === dynamicThumbstickInput) {
		return;
	}

	// fixup unknown touches
	if (touches.get(input) === undefined) {
		touches.set(input, sunk);
	}

	// collect unsunk touches
	const unsunkTouches: InputObject[] = [];
	for (const [touch, touchSunk] of touches) {
		if (!touchSunk) {
			unsunkTouches.push(touch);
		}
	}

	// 1 finger: pan
	if (unsunkTouches.size() === 1) {
		if (touches.get(input) === false) {
			const delta = input.Delta;
			touchState.Move = touchState.Move.add(new Vector2(delta.X, delta.Y)); // total touch pan movement (reset at end of frame)
		}
	}

	// 2 fingers: pinch
	if (unsunkTouches.size() === 2) {
		const pinchDiameter = unsunkTouches[0].Position.sub(unsunkTouches[1].Position).Magnitude;

		if (lastPinchDiameter !== undefined) {
			touchState.Pinch += pinchDiameter - lastPinchDiameter;
		}

		lastPinchDiameter = pinchDiameter;
	} else {
		lastPinchDiameter = undefined;
	}
}

function resetTouchState(): void {
	touches = new Map<InputObject, boolean>();
	dynamicThumbstickInput = undefined;
	lastPinchDiameter = undefined;
}

function pointerAction(wheel: number, pan: Vector2, pinch: number, gpe: boolean): void {
	if (!gpe) {
		mouseState.Wheel = wheel;
		mouseState.Pan = pan;
		mouseState.Pinch = -pinch;
	}
}

function inputBegan(input: InputObject, sunk: boolean): void {
	if (input.UserInputType === Enum.UserInputType.Touch) {
		touchBegan(input, sunk);
	} else if (input.UserInputType === Enum.UserInputType.MouseButton2 && !sunk) {
		incPanInputCount();
	}
}

function inputChanged(input: InputObject, sunk: boolean): void {
	if (input.UserInputType === Enum.UserInputType.Touch) {
		touchChanged(input, sunk);
	} else if (input.UserInputType === Enum.UserInputType.MouseMovement) {
		mouseMovement(input);
	}
}

function inputEnded(input: InputObject, sunk: boolean): void {
	if (input.UserInputType === Enum.UserInputType.Touch) {
		touchEnded(input, sunk);
	} else if (input.UserInputType === Enum.UserInputType.MouseButton2) {
		decPanInputCount();
	}
}

let inputEnabled = false;

function setInputEnabled(_inputEnabled: boolean): void {
	if (inputEnabled === _inputEnabled) {
		return;
	}
	inputEnabled = _inputEnabled;

	resetInputDevices();
	resetTouchState();

	if (inputEnabled) {
		// enable
		ContextActionService.BindActionAtPriority(
			"RbxCameraThumbstick",
			thumbstick,
			false,
			CAMERA_INPUT_PRIORITY,
			Enum.KeyCode.Thumbstick2,
		);

		ContextActionService.BindActionAtPriority(
			"RbxCameraKeypress",
			keypress,
			false,
			CAMERA_INPUT_PRIORITY,
			Enum.KeyCode.Left,
			Enum.KeyCode.Right,
			Enum.KeyCode.I,
			Enum.KeyCode.O,
		);

		if (VRService.VREnabled && FFlagUserFlagEnableNewVRSystem) {
			ContextActionService.BindAction("RbxCameraGamepadReset", gamepadResetHandler, false, Enum.KeyCode.ButtonL3);
		}

		ContextActionService.BindAction("RbxCameraGamepadZoom", gamepadZoomPressHandler, false, Enum.KeyCode.ButtonR3);

		connectionList.push(UserInputService.InputBegan.Connect(inputBegan));
		connectionList.push(UserInputService.InputChanged.Connect(inputChanged));
		connectionList.push(UserInputService.InputEnded.Connect(inputEnded));
		connectionList.push(UserInputService.PointerAction.Connect(pointerAction));
	} else {
		// disable
		ContextActionService.UnbindAction("RbxCameraThumbstick");
		ContextActionService.UnbindAction("RbxCameraMouseMove");
		ContextActionService.UnbindAction("RbxCameraMouseWheel");
		ContextActionService.UnbindAction("RbxCameraKeypress");

		if (FFlagUserFlagEnableNewVRSystem) {
			ContextActionService.UnbindAction("RbxCameraGamepadZoom");
			if (VRService.VREnabled) {
				ContextActionService.UnbindAction("RbxCameraGamepadReset");
			}
		}

		for (const conn of connectionList) {
			conn.Disconnect();
		}
		connectionList = [];
	}
}

function getInputEnabled(): boolean {
	return inputEnabled;
}

function resetInputForFrameEnd(): void {
	mouseState.Movement = Vector2.zero;
	touchState.Move = Vector2.zero;
	touchState.Pinch = 0;

	mouseState.Wheel = 0; // PointerAction
	mouseState.Pan = Vector2.zero; // PointerAction
	mouseState.Pinch = 0; // PointerAction
}

UserInputService.WindowFocused.Connect(resetInputDevices);
UserInputService.WindowFocusReleased.Connect(resetInputDevices);

// Toggle pan
let holdPan = false;
let togglePan = false;
let lastRmbDown = 0; // tick() timestamp of the last right mouse button down event

function getHoldPan(): boolean {
	return holdPan;
}

function getTogglePan(): boolean {
	return togglePan;
}

function getPanning(): boolean {
	return togglePan || holdPan;
}

function setTogglePan(value: boolean): void {
	togglePan = value;
}

let cameraToggleInputEnabled = false;
let rmbDownConnection: RBXScriptConnection | undefined;
let rmbUpConnection: RBXScriptConnection | undefined;

function enableCameraToggleInput(): void {
	if (cameraToggleInputEnabled) {
		return;
	}
	cameraToggleInputEnabled = true;

	holdPan = false;
	togglePan = false;

	if (rmbDownConnection) {
		rmbDownConnection.Disconnect();
	}

	if (rmbUpConnection) {
		rmbUpConnection.Disconnect();
	}

	rmbDownConnection = rmbDown.Connect(() => {
		holdPan = true;
		lastRmbDown = tick();
	});

	rmbUpConnection = rmbUp.Connect(() => {
		holdPan = false;
		if (tick() - lastRmbDown < MB_TAP_LENGTH && (togglePan || UserInputService.GetMouseDelta().Magnitude < 2)) {
			togglePan = !togglePan;
		}
	});
}

function disableCameraToggleInput(): void {
	if (!cameraToggleInputEnabled) {
		return;
	}
	cameraToggleInputEnabled = false;

	if (rmbDownConnection) {
		rmbDownConnection.Disconnect();
		rmbDownConnection = undefined;
	}

	if (rmbUpConnection) {
		rmbUpConnection.Disconnect();
		rmbUpConnection = undefined;
	}
}

const CameraInput: CameraInputModule = {
	gamepadZoomPress,
	gamepadReset,

	getRotationActivated,
	getRotation,
	getZoomDelta,

	setInputEnabled,
	getInputEnabled,
	resetInputForFrameEnd,

	getHoldPan,
	getTogglePan,
	getPanning,
	setTogglePan,
	enableCameraToggleInput,
	disableCameraToggleInput,
};

export = CameraInput;
