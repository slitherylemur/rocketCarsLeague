// Original: StarterPlayer/StarterPlayerScripts/VehicleKeyHandler (LocalScript)

import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import keyCodeImages from "shared/KeyCodeImages";
import { legacyWait } from "shared/LegacyTiming";

const ContextActionService = game.GetService("ContextActionService");
const Players = game.GetService("Players");
const Player = Players.LocalPlayer;

const handleAction = (actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) => {
	FunctionsAndEvents.KeyHandler.FireServer(actionName, inputState, inputObject);
};
const UserInputService = game.GetService("UserInputService");

let seatedConnection: RBXScriptConnection | undefined = undefined;

const GuiService = game.GetService("GuiService");

const RunService = game.GetService("RunService");
const GetKeyBinding = FunctionsAndEvents.GetKeyBinding;
const SetKeyBinding = FunctionsAndEvents.SetKeyBinding;

const throttleFloat = 0;
const steerFloat = 0;
const vehicleModel = undefined;

interface KeyBindButton extends TextButton {
	ImageLabel: ImageLabel;
}

Player.CharacterAdded.Connect((Character) => {
	// When the player sits in the vehicle:
	if (seatedConnection) {
		seatedConnection.Disconnect();
	}

	const humanoid = Character.WaitForChild("Humanoid") as Humanoid;
	seatedConnection = humanoid.Seated.Connect((isSeated) => {
		if (isSeated === true) {
			while (humanoid.SeatPart === undefined) {
				task.wait();
			}
			while (humanoid.SeatPart!.Parent === undefined) {
				task.wait();
			}

			//ContextActionService:BindAction("FlipVehicle", handleAction, false, Enum.KeyCode.V, Enum.KeyCode.ButtonX)
			ContextActionService.BindAction(
				"HonkHorn",
				handleAction as never,
				false,
				GetKeyBinding.InvokeServer("Horn") as Enum.KeyCode,
				Enum.KeyCode.ButtonY,
			);
			//ContextActionService:BindAction("Jump1", handleAction, false, GetKeyBinding:InvokeServer("Jump"))

			if (UserInputService.TouchEnabled) {
				//print("The user's device has a touchscreen!")
				(
					(Player as unknown as { PlayerGui: Instance }).PlayerGui.FindFirstChild(
						"MobileInterface",
					) as ScreenGui
				).Enabled = true;
			}
		} else {
			// When the player gets out:
			ContextActionService.UnbindAction("FlipVehicle");
			ContextActionService.UnbindAction("Drift");
			ContextActionService.UnbindAction("Boost");
			ContextActionService.UnbindAction("RollLeft");
			ContextActionService.UnbindAction("RollRight");

			pcall(() => {
				ContextActionService.UnbindAction("Jump");
			});
			pcall(() => {
				ContextActionService.UnbindAction("Jump2");
			});

			if (UserInputService.TouchEnabled) {
				//print("The user's device has a touchscreen!")
				(
					(Player as unknown as { PlayerGui: Instance }).PlayerGui.FindFirstChild(
						"MobileInterface",
					) as ScreenGui
				).Enabled = false;
			}
		}
	});
});

if (UserInputService.TouchEnabled) {
	//print("The user's device has a touchscreen!")
}

const UserInputService2 = game.GetService("UserInputService");

UserInputService2.InputBegan.Connect((input, gameProcessed) => {
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
