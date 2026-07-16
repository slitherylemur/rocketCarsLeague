// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/TouchJump (ModuleScript)
/*
	// FileName: TouchJump
	// Version 1.0
	// Written by: jmargh
	// Description: Implements jump controls for touch devices. Use with Thumbstick and Thumbpad
*/

import BaseCharacterController from "./BaseCharacterController";

const Players = game.GetService("Players");
const GuiService = game.GetService("GuiService");

//[[ Constants ]]--
const TOUCH_CONTROL_SHEET = "rbxasset://textures/ui/Input/TouchControlsSheetV2.png";

//[[ The Module ]]--
class TouchJump extends BaseCharacterController {
	parentUIFrame?: GuiBase2d;
	jumpButton?: ImageButton;
	characterAddedConn?: RBXScriptConnection;
	humanoidStateEnabledChangedConn?: RBXScriptConnection;
	humanoidJumpPowerConn?: RBXScriptConnection;
	humanoidParentConn?: RBXScriptConnection;
	// Referenced (checked + disconnected) by HumanoidChanged and CharacterAdded, but -- exactly
	// as in the original Lua -- never actually assigned anywhere (CharacterAdded stores its
	// connections in humanoidJumpPowerConn/humanoidParentConn instead). Preserved verbatim as
	// vestigial/dead code from the source file.
	humanoidChangeConn?: RBXScriptConnection;
	externallyEnabled: boolean;
	jumpPower: number;
	jumpStateEnabled: boolean;
	humanoid?: Humanoid; // saved reference because property change connections are made using it

	constructor() {
		super();

		this.parentUIFrame = undefined;
		this.jumpButton = undefined;
		this.characterAddedConn = undefined;
		this.humanoidStateEnabledChangedConn = undefined;
		this.humanoidJumpPowerConn = undefined;
		this.humanoidParentConn = undefined;
		this.externallyEnabled = false;
		this.jumpPower = 0;
		this.jumpStateEnabled = true;
		this.isJumping = false;
		this.humanoid = undefined; // saved reference because property change connections are made using it
	}

	EnableButton(enable: boolean): void {
		if (enable) {
			if (!this.jumpButton) {
				this.Create();
			}
			const humanoid =
				Players.LocalPlayer.Character && Players.LocalPlayer.Character.FindFirstChildOfClass("Humanoid");
			if (humanoid && this.externallyEnabled) {
				if (this.externallyEnabled) {
					if (humanoid.JumpPower > 0) {
						this.jumpButton!.Visible = true;
					}
				}
			}
		} else {
			this.jumpButton!.Visible = false;
			this.isJumping = false;
			this.jumpButton!.ImageRectOffset = new Vector2(1, 146);
		}
	}

	UpdateEnabled(): void {
		if (this.jumpPower > 0 && this.jumpStateEnabled) {
			this.EnableButton(true);
		} else {
			this.EnableButton(false);
		}
	}

	HumanoidChanged(prop: string): void {
		const humanoid =
			Players.LocalPlayer.Character && Players.LocalPlayer.Character.FindFirstChildOfClass("Humanoid");
		if (humanoid) {
			if (prop === "JumpPower") {
				this.jumpPower = humanoid.JumpPower;
				this.UpdateEnabled();
			} else if (prop === "Parent") {
				if (!humanoid.Parent) {
					this.humanoidChangeConn!.Disconnect();
				}
			}
		}
	}

	HumanoidStateEnabledChanged(state: Enum.HumanoidStateType, isEnabled: boolean): void {
		if (state === Enum.HumanoidStateType.Jumping) {
			this.jumpStateEnabled = isEnabled;
			this.UpdateEnabled();
		}
	}

	CharacterAdded(char: Model): void {
		if (this.humanoidChangeConn) {
			this.humanoidChangeConn.Disconnect();
			this.humanoidChangeConn = undefined;
		}

		let humanoidOrUndefined = char.FindFirstChildOfClass("Humanoid");
		while (!humanoidOrUndefined) {
			char.ChildAdded.Wait();
			humanoidOrUndefined = char.FindFirstChildOfClass("Humanoid");
		}
		this.humanoid = humanoidOrUndefined;

		this.humanoidJumpPowerConn = this.humanoid.GetPropertyChangedSignal("JumpPower").Connect(() => {
			this.jumpPower = this.humanoid!.JumpPower;
			this.UpdateEnabled();
		});

		this.humanoidParentConn = this.humanoid.GetPropertyChangedSignal("Parent").Connect(() => {
			if (!this.humanoid!.Parent) {
				this.humanoidJumpPowerConn!.Disconnect();
				this.humanoidJumpPowerConn = undefined;
				this.humanoidParentConn!.Disconnect();
				this.humanoidParentConn = undefined;
			}
		});

		this.humanoidStateEnabledChangedConn = this.humanoid.StateEnabledChanged.Connect((state, enabled) => {
			this.HumanoidStateEnabledChanged(state, enabled);
		});

		this.jumpPower = this.humanoid.JumpPower;
		this.jumpStateEnabled = this.humanoid.GetStateEnabled(Enum.HumanoidStateType.Jumping);
		this.UpdateEnabled();
	}

	SetupCharacterAddedFunction(): void {
		this.characterAddedConn = Players.LocalPlayer.CharacterAdded.Connect((char) => {
			this.CharacterAdded(char);
		});
		if (Players.LocalPlayer.Character) {
			this.CharacterAdded(Players.LocalPlayer.Character);
		}
	}

	Enable(enable: boolean, parentFrame?: GuiBase2d): boolean {
		if (parentFrame) {
			this.parentUIFrame = parentFrame;
		}
		this.externallyEnabled = enable;
		this.EnableButton(enable);

		// Original has no return statement at all (implicit `nil`).
		return undefined as unknown as boolean;
	}

	Create(): void {
		if (!this.parentUIFrame) {
			return;
		}

		if (this.jumpButton) {
			this.jumpButton.Destroy();
			this.jumpButton = undefined;
		}

		const minAxis = math.min(this.parentUIFrame.AbsoluteSize.X, this.parentUIFrame.AbsoluteSize.Y);
		const isSmallScreen = minAxis <= 500;
		const jumpButtonSize = isSmallScreen ? 70 : 120;

		this.jumpButton = new Instance("ImageButton");
		this.jumpButton.Name = "JumpButton";
		this.jumpButton.Visible = false;
		this.jumpButton.BackgroundTransparency = 1;
		this.jumpButton.Image = TOUCH_CONTROL_SHEET;
		this.jumpButton.ImageRectOffset = new Vector2(1, 146);
		this.jumpButton.ImageRectSize = new Vector2(144, 144);
		this.jumpButton.Size = new UDim2(0, jumpButtonSize, 0, jumpButtonSize);

		this.jumpButton.Position = isSmallScreen
			? new UDim2(1, -(jumpButtonSize * 1.5 - 10), 1, -jumpButtonSize - 20)
			: new UDim2(1, -(jumpButtonSize * 1.5 - 10), 1, -jumpButtonSize * 1.75);

		let touchObject: InputObject | undefined = undefined;
		this.jumpButton.InputBegan.Connect((inputObject) => {
			//A touch that starts elsewhere on the screen will be sent to a frame's InputBegan event
			//if it moves over the frame. So we check that this is actually a new touch (inputObject.UserInputState ~= Enum.UserInputState.Begin)
			if (
				touchObject ||
				inputObject.UserInputType !== Enum.UserInputType.Touch ||
				inputObject.UserInputState !== Enum.UserInputState.Begin
			) {
				return;
			}

			touchObject = inputObject;
			this.jumpButton!.ImageRectOffset = new Vector2(146, 146);
			this.isJumping = true;
		});

		const OnInputEnded = () => {
			touchObject = undefined;
			this.isJumping = false;
			this.jumpButton!.ImageRectOffset = new Vector2(1, 146);
		};

		this.jumpButton.InputEnded.Connect((inputObject: InputObject) => {
			if (inputObject === touchObject) {
				OnInputEnded();
			}
		});

		GuiService.MenuOpened.Connect(() => {
			if (touchObject) {
				OnInputEnded();
			}
		});

		if (!this.characterAddedConn) {
			this.SetupCharacterAddedFunction();
		}

		this.jumpButton.Parent = this.parentUIFrame;
	}
}

export = TouchJump;
