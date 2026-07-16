// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/DynamicThumbstick (ModuleScript)

import BaseCharacterController from "./BaseCharacterController";

//[[ Constants ]]--
const ZERO_VECTOR3 = new Vector3(0, 0, 0);
const TOUCH_CONTROLS_SHEET = "rbxasset://textures/ui/Input/TouchControlsSheetV2.png";

const DYNAMIC_THUMBSTICK_ACTION_NAME = "DynamicThumbstickAction";
const DYNAMIC_THUMBSTICK_ACTION_PRIORITY = Enum.ContextActionPriority.High.Value;

const MIDDLE_TRANSPARENCIES = [1 - 0.89, 1 - 0.7, 1 - 0.6, 1 - 0.5, 1 - 0.4, 1 - 0.3, 1 - 0.25];
const NUM_MIDDLE_IMAGES = MIDDLE_TRANSPARENCIES.size();

const FADE_IN_OUT_BACKGROUND = true;
const FADE_IN_OUT_MAX_ALPHA = 0.35;

const FADE_IN_OUT_HALF_DURATION_DEFAULT = 0.3;
const FADE_IN_OUT_BALANCE_DEFAULT = 0.5;
const ThumbstickFadeTweenInfo = new TweenInfo(0.15, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut);

const Players = game.GetService("Players");
const GuiService = game.GetService("GuiService");
const UserInputService = game.GetService("UserInputService");
const ContextActionService = game.GetService("ContextActionService");
const RunService = game.GetService("RunService");
const TweenService = game.GetService("TweenService");

let LocalPlayer = Players.LocalPlayer;
if (!LocalPlayer) {
	Players.GetPropertyChangedSignal("LocalPlayer").Wait();
	LocalPlayer = Players.LocalPlayer;
}

//[[ The Module ]]--
class DynamicThumbstick extends BaseCharacterController {
	moveTouchObject?: InputObject;
	moveTouchLockedIn: boolean;
	moveTouchFirstChanged: boolean;
	moveTouchStartPosition?: Vector3;

	startImage?: ImageLabel;
	endImage?: ImageLabel;
	middleImages: ImageLabel[];

	startImageFadeTween?: Tween;
	endImageFadeTween?: Tween;
	middleImageFadeTweens: (Tween | undefined)[];

	isFirstTouch: boolean;

	thumbstickFrame?: Frame;

	onRenderSteppedConn?: RBXScriptConnection;
	// Note: not initialized in the original .new() either -- only ever assigned inside Create().
	onTouchEndedConn?: RBXScriptConnection;

	fadeInAndOutBalance: number;
	fadeInAndOutHalfDuration: number;
	hasFadedBackgroundInPortrait: boolean;
	hasFadedBackgroundInLandscape: boolean;

	tweenInAlphaStart?: number;
	tweenOutAlphaStart?: number;

	// Assigned inside Create(); nothing meaningful before the first Create() call (mirrors the
	// Lua original, which leaves these nil until Create() runs).
	thumbstickSize!: number;
	thumbstickRingSize!: number;
	middleSize!: number;
	middleSpacing!: number;
	radiusOfDeadZone!: number;
	radiusOfMaxSpeed!: number;

	constructor() {
		super();

		this.moveTouchObject = undefined;
		this.moveTouchLockedIn = false;
		this.moveTouchFirstChanged = false;
		this.moveTouchStartPosition = undefined;

		this.startImage = undefined;
		this.endImage = undefined;
		this.middleImages = [];

		this.startImageFadeTween = undefined;
		this.endImageFadeTween = undefined;
		this.middleImageFadeTweens = [];

		this.isFirstTouch = true;

		this.thumbstickFrame = undefined;

		this.onRenderSteppedConn = undefined;

		this.fadeInAndOutBalance = FADE_IN_OUT_BALANCE_DEFAULT;
		this.fadeInAndOutHalfDuration = FADE_IN_OUT_HALF_DURATION_DEFAULT;
		this.hasFadedBackgroundInPortrait = false;
		this.hasFadedBackgroundInLandscape = false;

		this.tweenInAlphaStart = undefined;
		this.tweenOutAlphaStart = undefined;
	}

	// Note: Overrides base class GetIsJumping with get-and-clear behavior to do a single jump
	// rather than sustained jumping. This is only to preserve the current behavior through the refactor.
	GetIsJumping(): boolean {
		const wasJumping = this.isJumping;
		this.isJumping = false;
		return wasJumping;
	}

	Enable(enable: boolean | undefined, uiParentFrame?: GuiBase2d): boolean {
		if (enable === undefined) return false; // If nil, return false (invalid argument)
		enable = enable ? true : false; // Force anything non-nil to boolean before comparison
		if (this.enabled === enable) return true; // If no state change, return true indicating already in requested state

		if (enable) {
			// Enable
			if (!this.thumbstickFrame) {
				this.Create(uiParentFrame!);
			}

			this.BindContextActions();
		} else {
			ContextActionService.UnbindAction(DYNAMIC_THUMBSTICK_ACTION_NAME);
			// Disable
			this.OnInputEnded();
		}

		this.enabled = enable;
		this.thumbstickFrame!.Visible = enable;

		// Original falls off the end of the function here (no explicit return), which is an
		// implicit `nil` in Lua -- falsy, same as `false` to any truthy check on the result.
		return undefined as unknown as boolean;
	}

	// Was called OnMoveTouchEnded in previous version
	OnInputEnded(): void {
		this.moveTouchObject = undefined;
		this.moveVector = ZERO_VECTOR3;
		this.FadeThumbstick(false);
	}

	FadeThumbstick(visible: boolean | undefined): void {
		if (!visible && this.moveTouchObject) {
			return;
		}
		if (this.isFirstTouch) return;

		if (this.startImageFadeTween) {
			this.startImageFadeTween.Cancel();
		}
		if (this.endImageFadeTween) {
			this.endImageFadeTween.Cancel();
		}
		for (let i = 0; i < this.middleImages.size(); i++) {
			if (this.middleImageFadeTweens[i]) {
				this.middleImageFadeTweens[i]!.Cancel();
			}
		}

		if (visible) {
			this.startImageFadeTween = TweenService.Create(this.startImage!, ThumbstickFadeTweenInfo, {
				ImageTransparency: 0,
			});
			this.startImageFadeTween.Play();

			this.endImageFadeTween = TweenService.Create(this.endImage!, ThumbstickFadeTweenInfo, {
				ImageTransparency: 0.2,
			});
			this.endImageFadeTween.Play();

			for (let i = 0; i < this.middleImages.size(); i++) {
				this.middleImageFadeTweens[i] = TweenService.Create(this.middleImages[i], ThumbstickFadeTweenInfo, {
					ImageTransparency: MIDDLE_TRANSPARENCIES[i],
				});
				this.middleImageFadeTweens[i]!.Play();
			}
		} else {
			this.startImageFadeTween = TweenService.Create(this.startImage!, ThumbstickFadeTweenInfo, {
				ImageTransparency: 1,
			});
			this.startImageFadeTween.Play();

			this.endImageFadeTween = TweenService.Create(this.endImage!, ThumbstickFadeTweenInfo, {
				ImageTransparency: 1,
			});
			this.endImageFadeTween.Play();

			for (let i = 0; i < this.middleImages.size(); i++) {
				this.middleImageFadeTweens[i] = TweenService.Create(this.middleImages[i], ThumbstickFadeTweenInfo, {
					ImageTransparency: 1,
				});
				this.middleImageFadeTweens[i]!.Play();
			}
		}
	}

	FadeThumbstickFrame(fadeDuration: number, fadeRatio: number): void {
		this.fadeInAndOutHalfDuration = fadeDuration * 0.5;
		this.fadeInAndOutBalance = fadeRatio;
		this.tweenInAlphaStart = tick();
	}

	InputInFrame(inputObject: InputObject): boolean {
		const frameCornerTopLeft: Vector2 = this.thumbstickFrame!.AbsolutePosition;
		const frameCornerBottomRight = frameCornerTopLeft.add(this.thumbstickFrame!.AbsoluteSize);
		const inputPosition = inputObject.Position;
		if (inputPosition.X >= frameCornerTopLeft.X && inputPosition.Y >= frameCornerTopLeft.Y) {
			if (inputPosition.X <= frameCornerBottomRight.X && inputPosition.Y <= frameCornerBottomRight.Y) {
				return true;
			}
		}
		return false;
	}

	DoFadeInBackground(): void {
		const playerGui = LocalPlayer.FindFirstChildOfClass("PlayerGui");
		let hasFadedBackgroundInOrientation = false;

		// only fade in/out the background once per orientation
		if (playerGui) {
			if (
				playerGui.CurrentScreenOrientation === Enum.ScreenOrientation.LandscapeLeft ||
				playerGui.CurrentScreenOrientation === Enum.ScreenOrientation.LandscapeRight
			) {
				hasFadedBackgroundInOrientation = this.hasFadedBackgroundInLandscape;
				this.hasFadedBackgroundInLandscape = true;
			} else if (playerGui.CurrentScreenOrientation === Enum.ScreenOrientation.Portrait) {
				hasFadedBackgroundInOrientation = this.hasFadedBackgroundInPortrait;
				this.hasFadedBackgroundInPortrait = true;
			}
		}

		if (!hasFadedBackgroundInOrientation) {
			this.fadeInAndOutHalfDuration = FADE_IN_OUT_HALF_DURATION_DEFAULT;
			this.fadeInAndOutBalance = FADE_IN_OUT_BALANCE_DEFAULT;
			this.tweenInAlphaStart = tick();
		}
	}

	// Note: the Lua source annotates `direction` as a Vector3, but the only call site
	// (BindContextActions' inputChanged) always passes a Vector2. Vector2 and Vector3 both
	// expose Magnitude/Unit/X/Y (only X/Y are used here), so this is purely a stale/incorrect
	// type annotation in the original untyped (non --!strict) file with no effect on behavior;
	// typed here as what is actually passed.
	DoMove(direction: Vector2): void {
		// Scaled Radial Dead Zone
		const inputAxisMagnitude: number = direction.Magnitude;
		let currentMoveVector: Vector3;
		if (inputAxisMagnitude < this.radiusOfDeadZone) {
			currentMoveVector = ZERO_VECTOR3;
		} else {
			const scaledDirection = direction.Unit.mul(
				1 - math.max(0, (this.radiusOfMaxSpeed - direction.Magnitude) / this.radiusOfMaxSpeed),
			);
			currentMoveVector = new Vector3(scaledDirection.X, 0, scaledDirection.Y);
		}

		this.moveVector = currentMoveVector;
	}

	// Note: same stale-annotation situation as DoMove -- MoveStick's startPos/endPos (computed
	// from AbsolutePosition subtraction) are always Vector2 at the only call site, not Vector3.
	LayoutMiddleImages(startPos: Vector2, endPos: Vector2): void {
		const startDist = this.thumbstickSize / 2 + this.middleSize;
		const vector = endPos.sub(startPos);
		const distAvailable = vector.Magnitude - this.thumbstickRingSize / 2 - this.middleSize;
		const direction = vector.Unit;

		const distNeeded = this.middleSpacing * NUM_MIDDLE_IMAGES;
		let spacing = this.middleSpacing;

		if (distNeeded < distAvailable) {
			spacing = distAvailable / NUM_MIDDLE_IMAGES;
		}

		for (let i = 1; i <= NUM_MIDDLE_IMAGES; i++) {
			const image = this.middleImages[i - 1];
			const distWithout = startDist + spacing * (i - 2);
			const currentDist = startDist + spacing * (i - 1);

			if (distWithout < distAvailable) {
				const pos = endPos.sub(direction.mul(currentDist));
				const exposedFraction = math.clamp(1 - (currentDist - distAvailable) / spacing, 0, 1);

				image.Visible = true;
				image.Position = new UDim2(0, pos.X, 0, pos.Y);
				image.Size = new UDim2(0, this.middleSize * exposedFraction, 0, this.middleSize * exposedFraction);
			} else {
				image.Visible = false;
			}
		}
	}

	MoveStick(pos: Vector3): void {
		const vector2StartPosition = new Vector2(this.moveTouchStartPosition!.X, this.moveTouchStartPosition!.Y);
		const startPos = vector2StartPosition.sub(this.thumbstickFrame!.AbsolutePosition);
		const endPos = new Vector2(pos.X, pos.Y).sub(this.thumbstickFrame!.AbsolutePosition);
		this.endImage!.Position = new UDim2(0, endPos.X, 0, endPos.Y);
		this.LayoutMiddleImages(startPos, endPos);
	}

	BindContextActions(): void {
		const inputBegan = (inputObject: InputObject): Enum.ContextActionResult => {
			if (this.moveTouchObject) {
				return Enum.ContextActionResult.Pass;
			}

			if (!this.InputInFrame(inputObject)) {
				return Enum.ContextActionResult.Pass;
			}

			if (this.isFirstTouch) {
				this.isFirstTouch = false;
				const tweenInfo = new TweenInfo(0.5, Enum.EasingStyle.Quad, Enum.EasingDirection.Out, 0, false, 0);
				TweenService.Create(this.startImage!, tweenInfo, { Size: new UDim2(0, 0, 0, 0) }).Play();
				TweenService.Create(this.endImage!, tweenInfo, {
					Size: new UDim2(0, this.thumbstickSize, 0, this.thumbstickSize),
					ImageColor3: new Color3(0, 0, 0),
				}).Play();
			}

			this.moveTouchLockedIn = false;
			this.moveTouchObject = inputObject;
			this.moveTouchStartPosition = inputObject.Position;
			this.moveTouchFirstChanged = true;

			if (FADE_IN_OUT_BACKGROUND) {
				this.DoFadeInBackground();
			}

			return Enum.ContextActionResult.Pass;
		};

		const inputChanged = (inputObject: InputObject): Enum.ContextActionResult => {
			if (inputObject === this.moveTouchObject) {
				if (this.moveTouchFirstChanged) {
					this.moveTouchFirstChanged = false;

					const startPosVec2 = new Vector2(
						inputObject.Position.X - this.thumbstickFrame!.AbsolutePosition.X,
						inputObject.Position.Y - this.thumbstickFrame!.AbsolutePosition.Y,
					);
					this.startImage!.Visible = true;
					this.startImage!.Position = new UDim2(0, startPosVec2.X, 0, startPosVec2.Y);
					this.endImage!.Visible = true;
					this.endImage!.Position = this.startImage!.Position;

					this.FadeThumbstick(true);
					this.MoveStick(inputObject.Position);
				}

				this.moveTouchLockedIn = true;

				const direction = new Vector2(
					inputObject.Position.X - this.moveTouchStartPosition!.X,
					inputObject.Position.Y - this.moveTouchStartPosition!.Y,
				);
				if (math.abs(direction.X) > 0 || math.abs(direction.Y) > 0) {
					this.DoMove(direction);
					this.MoveStick(inputObject.Position);
				}
				return Enum.ContextActionResult.Sink;
			}
			return Enum.ContextActionResult.Pass;
		};

		const inputEnded = (inputObject: InputObject): Enum.ContextActionResult => {
			if (inputObject === this.moveTouchObject) {
				this.OnInputEnded();
				if (this.moveTouchLockedIn) {
					return Enum.ContextActionResult.Sink;
				}
			}
			return Enum.ContextActionResult.Pass;
		};

		const handleInput = (
			actionName: string,
			inputState: Enum.UserInputState,
			inputObject: InputObject,
		): Enum.ContextActionResult | undefined => {
			if (inputState === Enum.UserInputState.Begin) {
				return inputBegan(inputObject);
			} else if (inputState === Enum.UserInputState.Change) {
				return inputChanged(inputObject);
			} else if (inputState === Enum.UserInputState.End) {
				return inputEnded(inputObject);
			} else if (inputState === Enum.UserInputState.Cancel) {
				this.OnInputEnded();
			}
			return undefined;
		};

		ContextActionService.BindActionAtPriority(
			DYNAMIC_THUMBSTICK_ACTION_NAME,
			handleInput as never,
			false,
			DYNAMIC_THUMBSTICK_ACTION_PRIORITY,
			Enum.UserInputType.Touch,
		);
	}

	Create(parentFrame: GuiBase2d): void {
		if (this.thumbstickFrame) {
			this.thumbstickFrame.Destroy();
			this.thumbstickFrame = undefined;
			if (this.onRenderSteppedConn) {
				this.onRenderSteppedConn.Disconnect();
				this.onRenderSteppedConn = undefined;
			}
		}

		this.thumbstickSize = 45;
		this.thumbstickRingSize = 20;
		this.middleSize = 10;
		this.middleSpacing = this.middleSize + 4;
		this.radiusOfDeadZone = 2;
		this.radiusOfMaxSpeed = 20;

		const screenSize = parentFrame.AbsoluteSize;
		const isBigScreen = math.min(screenSize.X, screenSize.Y) > 500;
		if (isBigScreen) {
			this.thumbstickSize = this.thumbstickSize * 2;
			this.thumbstickRingSize = this.thumbstickRingSize * 2;
			this.middleSize = this.middleSize * 2;
			this.middleSpacing = this.middleSpacing * 2;
			this.radiusOfDeadZone = this.radiusOfDeadZone * 2;
			this.radiusOfMaxSpeed = this.radiusOfMaxSpeed * 2;
		}

		const layoutThumbstickFrame = (portraitMode: boolean) => {
			if (portraitMode) {
				this.thumbstickFrame!.Size = new UDim2(1, 0, 0.4, 0);
				this.thumbstickFrame!.Position = new UDim2(0, 0, 0.6, 0);
			} else {
				this.thumbstickFrame!.Size = new UDim2(0.4, 0, 2 / 3, 0);
				this.thumbstickFrame!.Position = new UDim2(0, 0, 1 / 3, 0);
			}
		};

		this.thumbstickFrame = new Instance("Frame");
		this.thumbstickFrame.BorderSizePixel = 0;
		this.thumbstickFrame.Name = "DynamicThumbstickFrame";
		this.thumbstickFrame.Visible = false;
		this.thumbstickFrame.BackgroundTransparency = 1.0;
		this.thumbstickFrame.BackgroundColor3 = Color3.fromRGB(0, 0, 0);
		this.thumbstickFrame.Active = false;
		layoutThumbstickFrame(false);

		this.startImage = new Instance("ImageLabel");
		this.startImage.Name = "ThumbstickStart";
		this.startImage.Visible = true;
		this.startImage.BackgroundTransparency = 1;
		this.startImage.Image = TOUCH_CONTROLS_SHEET;
		this.startImage.ImageRectOffset = new Vector2(1, 1);
		this.startImage.ImageRectSize = new Vector2(144, 144);
		this.startImage.ImageColor3 = new Color3(0, 0, 0);
		this.startImage.AnchorPoint = new Vector2(0.5, 0.5);
		this.startImage.Position = new UDim2(0, this.thumbstickRingSize * 3.3, 1, -this.thumbstickRingSize * 2.8);
		this.startImage.Size = new UDim2(0, this.thumbstickRingSize * 3.7, 0, this.thumbstickRingSize * 3.7);
		this.startImage.ZIndex = 10;
		this.startImage.Parent = this.thumbstickFrame;

		this.endImage = new Instance("ImageLabel");
		this.endImage.Name = "ThumbstickEnd";
		this.endImage.Visible = true;
		this.endImage.BackgroundTransparency = 1;
		this.endImage.Image = TOUCH_CONTROLS_SHEET;
		this.endImage.ImageRectOffset = new Vector2(1, 1);
		this.endImage.ImageRectSize = new Vector2(144, 144);
		this.endImage.AnchorPoint = new Vector2(0.5, 0.5);
		this.endImage.Position = this.startImage.Position;
		this.endImage.Size = new UDim2(0, this.thumbstickSize * 0.8, 0, this.thumbstickSize * 0.8);
		this.endImage.ZIndex = 10;
		this.endImage.Parent = this.thumbstickFrame;

		for (let i = 1; i <= NUM_MIDDLE_IMAGES; i++) {
			const middleImage = new Instance("ImageLabel");
			middleImage.Name = "ThumbstickMiddle";
			middleImage.Visible = false;
			middleImage.BackgroundTransparency = 1;
			middleImage.Image = TOUCH_CONTROLS_SHEET;
			middleImage.ImageRectOffset = new Vector2(1, 1);
			middleImage.ImageRectSize = new Vector2(144, 144);
			middleImage.ImageTransparency = MIDDLE_TRANSPARENCIES[i - 1];
			middleImage.AnchorPoint = new Vector2(0.5, 0.5);
			middleImage.ZIndex = 9;
			middleImage.Parent = this.thumbstickFrame;
			this.middleImages[i - 1] = middleImage;
		}

		let CameraChangedConn: RBXScriptConnection | undefined = undefined;
		const onCurrentCameraChanged = () => {
			if (CameraChangedConn) {
				CameraChangedConn.Disconnect();
				CameraChangedConn = undefined;
			}
			const newCamera = game.Workspace.CurrentCamera;
			if (newCamera) {
				const onViewportSizeChanged = () => {
					const size = newCamera.ViewportSize;
					const portraitMode = size.X < size.Y;
					layoutThumbstickFrame(portraitMode);
				};
				CameraChangedConn = newCamera.GetPropertyChangedSignal("ViewportSize").Connect(onViewportSizeChanged);
				onViewportSizeChanged();
			}
		};
		game.Workspace.GetPropertyChangedSignal("CurrentCamera").Connect(onCurrentCameraChanged);
		if (game.Workspace.CurrentCamera) {
			onCurrentCameraChanged();
		}

		this.moveTouchStartPosition = undefined;

		this.startImageFadeTween = undefined;
		this.endImageFadeTween = undefined;
		this.middleImageFadeTweens = [];

		this.onRenderSteppedConn = RunService.RenderStepped.Connect(() => {
			if (this.tweenInAlphaStart !== undefined) {
				const delta = tick() - this.tweenInAlphaStart;
				const fadeInTime = this.fadeInAndOutHalfDuration * 2 * this.fadeInAndOutBalance;
				this.thumbstickFrame!.BackgroundTransparency = 1 - FADE_IN_OUT_MAX_ALPHA * math.min(delta / fadeInTime, 1);
				if (delta > fadeInTime) {
					this.tweenOutAlphaStart = tick();
					this.tweenInAlphaStart = undefined;
				}
			} else if (this.tweenOutAlphaStart !== undefined) {
				const delta = tick() - this.tweenOutAlphaStart;
				const fadeOutTime =
					this.fadeInAndOutHalfDuration * 2 - this.fadeInAndOutHalfDuration * 2 * this.fadeInAndOutBalance;
				this.thumbstickFrame!.BackgroundTransparency =
					1 - FADE_IN_OUT_MAX_ALPHA + FADE_IN_OUT_MAX_ALPHA * math.min(delta / fadeOutTime, 1);
				if (delta > fadeOutTime) {
					this.tweenOutAlphaStart = undefined;
				}
			}
		});

		this.onTouchEndedConn = UserInputService.TouchEnded.Connect((inputObject: InputObject) => {
			if (inputObject === this.moveTouchObject) {
				this.OnInputEnded();
			}
		});

		GuiService.MenuOpened.Connect(() => {
			if (this.moveTouchObject) {
				this.OnInputEnded();
			}
		});

		let playerGuiOrUndefined = LocalPlayer.FindFirstChildOfClass("PlayerGui");
		while (!playerGuiOrUndefined) {
			LocalPlayer.ChildAdded.Wait();
			playerGuiOrUndefined = LocalPlayer.FindFirstChildOfClass("PlayerGui");
		}
		const playerGui = playerGuiOrUndefined;

		let playerGuiChangedConn: RBXScriptConnection | undefined = undefined;
		const originalScreenOrientationWasLandscape =
			playerGui.CurrentScreenOrientation === Enum.ScreenOrientation.LandscapeLeft ||
			playerGui.CurrentScreenOrientation === Enum.ScreenOrientation.LandscapeRight;

		const longShowBackground = () => {
			this.fadeInAndOutHalfDuration = 2.5;
			this.fadeInAndOutBalance = 0.05;
			this.tweenInAlphaStart = tick();
		};

		playerGuiChangedConn = playerGui.GetPropertyChangedSignal("CurrentScreenOrientation").Connect(() => {
			// Read into a local first: comparing playerGui.CurrentScreenOrientation directly
			// against Portrait here (after the Landscape checks used to compute
			// originalScreenOrientationWasLandscape above) makes TypeScript's aliased-condition
			// narrowing (readonly property + const object) assume the property's value can't
			// have changed since -- which is exactly false here, since this whole callback only
			// runs because that property just changed. A local re-read sidesteps the incorrect
			// narrowing without altering behavior.
			const currentScreenOrientation = playerGui.CurrentScreenOrientation;
			if (
				(originalScreenOrientationWasLandscape && currentScreenOrientation === Enum.ScreenOrientation.Portrait) ||
				(!originalScreenOrientationWasLandscape && currentScreenOrientation !== Enum.ScreenOrientation.Portrait)
			) {
				playerGuiChangedConn!.Disconnect();
				longShowBackground();

				if (originalScreenOrientationWasLandscape) {
					this.hasFadedBackgroundInPortrait = true;
				} else {
					this.hasFadedBackgroundInLandscape = true;
				}
			}
		});

		this.thumbstickFrame.Parent = parentFrame;

		if (game.IsLoaded()) {
			longShowBackground();
		} else {
			coroutine.wrap(() => {
				game.Loaded.Wait();
				longShowBackground();
			})();
		}
	}
}

export = DynamicThumbstick;
