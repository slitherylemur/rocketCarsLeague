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
const authoredVolume = musicObj.Volume;

const menuMusicId = 1836805380;

const inGameMusicIds = [1839703786, 1839703828, 1839834408, 1845821031];

// The join handshake can deliver the same toggle twice (original fire +
// resend) — dedupe so menu music doesn't audibly restart.
let lastToggle: boolean | undefined = undefined;
FunctionsAndEvents.ToggleMenuCamera.OnClientEvent.Connect((...args: unknown[]) => {
	const toggle = args[0] as boolean;
	if (toggle === lastToggle) {
		return;
	}
	lastToggle = toggle;
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
	musicObj.Volume = authoredVolume * 0.5;

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
	// Keep selection, playback and repeat behaviour intact so gameplay music
	// can be restored later by changing only this temporary mute.
	musicObj.Volume = 0;
	musicObj.Play();

	if (repeatInGame) {
		repeatInGame.Disconnect();
	}

	repeatInGame = musicObj.Ended.Connect(() => {
		inGameMusic();
	});
}
