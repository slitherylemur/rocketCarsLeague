// Client-side animation driver for the LadderMap screen (see
// src/server/ui/LadderMapScreen.ts). The server builds the ladder and owns
// the timeline, but running TweenService on the server replicates property
// writes at network rate and stutters — so the server only sets attributes
// and every viewer tweens locally:
//
//   * gui "CB_Anim" = "cam:<duration>:<seq>" → the 3D camera rises from
//     CAM_START_HEIGHT to CAM_END_HEIGHT studs above the gui's CB_CamCenter
//     (the viewer's own pitch), looking straight down, while the Canvas
//     CanvasGroup fades in (GroupTransparency 1→0) over the SECOND HALF of
//     the rise. No CB_CamCenter (menu spectators) → fade only, camera
//     untouched.
//   * gui "CB_Anim" = "move:<duration>:<seq>" → every World child with
//     CB_ToX/CB_ToY tweens its Position to that world-scale target, and the
//     World frame itself tweens to CB_MoveX/CB_MoveY — the 2D camera
//     following the viewer's team to its new pitch.
//   * gui "CB_Anim" = "pan:<duration>:<seq>" → the World frame tweens its
//     Size to CB_PanScale and Position to CB_PanX/CB_PanY — the pan across
//     the whole ladder up to the 🏆 pitch, zooming out a little.
//
// The <seq> nonce only makes consecutive values distinct so the attribute
// change always fires. The server snaps the final property values after each
// phase, so a missed trigger still ends in the right state (the snap
// replicates the same values the tween already reached — visually a no-op).
//
// Camera note: the camera is deliberately left Scriptable at the top of the
// rise — by then the opaque ladder UI covers the screen, and the shop-phase
// menu that follows installs its own camera (same handoff the victory scene
// already used).
//
// Same lifecycle pattern as uiClientBehaviors.client.ts: PlayerGui is
// server-rendered React and remounts wholesale, so attach to every fresh
// "LadderMap" mount via ChildAdded.

const Players = game.GetService("Players");
const TweenService = game.GetService("TweenService");
const LocalPlayer = Players.LocalPlayer;

const CAM_START_HEIGHT = 10;
const CAM_END_HEIGHT = 650;
// Straight-down look needs an explicit up vector (the default Y-up is
// degenerate). The pitch's long (goal-to-goal) axis runs along world Z, so
// the up vector must be along X for that axis to read HORIZONTAL on screen —
// matching the landscape pitch cards the UI fades into. -X up puts the
// better pitches (gold is first along the line) toward the top of screen.
const CAM_UP = new Vector3(-1, 0, 0);

function canvasOf(gui: ScreenGui): CanvasGroup | undefined {
	const canvas = gui.FindFirstChild("Canvas");
	return canvas && canvas.IsA("CanvasGroup") ? canvas : undefined;
}

function worldOf(gui: ScreenGui): Frame | undefined {
	const canvas = canvasOf(gui);
	const stage = canvas && canvas.FindFirstChild("Stage");
	const world = stage && stage.FindFirstChild("World");
	return world && world.IsA("Frame") ? world : undefined;
}

function runCamPhase(gui: ScreenGui, duration: number) {
	const canvas = canvasOf(gui);
	if (!canvas) {
		return;
	}
	canvas.GroupTransparency = 1;
	const fadeTime = duration / 2;

	const center = gui.GetAttribute("CB_CamCenter");
	const camera = game.Workspace.CurrentCamera;
	if (typeIs(center, "Vector3") && camera) {
		// Drone shot: launch straight up off the pitch (Quad Out — most of the
		// altitude lands in the first half, so the whole pitch and its
		// neighbours are in view BEFORE the fading-in UI covers them).
		camera.CameraType = Enum.CameraType.Scriptable;
		camera.CFrame = CFrame.lookAt(center.add(new Vector3(0, CAM_START_HEIGHT, 0)), center, CAM_UP);
		TweenService.Create(camera, new TweenInfo(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			CFrame: CFrame.lookAt(center.add(new Vector3(0, CAM_END_HEIGHT, 0)), center, CAM_UP),
		}).Play();
	}

	// The ladder fades in over the second half of the rise.
	task.delay(duration - fadeTime, () => {
		if (gui.Parent === undefined || !gui.Enabled) {
			return;
		}
		TweenService.Create(canvas, new TweenInfo(fadeTime, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			GroupTransparency: 0,
		}).Play();
	});
}

function runMovePhase(gui: ScreenGui, duration: number) {
	const world = worldOf(gui);
	if (!world) {
		return;
	}
	const info = new TweenInfo(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut);
	for (const child of world.GetChildren()) {
		const toX = child.GetAttribute("CB_ToX");
		const toY = child.GetAttribute("CB_ToY");
		if (child.IsA("GuiObject") && typeIs(toX, "number") && typeIs(toY, "number")) {
			TweenService.Create(child, info, { Position: new UDim2(toX, 0, toY, 0) }).Play();
		}
	}
	// The 2D camera follows the viewer's team to its new pitch.
	const moveX = world.GetAttribute("CB_MoveX");
	const moveY = world.GetAttribute("CB_MoveY");
	if (typeIs(moveX, "number") && typeIs(moveY, "number")) {
		TweenService.Create(world, info, { Position: new UDim2(moveX, 0, moveY, 0) }).Play();
	}
}

function runPanPhase(gui: ScreenGui, duration: number) {
	const world = worldOf(gui);
	if (!world) {
		return;
	}
	const scale = world.GetAttribute("CB_PanScale");
	const panX = world.GetAttribute("CB_PanX");
	const panY = world.GetAttribute("CB_PanY");
	if (typeIs(scale, "number") && typeIs(panX, "number") && typeIs(panY, "number")) {
		const info = new TweenInfo(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut);
		TweenService.Create(world, info, {
			Size: new UDim2(scale, 0, scale, 0),
			Position: new UDim2(panX, 0, panY, 0),
		}).Play();
	}
}

function runAnim(gui: ScreenGui) {
	const anim = gui.GetAttribute("CB_Anim");
	if (!typeIs(anim, "string")) {
		return;
	}
	const [phase, durationText] = string.match(anim, "^(%a+):([%d%.]+)");
	const duration = tonumber(durationText);
	if (!typeIs(phase, "string") || duration === undefined) {
		return;
	}
	if (phase === "cam") {
		runCamPhase(gui, duration);
	} else if (phase === "move") {
		runMovePhase(gui, duration);
	} else if (phase === "pan") {
		runPanPhase(gui, duration);
	}
}

function onGuiAdded(child: Instance) {
	if (child.Name !== "LadderMap" || !child.IsA("ScreenGui")) {
		return;
	}
	child.GetAttributeChangedSignal("CB_Anim").Connect(() => runAnim(child));
}

const playerGui = LocalPlayer.WaitForChild("PlayerGui");
for (const child of playerGui.GetChildren()) {
	onGuiAdded(child);
}
playerGui.ChildAdded.Connect(onGuiAdded);
