// Original: StarterPlayer/StarterPlayerScripts/TerrainReset (LocalScript)

const GuiService = game.GetService("GuiService");
const Players = game.GetService("Players");
const UserInputService = game.GetService("UserInputService");

if (GuiService.IsTenFootInterface() || (UserInputService.KeyboardEnabled === false && UserInputService.TouchEnabled)) {
	game.Workspace.Terrain.SetMaterialColor(Enum.Material.Limestone, Color3.fromRGB(143, 107, 86));
	game.Workspace.Terrain.SetMaterialColor(Enum.Material.Sand, Color3.fromRGB(166, 131, 96));
	game.Workspace.Terrain.SetMaterialColor(Enum.Material.Ground, Color3.fromRGB(99, 79, 59));
	game.Workspace.Terrain.SetMaterialColor(Enum.Material.Mud, Color3.fromRGB(44, 17, 0));
	game.Workspace.Terrain.SetMaterialColor(Enum.Material.Snow, Color3.fromRGB(63, 46, 20));
	game.Workspace.Terrain.SetMaterialColor(Enum.Material.Sandstone, Color3.fromRGB(137, 90, 71));
}
