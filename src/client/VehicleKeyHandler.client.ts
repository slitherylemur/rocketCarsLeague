// Original: StarterPlayer/StarterPlayerScripts/VehicleKeyHandler (LocalScript)
//
// Restored to the server-authoritative input model (bumperCars a5318d46):
// this script only reads input and forwards it to the server —
//   * movement floats via the per-vehicle `inputChangedEvent` RemoteEvent
//   * ability keys (Drift/Boost/Jump/Horn/Rolls) via the KeyHandler RemoteEvent
// All physics runs in the server VehicleClass drive loop.
//
// Deliberate divergence from a5318d46: throttle/steer are derived from
// per-key held state instead of the original +1/-1 accumulators. The
// accumulator desynced permanently whenever an End event was missed or CAS
// delivered UserInputState.Cancel (the "stuck input / weird simultaneous
// keys" bugs); held-state cannot drift.

import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import keyCodeImages from "shared/KeyCodeImages";
import { legacyWait } from "shared/LegacyTiming";

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
// Movement input → inputChangedEvent
// ---------------------------------------------------------------------------

interface HeldKeys {
	forward: boolean;
	backward: boolean;
	left: boolean;
	right: boolean;
}

const held: HeldKeys = { forward: false, backward: false, left: false, right: false };
let analogSteer = 0; // thumbstick / mobile joystick
let analogThrottle = 0; // mobile joystick

let inputEvent: RemoteEvent | undefined = undefined;
let lastSentThrottle = 0;
let lastSentSteer = 0;

function computeThrottle(): number {
	const digital = (held.forward ? 1 : 0) - (held.backward ? 1 : 0);
	return digital !== 0 ? digital : math.clamp(analogThrottle, -1, 1);
}

function computeSteer(): number {
	const digital = (held.right ? 1 : 0) - (held.left ? 1 : 0);
	return digital !== 0 ? digital : math.clamp(analogSteer, -1, 1);
}

function sendMovement(force?: boolean) {
	if (!inputEvent) {
		return;
	}
	const throttle = computeThrottle();
	const steer = computeSteer();
	if (force || throttle !== lastSentThrottle || steer !== lastSentSteer) {
		lastSentThrottle = throttle;
		lastSentSteer = steer;
		inputEvent.FireServer(throttle, steer);
	}
}

function resetMovementState() {
	held.forward = false;
	held.backward = false;
	held.left = false;
	held.right = false;
	analogSteer = 0;
	analogThrottle = 0;
	lastSentThrottle = 0;
	lastSentSteer = 0;
}

// Any state that isn't Begin (End, Cancel, …) counts as released — a missed
// or cancelled key can therefore never wedge the car in a driving state.
function makeMovementHandler(key: keyof HeldKeys) {
	return (actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) => {
		held[key] = inputState === Enum.UserInputState.Begin;
		sendMovement();
	};
}

const forward = makeMovementHandler("forward");
const backwards = makeMovementHandler("backward");
const left = makeMovementHandler("left");
const right = makeMovementHandler("right");

function controllerSteer(actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) {
	if (inputObject === undefined) {
		return;
	}
	if (inputState === Enum.UserInputState.End || inputState === Enum.UserInputState.Cancel) {
		analogSteer = 0;
	} else if (math.abs(inputObject.Position.X) < 0.3) {
		analogSteer = 0;
	} else {
		analogSteer = inputObject.Position.X;
	}
	sendMovement();
}

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
			sendMovement();
		}
	}
}

const MOVEMENT_ACTIONS = ["Forward", "Backwards", "Left", "Right", "ControllerSteer"];

// ---------------------------------------------------------------------------
// Server authority: prediction management while seated
// ---------------------------------------------------------------------------
// Under Workspace.AuthorityMode = Server the local character is predicted by
// default. Seating welds it into the car assembly, and the engine cannot
// predict half an assembly: it emits "Instance ... is not predicted" for the
// car's parts/constraints and the resulting render fight shows up as the car
// hovering and bobbing.
//
// Until the shared simulation module exists (SERVER_AUTHORITY_PLAN.md Phases
// 2-4), the stable configuration is NO prediction around the car: while
// seated, both the car and the character are forced to PredictionMode.Off so
// the client renders pure authoritative server state. Both revert to
// Automatic on exit. The same modes are also set server-side in spawnVehicle
// (the docs don't say which side owns the flag); every call is pcall-guarded
// so this is a no-op without server authority.

let managedVehicle: Instance | undefined = undefined;
let managedCharacter: Instance | undefined = undefined;

function setPredictionDeep(root: Instance, mode: Enum.PredictionMode) {
	const [ok, err] = pcall(() => {
		RunService.SetPredictionMode(root, mode);
		for (const descendant of root.GetDescendants()) {
			RunService.SetPredictionMode(descendant, mode);
		}
	});
	if (!ok) {
		warn(`[VehicleKeyHandler] SetPredictionMode(${mode}) failed: ${err}`);
	}
}

function logPredictionStatus(label: string, instance: Instance) {
	pcall(() => {
		print(`[VehicleKeyHandler] prediction status of ${label}: ${RunService.GetPredictionStatus(instance)}`);
	});
}

function connectMovementControls(seat: BasePart) {
	resetMovementState();

	const vehicleModel = seat.Parent!.Parent!;
	inputEvent = vehicleModel.WaitForChild("inputChangedEvent", 5) as RemoteEvent | undefined;
	if (!inputEvent) {
		warn(`[VehicleKeyHandler] no inputChangedEvent on ${vehicleModel.GetFullName()}`);
		return;
	}

	managedVehicle = vehicleModel;
	managedCharacter = Player.Character;
	setPredictionDeep(vehicleModel, Enum.PredictionMode.Off);
	if (managedCharacter) {
		setPredictionDeep(managedCharacter, Enum.PredictionMode.Off);
	}
	task.delay(1, () => {
		// Diagnostic: confirm the engine honored the modes (expect no
		// "Instance ... is not predicted" spam and no bobbing when it did).
		if (managedVehicle === vehicleModel) {
			const base = vehicleModel.FindFirstChild("Base");
			if (base) {
				logPredictionStatus("vehicle Base", base);
			}
			const root = managedCharacter ? managedCharacter.FindFirstChild("HumanoidRootPart") : undefined;
			if (root) {
				logPredictionStatus("HumanoidRootPart", root);
			}
		}
	});

	ContextActionService.BindAction("Forward", forward as never, false, Enum.KeyCode.W, Enum.KeyCode.ButtonR2);
	ContextActionService.BindAction("Backwards", backwards as never, false, Enum.KeyCode.S, Enum.KeyCode.ButtonL2);
	ContextActionService.BindAction("Left", left as never, false, Enum.KeyCode.A);
	ContextActionService.BindAction("Right", right as never, false, Enum.KeyCode.D);

	ContextActionService.BindAction("ControllerSteer", controllerSteer as never, false, Enum.KeyCode.Thumbstick1);

	if (UserInputService.TouchEnabled) {
		RunService.BindToRenderStep("MobileSteer", 1, mobileSteerFunction);
	}
}

function disconnectMovementControls() {
	if (managedVehicle) {
		setPredictionDeep(managedVehicle, Enum.PredictionMode.Automatic);
		managedVehicle = undefined;
	}
	if (managedCharacter) {
		setPredictionDeep(managedCharacter, Enum.PredictionMode.Automatic);
		managedCharacter = undefined;
	}

	for (const action of MOVEMENT_ACTIONS) {
		ContextActionService.UnbindAction(action);
	}
	if (UserInputService.TouchEnabled) {
		pcall(() => {
			RunService.UnbindFromRenderStep("MobileSteer");
		});
	}

	// Zero the server-side floats before dropping the event reference, so a
	// re-seated (or killed) vehicle never keeps stale input.
	if (inputEvent && inputEvent.Parent) {
		inputEvent.FireServer(0, 0);
	}
	inputEvent = undefined;
	resetMovementState();
}

// ---------------------------------------------------------------------------
// Mobile ability buttons (connected once — the original reconnected them on
// every seating, stacking duplicate handlers)
// ---------------------------------------------------------------------------

interface MobileInterfaceShape extends ScreenGui {
	Jump: TextButton;
	Drift: TextButton;
	Boost: TextButton;
}

if (UserInputService.TouchEnabled) {
	task.spawn(() => {
		const mobileInterface = (Player.WaitForChild("PlayerGui") as PlayerGui).WaitForChild(
			"MobileInterface",
			30,
		) as MobileInterfaceShape | undefined;
		if (!mobileInterface) {
			return;
		}

		mobileInterface.Boost.MouseButton1Down.Connect(() => handleAction("Boost", Enum.UserInputState.Begin));
		mobileInterface.Boost.MouseButton1Up.Connect(() => handleAction("Boost", Enum.UserInputState.End));

		mobileInterface.Drift.MouseButton1Down.Connect(() => handleAction("Drift", Enum.UserInputState.Begin));
		mobileInterface.Drift.MouseButton1Up.Connect(() => handleAction("Drift", Enum.UserInputState.End));

		mobileInterface.Jump.MouseButton1Down.Connect(() => handleAction("Jump1", Enum.UserInputState.Begin));
		mobileInterface.Jump.MouseButton1Up.Connect(() => handleAction("Jump1", Enum.UserInputState.End));
	});
}

// ---------------------------------------------------------------------------
// Seat handling
// ---------------------------------------------------------------------------

let seatedConnection: RBXScriptConnection | undefined = undefined;
let jumpGamepadConnection: RBXScriptConnection | undefined = undefined;

function onSeated(humanoid: Humanoid, isSeated: boolean) {
	if (isSeated === true) {
		while (humanoid.SeatPart === undefined) {
			task.wait();
		}
		while (humanoid.SeatPart!.Parent === undefined) {
			task.wait();
		}

		// Only vehicle seats belonging to a car model carry the input event;
		// connectMovementControls warns and bails for anything else.
		connectMovementControls(humanoid.SeatPart!);

		ContextActionService.BindAction(
			"HonkHorn",
			handleAction as never,
			false,
			GetKeyBinding.InvokeServer("Horn") as Enum.KeyCode,
			Enum.KeyCode.ButtonY,
		);
		ContextActionService.BindAction(
			"Drift",
			handleAction as never,
			false,
			GetKeyBinding.InvokeServer("Drift") as Enum.KeyCode,
			Enum.KeyCode.ButtonL1,
		);
		ContextActionService.BindAction(
			"Boost",
			handleAction as never,
			false,
			GetKeyBinding.InvokeServer("Boost") as Enum.KeyCode,
			Enum.KeyCode.ButtonR1,
		);
		ContextActionService.BindAction(
			"Jump1",
			handleAction as never,
			false,
			GetKeyBinding.InvokeServer("Jump") as Enum.KeyCode,
		);

		// ButtonA doubles as UI "accept"; the original only bound it after the
		// first press while seated, to avoid stealing menu navigation.
		if (jumpGamepadConnection) {
			jumpGamepadConnection.Disconnect();
		}
		jumpGamepadConnection = UserInputService.InputBegan.Connect((input) => {
			if (input.KeyCode === Enum.KeyCode.ButtonA) {
				jumpGamepadConnection!.Disconnect();
				jumpGamepadConnection = undefined;
				ContextActionService.BindAction("Jump2", handleAction as never, false, Enum.KeyCode.ButtonA);
			}
		});

		ContextActionService.BindAction(
			"RollLeft",
			handleAction as never,
			false,
			GetKeyBinding.InvokeServer("RollLeft") as Enum.KeyCode,
			Enum.KeyCode.ButtonL3,
		);
		ContextActionService.BindAction(
			"RollRight",
			handleAction as never,
			false,
			GetKeyBinding.InvokeServer("RollRight") as Enum.KeyCode,
			Enum.KeyCode.ButtonR3,
		);

		if (UserInputService.TouchEnabled) {
			const mobileInterface = (Player as unknown as { PlayerGui: Instance }).PlayerGui.FindFirstChild(
				"MobileInterface",
			) as ScreenGui | undefined;
			if (mobileInterface) {
				mobileInterface.Enabled = true;
			}
		}
	} else {
		// When the player gets out:
		disconnectMovementControls();

		ContextActionService.UnbindAction("FlipVehicle");
		ContextActionService.UnbindAction("HonkHorn");
		ContextActionService.UnbindAction("Drift");
		ContextActionService.UnbindAction("Boost");
		ContextActionService.UnbindAction("RollLeft");
		ContextActionService.UnbindAction("RollRight");

		pcall(() => {
			ContextActionService.UnbindAction("Jump1");
		});
		pcall(() => {
			ContextActionService.UnbindAction("Jump2");
		});
		if (jumpGamepadConnection) {
			jumpGamepadConnection.Disconnect();
			jumpGamepadConnection = undefined;
		}

		if (UserInputService.TouchEnabled) {
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
// Keybinding menu UI (unchanged)
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
