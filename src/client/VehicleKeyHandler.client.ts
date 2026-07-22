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

// MobileInterface is recreated (ResetOnSpawn) on every character respawn, so
// this must re-wire whenever the instance changes — called on every seating
// and whenever a fresh MobileInterface arrives in PlayerGui.
let wiredMobileInterface: Instance | undefined = undefined;

function wireTouchButtons() {
	const mobileInterface = (Player.WaitForChild("PlayerGui") as PlayerGui).FindFirstChild("MobileInterface") as
		| ScreenGui
		| undefined;
	if (!mobileInterface || mobileInterface === wiredMobileInterface) {
		return;
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

	hook(VehicleInput.Boost, mobileInterface, "Boost");
	hook(VehicleInput.Drift, mobileInterface, "Drift");
	hook(VehicleInput.Jump, mobileInterface, "Jump");
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
	vehicleContext = Player.WaitForChild(VehicleInput.ContextName, 60) as InputContext | undefined;
	if (!vehicleContext) {
		warn("[VehicleKeyHandler] no VehicleControls InputContext arrived — vehicle inputs will be dead");
		return;
	}
	const context = vehicleContext;
	context.GetPropertyChangedSignal("Enabled").Connect(() => syncActionStates(context, context.Enabled));
	syncActionStates(context, context.Enabled);

	// Focus changes are the other latch vector (alt-tab / multi-client window
	// switching): a key released while another window has focus never delivers
	// its transition here. Neutral everything on focus loss, and re-sync to the
	// real hardware state on focus gain (a key genuinely still held keeps
	// working).
	UserInputService.WindowFocusReleased.Connect(() => syncActionStates(context, false));
	UserInputService.WindowFocused.Connect(() => syncActionStates(context, context.Enabled));
});

// ---------------------------------------------------------------------------
// Seat handling
// ---------------------------------------------------------------------------

let seatedConnection: RBXScriptConnection | undefined = undefined;

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
	if (isSeated === true) {
		while (humanoid.SeatPart === undefined) {
			task.wait();
		}
		while (humanoid.SeatPart!.Parent === undefined) {
			task.wait();
		}

		// Only manage prediction for actual cars (seat lives in Model.Seats
		// inside a model that has a Base).
		const vehicleModel = humanoid.SeatPart!.Parent!.Parent;
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
		ContextActionService.BindAction(
			"HonkHorn",
			handleHornAction as never,
			false,
			GetKeyBinding.InvokeServer("Horn") as Enum.KeyCode,
			Enum.KeyCode.ButtonY,
		);

		if (UserInputService.TouchEnabled) {
			touchSeated = true;
			setCoreTouchControlsEnabled(false); // the humanoid thumbstick is useless in a car
			// The joystick sampler stays bound as a fallback: with the core
			// controls hidden MoveDirection is always zero, so it fires nothing.
			RunService.BindToRenderStep("MobileSteer", 1, mobileSteerFunction);
			task.spawn(() => {
				// The interface may not have mounted yet (the server React
				// render races the first seat) and is recreated on every
				// respawn — wait for it, then show and (re)wire.
				const playerGui = Player.WaitForChild("PlayerGui") as PlayerGui;
				const mobileInterface = playerGui.WaitForChild("MobileInterface", 30) as ScreenGui | undefined;
				if (!mobileInterface) {
					warn("[VehicleKeyHandler] MobileInterface never arrived — no touch controls this drive");
					return;
				}
				if (touchSeated) {
					mobileInterface.Enabled = true;
					wireTouchButtons(); // re-wires if the interface was recreated on respawn
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
			const mobileInterface = (Player as unknown as { PlayerGui: Instance }).PlayerGui.FindFirstChild(
				"MobileInterface",
			) as ScreenGui | undefined;
			if (mobileInterface) {
				mobileInterface.Enabled = false;
			}
		}
	}
}

function connectCharacter(Character: Model) {
	if (seatedConnection) {
		seatedConnection.Disconnect();
	}

	const humanoid = Character.WaitForChild("Humanoid") as Humanoid;
	seatedConnection = humanoid.Seated.Connect((isSeated) => {
		onSeated(humanoid, isSeated);
	});
}

Player.CharacterAdded.Connect(connectCharacter);
if (Player.Character) {
	task.spawn(() => connectCharacter(Player.Character!));
}

// Remount robustness: the server destroys/recreates MobileInterface on every
// respawn (ResetOnSpawn) and the timing races the seat events. If a fresh
// instance arrives while we are already driving, show and re-wire it instead
// of driving blind with no buttons for the rest of the round.
if (UserInputService.TouchEnabled) {
	task.spawn(() => {
		const playerGui = Player.WaitForChild("PlayerGui") as PlayerGui;
		playerGui.ChildAdded.Connect((child) => {
			if (child.Name === "MobileInterface" && child.IsA("ScreenGui")) {
				task.defer(() => {
					if (touchSeated && child.Parent === playerGui) {
						child.Enabled = true;
						wireTouchButtons();
					}
				});
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Gamepad menu buttons (unchanged)
// ---------------------------------------------------------------------------

UserInputService.InputBegan.Connect((input, gameProcessed) => {
	if (input.UserInputType === Enum.UserInputType.Gamepad1) {
		if (input.KeyCode === Enum.KeyCode.ButtonX) {
			FunctionsAndEvents.GamePadButtonXDown.FireServer();
		} else if (input.KeyCode === Enum.KeyCode.ButtonY) {
			FunctionsAndEvents.GamePadButtonYDown.FireServer();
		} else if (input.KeyCode === Enum.KeyCode.ButtonR2) {
			FunctionsAndEvents.GamePadButtonR2Down.FireServer();
		} else if (input.KeyCode === Enum.KeyCode.ButtonB) {
			FunctionsAndEvents.GamePadButtonBDown.FireServer();
		} else if (input.KeyCode === Enum.KeyCode.ButtonR1) {
			FunctionsAndEvents.GamePadButtonR1Down.FireServer();
		} else if (input.KeyCode === Enum.KeyCode.ButtonL1) {
			FunctionsAndEvents.GamePadButtonL1Down.FireServer();
		}
	}
});

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

(Player as unknown as { PlayerGui: Instance }).PlayerGui.DescendantAdded.Connect((descendant) => {
	if (descendant.Name === "Garage") {
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
});

FunctionsAndEvents.GetPlayerPointToScreenSpace.OnClientInvoke = (position) => {
	const camera = game.Workspace.CurrentCamera!;
	const [vector, onScreen] = camera.WorldToScreenPoint(position as Vector3);
	return vector;
};
