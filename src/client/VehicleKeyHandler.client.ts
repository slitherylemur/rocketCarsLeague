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
// Under Workspace.AuthorityMode = Server the local character is predicted by
// default. Seating welds it into the car assembly, and the engine cannot
// predict half an assembly. Until the shared sim runs on the client too
// (Phase 4), the stable configuration is NO prediction around the car: both
// the car and the character are forced to PredictionMode.Off while seated and
// revert to Automatic on exit. The server sets the same modes (spawnVehicle);
// every call is pcall-guarded so this is a no-op without server authority.

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
// input stream). MobileInterface is recreated from StarterGui on every
// character respawn, so this must re-wire whenever the instance changes —
// it's called on every seating.
let wiredMobileInterface: Instance | undefined = undefined;

function wireTouchButtons() {
	const mobileInterface = (Player.WaitForChild("PlayerGui") as PlayerGui).FindFirstChild("MobileInterface") as
		| (ScreenGui & { Jump: TextButton; Drift: TextButton; Boost: TextButton })
		| undefined;
	if (!mobileInterface || mobileInterface === wiredMobileInterface) {
		return;
	}
	wiredMobileInterface = mobileInterface;

	const hook = (actionName: string, button: GuiButton) => {
		button.MouseButton1Down.Connect(() => fireBoolAction(actionName, true));
		button.MouseButton1Up.Connect(() => fireBoolAction(actionName, false));
	};
	hook(VehicleInput.Boost, mobileInterface.Boost);
	hook(VehicleInput.Drift, mobileInterface.Drift);
	hook(VehicleInput.Jump, mobileInterface.Jump);
}

task.spawn(() => {
	vehicleContext = Player.WaitForChild(VehicleInput.ContextName, 60) as InputContext | undefined;
	if (!vehicleContext) {
		warn("[VehicleKeyHandler] no VehicleControls InputContext arrived — vehicle inputs will be dead");
	}
});

// ---------------------------------------------------------------------------
// Seat handling
// ---------------------------------------------------------------------------

let seatedConnection: RBXScriptConnection | undefined = undefined;

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
			setPredictionDeep(vehicleModel, Enum.PredictionMode.Off);
			if (managedCharacter) {
				setPredictionDeep(managedCharacter, Enum.PredictionMode.Off);
			}
			task.delay(1, () => {
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
		}

		// Horn stays on the legacy remote (cosmetic, not part of the sim).
		ContextActionService.BindAction(
			"HonkHorn",
			handleAction as never,
			false,
			GetKeyBinding.InvokeServer("Horn") as Enum.KeyCode,
			Enum.KeyCode.ButtonY,
		);

		if (UserInputService.TouchEnabled) {
			RunService.BindToRenderStep("MobileSteer", 1, mobileSteerFunction);
			const mobileInterface = (Player as unknown as { PlayerGui: Instance }).PlayerGui.FindFirstChild(
				"MobileInterface",
			) as ScreenGui | undefined;
			if (mobileInterface) {
				mobileInterface.Enabled = true;
			}
			wireTouchButtons(); // re-wires if the interface was recreated on respawn
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
