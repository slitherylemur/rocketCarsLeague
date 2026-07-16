// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/CameraUI (ModuleScript)

const Players = game.GetService("Players");
const TweenService = game.GetService("TweenService");

let LocalPlayer = Players.LocalPlayer;
if (!LocalPlayer) {
	Players.GetPropertyChangedSignal("LocalPlayer").Wait();
	LocalPlayer = Players.LocalPlayer;
}

function waitForChildOfClass(parent: Instance, className: string): Instance {
	let child = (
		parent as unknown as { FindFirstChildOfClass(name: string): Instance | undefined }
	).FindFirstChildOfClass(className);
	while (!child || child.ClassName !== className) {
		[child] = parent.ChildAdded.Wait();
	}
	return child;
}

const PlayerGui = waitForChildOfClass(LocalPlayer, "PlayerGui") as PlayerGui;

const TOAST_OPEN_SIZE = new UDim2(0, 326, 0, 58);
const TOAST_CLOSED_SIZE = new UDim2(0, 80, 0, 58);
const TOAST_BACKGROUND_COLOR = Color3.fromRGB(32, 32, 32);
const TOAST_BACKGROUND_TRANS = 0.4;
const TOAST_FOREGROUND_COLOR = Color3.fromRGB(200, 200, 200);
const TOAST_FOREGROUND_TRANS = 0;

let initialized = false;

let uiRoot: ScreenGui;
let toast: ImageLabel;
let toastIcon: ImageLabel;
let toastUpperText: TextLabel;
let toastLowerText: TextLabel;

// Note: rewritten from the original's generic `create(className){props}` tree-builder helper
// into direct imperative instance creation. Behavior is preserved exactly: every instance is
// fully built bottom-up (properties set, children parented in) before being parented into its
// own parent, and the whole tree is parented into PlayerGui only as the very last step (matching
// the original's "only set parent after all other properties are initialized" comment).
function initializeUI(): void {
	assert(!initialized);

	const icon = new Instance("ImageLabel");
	icon.Name = "Icon";
	icon.AnchorPoint = new Vector2(0.5, 0.5);
	icon.BackgroundTransparency = 1;
	icon.Position = new UDim2(0.5, 0, 0.5, 0);
	icon.Size = new UDim2(0, 48, 0, 48);
	icon.ZIndex = 2;
	icon.Image = "rbxasset://textures/ui/Camera/CameraToastIcon.png";
	icon.ImageColor3 = TOAST_FOREGROUND_COLOR;
	icon.ImageTransparency = 1;

	const iconBuffer = new Instance("Frame");
	iconBuffer.Name = "IconBuffer";
	iconBuffer.BackgroundTransparency = 1;
	iconBuffer.BorderSizePixel = 0;
	iconBuffer.Position = new UDim2(0, 0, 0, 0);
	iconBuffer.Size = new UDim2(0, 80, 1, 0);
	icon.Parent = iconBuffer;

	const upper = new Instance("TextLabel");
	upper.Name = "Upper";
	upper.AnchorPoint = new Vector2(0, 1);
	upper.BackgroundTransparency = 1;
	upper.Position = new UDim2(0, 0, 0.5, 0);
	upper.Size = new UDim2(1, 0, 0, 19);
	upper.Font = Enum.Font.GothamMedium;
	upper.Text = "Camera control enabled";
	upper.TextColor3 = TOAST_FOREGROUND_COLOR;
	upper.TextTransparency = 1;
	upper.TextSize = 19;
	upper.TextXAlignment = Enum.TextXAlignment.Left;
	upper.TextYAlignment = Enum.TextYAlignment.Center;

	const lower = new Instance("TextLabel");
	lower.Name = "Lower";
	lower.AnchorPoint = new Vector2(0, 0);
	lower.BackgroundTransparency = 1;
	lower.Position = new UDim2(0, 0, 0.5, 3);
	lower.Size = new UDim2(1, 0, 0, 15);
	lower.Font = Enum.Font.Gotham;
	lower.Text = "Right mouse button to toggle";
	lower.TextColor3 = TOAST_FOREGROUND_COLOR;
	lower.TextTransparency = 1;
	lower.TextSize = 15;
	lower.TextXAlignment = Enum.TextXAlignment.Left;
	lower.TextYAlignment = Enum.TextYAlignment.Center;

	const textBuffer = new Instance("Frame");
	textBuffer.Name = "TextBuffer";
	textBuffer.BackgroundTransparency = 1;
	textBuffer.BorderSizePixel = 0;
	textBuffer.Position = new UDim2(0, 80, 0, 0);
	textBuffer.Size = new UDim2(1, -80, 1, 0);
	textBuffer.ClipsDescendants = true;
	upper.Parent = textBuffer;
	lower.Parent = textBuffer;

	const toastInstance = new Instance("ImageLabel");
	toastInstance.Name = "Toast";
	toastInstance.Visible = false;
	toastInstance.AnchorPoint = new Vector2(0.5, 0);
	toastInstance.BackgroundTransparency = 1;
	toastInstance.BorderSizePixel = 0;
	toastInstance.Position = new UDim2(0.5, 0, 0, 8);
	toastInstance.Size = TOAST_CLOSED_SIZE;
	toastInstance.Image = "rbxasset://textures/ui/Camera/CameraToast9Slice.png";
	toastInstance.ImageColor3 = TOAST_BACKGROUND_COLOR;
	toastInstance.ImageRectSize = new Vector2(6, 6);
	toastInstance.ImageTransparency = 1;
	toastInstance.ScaleType = Enum.ScaleType.Slice;
	toastInstance.SliceCenter = new Rect(3, 3, 3, 3);
	toastInstance.ClipsDescendants = true;
	iconBuffer.Parent = toastInstance;
	textBuffer.Parent = toastInstance;

	const uiRootInstance = new Instance("ScreenGui");
	uiRootInstance.Name = "RbxCameraUI";
	uiRootInstance.AutoLocalize = false;
	uiRootInstance.Enabled = true;
	uiRootInstance.DisplayOrder = -1; // Appears behind default developer UI
	uiRootInstance.IgnoreGuiInset = false;
	uiRootInstance.ResetOnSpawn = false;
	uiRootInstance.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;
	toastInstance.Parent = uiRootInstance;
	uiRootInstance.Parent = PlayerGui;

	uiRoot = uiRootInstance;
	toast = toastInstance;
	toastIcon = icon;
	toastUpperText = upper;
	toastLowerText = lower;

	initialized = true;
}

const tweenInfo = new TweenInfo(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);

// Instantaneously disable the toast or enable for opening later on. Used when switching camera modes.
function setCameraModeToastEnabled(enabled: boolean): void {
	if (!enabled && !initialized) {
		return;
	}

	if (!initialized) {
		initializeUI();
	}

	toast.Visible = enabled;
	if (!enabled) {
		setCameraModeToastOpen(false);
	}
}

// Tween the toast in or out. Toast must be enabled with setCameraModeToastEnabled.
function setCameraModeToastOpen(open: boolean): void {
	assert(initialized);

	TweenService.Create(toast, tweenInfo, {
		Size: open ? TOAST_OPEN_SIZE : TOAST_CLOSED_SIZE,
		ImageTransparency: open ? TOAST_BACKGROUND_TRANS : 1,
	}).Play();

	TweenService.Create(toastIcon, tweenInfo, {
		ImageTransparency: open ? TOAST_FOREGROUND_TRANS : 1,
	}).Play();

	TweenService.Create(toastUpperText, tweenInfo, {
		TextTransparency: open ? TOAST_FOREGROUND_TRANS : 1,
	}).Play();

	TweenService.Create(toastLowerText, tweenInfo, {
		TextTransparency: open ? TOAST_FOREGROUND_TRANS : 1,
	}).Play();
}

const CameraUI = {
	setCameraModeToastEnabled,
	setCameraModeToastOpen,
};

export = CameraUI;
