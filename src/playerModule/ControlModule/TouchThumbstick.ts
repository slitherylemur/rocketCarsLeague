// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/TouchThumbstick (ModuleScript)
/*

	TouchThumbstick

*/

import BaseCharacterController from "./BaseCharacterController";

const Players = game.GetService("Players");
const GuiService = game.GetService("GuiService");
const UserInputService = game.GetService("UserInputService");

//[[ Constants ]]--
const ZERO_VECTOR3 = new Vector3(0, 0, 0);
const TOUCH_CONTROL_SHEET = "rbxasset://textures/ui/TouchControlsSheet.png";

//[[ The Module ]]--
class TouchThumbstick extends BaseCharacterController {
	isFollowStick: boolean;

	thumbstickFrame?: Frame;
	moveTouchObject?: InputObject;
	onTouchMovedConn?: RBXScriptConnection;
	onTouchEndedConn?: RBXScriptConnection;
	screenPos?: UDim2;
	stickImage?: ImageLabel;
	thumbstickSize?: number; // Float

	constructor() {
		super();

		this.isFollowStick = false;

		this.thumbstickFrame = undefined;
		this.moveTouchObject = undefined;
		this.onTouchMovedConn = undefined;
		this.onTouchEndedConn = undefined;
		this.screenPos = undefined;
		this.stickImage = undefined;
		this.thumbstickSize = undefined; // Float
	}

	Enable(enable: boolean | undefined, uiParentFrame?: GuiBase2d): boolean {
		if (enable === undefined) return false; // If nil, return false (invalid argument)
		enable = enable ? true : false; // Force anything non-nil to boolean before comparison
		if (this.enabled === enable) return true; // If no state change, return true indicating already in requested state

		this.moveVector = ZERO_VECTOR3;
		this.isJumping = false;

		if (enable) {
			// Enable
			if (!this.thumbstickFrame) {
				this.Create(uiParentFrame!);
			}
			this.thumbstickFrame!.Visible = true;
		} else {
			// Disable
			this.thumbstickFrame!.Visible = false;
			this.OnInputEnded();
		}
		this.enabled = enable;

		// Original falls off the end of the function here (no explicit return), which is an
		// implicit `nil` in Lua.
		return undefined as unknown as boolean;
	}

	OnInputEnded(): void {
		this.thumbstickFrame!.Position = this.screenPos!;
		this.stickImage!.Position = new UDim2(
			0,
			this.thumbstickFrame!.Size.X.Offset / 2 - this.thumbstickSize! / 4,
			0,
			this.thumbstickFrame!.Size.Y.Offset / 2 - this.thumbstickSize! / 4,
		);

		this.moveVector = ZERO_VECTOR3;
		this.isJumping = false;
		this.thumbstickFrame!.Position = this.screenPos!;
		this.moveTouchObject = undefined;
	}

	Create(parentFrame: GuiBase2d): void {
		if (this.thumbstickFrame) {
			this.thumbstickFrame.Destroy();
			this.thumbstickFrame = undefined;
			if (this.onTouchMovedConn) {
				this.onTouchMovedConn.Disconnect();
				this.onTouchMovedConn = undefined;
			}
			if (this.onTouchEndedConn) {
				this.onTouchEndedConn.Disconnect();
				this.onTouchEndedConn = undefined;
			}
		}

		const minAxis = math.min(parentFrame.AbsoluteSize.X, parentFrame.AbsoluteSize.Y);
		const isSmallScreen = minAxis <= 500;
		this.thumbstickSize = isSmallScreen ? 70 : 120;
		this.screenPos = isSmallScreen
			? new UDim2(0, this.thumbstickSize / 2 - 10, 1, -this.thumbstickSize - 20)
			: new UDim2(0, this.thumbstickSize / 2, 1, -this.thumbstickSize * 1.75);

		this.thumbstickFrame = new Instance("Frame");
		this.thumbstickFrame.Name = "ThumbstickFrame";
		this.thumbstickFrame.Active = true;
		this.thumbstickFrame.Visible = false;
		this.thumbstickFrame.Size = new UDim2(0, this.thumbstickSize, 0, this.thumbstickSize);
		this.thumbstickFrame.Position = this.screenPos;
		this.thumbstickFrame.BackgroundTransparency = 1;

		const outerImage = new Instance("ImageLabel");
		outerImage.Name = "OuterImage";
		outerImage.Image = TOUCH_CONTROL_SHEET;
		outerImage.ImageRectOffset = new Vector2();
		outerImage.ImageRectSize = new Vector2(220, 220);
		outerImage.BackgroundTransparency = 1;
		outerImage.Size = new UDim2(0, this.thumbstickSize, 0, this.thumbstickSize);
		outerImage.Position = new UDim2(0, 0, 0, 0);
		outerImage.Parent = this.thumbstickFrame;

		this.stickImage = new Instance("ImageLabel");
		this.stickImage.Name = "StickImage";
		this.stickImage.Image = TOUCH_CONTROL_SHEET;
		this.stickImage.ImageRectOffset = new Vector2(220, 0);
		this.stickImage.ImageRectSize = new Vector2(111, 111);
		this.stickImage.BackgroundTransparency = 1;
		this.stickImage.Size = new UDim2(0, this.thumbstickSize / 2, 0, this.thumbstickSize / 2);
		this.stickImage.Position = new UDim2(
			0,
			this.thumbstickSize / 2 - this.thumbstickSize / 4,
			0,
			this.thumbstickSize / 2 - this.thumbstickSize / 4,
		);
		this.stickImage.ZIndex = 2;
		this.stickImage.Parent = this.thumbstickFrame;

		let centerPosition: Vector2 | undefined = undefined;
		const deadZone = 0.05;

		const DoMove = (direction: Vector2) => {
			const scaledVector = direction.div(this.thumbstickSize! / 2);

			// Scaled Radial Dead Zone
			const inputAxisMagnitude = scaledVector.Magnitude;
			let currentMoveVector: Vector3;
			if (inputAxisMagnitude < deadZone) {
				currentMoveVector = new Vector3();
			} else {
				const adjustedVector = scaledVector.Unit.mul((inputAxisMagnitude - deadZone) / (1 - deadZone));
				// NOTE: Making currentMoveVector a unit vector will cause the player to instantly go max speed
				// must check for zero length vector is using unit
				currentMoveVector = new Vector3(adjustedVector.X, 0, adjustedVector.Y);
			}

			this.moveVector = currentMoveVector;
		};

		const MoveStick = (pos: Vector3) => {
			let relativePosition = new Vector2(pos.X - centerPosition!.X, pos.Y - centerPosition!.Y);
			let length = relativePosition.Magnitude;
			const maxLength = this.thumbstickFrame!.AbsoluteSize.X / 2;
			if (this.isFollowStick && length > maxLength) {
				const offset = relativePosition.Unit.mul(maxLength);
				this.thumbstickFrame!.Position = new UDim2(
					0,
					pos.X - this.thumbstickFrame!.AbsoluteSize.X / 2 - offset.X,
					0,
					pos.Y - this.thumbstickFrame!.AbsoluteSize.Y / 2 - offset.Y,
				);
			} else {
				length = math.min(length, maxLength);
				relativePosition = relativePosition.Unit.mul(length);
			}
			this.stickImage!.Position = new UDim2(
				0,
				relativePosition.X + this.stickImage!.AbsoluteSize.X / 2,
				0,
				relativePosition.Y + this.stickImage!.AbsoluteSize.Y / 2,
			);
		};

		// input connections
		this.thumbstickFrame.InputBegan.Connect((inputObject: InputObject) => {
			//A touch that starts elsewhere on the screen will be sent to a frame's InputBegan event
			//if it moves over the frame. So we check that this is actually a new touch (inputObject.UserInputState ~= Enum.UserInputState.Begin)
			if (
				this.moveTouchObject ||
				inputObject.UserInputType !== Enum.UserInputType.Touch ||
				inputObject.UserInputState !== Enum.UserInputState.Begin
			) {
				return;
			}

			this.moveTouchObject = inputObject;
			this.thumbstickFrame!.Position = new UDim2(
				0,
				inputObject.Position.X - this.thumbstickFrame!.Size.X.Offset / 2,
				0,
				inputObject.Position.Y - this.thumbstickFrame!.Size.Y.Offset / 2,
			);
			centerPosition = new Vector2(
				this.thumbstickFrame!.AbsolutePosition.X + this.thumbstickFrame!.AbsoluteSize.X / 2,
				this.thumbstickFrame!.AbsolutePosition.Y + this.thumbstickFrame!.AbsoluteSize.Y / 2,
			);
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const direction = new Vector2(
				inputObject.Position.X - centerPosition.X,
				inputObject.Position.Y - centerPosition.Y,
			);
		});

		this.onTouchMovedConn = UserInputService.TouchMoved.Connect((inputObject: InputObject, isProcessed: boolean) => {
			if (inputObject === this.moveTouchObject) {
				centerPosition = new Vector2(
					this.thumbstickFrame!.AbsolutePosition.X + this.thumbstickFrame!.AbsoluteSize.X / 2,
					this.thumbstickFrame!.AbsolutePosition.Y + this.thumbstickFrame!.AbsoluteSize.Y / 2,
				);
				const direction = new Vector2(
					inputObject.Position.X - centerPosition.X,
					inputObject.Position.Y - centerPosition.Y,
				);
				DoMove(direction);
				MoveStick(inputObject.Position);
			}
		});

		this.onTouchEndedConn = UserInputService.TouchEnded.Connect((inputObject, isProcessed) => {
			if (inputObject === this.moveTouchObject) {
				this.OnInputEnded();
			}
		});

		GuiService.MenuOpened.Connect(() => {
			if (this.moveTouchObject) {
				this.OnInputEnded();
			}
		});

		this.thumbstickFrame.Parent = parentFrame;
	}
}

export = TouchThumbstick;
