// Shows an edge-clamped arrow toward the local player's ball whenever the
// ball is outside the camera viewport.

import { BALL_NAME } from "shared/ballSim/BallConfig";

const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const Workspace = game.GetService("Workspace");

const localPlayer = Players.LocalPlayer;
const PITCH_ATTRIBUTE = "CB_PitchId";
const EDGE_MARGIN = 72;
const ARROW_SIZE = 112;
const ARROW_GLYPH = utf8.char(0x27a4); // U+27A4, generated this way to avoid source-encoding corruption.

const playerGui = localPlayer.WaitForChild("PlayerGui");
let arrow: Frame | undefined;

function createTextIndicator(): TextLabel {
	const screenGui = new Instance("ScreenGui");
	screenGui.Name = "BallDirectionIndicator";
	screenGui.DisplayOrder = 20;
	screenGui.IgnoreGuiInset = true;
	screenGui.ResetOnSpawn = false;
	screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;

	const label = new Instance("TextLabel");
	label.Name = "Arrow";
	label.AnchorPoint = new Vector2(0.5, 0.5);
	label.Size = UDim2.fromOffset(ARROW_SIZE, ARROW_SIZE);
	label.BackgroundTransparency = 1;
	label.Font = Enum.Font.GothamBlack;
	label.Text = ARROW_GLYPH;
	/*
	label.Text = "➤";
	label.TextColor3 = Color3.fromRGB(255, 183, 38);
	*/
	label.TextColor3 = Color3.fromRGB(255, 183, 38);
	label.TextScaled = true;
	label.TextStrokeColor3 = Color3.fromRGB(25, 18, 5);
	label.TextStrokeTransparency = 0;
	label.Visible = false;
	label.ZIndex = 20;
	label.Parent = screenGui;

	const sizeConstraint = new Instance("UITextSizeConstraint");
	sizeConstraint.MaxTextSize = 100;
	sizeConstraint.MinTextSize = 50;
	sizeConstraint.Parent = label;

	screenGui.Parent = playerGui;
	return label;
}

function addArrowSegment(parent: Frame, name: string, size: Vector2, position: Vector2, rotation = 0) {
	const segment = new Instance("Frame");
	segment.Name = name;
	segment.AnchorPoint = new Vector2(0.5, 0.5);
	segment.Position = UDim2.fromScale(position.X, position.Y);
	segment.Size = UDim2.fromScale(size.X, size.Y);
	segment.Rotation = rotation;
	segment.BackgroundColor3 = Color3.fromRGB(255, 183, 38);
	segment.BorderSizePixel = 0;
	segment.ZIndex = 20;
	segment.Parent = parent;

	const corner = new Instance("UICorner");
	corner.CornerRadius = new UDim(0.5, 0);
	corner.Parent = segment;

	const outline = new Instance("UIStroke");
	outline.Color = Color3.fromRGB(25, 18, 5);
	outline.Thickness = 4;
	outline.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
	outline.Parent = segment;
}

function createIndicator(): Frame {
	const screenGui = new Instance("ScreenGui");
	screenGui.Name = "BallDirectionIndicator";
	screenGui.DisplayOrder = 20;
	screenGui.IgnoreGuiInset = true;
	screenGui.ResetOnSpawn = false;
	screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;

	const indicator = new Instance("Frame");
	indicator.Name = "Arrow";
	indicator.AnchorPoint = new Vector2(0.5, 0.5);
	indicator.Size = UDim2.fromOffset(ARROW_SIZE, ARROW_SIZE);
	indicator.BackgroundTransparency = 1;
	indicator.Visible = false;
	indicator.ZIndex = 20;
	indicator.Parent = screenGui;

	// A solid shaft and two diagonal arms form a font-independent right arrow.
	addArrowSegment(indicator, "Shaft", new Vector2(0.62, 0.18), new Vector2(0.4, 0.5));
	addArrowSegment(indicator, "UpperHead", new Vector2(0.48, 0.18), new Vector2(0.68, 0.35), 45);
	addArrowSegment(indicator, "LowerHead", new Vector2(0.48, 0.18), new Vector2(0.68, 0.65), -45);

	screenGui.Parent = playerGui;
	return indicator;
}

arrow = createIndicator();

// The victory scene (FB_Phase="Ended") points the camera at the lineup, not
// the pitch — the arrow would just sit on screen aiming at the leftover ball.
// Hidden for that phase; the next round's phases bring it straight back.
function matchEnded(): boolean {
	const pitchId = localPlayer.GetAttribute(PITCH_ATTRIBUTE);
	if (!typeIs(pitchId, "string")) {
		return false;
	}
	const mapFolder = Workspace.FindFirstChild("Map");
	const pitch = mapFolder && mapFolder.FindFirstChild(pitchId);
	return pitch !== undefined && pitch.GetAttribute("FB_Phase") === "Ended";
}

function localBall(): BasePart | undefined {
	const pitchId = localPlayer.GetAttribute(PITCH_ATTRIBUTE);
	if (!typeIs(pitchId, "string")) {
		return undefined;
	}
	for (const child of Workspace.GetChildren()) {
		if (child.Name === BALL_NAME && child.IsA("BasePart") && child.GetAttribute(PITCH_ATTRIBUTE) === pitchId) {
			return child;
		}
	}
	return undefined;
}

RunService.RenderStepped.Connect(() => {
	if (!arrow || arrow.Parent === undefined) {
		arrow = createIndicator();
	}
	const currentArrow = arrow;
	const camera = Workspace.CurrentCamera;
	const ball = localBall();
	if (!camera || !ball || ball.Parent === undefined || matchEnded()) {
		currentArrow.Visible = false;
		return;
	}

	const [viewportPoint, onScreen] = camera.WorldToViewportPoint(ball.Position);
	if (onScreen && viewportPoint.Z > 0) {
		currentArrow.Visible = false;
		return;
	}

	const viewport = camera.ViewportSize;
	const center = viewport.div(2);
	let direction = new Vector2(viewportPoint.X - center.X, viewportPoint.Y - center.Y);

	// Roblox mirrors projected coordinates for points behind the camera.
	if (viewportPoint.Z <= 0) {
		direction = direction.mul(-1);
	}
	if (direction.Magnitude < 0.001) {
		// A point exactly behind the camera has no projected 2D direction.
		direction = new Vector2(0, 1);
	}
	direction = direction.Unit;

	const halfWidth = math.max(1, center.X - EDGE_MARGIN);
	const halfHeight = math.max(1, center.Y - EDGE_MARGIN);
	const xScale = math.abs(direction.X) > 0.001 ? halfWidth / math.abs(direction.X) : math.huge;
	const yScale = math.abs(direction.Y) > 0.001 ? halfHeight / math.abs(direction.Y) : math.huge;
	const edgePosition = center.add(direction.mul(math.min(xScale, yScale)));

	currentArrow.Position = UDim2.fromOffset(edgePosition.X, edgePosition.Y);
	currentArrow.Rotation = math.deg(math.atan2(direction.Y, direction.X));
	currentArrow.Visible = true;
});
