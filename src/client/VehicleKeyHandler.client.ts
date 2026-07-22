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
// input stream). MobileInterface is destroyed and re-mounted server-side on
// every spawn, so this must re-wire whenever the instance changes — it's
// retried from the per-sit maintenance loop until the buttons exist (the
// ScreenGui and its children can replicate over several frames; dot-accessing
// a button that hadn't arrived yet used to error and kill the whole seating
// thread, leaving visible-but-dead buttons).
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

	const hook = (actionName: string, button: GuiButton) => {
		button.MouseButton1Down.Connect(() => fireBoolAction(actionName, true));
		button.MouseButton1Up.Connect(() => fireBoolAction(actionName, false));
	};
	hook(VehicleInput.Boost, boost);
	hook(VehicleInput.Drift, drift);
	hook(VehicleInput.Jump, jump);
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
			action.Fire(toHardware && actionHardwareHeld(action));
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
			// Idempotent re-bind: a missed exit edge (character destroyed while
			// seated) can leave the old binding behind.
			pcall(() => {
				RunService.UnbindFromRenderStep("MobileSteer");
			});
			RunService.BindToRenderStep("MobileSteer", 1, mobileSteerFunction);
			// The server destroys + re-mounts MobileInterface on every spawn and
			// it can replicate AFTER the sit does — keep the UI enabled/wired
			// from current state for the whole sit instead of sampling once.
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
			pcall(() => {
				RunService.UnbindFromRenderStep("MobileSteer");
			});
			resetTouchMovement();
			// A button still held while exiting must not stay latched.
			fireBoolAction(VehicleInput.Boost, false);
			fireBoolAction(VehicleInput.Drift, false);
			fireBoolAction(VehicleInput.Jump, false);
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
