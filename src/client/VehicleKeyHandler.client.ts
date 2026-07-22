// Original: StarterPlayer/StarterPlayerScripts/VehicleKeyHandler (LocalScript)
//
// Phase 3 (SERVER_AUTHORITY_PLAN.md): vehicle inputs moved to the Input
// Action System. The per-player InputContext (Player.VehicleControls) is
// built server-side and enabled by the sim while driving; the engine
// captures keyboard/gamepad bindings natively and streams them into the
// server authority input system — no remotes, and inputs get replayed on
// rollback once client prediction lands (Phase 4).
//
// What remains in this script:
//   - prediction management while seated (car + character Off until Phase 4)
//   - the Horn key (cosmetic, stays on the legacy KeyHandler remote)
//   - mobile: joystick sampling fired into ThrottleTouch/SteerTouch actions,
//     and UIButton wiring for the Drift/Boost/Jump touch bindings
//   - the keybindings menu UI (rebinds now apply live via SetKeyBinding)
// (The gamepad menu-button fires and the GetPlayerPointToScreenSpace handler
// are gone — retired across Phases 5-8 with their server halves.)

import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import keyCodeImages from "shared/KeyCodeImages";
import { legacyWait } from "shared/LegacyTiming";
import { VehicleInput } from "shared/vehicleSim/VehicleSim";

const ContextActionService = game.GetService("ContextActionService");
const UserInputService = game.GetService("UserInputService");
const GuiService = game.GetService("GuiService");
const RunService = game.GetService("RunService");
const Players = game.GetService("Players");
const Player = Players.LocalPlayer;

const GetKeyBinding = FunctionsAndEvents.GetKeyBinding;
const SetKeyBinding = FunctionsAndEvents.SetKeyBinding;

const handleAction = (actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) => {
	FunctionsAndEvents.KeyHandler.FireServer(actionName, inputState, inputObject);
};

// ---------------------------------------------------------------------------
// Server authority: prediction management while seated
// ---------------------------------------------------------------------------
// Phase 4: the local car is fully PREDICTED. The client runs the same sim
// (initVehicleSim.client.ts) under BindToSimulation, and every part and
// constraint of the car is forced to PredictionMode.On while seated (the
// engine can't predict half an assembly — the seated character is predicted
// by default and is welded into the car). Reverts to Automatic on exit.
// pcall-guarded: a no-op without server authority.

let managedVehicle: Instance | undefined = undefined;
let managedCharacter: Instance | undefined = undefined;
// While seated: DescendantAdded watchers that mark late-streaming parts On.
// The server used to mark the whole car at spawn, covering anything the
// client hadn't streamed yet — SetPredictionMode is CLIENT-ONLY since the
// 2026-07 engine update, so a part arriving after the seat-time deep mark
// would otherwise stay unpredicted and get the WHOLE assembly refused
// ("can't predict half an assembly" → Authoritative → input delay).
let predictionWatchers: RBXScriptConnection[] = [];

// Only these classes can be predicted — sweeping everything made the engine
// warn about TouchTransmitter/Humanoid.Status and refuse the whole car.
function canPredict(instance: Instance): boolean {
	return (
		instance.IsA("BasePart") ||
		instance.IsA("Model") ||
		instance.IsA("Folder") ||
		instance.IsA("Attachment") ||
		instance.IsA("Constraint") ||
		instance.IsA("JointInstance")
	);
}

function setPredictionDeep(root: Instance, mode: Enum.PredictionMode) {
	const [ok, err] = pcall(() => {
		if (canPredict(root)) {
			RunService.SetPredictionMode(root, mode);
		}
		for (const descendant of root.GetDescendants()) {
			if (canPredict(descendant)) {
				RunService.SetPredictionMode(descendant, mode);
			}
		}
	});
	if (!ok) {
		warn(`[VehicleKeyHandler] SetPredictionMode(${mode}) failed: ${err}`);
	}
}

// ---------------------------------------------------------------------------
// Horn: local-first playback
// ---------------------------------------------------------------------------
// The legacy remote path (press → FireServer → server Play() → replicate back)
// costs a full round trip before the owner hears anything. Instead the owner
// plays a LOCAL clone instantly on the keypress and locally mutes the
// server-replicated hornSound (property writes on the client don't replicate,
// so everyone else still hears the server's spatial playback).

const LOCAL_HORN_NAME = "LocalHorn";

function playLocalHorn() {
	const vehicle = managedVehicle;
	if (!vehicle) {
		return;
	}
	const base = vehicle.FindFirstChild("VehicleRoot") ?? vehicle.FindFirstChild("Base");
	const hornSound = base && base.FindFirstChild("hornSound");
	if (!base || !hornSound || !hornSound.IsA("Sound") || hornSound.SoundId === "") {
		return; // no preloaded id (old save / race) — the server path still honks
	}
	let localHorn = base.FindFirstChild(LOCAL_HORN_NAME) as Sound | undefined;
	if (!localHorn) {
		localHorn = hornSound.Clone(); // clone BEFORE muting so the volume carries over
		localHorn.Name = LOCAL_HORN_NAME;
		localHorn.Parent = base;
	}
	hornSound.Volume = 0;
	localHorn.SoundId = hornSound.SoundId; // tracks live horn re-equips
	localHorn.TimePosition = 0;
	localHorn.Play();
}

const handleHornAction = (actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) => {
	if (inputState === Enum.UserInputState.Begin) {
		playLocalHorn();
	}
	// Server still plays for everyone else (and any client without the id yet).
	handleAction(actionName, inputState, inputObject);
};

// ---------------------------------------------------------------------------
// Mobile: joystick → ThrottleTouch/SteerTouch, buttons → Touch bindings
// ---------------------------------------------------------------------------

let vehicleContext: InputContext | undefined = undefined;

function fireTouchAction(actionName: string, value: number) {
	if (!vehicleContext) {
		return;
	}
	const action = vehicleContext.FindFirstChild(actionName);
	if (action && action.IsA("InputAction")) {
		action.Fire(value);
	}
}

let analogSteer = 0;
let analogThrottle = 0;

const JOYSTICK_DEADZONE = 0.1;
let joystickInput: InputObject | undefined = undefined;
let joystickBase: GuiObject | undefined = undefined;
let joystickKnob: GuiObject | undefined = undefined;

function moveJoystickKnob(direction: Vector2) {
	if (!joystickBase || !joystickKnob) {
		return;
	}
	// The knob is 42% of the base, leaving 29% of the base diameter as
	// travel in every direction. Pixel offsets keep the motion circular.
	const travel = math.min(joystickBase.AbsoluteSize.X, joystickBase.AbsoluteSize.Y) * 0.29;
	joystickKnob.Position = new UDim2(0.5, direction.X * travel, 0.5, direction.Y * travel);
}

function publishTouchMovement(steer: number, throttle: number) {
	const nextSteer = math.clamp(steer, -1, 1);
	const nextThrottle = math.clamp(throttle, -1, 1);
	if (math.abs(nextSteer - analogSteer) < 0.01 && math.abs(nextThrottle - analogThrottle) < 0.01) {
		return;
	}
	analogSteer = nextSteer;
	analogThrottle = nextThrottle;
	fireTouchAction(VehicleInput.SteerTouch, analogSteer);
	fireTouchAction(VehicleInput.ThrottleTouch, analogThrottle);
}

function updateJoystick(position: Vector3) {
	const base = joystickBase;
	if (!base) {
		return;
	}
	const size = base.AbsoluteSize;
	const radius = math.min(size.X, size.Y) * 0.5;
	if (radius <= 0) {
		return;
	}
	const center = base.AbsolutePosition.add(size.div(2));
	const displacement = new Vector2(position.X - center.X, position.Y - center.Y).div(radius);
	const magnitude = displacement.Magnitude;
	const clampedDirection = magnitude > 1 ? displacement.div(magnitude) : displacement;
	moveJoystickKnob(clampedDirection);

	// Radial deadzone with the remaining range remapped back to 0..1. X and Y
	// stay in screen space: right is always steer-right and up is always drive.
	if (magnitude <= JOYSTICK_DEADZONE) {
		publishTouchMovement(0, 0);
		return;
	}
	const direction = displacement.div(magnitude);
	const strength = math.clamp((magnitude - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE), 0, 1);
	const output = direction.mul(strength);
	publishTouchMovement(output.X, -output.Y);
}

function resetTouchMovement() {
	joystickInput = undefined;
	analogSteer = 0;
	analogThrottle = 0;
	moveJoystickKnob(new Vector2(0, 0));
	fireTouchAction(VehicleInput.SteerTouch, 0);
	fireTouchAction(VehicleInput.ThrottleTouch, 0);
}

function hookDriveJoystick(base: GuiObject, knob: GuiObject) {
	joystickBase = base;
	joystickKnob = knob;
	moveJoystickKnob(new Vector2(0, 0));
	const begin = (input: InputObject) => {
		if (joystickBase !== base || joystickInput !== undefined) {
			return;
		}
		if (
			input.UserInputType !== Enum.UserInputType.Touch &&
			input.UserInputType !== Enum.UserInputType.MouseButton1
		) {
			return;
		}
		joystickInput = input;
		updateJoystick(input.Position);
	};
	// Listen on both objects so the centred knob cannot intercept the initial
	// press on devices whose GUI hit-testing does not bubble to its parent.
	base.InputBegan.Connect(begin);
	knob.InputBegan.Connect(begin);
}

function fireBoolAction(actionName: string, held: boolean) {
	if (!vehicleContext) {
		return;
	}
	const action = vehicleContext.FindFirstChild(actionName);
	if (action && action.IsA("InputAction")) {
		action.Fire(held);
	}
}

// Wire the MobileInterface ability buttons to their Bool actions. Movement is
// handled separately by the fixed analog joystick above.
//
// Press semantics: press-and-hold, multi-touch safe (steer while
// accelerating). Each press records its InputObject — touch InputObjects
// keep their identity for the whole gesture, so the release matches exactly
// the finger that pressed. A finger that slides well off a button releases
// it (buttons must never stay latched), but small drift keeps the press.

const TOUCH_HOLD_ACTIONS = [
	VehicleInput.Drift,
	VehicleInput.Boost,
	VehicleInput.Jump,
];

// Current held-state per action, as produced by the touch buttons only.
// syncActionStates() consults this so a button held across a context
// re-enable (e.g. the kickoff control-lock lifting) keeps working.
const touchHeld = new Map<string, boolean>();

function setTouchHeld(actionName: string, held: boolean) {
	if ((touchHeld.get(actionName) === true) === held) {
		return;
	}
	touchHeld.set(actionName, held);
	fireBoolAction(actionName, held);
}

interface HeldTouch {
	actionName: string;
	button: GuiButton;
	input: InputObject;
}

const heldTouches = new Array<HeldTouch>();

function releaseHeldTouch(index: number) {
	const held = heldTouches[index];
	heldTouches.remove(index);
	// Only drop the action if no OTHER finger still holds a button for it.
	for (const other of heldTouches) {
		if (other.actionName === held.actionName) {
			return;
		}
	}
	setTouchHeld(held.actionName, false);
}

function releaseAllTouches() {
	heldTouches.clear();
	for (const name of TOUCH_HOLD_ACTIONS) {
		setTouchHeld(name, false);
	}
}

// Slide-off tolerance: released once the finger is more than half a button
// beyond the button's bounds (also absorbs any inset mismatch between
// InputObject.Position and AbsolutePosition).
function touchStillOverButton(button: GuiButton, position: Vector3): boolean {
	const pos = button.AbsolutePosition;
	const size = button.AbsoluteSize;
	const pad = math.max(size.X, size.Y) * 0.5;
	return (
		position.X >= pos.X - pad &&
		position.X <= pos.X + size.X + pad &&
		position.Y >= pos.Y - pad &&
		position.Y <= pos.Y + size.Y + pad
	);
}

function hookHoldButton(actionName: string, button: GuiButton) {
	button.InputBegan.Connect((input) => {
		if (
			input.UserInputType !== Enum.UserInputType.Touch &&
			input.UserInputType !== Enum.UserInputType.MouseButton1
		) {
			return;
		}
		// Never two records for one button (a stale record would latch).
		for (let i = heldTouches.size() - 1; i >= 0; i--) {
			if (heldTouches[i].button === button) {
				heldTouches.remove(i);
			}
		}
		heldTouches.push({ actionName, button, input });
		setTouchHeld(actionName, true);
	});
}

UserInputService.InputEnded.Connect((input) => {
	if (
		joystickInput === input ||
		(input.UserInputType === Enum.UserInputType.MouseButton1 &&
			joystickInput?.UserInputType === Enum.UserInputType.MouseButton1)
	) {
		resetTouchMovement();
	}
	for (let i = heldTouches.size() - 1; i >= 0; i--) {
		const held = heldTouches[i];
		// Touch: match the exact InputObject. Mouse (Studio touch-less
		// testing): any MouseButton1 up releases every mouse-held button.
		if (
			held.input === input ||
			(input.UserInputType === Enum.UserInputType.MouseButton1 &&
				held.input.UserInputType === Enum.UserInputType.MouseButton1)
		) {
			releaseHeldTouch(i);
		}
	}
});

UserInputService.InputChanged.Connect((input) => {
	if (
		joystickInput === input ||
		(joystickInput?.UserInputType === Enum.UserInputType.MouseButton1 &&
			input.UserInputType === Enum.UserInputType.MouseMovement)
	) {
		updateJoystick(input.Position);
	}
	if (input.UserInputType === Enum.UserInputType.Touch && heldTouches.size() > 0) {
		for (let i = heldTouches.size() - 1; i >= 0; i--) {
			const held = heldTouches[i];
			if (held.input === input && !touchStillOverButton(held.button, input.Position)) {
				releaseHeldTouch(i);
			}
		}
	}
});

// MobileInterface is CLIENT-mounted once at boot (Phase 3,
// src/client/ui/bootstrap.client.ts, ResetOnSpawn=false) — ONE instance for
// the whole session, never recreated. wireTouchButtons is still retried from
// the per-sit maintenance loop until the base buttons exist, because the
// React mount can parent the ScreenGui before its children finish building —
// dot-accessing a button that hadn't arrived yet used to error and kill the
// whole seating thread, leaving visible-but-dead buttons. The
// wiredMobileInterface guard makes the retries idempotent.
let wiredMobileInterface: Instance | undefined = undefined;

function wireTouchButtons(mobileInterface: ScreenGui) {
	if (mobileInterface === wiredMobileInterface) {
		return;
	}
	const boost = mobileInterface.FindFirstChild("Boost");
	const drift = mobileInterface.FindFirstChild("Drift");
	const jump = mobileInterface.FindFirstChild("Jump");
	if (
		!boost ||
		!boost.IsA("GuiButton") ||
		!drift ||
		!drift.IsA("GuiButton") ||
		!jump ||
		!jump.IsA("GuiButton")
	) {
		return; // children still replicating — caller retries
	}
	wiredMobileInterface = mobileInterface;
	// Fresh wiring baseline: nothing may stay held from before the buttons
	// existed.
	releaseAllTouches();
	resetTouchMovement();

	// Boost/Drift/Jump already resolved above (their presence gates the wire).
	hookHoldButton(VehicleInput.Boost, boost);
	hookHoldButton(VehicleInput.Drift, drift);
	hookHoldButton(VehicleInput.Jump, jump);
	task.spawn(() => {
		const driveJoystick = mobileInterface.WaitForChild("DriveJoystick", 10);
		if (!driveJoystick || !driveJoystick.IsA("GuiObject") || wiredMobileInterface !== mobileInterface) {
			return;
		}
		const knob = driveJoystick.WaitForChild("Knob", 10);
		if (knob && knob.IsA("GuiObject") && wiredMobileInterface === mobileInterface) {
			hookDriveJoystick(driveJoystick, knob);
		} else {
			warn("[VehicleKeyHandler] MobileInterface joystick knob missing — touch movement unavailable");
		}
	});
}

// ---------------------------------------------------------------------------
// Stale-input protection
// ---------------------------------------------------------------------------
// IAS action state LATCHES across context disables: while VehicleControls is
// Disabled the engine stops delivering key transitions to the actions, so a
// key that was down when the context got disabled (round end destroys the car
// mid-drive, or a footballMatch control lock) stays `true` forever — the next
// round's car throttles forward on its own, and a latched SteerLeft cancels
// every D press. Whenever Enabled flips we Fire() every action back to the
// truth: neutral on disable, the real hardware state on enable (so a key
// genuinely still held at round start keeps working).

const BOOL_ACTION_NAMES = [
	VehicleInput.ThrottleForward,
	VehicleInput.ThrottleBackward,
	VehicleInput.SteerRight,
	VehicleInput.SteerLeft,
	VehicleInput.Drift,
	VehicleInput.Boost,
	VehicleInput.Jump,
	VehicleInput.RollLeft,
	VehicleInput.RollRight,
];

function keyCodeDown(keyCode: Enum.KeyCode): boolean {
	if (keyCode === Enum.KeyCode.Unknown) {
		return false;
	}
	const name = keyCode.Name;
	if (name.sub(1, 6) === "Button" || name.sub(1, 4) === "DPad" || name.sub(1, 10) === "Thumbstick") {
		return UserInputService.IsGamepadButtonDown(Enum.UserInputType.Gamepad1, keyCode);
	}
	return UserInputService.IsKeyDown(keyCode);
}

function actionHardwareHeld(action: InputAction): boolean {
	for (const child of action.GetChildren()) {
		if (child.IsA("InputBinding") && keyCodeDown(child.KeyCode)) {
			return true;
		}
	}
	return false;
}

function syncActionStates(context: InputContext, toHardware: boolean) {
	const fire = (name: string, value: boolean | number | Vector2) => {
		const action = context.FindFirstChild(name);
		if (action && action.IsA("InputAction")) {
			action.Fire(value);
		}
	};

	for (const name of BOOL_ACTION_NAMES) {
		const action = context.FindFirstChild(name);
		if (action && action.IsA("InputAction")) {
			// A touch button counts as "hardware": a finger already holding
			// an ability when the context re-enables must keep working.
			action.Fire(toHardware && (actionHardwareHeld(action) || touchHeld.get(name) === true));
		}
	}

	// Analog axes: neutral unless a connected gamepad says otherwise.
	let axisThrottle = 0;
	let stick = new Vector2(0, 0);
	if (toHardware && UserInputService.GetGamepadConnected(Enum.UserInputType.Gamepad1)) {
		pcall(() => {
			for (const state of UserInputService.GetGamepadState(Enum.UserInputType.Gamepad1)) {
				if (state.KeyCode === Enum.KeyCode.Thumbstick1) {
					stick = new Vector2(state.Position.X, state.Position.Y);
				} else if (state.KeyCode === Enum.KeyCode.ButtonR2) {
					axisThrottle += state.Position.Z;
				} else if (state.KeyCode === Enum.KeyCode.ButtonL2) {
					axisThrottle -= state.Position.Z;
				}
			}
		});
	}
	fire(VehicleInput.ThrottleAxis, axisThrottle);
	fire(VehicleInput.SteerStick, stick);
	// Preserve a currently-held touch stick across a harmless context re-sync.
	// Its values are already camera-independent screen-space axes.
	const touchActive = toHardware && joystickInput !== undefined;
	fire(VehicleInput.ThrottleTouch, touchActive ? analogThrottle : 0);
	fire(VehicleInput.SteerTouch, touchActive ? analogSteer : 0);
}

task.spawn(() => {
	// The context is built server-side on join and can arrive arbitrarily late
	// (its keybind reads hit DataStore, which throttles under real load) —
	// giving up after a timeout left mobile inputs dead for the whole session,
	// so keep waiting for as long as the session lives.
	let context: InputContext | undefined = undefined;
	let warned = false;
	while (context === undefined) {
		context = Player.WaitForChild(VehicleInput.ContextName, 30) as InputContext | undefined;
		if (!context && !warned) {
			warned = true;
			warn("[VehicleKeyHandler] VehicleControls InputContext still hasn't arrived — waiting");
		}
	}
	vehicleContext = context;
	const adopted = context;
	adopted.GetPropertyChangedSignal("Enabled").Connect(() => syncActionStates(adopted, adopted.Enabled));
	syncActionStates(adopted, adopted.Enabled);

	// Focus changes are the other latch vector (alt-tab / multi-client window
	// switching): a key released while another window has focus never delivers
	// its transition here. Neutral everything on focus loss, and re-sync to the
	// real hardware state on focus gain (a key genuinely still held keeps
	// working).
	UserInputService.WindowFocusReleased.Connect(() => {
		resetTouchMovement();
		syncActionStates(adopted, false);
	});
	UserInputService.WindowFocused.Connect(() => syncActionStates(adopted, adopted.Enabled));
});

// ---------------------------------------------------------------------------
// Seat handling
// ---------------------------------------------------------------------------

let seatedConnection: RBXScriptConnection | undefined = undefined;
let seatPartConnection: RBXScriptConnection | undefined = undefined;

// Whether the drive-mode setup (prediction, horn, mobile UI) is currently
// active, and a token so per-sit background threads stop when the sit ends.
let drivingActive = false;
let seatSession = 0;

// While driving, the Roblox core touch controls steer the Humanoid and use
// camera-relative movement. The car uses its own fixed screen-space joystick,
// so hide the core controls until the player gets out. This is client-side and
// instantly reversible, without touching DevTouchMovementMode
// (which would replicate/persist and still leaves the core jump button) or
// the deprecated ModalEnabled. Walking around out of the car keeps the
// normal joystick. pcall-guarded: purely cosmetic, must never kill seating.
function setCoreTouchControlsEnabled(enabled: boolean) {
	pcall(() => {
		GuiService.TouchControlsEnabled = enabled;
	});
}

function onSeated(humanoid: Humanoid, isSeated: boolean) {
	const session = ++seatSession;
	if (isSeated === true) {
		const seatPart = humanoid.SeatPart;
		if (seatPart === undefined || seatPart.Parent === undefined) {
			return; // evaluateSeating only enters here with a live SeatPart
		}

		// Only manage prediction for actual cars (seat lives in Model.Seats
		// inside a model that has a Base).
		const vehicleModel = seatPart.Parent.Parent;
		if (vehicleModel && vehicleModel.FindFirstChild("Base")) {
			managedVehicle = vehicleModel;
			managedCharacter = Player.Character;
			// Warm the horn asset so the first local-first honk is instant.
			task.spawn(() => {
				const hornSound = vehicleModel.FindFirstChild("Base")!.FindFirstChild("hornSound");
				if (hornSound && hornSound.IsA("Sound") && hornSound.SoundId !== "") {
					pcall(() => game.GetService("ContentProvider").PreloadAsync([hornSound]));
				}
			});
			setPredictionDeep(vehicleModel, Enum.PredictionMode.On);
			if (managedCharacter) {
				setPredictionDeep(managedCharacter, Enum.PredictionMode.On);
			}
			// Keep late arrivals marked, and re-assert the deep mark a couple of
			// times — replication can land descendants for several seconds after
			// the seat edge, and no server-side marking backstops this anymore.
			for (const root of [vehicleModel, managedCharacter]) {
				if (root === undefined) {
					continue;
				}
				predictionWatchers.push(
					root.DescendantAdded.Connect((descendant) => {
						if (canPredict(descendant)) {
							pcall(() => RunService.SetPredictionMode(descendant, Enum.PredictionMode.On));
						}
					}),
				);
			}
			for (const delaySeconds of [1, 3]) {
				task.delay(delaySeconds, () => {
					if (managedVehicle === vehicleModel && vehicleModel.Parent !== undefined) {
						setPredictionDeep(vehicleModel, Enum.PredictionMode.On);
						if (managedCharacter && managedCharacter.Parent !== undefined) {
							setPredictionDeep(managedCharacter, Enum.PredictionMode.On);
						}
					}
				});
			}
			// One-shot diagnostic: the engine's predicted-instance count is the
			// only trustworthy signal (GetPredictionStatus outside a resim pass
			// reports Authoritative even for predicted instances). Expect
			// roughly "car + character"-sized numbers while seated.
			task.delay(2, () => {
				if (managedVehicle === vehicleModel) {
					pcall(() => {
						const predicted = game.GetService("AuroraService").GetPredictedInstances();
						print(`[VehicleKeyHandler] engine predicted-instance count while seated: ${predicted.size()}`);
					});
				}
			});
		}

		// Horn stays on the legacy remote (cosmetic, not part of the sim), but
		// plays locally first — the remote only serves the other clients.
		// The keybind fetch is a yielding RemoteFunction backed by DataStore2 —
		// spawned + pcall'd so a slow or failing server read can neither delay
		// nor kill the rest of the seating setup (it used to run inline BEFORE
		// the mobile block: one throw = no mobile UI for the whole drive).
		task.spawn(() => {
			let hornKey: Enum.KeyCode = Enum.KeyCode.H; // DataStoreDefaults keyBinds.Horn
			pcall(() => {
				hornKey = GetKeyBinding.InvokeServer("Horn") as Enum.KeyCode;
			});
			if (seatSession !== session) {
				return; // sit already ended while the invoke was in flight
			}
			ContextActionService.BindAction("HonkHorn", handleHornAction as never, false, hornKey, Enum.KeyCode.ButtonY);
		});

		if (UserInputService.TouchEnabled) {
			setCoreTouchControlsEnabled(false);
			// MobileInterface is client-mounted at boot (Phase 3) so it exists
			// before any sit — the loop stays to keep the UI enabled/wired from
			// current state for the whole sit instead of sampling once.
			task.spawn(() => {
				const playerGui = Player.WaitForChild("PlayerGui") as PlayerGui;
				while (seatSession === session) {
					const mobileInterface = playerGui.FindFirstChild("MobileInterface");
					if (mobileInterface && mobileInterface.IsA("ScreenGui")) {
						if (!mobileInterface.Enabled) {
							mobileInterface.Enabled = true;
						}
						wireTouchButtons(mobileInterface); // no-op once wired to this instance
					}
					task.wait(0.5);
				}
			});
		}
	} else {
		// When the player gets out:
		for (const watcher of predictionWatchers) {
			watcher.Disconnect();
		}
		predictionWatchers = [];
		if (managedVehicle) {
			setPredictionDeep(managedVehicle, Enum.PredictionMode.Automatic);
			managedVehicle = undefined;
		}
		if (managedCharacter) {
			setPredictionDeep(managedCharacter, Enum.PredictionMode.Automatic);
			managedCharacter = undefined;
		}

		ContextActionService.UnbindAction("HonkHorn");

		if (UserInputService.TouchEnabled) {
			setCoreTouchControlsEnabled(true); // back on foot — restore the normal joystick
			resetTouchMovement();
			// A button still held while exiting must not stay latched.
			releaseAllTouches();
			// FindFirstChild chain (not dot-access): this branch also runs
			// synchronously from connectCharacter's missed-exit cleanup, where a
			// throw would kill the re-connect and leave seating unmonitored.
			const playerGui = Player.FindFirstChild("PlayerGui");
			const mobileInterface = playerGui ? playerGui.FindFirstChild("MobileInterface") : undefined;
			if (mobileInterface && mobileInterface.IsA("ScreenGui")) {
				mobileInterface.Enabled = false;
			}
		}
	}
}

// Seat state is RE-DERIVED from Humanoid.SeatPart instead of trusting the
// one-shot Seated event edge: the server seats the character within a fraction
// of a second of LoadCharacter, so under real load (slow client boot, bad
// ping, replication backlog) the character can arrive on the client ALREADY
// seated — the edge fires before the listener below exists, and nothing ever
// re-checked, leaving a touch player with no mobile UI and no control for the
// entire match. The latch keeps the transitions idempotent however many
// signals report the same state.
function evaluateSeating(humanoid: Humanoid) {
	const seatPart = humanoid.SeatPart;
	const seatedNow = seatPart !== undefined && seatPart.Parent !== undefined;
	if (seatedNow === drivingActive) {
		return;
	}
	drivingActive = seatedNow;
	onSeated(humanoid, seatedNow);
}

function connectCharacter(Character: Model) {
	if (seatedConnection) {
		seatedConnection.Disconnect();
		seatedConnection = undefined;
	}
	if (seatPartConnection) {
		seatPartConnection.Disconnect();
		seatPartConnection = undefined;
	}

	const humanoid = Character.WaitForChild("Humanoid") as Humanoid;
	if (Character !== Player.Character) {
		return; // respawned while waiting — the newer connectCharacter took over
	}
	// Previous character was destroyed while seated (round teardown): its
	// Seated(false) never fired, so run the exit cleanup before re-latching.
	if (drivingActive) {
		drivingActive = false;
		onSeated(humanoid, false);
	}
	seatedConnection = humanoid.Seated.Connect(() => evaluateSeating(humanoid));
	// SeatPart replicating late (or the sit predating this connection) still
	// lands here even though the Seated edge itself was missed.
	seatPartConnection = humanoid.GetPropertyChangedSignal("SeatPart").Connect(() => evaluateSeating(humanoid));
	evaluateSeating(humanoid); // already seated by the time we connected?
}

Player.CharacterAdded.Connect(connectCharacter);
if (Player.Character) {
	task.spawn(() => connectCharacter(Player.Character!));
}

// ---------------------------------------------------------------------------
// V2 drive mode (no seat): derived from the own car's Driving attribute.
// Horn bind + mobile UI mirror the seat path; prediction marking for V2 lives
// in initVehicleSim.client.ts (root/hitboxes On at registration).
// ---------------------------------------------------------------------------

function onV2Driving(vehicleModel: Model, driving: boolean) {
	const session = ++seatSession;
	if (driving) {
		managedVehicle = vehicleModel;
		task.spawn(() => {
			const root = vehicleModel.FindFirstChild("VehicleRoot");
			const hornSound = root ? root.FindFirstChild("hornSound") : undefined;
			if (hornSound && hornSound.IsA("Sound") && hornSound.SoundId !== "") {
				pcall(() => game.GetService("ContentProvider").PreloadAsync([hornSound]));
			}
		});
		task.spawn(() => {
			let hornKey: Enum.KeyCode = Enum.KeyCode.H;
			pcall(() => {
				hornKey = GetKeyBinding.InvokeServer("Horn") as Enum.KeyCode;
			});
			if (seatSession !== session) {
				return;
			}
			ContextActionService.BindAction("HonkHorn", handleHornAction as never, false, hornKey, Enum.KeyCode.ButtonY);
		});
		if (UserInputService.TouchEnabled) {
			setCoreTouchControlsEnabled(false);
			task.spawn(() => {
				const playerGui = Player.WaitForChild("PlayerGui") as PlayerGui;
				while (seatSession === session) {
					const mobileInterface = playerGui.FindFirstChild("MobileInterface");
					if (mobileInterface && mobileInterface.IsA("ScreenGui")) {
						if (!mobileInterface.Enabled) {
							mobileInterface.Enabled = true;
						}
						wireTouchButtons(mobileInterface);
					}
					task.wait(0.5);
				}
			});
		}
	} else {
		managedVehicle = undefined;
		ContextActionService.UnbindAction("HonkHorn");
		if (UserInputService.TouchEnabled) {
			setCoreTouchControlsEnabled(true);
			resetTouchMovement();
			releaseAllTouches();
			const playerGui = Player.FindFirstChild("PlayerGui");
			const mobileInterface = playerGui ? playerGui.FindFirstChild("MobileInterface") : undefined;
			if (mobileInterface && mobileInterface.IsA("ScreenGui")) {
				mobileInterface.Enabled = false;
			}
		}
	}
}

{
	let v2DrivingActive = false;
	const tryHookV2 = (model: Instance) => {
		if (!model.IsA("Model")) {
			return;
		}
		task.spawn(() => {
			// V2 attr + owner marker can land after the ChildAdded edge.
			const t0 = os.clock();
			while (model.Parent !== undefined && os.clock() - t0 < 15) {
				if (model.GetAttribute("V2") !== undefined && model.GetAttribute("OwnerUserId") !== undefined) {
					break;
				}
				task.wait(0.2);
			}
			if (
				model.Parent === undefined ||
				model.GetAttribute("V2") === undefined ||
				model.GetAttribute("OwnerUserId") !== Player.UserId
			) {
				return;
			}
			const root = model.WaitForChild("VehicleRoot", 15);
			if (!root || model.Parent === undefined) {
				return;
			}
			const evaluate = () => {
				const drivingNow = model.Parent !== undefined && root.GetAttribute("Driving") === true;
				if (drivingNow === v2DrivingActive) {
					return;
				}
				v2DrivingActive = drivingNow;
				onV2Driving(model, drivingNow);
			};
			root.GetAttributeChangedSignal("Driving").Connect(evaluate);
			model.AncestryChanged.Connect(() => {
				if (model.Parent === undefined) {
					evaluate();
				}
			});
			evaluate();
		});
	};
	task.spawn(() => {
		const vehicles = game.Workspace.WaitForChild("Vehicles");
		vehicles.ChildAdded.Connect(tryHookV2);
		for (const child of vehicles.GetChildren()) {
			tryHookV2(child);
		}
	});
}

// (The old PlayerGui.ChildAdded re-mount hook is gone — MobileInterface is
// mounted exactly once at boot and never recreated; the per-sit maintenance
// loop in onSeated covers enabling + wiring it for every sit.)

// (Gamepad menu buttons: all fires retired — Phase 5 made X/R1/L1/R2 garage
// navigation client-local in garage.client.ts, Phase 6 made the spectate
// Y-respawn client-local in gameHud.client.ts, and Phase 8 pruned the
// GamePadButton*Down typed accessors from shared/FunctionsAndEvents.ts.)

// ---------------------------------------------------------------------------
// Keybinding menu UI (unchanged — SetKeyBinding now also retargets the live
// IAS binding server-side)
// ---------------------------------------------------------------------------

interface KeyBindButton extends TextButton {
	ImageLabel: ImageLabel;
}

function WaitForKeyBind(button: KeyBindButton) {
	const OldImage = button.ImageLabel.Image;
	button.ImageLabel.Image = "rbxassetid://9960502642";
	let connection: RBXScriptConnection | undefined = undefined;
	legacyWait(0.2);
	connection = UserInputService.InputBegan.Connect((input, gameProcessed) => {
		connection!.Disconnect();

		let inputKey: EnumItem | undefined = undefined;
		if (
			input.UserInputType === Enum.UserInputType.MouseButton1 ||
			input.UserInputType === Enum.UserInputType.MouseButton2 ||
			input.UserInputType === Enum.UserInputType.MouseButton3
		) {
			inputKey = input.UserInputType;
		} else {
			inputKey = input.KeyCode;
		}
		if (keyCodeImages.get(inputKey) !== undefined) {
			button.ImageLabel.Image = "rbxassetid://" + keyCodeImages.get(inputKey);
			SetKeyBinding.InvokeServer(button.Name, inputKey);
		} else {
			print("NoImageForKeyCode");
			button.ImageLabel.Image = OldImage;
		}
	});
}

function OpenKeyBindMenu(keyBindingsMenu: Frame & { Controls: Frame; CloseButton: GuiButton }) {
	keyBindingsMenu.Visible = true;
	for (const button of keyBindingsMenu.Controls.GetChildren()) {
		if (button.IsA("TextButton")) {
			(button as KeyBindButton).ImageLabel.Image =
				"rbxassetid://" + keyCodeImages.get(GetKeyBinding.InvokeServer(button.Name) as unknown as EnumItem);
			button.MouseButton1Down.Connect(() => {
				WaitForKeyBind(button as KeyBindButton);
			});
		}
	}
	keyBindingsMenu.CloseButton.MouseButton1Down.Connect(() => {
		keyBindingsMenu.Visible = false;
	});
}

const wiredMenuGuis = new Set<Instance>();

function wireMenuGui(descendant: Instance) {
	if (wiredMenuGuis.has(descendant)) {
		return;
	}
	if (descendant.Name === "Garage") {
		wiredMenuGuis.add(descendant);
		const openKeyBindingsButton = descendant
			.WaitForChild("Inventory")
			.WaitForChild("Buttons")
			.WaitForChild("KeyBindings") as GuiButton;
		const keyBindingsMenu = descendant.WaitForChild("KeyBindingsMenu") as Frame & {
			Controls: Frame;
			CloseButton: GuiButton;
		};
		openKeyBindingsButton.MouseButton1Click.Connect(() => {
			OpenKeyBindMenu(keyBindingsMenu);
		});
	} else if (descendant.Name === "Game") {
		wiredMenuGuis.add(descendant);
		const ControlsMenu = descendant.WaitForChild("Controls");
		for (const button of ControlsMenu.GetChildren()) {
			if (button.IsA("TextButton")) {
				if (
					GuiService.IsTenFootInterface() &&
					(GetKeyBinding.InvokeServer(button.Name) as unknown) === Enum.UserInputType.MouseButton1
				) {
					SetKeyBinding.InvokeServer(button.Name, Enum.KeyCode.R);
				}
				pcall(() => {
					(button.WaitForChild("ImageLabel", 5) as ImageLabel).Image =
						"rbxassetid://" + keyCodeImages.get(GetKeyBinding.InvokeServer(button.Name) as unknown as EnumItem);
				});
			}
		}
	}
}

{
	const playerGui = (Player as unknown as { PlayerGui: Instance }).PlayerGui;
	playerGui.DescendantAdded.Connect((descendant) => task.spawn(() => wireMenuGui(descendant)));
	// Phase 5: the Garage is CLIENT-mounted once at boot (bootstrap.client.ts)
	// and may already exist before this connection lands — scan what's there.
	for (const child of playerGui.GetChildren()) {
		task.spawn(() => wireMenuGui(child));
	}
}
