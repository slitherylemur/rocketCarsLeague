// Replaces the original pattern of mutating the StarterGui *templates*
// server-side (roundHandler set game.StarterGui.Game.Information.Gamemode.Text,
// TeamScore texts and TeamScore.Visible so that every FUTURE clone of the Game
// ScreenGui inherited those values — the engine re-clones StarterGui into
// PlayerGui on every spawn, and initializePlayer clones manually on join/reset).
//
// With React server-rendering the UI, this module carries that same
// template state; PlayerGuiManager reads it whenever it (re)mounts a player's
// UI, which is exactly when the original would have cloned the mutated
// template. Live, already-cloned UIs are unaffected by writes here — matching
// the original's template-only mutations.

export const StarterGuiState = {
	Game: {
		Information: {
			// Original template value in the place file
			GamemodeText: "Gamemode Name",
			// Football hides the whole Information frame (MatchHud carries the
			// clock); template default matches the place file.
			Visible: true,
		},
		TeamScore: {
			// Original template values in the place file
			Visible: false,
			RedText: "Red: 10",
			BlueText: "Blue: 10",
		},
		Leaderboard: {
			// Football hides the kill-icon row (MatchHud shows team rosters).
			Visible: true,
		},
	},
};
