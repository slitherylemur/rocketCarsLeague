// Neutral waiting presentation. Competitive MatchHud stays completely
// disabled in muckabout so no side, score, face-off or victory state leaks in.

const Players = game.GetService("Players");
const player = Players.LocalPlayer;
const playerGui = player.WaitForChild("PlayerGui") as PlayerGui;

const gui = new Instance("ScreenGui");
gui.Name = "MuckaboutHud";
gui.ResetOnSpawn = false;
gui.IgnoreGuiInset = true;
gui.DisplayOrder = 18;
gui.Enabled = false;

const label = new Instance("TextLabel");
label.Name = "WaitingMessage";
label.AnchorPoint = new Vector2(0.5, 0);
label.Position = UDim2.fromScale(0.5, 0.055);
label.Size = UDim2.fromOffset(430, 42);
label.BackgroundColor3 = Color3.fromRGB(9, 15, 24);
label.BackgroundTransparency = 0.18;
label.BorderSizePixel = 0;
label.Font = Enum.Font.GothamBold;
label.Text = "FREE PLAY  •  WAITING FOR AN OPPONENT";
label.TextColor3 = Color3.fromRGB(240, 245, 255);
label.TextScaled = true;
label.Parent = gui;

const padding = new Instance("UIPadding");
padding.PaddingLeft = new UDim(0, 14);
padding.PaddingRight = new UDim(0, 14);
padding.PaddingTop = new UDim(0, 8);
padding.PaddingBottom = new UDim(0, 8);
padding.Parent = label;

const corner = new Instance("UICorner");
corner.CornerRadius = new UDim(0, 10);
corner.Parent = label;

gui.Parent = playerGui;

function refresh() {
	gui.Enabled =
		player.GetAttribute("CB_ArenaKind") === "Muckabout" &&
		typeIs(player.GetAttribute("CB_PitchId"), "string") &&
		player.GetAttribute("CB_MatchId") === undefined;
}

player.GetAttributeChangedSignal("CB_ArenaKind").Connect(refresh);
player.GetAttributeChangedSignal("CB_PitchId").Connect(refresh);
player.GetAttributeChangedSignal("CB_MatchId").Connect(refresh);
refresh();
