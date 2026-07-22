// Mid-round pitch-move cover: the server sets the CB_PitchMoveCover player
// attribute while it teleports a free-playing team onto their real match
// pitch (footballMatch.moveTeamBehindCover), and this script shows the same
// black logo + LOADING... cover as the join-time loading screen so the
// teleport is hidden. Clearing the attribute fades it out; a hard timeout
// guarantees a broken flow can never trap the player behind it.

const Players = game.GetService("Players");
const TweenService = game.GetService("TweenService");

const COVER_ATTR = "CB_PitchMoveCover";
const TITLE_IMAGE = "rbxassetid://103972010667054"; // same art as LandingGui
const FREDOKA = new Font("rbxasset://fonts/families/FredokaOne.json");
const FAILSAFE_TIME = 6;

const player = Players.LocalPlayer;
const playerGui = player.WaitForChild("PlayerGui") as PlayerGui;

let current: ScreenGui | undefined;
let generation = 0;
let activeToken: unknown;

function hideCover() {
	const gui = current;
	if (!gui) {
		return;
	}
	current = undefined;
	generation += 1;
	const cover = gui.FindFirstChild("Cover") as Frame | undefined;
	if (!cover) {
		gui.Destroy();
		return;
	}
	const fadeInfo = new TweenInfo(0.6, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);
	TweenService.Create(cover, fadeInfo, { BackgroundTransparency: 1 }).Play();
	const logo = cover.FindFirstChild("Logo");
	if (logo && logo.IsA("ImageLabel")) {
		TweenService.Create(logo, fadeInfo, { ImageTransparency: 1 }).Play();
	}
	const text = cover.FindFirstChild("LoadingText");
	if (text && text.IsA("TextLabel")) {
		TweenService.Create(text, fadeInfo, { TextTransparency: 1 }).Play();
	}
	task.delay(0.65, () => gui.Destroy());
}

function showCover(token: unknown) {
	if (current) {
		activeToken = token;
		generation += 1;
		const refreshGeneration = generation;
		const gui = current;
		task.delay(FAILSAFE_TIME, () => {
			if (generation === refreshGeneration && current === gui && activeToken === token) hideCover();
		});
		return;
	}
	activeToken = token;
	generation += 1;
	const gen = generation;

	const screenGui = new Instance("ScreenGui");
	screenGui.Name = "PitchTransition";
	screenGui.DisplayOrder = 1000;
	screenGui.IgnoreGuiInset = true;
	screenGui.ResetOnSpawn = false;

	const cover = new Instance("Frame");
	cover.Name = "Cover";
	cover.BackgroundColor3 = new Color3(0, 0, 0);
	cover.BorderSizePixel = 0;
	cover.Size = new UDim2(1, 0, 1, 0);
	cover.Parent = screenGui;

	const logo = new Instance("ImageLabel");
	logo.Name = "Logo";
	logo.AnchorPoint = new Vector2(0.5, 0.5);
	logo.BackgroundTransparency = 1;
	logo.Image = TITLE_IMAGE;
	logo.Position = new UDim2(0.5, 0, 0.45, 0);
	logo.ScaleType = Enum.ScaleType.Fit;
	logo.Size = new UDim2(0.55, 0, 0.4, 0);
	logo.Parent = cover;

	const loadingText = new Instance("TextLabel");
	loadingText.Name = "LoadingText";
	loadingText.AnchorPoint = new Vector2(0.5, 0.5);
	loadingText.BackgroundTransparency = 1;
	loadingText.FontFace = FREDOKA;
	loadingText.Position = new UDim2(0.5, 0, 0.72, 0);
	loadingText.Size = new UDim2(0.5, 0, 0.05, 0);
	loadingText.Text = "LOADING...";
	loadingText.TextColor3 = new Color3(1, 1, 1);
	loadingText.TextScaled = true;
	loadingText.TextTransparency = 0.2;
	loadingText.Parent = cover;

	screenGui.Parent = playerGui;
	current = screenGui;

	// Animated ellipsis, same as the join loading screen.
	task.spawn(() => {
		let dots = 0;
		while (generation === gen && current === screenGui) {
			dots = (dots + 1) % 4;
			loadingText.Text = "LOADING" + string.rep(".", dots);
			task.wait(0.4);
		}
	});

	task.delay(FAILSAFE_TIME, () => {
		if (generation === gen && current === screenGui && activeToken === token) {
			hideCover();
		}
	});
}

player.GetAttributeChangedSignal(COVER_ATTR).Connect(() => {
	const token = player.GetAttribute(COVER_ATTR);
	if (token !== undefined) {
		showCover(token);
	} else {
		activeToken = undefined;
		hideCover();
	}
});

// Covers survive across the script's own start: if the attribute was already
// set when we connected (spawn race), honour it.
const initialToken = player.GetAttribute(COVER_ATTR);
if (initialToken !== undefined) {
	showCover(initialToken);
}
