// Keep Roblox chat scoped to active gameplay. Camera transitions alone are not
// authoritative because PlayerGui is remounted when entering/leaving matches.

const Players = game.GetService("Players");
const StarterGui = game.GetService("StarterGui");
const playerGui = Players.LocalPlayer.WaitForChild("PlayerGui") as PlayerGui;

const watchedNames = new Set(["Game", "Garage", "Landing"]);
const enabledConnections = new Map<ScreenGui, RBXScriptConnection>();

function findScreen(name: string): ScreenGui | undefined {
	const child = playerGui.FindFirstChild(name);
	return child?.IsA("ScreenGui") ? child : undefined;
}

function updateChatVisibility() {
	const gameGui = findScreen("Game");
	const garageGui = findScreen("Garage");
	const landingGui = findScreen("Landing");
	const inGame = gameGui?.Enabled === true && garageGui?.Enabled !== true && landingGui?.Enabled !== true;

	pcall(() => StarterGui.SetCoreGuiEnabled(Enum.CoreGuiType.Chat, inGame));
}

function watchScreen(instance: Instance) {
	if (!instance.IsA("ScreenGui") || !watchedNames.has(instance.Name) || enabledConnections.has(instance)) {
		return;
	}

	enabledConnections.set(instance, instance.GetPropertyChangedSignal("Enabled").Connect(updateChatVisibility));
	instance.Destroying.Connect(() => {
		enabledConnections.get(instance)?.Disconnect();
		enabledConnections.delete(instance);
		task.defer(updateChatVisibility);
	});
}

for (const child of playerGui.GetChildren()) {
	watchScreen(child);
}

playerGui.ChildAdded.Connect((child) => {
	watchScreen(child);
	task.defer(updateChatVisibility);
});
playerGui.ChildRemoved.Connect(() => task.defer(updateChatVisibility));

updateChatVisibility();
