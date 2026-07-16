// Original: ServerScriptService/SoftShutdown (Script)

game.BindToClose(() => {
	if (!game.GetService("RunService").IsStudio()) {
		game.GetService("TeleportService").TeleportPartyAsync(game.PlaceId, game.GetService("Players").GetPlayers());
	}
});
