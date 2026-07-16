// Original: ServerScriptService/physFixPlease (Script)

const players = game.GetService("Players");

players.PlayerAdded.Connect((player) => {
	player.CharacterRemoving.Connect((character) => {
		character.Destroy();
	});
});
