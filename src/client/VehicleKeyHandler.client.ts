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
//   - gamepad menu buttons + GetPlayerPointToScreenSpace (unchanged)

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
	const base = vehicle.FindFirstChild("Base");
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

function mobileSteerFunction() {
	if (Player.Character) {
		const humanoid = Player.Character.FindFirstChildOfClass("Humanoid");
		const root = Player.Character.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
		if (!humanoid || !root) {
			return;
		}
		const MoveDirection = humanoid.MoveDirection;
		const newMoveVector = root.CFrame.VectorToObjectSpace(MoveDirection);

		if (math.abs(newMoveVector.X - analogSteer) > 0.2 || math.abs(-newMoveVector.Z - analogThrottle) > 0.2) {
			analogSteer = newMoveVector.X;
			analogThrottle = -newMoveVector.Z;
			fireTouchAction(VehicleInput.SteerTouch, math.clamp(analogSteer, -1, 1));
			fireTouchAction(VehicleInput.ThrottleTouch, math.clamp(analogThrottle, -1, 1));
		}
	}
}

function resetTouchMovement() {
	analogSteer = 0;
	analogThrottle = 0;
	fireTouchAction(VehicleInput.SteerTouch, 0);
	fireTouchAction(VehicleInput.ThrottleTouch, 0);
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

// Wire the MobileInterface buttons to Fire() the Bool actions — the same
// programmatic path the mobile joystick uses (proven to reach the server's
// input stream). Every touch button is named after the InputAction it drives:
// the left MovePad cluster fires ThrottleForward/ThrottleBackward/SteerLeft/
// SteerRight (the exact actions W/S/A/D bind to, so ground drive and aerial
// pitch/yaw behave identically to keyboard) and the right side fires
// Boost/Drift/Jump/RollLeft/RollRight.
//
// Press semantics: press-and-hold, multi-touch safe (steer while
// accelerating). Each press records its InputObject — touch InputObjects
// keep their identity for the whole gesture, so the release matches exactly
// the finger that pressed. A finger that slides well off a button releases
// it (buttons must never stay latched), but small drift keeps the press.

const TOUCH_HOLD_ACTIONS = [
	VehicleInput.ThrottleForward,
	VehicleInput.ThrottleBackward,
	VehicleInput.SteerLeft,
	VehicleInput.SteerRight,
	VehicleInput.Drift,
	VehicleInput.Boost,
	VehicleInput.Jump,
	VehicleInput.RollLeft,
	VehicleInput.RollRight,
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
	if (input.UserInputType !== Enum.UserInputType.Touch || heldTouches.size() === 0) {
		return;
	}
	for (let i = heldTouches.size() - 1; i >= 0; i--) {
		const held = heldTouches[i];
		if (held.input === input && !touchStillOverButton(held.button, input.Position)) {
			releaseHeldTouch(i);
		}
	}
});

// MobileInterface is CLIENT-mounted once at boot now (Phase 3,
// src/client/ui/bootstrap.client.ts, ResetOnSpawn=false) — one instance for
// the whole session. The re-wire-on-instance-change machinery below predates
// that and stays as harmless robustness: it's retried from the per-sit
// maintenance loop (and the PlayerGui.ChildAdded hook, which now fires at
// most once at boot) until the base buttons exist — the React mount can
// parent the ScreenGui before its children finish building, and dot-accessing
// a button that hadn't arrived yet used to error and kill the whole seating
// thread, leaving visible-but-dead buttons.
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
	// The old instance (and its connections) is gone; nothing may stay held.
	releaseAllTouches();

	// The server React mount can parent the ScreenGui before its children
	// finish building — wait for each button instead of dot-indexing.
	const hook = (actionName: string, parent: Instance, buttonName: string) => {
		task.spawn(() => {
			const button = parent.WaitForChild(buttonName, 10);
			if (wiredMobileInterface !== mobileInterface) {
				return; // a newer interface replaced this one while waiting
			}
			if (button && button.IsA("GuiButton")) {
				hookHoldButton(actionName, button);
			} else {
				warn(`[VehicleKeyHandler] MobileInterface button ${buttonName} missing — touch control dead`);
			}
		});
	};
	// Boost/Drift/Jump already resolved above (their presence gates the wire);
	// the MovePad cluster and roll buttons may still be replicating — hook()
	// waits for each.
	hookHoldButton(VehicleInput.Boost, boost);
	hookHoldButton(VehicleInput.Drift, drift);
	hookHoldButton(VehicleInput.Jump, jump);
	hook(VehicleInput.RollLeft, mobileInterface, VehicleInput.RollLeft);
	hook(VehicleInput.RollRight, mobileInterface, VehicleInput.RollRight);
	task.spawn(() => {
		const movePad = mobileInterface.WaitForChild("MovePad", 10);
		if (!movePad || wiredMobileInterface !== mobileInterface) {
			return;
		}
		hook(VehicleInput.ThrottleForward, movePad, VehicleInput.ThrottleForward);
		hook(VehicleInput.ThrottleBackward, movePad, VehicleInput.ThrottleBackward);
		hook(VehicleInput.SteerLeft, movePad, VehicleInput.SteerLeft);
		hook(VehicleInput.SteerRight, movePad, VehicleInput.SteerRight);
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
			// the MovePad when the context re-enables (kickoff control-lock
			// lifting) must keep working, exactly like a held key does.
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
	// The mobile joystick sampler re-fires these from MoveDirection once its
	// deltas exceed the threshold — resetting its cache keeps it honest.
	fire(VehicleInput.ThrottleTouch, 0);
	fire(VehicleInput.SteerTouch, 0);
	analogSteer = 0;
	analogThrottle = 0;
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
	UserInputService.WindowFocusReleased.Connect(() => syncActionStates(adopted, false));
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

// True while seated in a vehicle on a touch device — gates the async
// MobileInterface enable (the interface can mount AFTER the seat event) and
// the PlayerGui.ChildAdded re-mount below.
let touchSeated = false;

// While driving, the Roblox core touch controls (dynamic thumbstick + jump
// button) steer the HUMANOID, not the car — next to the custom MovePad they
// are pure noise. GuiService.TouchControlsEnabled hides them entirely,
// client-side and instantly reversible, without touching DevTouchMovementMode
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
			touchSeated = true;
			setCoreTouchControlsEnabled(false); // the humanoid thumbstick is useless in a car
			// Idempotent re-bind: a missed exit edge (character destroyed while
			// seated) can leave the old binding behind.
			pcall(() => {
				RunService.UnbindFromRenderStep("MobileSteer");
			});
			// The joystick sampler stays bound as a fallback: with the core
			// controls hidden MoveDirection is always zero, so it fires nothing.
			RunService.BindToRenderStep("MobileSteer", 1, mobileSteerFunction);
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
			touchSeated = false;
			setCoreTouchControlsEnabled(true); // back on foot — restore the normal joystick
			pcall(() => {
				RunService.UnbindFromRenderStep("MobileSteer");
			});
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

// Remount robustness: MobileInterface is client-mounted once at boot (Phase 3)
// so this ChildAdded simply fires once when bootstrap parents it. Kept in case
// a fresh instance ever arrives while already driving — show and re-wire it
// instead of driving blind with no buttons for the rest of the round.
if (UserInputService.TouchEnabled) {
	task.spawn(() => {
		const playerGui = Player.WaitForChild("PlayerGui") as PlayerGui;
		playerGui.ChildAdded.Connect((child) => {
			if (child.Name === "MobileInterface" && child.IsA("ScreenGui")) {
				task.defer(() => {
					if (touchSeated && child.Parent === playerGui) {
						child.Enabled = true;
						wireTouchButtons(child);
					}
				});
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Gamepad menu buttons
// ---------------------------------------------------------------------------
// Phase 6: nothing is fired to the server any more. Phase 5 stopped
// X/R1/L1/R2 (garage navigation went client-local in garage.client.ts); the
// last Y consumer — the spectate-screen respawn — is client-local now too
// (gameHud.client.ts fires Intent_ReturnToMenu on Y while spectating), and B
// has had no server consumer for a long time, so both fires are gone. The
// GamePadButtonYDown/BDown remotes themselves are Phase 8 demolition
// candidates.

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

// Phase 3: the server's only caller (VehicleClass money popups) now fires
// Ui_MoneyGained with a WORLD point instead of invoking this — the handler is
// kept for safety and is slated for retirement with the remote in Phase 8.
FunctionsAndEvents.GetPlayerPointToScreenSpace.OnClientInvoke = (position) => {
	const camera = game.Workspace.CurrentCamera!;
	const [vector, onScreen] = camera.WorldToScreenPoint(position as Vector3);
	return vector;
};
