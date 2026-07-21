// Client-side animation driver for the LadderMap screen (see
// src/server/ui/LadderMapScreen.ts). The server builds the ladder and owns
// the timeline, but running TweenService on the server replicates property
// writes at network rate and stutters — so the server only sets attributes
// and every viewer tweens locally:
//
//   * gui "CB_Anim" = "move:<duration>:<seq>" → every Board child with
//     CB_ToX/CB_ToY tweens its Position to that Board-scale target.
//   * gui "CB_Anim" = "zoom:<duration>:<seq>" → the Board tweens its
//     Size/Position to the CB_ZoomScale/CB_ZoomX/CB_ZoomY goal.
//
// The <seq> nonce only makes consecutive values distinct so the attribute
// change always fires. The server snaps the final property values after each
// phase, so a missed trigger still ends in the right state (the snap
// replicates the same values the tween already reached — visually a no-op).
//
// Same lifecycle pattern as uiClientBehaviors.client.ts: PlayerGui is
// server-rendered React and remounts wholesale, so attach to every fresh
// "LadderMap" mount via ChildAdded.

const Players = game.GetService("Players");
const TweenService = game.GetService("TweenService");
const LocalPlayer = Players.LocalPlayer;

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
	const board = gui.FindFirstChild("Board");
	if (!board || !board.IsA("Frame")) {
		return;
	}

	if (phase === "move") {
		const info = new TweenInfo(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut);
		for (const child of board.GetChildren()) {
			const toX = child.GetAttribute("CB_ToX");
			const toY = child.GetAttribute("CB_ToY");
			if (child.IsA("GuiObject") && typeIs(toX, "number") && typeIs(toY, "number")) {
				TweenService.Create(child, info, { Position: new UDim2(toX, 0, toY, 0) }).Play();
			}
		}
	} else if (phase === "zoom") {
		const scale = board.GetAttribute("CB_ZoomScale");
		const zoomX = board.GetAttribute("CB_ZoomX");
		const zoomY = board.GetAttribute("CB_ZoomY");
		if (typeIs(scale, "number") && typeIs(zoomX, "number") && typeIs(zoomY, "number")) {
			const info = new TweenInfo(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);
			TweenService.Create(board, info, {
				Size: new UDim2(scale, 0, scale, 0),
				Position: new UDim2(zoomX, 0, zoomY, 0),
			}).Play();
		}
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
