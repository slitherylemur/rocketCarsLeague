// Original: StarterPlayer/StarterPlayerScripts/gameUi (LocalScript)

import { FunctionsAndEvents } from "shared/FunctionsAndEvents";

const PlayerService = game.GetService("Players");
const LocalPlayer = PlayerService.LocalPlayer;
let roundTime = 0;

game.GetService("StarterGui").SetCoreGuiEnabled(Enum.CoreGuiType.Chat, false);
// The match HUD supplies the relevant roster and vehicle state, so the
// Roblox player list and humanoid health CoreGui only duplicate information.
game.GetService("StarterGui").SetCoreGuiEnabled(Enum.CoreGuiType.PlayerList, false);
game.GetService("StarterGui").SetCoreGuiEnabled(Enum.CoreGuiType.Health, false);

interface PlayerIconUi extends Frame {
	Value: TextLabel;
	Person: ImageLabel;
}

interface GameGuiShape extends ScreenGui {
	Leaderboard: Frame;
	TeamScore: Frame & { Red: TextLabel; Blue: TextLabel };
	Information: Frame & { Clock: TextLabel };
	Spectate: Frame & {
		Information: Frame & { name: TextLabel };
		Left: TextButton;
		Right: TextButton;
	};
	CloseToWin: Frame & { TextLabel: TextLabel };
	Killcam: Frame;
}

type PlayerWithKills = Player & { kills: NumberValue };

function getPlayerIcon(player: Player): string {
	const userId = player.UserId;
	const thumbType = Enum.ThumbnailType.HeadShot;
	const thumbSize = Enum.ThumbnailSize.Size420x420;
	const [content, isReady] = PlayerService.GetUserThumbnailAsync(userId, thumbType, thumbSize);

	return content;
}

function addKillUi(player: Player) {
	const localGui = (LocalPlayer as unknown as { PlayerGui: Instance }).PlayerGui;
	for (const p of (localGui.WaitForChild("Game") as GameGuiShape).Leaderboard.GetChildren()) {
		if (p.Name === tostring(player.UserId)) {
			return;
		}
	}

	const playerIcon = (
		game.GetService("ReplicatedStorage") as unknown as { Ui: { PlayerIcon: PlayerIconUi } }
	).Ui.PlayerIcon.Clone();
	playerIcon.Parent = (localGui.WaitForChild("Game") as GameGuiShape).Leaderboard;
	playerIcon.Value.Text = tostring((player.WaitForChild("kills") as NumberValue).Value);
	playerIcon.Name = tostring(player.UserId);
	if (player.Neutral === false) {
		playerIcon.BackgroundColor3 = player.TeamColor.Color;
	}
	playerIcon.Person.Image = getPlayerIcon(player);
	playerIcon.LayoutOrder = -(player.WaitForChild("kills") as NumberValue).Value;
	(player.WaitForChild("kills") as NumberValue).Changed.Connect((val) => {
		playerIcon.Value.Text = tostring(val);
		playerIcon.LayoutOrder = -val;
	});
}

function removeKillUi(player: Player) {
	const localGui = (LocalPlayer as unknown as { PlayerGui: Instance }).PlayerGui;
	const killUi = (localGui.WaitForChild("Game") as GameGuiShape).Leaderboard.FindFirstChild(
		tostring(player.UserId),
	);

	if (killUi) {
		killUi.Destroy();
	}
}

PlayerService.PlayerAdded.Connect((player) => {
	addKillUi(player);
});

PlayerService.PlayerRemoving.Connect((player) => {
	removeKillUi(player);
});

LocalPlayer.CharacterAdded.Connect((character) => {
	for (const player of PlayerService.GetPlayers()) {
		addKillUi(player);
	}
});

const Teams = game.GetService("Teams") as unknown as {
	Red: Team & { Kills: NumberValue };
	Blue: Team & { Kills: NumberValue };
};

Teams.Red.Kills.Changed.Connect((val) => {
	pcall(() => {
		((LocalPlayer.WaitForChild("PlayerGui") as Instance & { Game: GameGuiShape }).Game as GameGuiShape).TeamScore.Red.Text =
			"Red: " + val;
	});
});

Teams.Blue.Kills.Changed.Connect((val) => {
	pcall(() => {
		((LocalPlayer.WaitForChild("PlayerGui") as Instance & { Game: GameGuiShape }).Game as GameGuiShape).TeamScore.Blue.Text =
			"Blue: " + val;
	});
});

FunctionsAndEvents.UiTimer.OnClientEvent.Connect((...args: unknown[]) => {
	const [toggle, gameTime] = args as [boolean, number];
	roundTime = gameTime;

	if (!toggle) {
		roundTime = 0;
		updateTimeUi();
		return;
	}

	while (roundTime > 0) {
		roundTime -= 1;
		updateTimeUi();
		task.wait(1);
	}
});

FunctionsAndEvents.EndScreen.OnClientEvent.Connect(() => {
	// WaitForChild: under StreamingEnabled the VictoryStage may not have
	// streamed in when the end screen fires.
	const cameraPart = game.Workspace.WaitForChild("VictoryStage").WaitForChild("Camera") as BasePart;

	const camera = game.Workspace.CurrentCamera!;
	camera.CameraType = Enum.CameraType.Scriptable;
	camera.CFrame = cameraPart.CFrame;
});

function updateTimeUi() {
	const minutes = math.floor(roundTime / 60);
	const seconds = roundTime - minutes * 60;

	const minString = "0" + tostring(minutes);
	const secString = "0" + tostring(seconds);

	const localGui = (LocalPlayer as unknown as { PlayerGui: Instance }).PlayerGui;
	(localGui.WaitForChild("Game") as GameGuiShape).Information.Clock.Text =
		string.sub(minString, minString.size() - 1, minString.size()) +
		":" +
		string.sub(secString, secString.size() - 1, secString.size());
}

let spectatingPlayer: Player | undefined = undefined;

function SpectatePlayer(playerToSpectate: Player | undefined) {
	if (playerToSpectate === undefined) {
		for (const p of PlayerService.GetPlayers()) {
			if (PlayerCharacterExistsAndIsAlive(p)) {
				playerToSpectate = p;
				break;
			}
		}
	}

	spectatingPlayer = playerToSpectate;
	const camera = game.Workspace.CurrentCamera!;
	camera.CameraType = Enum.CameraType.Custom;
	camera.CameraSubject = playerToSpectate!.Character as unknown as Humanoid;
	const SpectateUi = ((LocalPlayer as unknown as { PlayerGui: { Game: GameGuiShape } }).PlayerGui.Game as GameGuiShape)
		.Spectate;
	SpectateUi.Information.name.Text = playerToSpectate!.Name;
}

let connections = new Map<number, RBXScriptConnection>();

function disconnectExistingConnections() {
	for (const [, connection] of pairs(connections)) {
		connection.Disconnect();
	}
	connections = new Map();
}

function getPlayerIndex(player: Player, players: Player[]): number {
	let playerIndex = 0;
	for (const [i, p] of ipairs(players)) {
		if (p.UserId === player.UserId) {
			playerIndex = i;
			break;
		}
	}
	return playerIndex;
}

function PlayerCharacterExistsAndIsAlive(player: Player): boolean {
	if (
		player.Character === undefined ||
		player.Character.FindFirstChild("Humanoid") === undefined ||
		(player.Character.FindFirstChild("Humanoid") as Humanoid).Health <= 0
	) {
		return false;
	}
	return true;
}

function GetNextPlayerToSpectate(currentPlayer: Player, Direction: number): Player {
	const players = PlayerService.GetPlayers();
	const currentPlayerIndex = getPlayerIndex(currentPlayer, players);
	let nextPlayerIndex = currentPlayerIndex + Direction;

	if (nextPlayerIndex > players.size()) {
		nextPlayerIndex = 1;
	} else if (nextPlayerIndex < 1) {
		nextPlayerIndex = players.size();
	}

	//check that the player has a character and is alive and if not go to the next player and check again
	while (!PlayerCharacterExistsAndIsAlive(players[nextPlayerIndex - 1])) {
		nextPlayerIndex = nextPlayerIndex + Direction;

		if (nextPlayerIndex > players.size()) {
			nextPlayerIndex = 1;
		} else if (nextPlayerIndex < 1) {
			nextPlayerIndex = players.size();
		}
	}

	return players[nextPlayerIndex - 1];
}

FunctionsAndEvents.spectatePlayer.OnClientEvent.Connect((...args: unknown[]) => {
	const playerToSpectate = args[0] as Player | undefined;
	SpectatePlayer(playerToSpectate);
	disconnectExistingConnections();
	const SpectateUi = ((LocalPlayer as unknown as { PlayerGui: { Game: GameGuiShape } }).PlayerGui.Game as GameGuiShape)
		.Spectate;
	connections.set(
		1,
		SpectateUi.Left.MouseButton1Click.Connect(() => {
			//Find the previouse player to spectate
			const nextPlayer = GetNextPlayerToSpectate(spectatingPlayer!, -1);
			SpectatePlayer(nextPlayer);
		}),
	);
	connections.set(
		2,
		SpectateUi.Right.MouseButton1Click.Connect(() => {
			//Find the next player to spectate
			const nextPlayer = GetNextPlayerToSpectate(spectatingPlayer!, 1);
			SpectatePlayer(nextPlayer);
		}),
	);
});

FunctionsAndEvents.CloseToWin.OnClientEvent.Connect((...args: unknown[]) => {
	const name = args[0] as string;
	const gui = (LocalPlayer as unknown as { PlayerGui: { Game: GameGuiShape } }).PlayerGui.Game as GameGuiShape;
	gui.CloseToWin.TextLabel.Text = name + " is close winning!";
	gui.CloseToWin.Visible = true;
});

FunctionsAndEvents.infoUi.OnClientEvent.Connect((...args: unknown[]) => {
	const messages = args[0] as string[];
	for (const message of messages) {
		const infoUi = (
			game.GetService("ReplicatedStorage") as unknown as { Ui: { infoUi: Frame & { Message: TextLabel } } }
		).Ui.infoUi.Clone();
		infoUi.Message.Text = message;

		infoUi.Parent = (
			(LocalPlayer as unknown as { PlayerGui: Instance }).PlayerGui.WaitForChild("Game") as GameGuiShape
		).Killcam;

		task.delay(10, () => {
			infoUi.Destroy();
		});
	}
});

(LocalPlayer as unknown as { PlayerGui: Instance }).PlayerGui.ChildAdded.Connect((child) => {
	if (child.Name === "TouchGui") {
		child.WaitForChild("TouchControlFrame").WaitForChild("JumpButton").Destroy();
	}
});

// --pcall(function()
// wait(1)
const resetBindable = new Instance("BindableEvent");
resetBindable.Event.Connect(() => {
	FunctionsAndEvents.PlayerReset.FireServer();
});
//game:GetService("StarterGui"):SetCore("ResetButtonCallback", resetBindable )
// --end)

// Original used a do-block declaring coreCall with retries.
const MAX_RETRIES = 8;

function coreCall(method: string, ...args: unknown[]): LuaTuple<[boolean, ...unknown[]]> {
	const StarterGui = game.GetService("StarterGui");
	const RunService = game.GetService("RunService");

	let result: LuaTuple<[boolean, ...unknown[]]> = pcall(() => {}) as never;
	for (let retries = 1; retries <= MAX_RETRIES; retries++) {
		result = pcall(
			(StarterGui as unknown as Record<string, (self: unknown, ...callArgs: unknown[]) => unknown>)[method],
			StarterGui,
			...args,
		) as LuaTuple<[boolean, ...unknown[]]>;
		if (result[0]) {
			break;
		}
		RunService.Stepped.Wait();
	}
	return result;
}

coreCall("SetCore", "ResetButtonCallback", resetBindable);
