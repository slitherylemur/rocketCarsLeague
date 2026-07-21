// ReplicatedFirst loading screen: a black cover with the game logo that stays
// up until the menu camera has actually been applied, hiding the sky flash
// between the Roblox loading screen dismissing and the garage shot landing.
//
// Deliberately import-free: ReplicatedFirst LocalScripts run before the rest
// of the game replicates, and requiring the roblox-ts runtime (which lives in
// ReplicatedStorage) would stall this script behind exactly the loading work
// it is meant to cover.

const Players = game.GetService("Players");
const TweenService = game.GetService("TweenService");
const ReplicatedFirst = game.GetService("ReplicatedFirst");

const TITLE_IMAGE = "rbxassetid://103972010667054"; // same art as LandingGui
const FREDOKA = new Font("rbxasset://fonts/families/FredokaOne.json");

const player = Players.LocalPlayer;
const playerGui = player.WaitForChild("PlayerGui");

const screenGui = new Instance("ScreenGui");
screenGui.Name = "LoadingScreen";
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
// Only after our own cover is visible — otherwise there'd be a frame of
// nothing between the default screen leaving and ours arriving.
ReplicatedFirst.RemoveDefaultLoadingScreen();

// Animate the ellipsis so the screen never looks hung.
let animating = true;
task.spawn(() => {
	let dots = 0;
	while (animating) {
		dots = (dots + 1) % 4;
		loadingText.Text = "LOADING" + string.rep(".", dots);
		task.wait(0.4);
	}
});

// Hold until menuCamera reports the garage shot applied (MenuCameraApplied
// attribute), or a character exists (spawned straight into play), with a hard
// timeout so a broken flow can never trap the player behind the cover.
const deadline = os.clock() + 20;
while (os.clock() < deadline) {
	if (player.GetAttribute("MenuCameraApplied") === true) {
		break;
	}
	if (player.Character !== undefined) {
		break;
	}
	task.wait(0.1);
}
// One beat for the garage around the freshly-placed camera to finish
// streaming in before we reveal it.
task.wait(0.5);

animating = false;
const fadeInfo = new TweenInfo(0.6, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);
TweenService.Create(cover, fadeInfo, { BackgroundTransparency: 1 }).Play();
TweenService.Create(logo, fadeInfo, { ImageTransparency: 1 }).Play();
const textFade = TweenService.Create(loadingText, fadeInfo, { TextTransparency: 1 });
textFade.Play();
textFade.Completed.Wait();
screenGui.Destroy();
