// Original: StarterPlayer/StarterPlayerScripts/music (LocalScript)

import { FunctionsAndEvents } from "shared/FunctionsAndEvents";

const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;
// Original: LocalPlayer.PlayerScripts:WaitForChild("gameMusic") — the gameMusic
// Sound was a plain child of StarterPlayerScripts and is recreated here since
// only scripts are removed from the original place... it remains an instance in
// StarterPlayerScripts, so the original WaitForChild still resolves it.
const musicObj = (LocalPlayer as unknown as { PlayerScripts: Instance }).PlayerScripts.WaitForChild(
	"gameMusic",
) as Sound;

const menuMusicId = 1836805380;

const inGameMusicIds = [1839703786, 1839703828, 1839834408, 1845821031];

FunctionsAndEvents.ToggleMenuCamera.OnClientEvent.Connect((...args: unknown[]) => {
	const toggle = args[0] as boolean;
	if (toggle) {
		menuMusic();
	} else {
		inGameMusic();
	}
});

let repeatInGame: RBXScriptConnection | undefined = undefined;

function menuMusic() {
	musicObj.SoundId = "rbxassetid://" + menuMusicId;
	musicObj.Looped = true;

	if (repeatInGame) {
		repeatInGame.Disconnect();
	}

	musicObj.Play();
}

let lastId: number | undefined = undefined;

function inGameMusic() {
	const soundID = inGameMusicIds[math.random(1, inGameMusicIds.size()) - 1];

	if (lastId === soundID) {
		inGameMusic();
	} else {
		lastId = soundID;
	}

	musicObj.SoundId = "rbxassetid://" + soundID;

	musicObj.Looped = false;
	musicObj.Play();

	if (repeatInGame) {
		repeatInGame.Disconnect();
	}

	repeatInGame = musicObj.Ended.Connect(() => {
		inGameMusic();
	});
}
