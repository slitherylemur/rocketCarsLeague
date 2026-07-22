// Game HUD deriver (client-side UI migration, Phase 6).
//
// The Game ScreenGui is CLIENT-mounted (bootstrap.client.ts) — this script
// owns everything the server used to write into its instances:
//
//   * Enabled — the old server sequence was: mount Enabled=false, then
//     Game.Enabled = true right after SpawnInPlayer's LoadCharacter+remount,
//     then back to false via the menu remount. Faithful derivation:
//     Enabled while CB_FlowState is "match", or "spawning" once a character
//     exists (SpawnInPlayer writes "spawning" at the button press but the old
//     enable only landed after LoadCharacter — gating on the character
//     reproduces that timing, and the menu flows destroy the character).
//     coreChatVisibility.client.ts keys chat off this same property, so the
//     chat scope is unchanged.
//   * Money label — rendered from the CB_Money attribute (setPlayerCash is a
//     pure publication now).
//   * BoostMeter.Visible — the old spawnVehicle write set it true right after
//     seating and only a remount reset it; derived here from the seat state
//     (visible while seated in a vehicle — vehicleRenderer.client.ts keeps
//     rendering the fill).
//   * Deathmatch chrome (dormant FFA/TDM support) — Information/Gamemode text
//     and the Information/Leaderboard/TeamScore visibility derive from the
//     CB_Gamemode replicated attribute (replaces roundHandler's StarterGui
//     template mutations; Football hides all three).
//   * ResultScreen / end screen (dormant FFA/TDM) — CB_EndScreen player attr:
//     set = hide the chrome (the old disablePlayerUi loop); a stats payload
//     additionally fills the PlayerBanner and shows the ResultScreen; cleared
//     = ResultScreen off, chrome restored (the old remount did that).
//   * WhoKilledYou + Spectate (dormant non-football death path) — CB_Killer
//     player attr (JSON {name, kills, userId}): banner fill + 9 s auto-hide +
//     click dismiss are client-local; the Spectate frame shows while the
//     attribute is set. Its Respawn button (and gamepad Y, the old server Y
//     handler's spectate branch) fires Intent_ReturnToMenu; the spectate
//     CAMERA is still driven by gameUi.client.ts from the spectatePlayer
//     remote (contract unchanged).

import { getUiIntentEvent } from "shared/UiIntents";

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const UserInputService = game.GetService("UserInputService");
const HttpService = game.GetService("HttpService");
const LocalPlayer = Players.LocalPlayer;

interface GameGuiShape extends ScreenGui {
	Information: Frame & { Gamemode: TextLabel };
	Leaderboard: Frame;
	Killcam: Frame;
	TeamScore: Frame & { Red: TextLabel; Blue: TextLabel };
	Money: Frame & { Currency: Frame & { TextLabel: TextLabel } };
	BoostMeter: CanvasGroup;
	CloseToWin: Frame;
	Controls: Frame;
	Spectate: Frame & { Information: Frame & { Respawn: TextButton } };
	WhoKilledYou: TextButton & {
		Content: Frame & { KillerName: TextLabel; kills: TextLabel; Person: ImageLabel };
	};
	ResultScreen: Frame & {
		PlayerBanner: Frame & {
			playerIcon: ImageLabel;
			username: TextLabel;
			kills: TextLabel;
			deaths: TextLabel;
			money: TextLabel;
		};
	};
}

const playerGui = LocalPlayer.WaitForChild("PlayerGui");
// bootstrap.client.ts mounts synchronously at client start; WaitForChild
// tolerates either script-start order.
const gameGui = playerGui.WaitForChild("Game") as GameGuiShape;

// Prefetched so the input/click handlers never yield on WaitForChild.
let returnToMenuRemote: RemoteEvent | undefined;
task.spawn(() => {
	returnToMenuRemote = getUiIntentEvent("Intent_ReturnToMenu");
});

function fireReturnToMenu() {
	const remote = returnToMenuRemote;
	if (remote) {
		remote.FireServer();
	}
}

// ---- Enabled ---------------------------------------------------------------

function flowState(): string | undefined {
	const state = LocalPlayer.GetAttribute("CB_FlowState");
	return typeIs(state, "string") ? state : undefined;
}

function refreshEnabled() {
	const state = flowState();
	gameGui.Enabled = state === "match" || (state === "spawning" && LocalPlayer.Character !== undefined);
}

LocalPlayer.GetAttributeChangedSignal("CB_FlowState").Connect(refreshEnabled);
LocalPlayer.CharacterAdded.Connect(() => refreshEnabled());
LocalPlayer.CharacterRemoving.Connect(() => task.defer(refreshEnabled));

// ---- money label -----------------------------------------------------------

function commaNumber(n: number): string {
	const raw = tostring(math.floor(n));
	let out = "";
	let count = 0;
	for (let i = raw.size(); i >= 1; i--) {
		out = string.sub(raw, i, i) + out;
		count += 1;
		if (count % 3 === 0 && i > 1) {
			out = "," + out;
		}
	}
	return out;
}

function refreshMoney() {
	const money = LocalPlayer.GetAttribute("CB_Money");
	if (typeIs(money, "number")) {
		gameGui.Money.Currency.TextLabel.Text = "$" + commaNumber(money);
	}
}

LocalPlayer.GetAttributeChangedSignal("CB_Money").Connect(refreshMoney);

// ---- boost meter (visible while seated in a car) ---------------------------

let seatConnections: RBXScriptConnection[] = [];

function refreshBoostMeter(humanoid: Humanoid | undefined) {
	const seat = humanoid ? humanoid.SeatPart : undefined;
	gameGui.BoostMeter.Visible = seat !== undefined && seat.IsA("VehicleSeat");
}

function watchCharacterSeat(character: Model) {
	for (const connection of seatConnections) {
		connection.Disconnect();
	}
	seatConnections = [];
	refreshBoostMeter(undefined);
	task.spawn(() => {
		const humanoid = character.WaitForChild("Humanoid", 15) as Humanoid | undefined;
		if (!humanoid || character.Parent === undefined) {
			return;
		}
		seatConnections.push(humanoid.Seated.Connect(() => refreshBoostMeter(humanoid)));
		seatConnections.push(humanoid.GetPropertyChangedSignal("SeatPart").Connect(() => refreshBoostMeter(humanoid)));
		refreshBoostMeter(humanoid);
	});
}

LocalPlayer.CharacterAdded.Connect(watchCharacterSeat);
LocalPlayer.CharacterRemoving.Connect(() => {
	for (const connection of seatConnections) {
		connection.Disconnect();
	}
	seatConnections = [];
	refreshBoostMeter(undefined);
});
if (LocalPlayer.Character) {
	watchCharacterSeat(LocalPlayer.Character);
}

// ---- gamemode chrome (Information / Leaderboard / TeamScore) ---------------
// Replaces roundHandler's StarterGui template mutations. Football (the only
// live mode) hides all three; the FFA/TDM values are kept for the dormant
// deathmatch machinery (roundHandler keeps its game-logic halves).

function gamemodeDisplayName(mode: string): string | undefined {
	if (mode === "FFA") {
		return "Free For All";
	} else if (mode === "TDM") {
		return "Team Deathmatch";
	} else if (mode === "Football") {
		return "Football";
	}
	return undefined;
}

function currentGamemode(): string | undefined {
	const mode = ReplicatedStorage.GetAttribute("CB_Gamemode");
	return typeIs(mode, "string") ? mode : undefined;
}

let lastMode: string | undefined;

function applyChrome() {
	if (endScreenRaw() !== undefined) {
		// The end screen owns the chrome while CB_EndScreen is set.
		return;
	}
	const mode = currentGamemode();
	const displayName = mode !== undefined ? gamemodeDisplayName(mode) : undefined;
	if (displayName !== undefined) {
		gameGui.Information.Gamemode.Text = displayName;
	}
	const deathmatch = mode === "FFA" || mode === "TDM";
	gameGui.Information.Visible = deathmatch;
	gameGui.Leaderboard.Visible = deathmatch;
	gameGui.TeamScore.Visible = mode === "TDM";
	if (mode === "TDM" && lastMode !== "TDM") {
		// turnOnTeamUi's template reset; gameUi.client.ts keeps the labels live
		// from the Teams Kills.Changed events afterwards.
		gameGui.TeamScore.Red.Text = "Red: 0";
		gameGui.TeamScore.Blue.Text = "Blue: 0";
	}
	lastMode = mode;
}

ReplicatedStorage.GetAttributeChangedSignal("CB_Gamemode").Connect(applyChrome);

// ---- end screen (dormant FFA/TDM ResultScreen) -----------------------------

function endScreenRaw(): string | undefined {
	const raw = LocalPlayer.GetAttribute("CB_EndScreen");
	return typeIs(raw, "string") ? raw : undefined;
}

const thumbnailCache = new Map<number, string>();

function fetchThumbnail(userId: number, apply: (image: string) => void) {
	const cached = thumbnailCache.get(userId);
	if (cached !== undefined) {
		apply(cached);
		return;
	}
	task.spawn(() => {
		const [ok, content] = pcall(() => {
			const [image] = Players.GetUserThumbnailAsync(
				userId,
				Enum.ThumbnailType.HeadShot,
				Enum.ThumbnailSize.Size420x420,
			);
			return image;
		});
		if (ok && typeIs(content, "string")) {
			thumbnailCache.set(userId, content);
			apply(content);
		}
	});
}

function refreshEndScreen() {
	const raw = endScreenRaw();
	if (raw === undefined) {
		// Cleared: the old flow remounted a fresh gui — restore the defaults.
		gameGui.ResultScreen.Visible = false;
		gameGui.Killcam.Visible = true;
		gameGui.Controls.Visible = true;
		gameGui.Money.Visible = true;
		gameGui.CloseToWin.Visible = false;
		applyChrome();
		refreshSpectate();
		return;
	}
	// Set: the old disablePlayerUi loop — every Frame/TextButton except the
	// ResultScreen goes invisible.
	for (const child of gameGui.GetChildren()) {
		if ((child.IsA("Frame") || child.IsA("TextButton")) && child.Name !== "ResultScreen") {
			child.Visible = false;
		}
	}
	// A stats payload (showPlayerBanner) fills the banner and shows the screen;
	// the empty "{}" from disablePlayerUi only hides the chrome, like the
	// original ordering (banner appeared a beat later).
	const [ok, decoded] = pcall(() => HttpService.JSONDecode(raw));
	const stats = ok && typeIs(decoded, "table") ? (decoded as { kills?: number; deaths?: number; money?: number }) : undefined;
	if (stats !== undefined && stats.money !== undefined) {
		const banner = gameGui.ResultScreen.PlayerBanner;
		banner.username.Text = LocalPlayer.Name;
		banner.kills.Text = "Kills: " + tostring(stats.kills ?? 0);
		banner.deaths.Text = "Deaths: " + tostring(stats.deaths ?? 0);
		banner.money.Text = "+" + tostring(stats.money) + " $";
		fetchThumbnail(LocalPlayer.UserId, (image) => {
			banner.playerIcon.Image = image;
		});
		gameGui.ResultScreen.Visible = true;
	}
}

LocalPlayer.GetAttributeChangedSignal("CB_EndScreen").Connect(refreshEndScreen);

// ---- killed-by banner + spectate frame (dormant non-football deaths) -------

interface KillerPayload {
	name: string;
	kills: number;
	userId: number;
}

function decodeKiller(): KillerPayload | undefined {
	const raw = LocalPlayer.GetAttribute("CB_Killer");
	if (!typeIs(raw, "string") || raw === "") {
		return undefined;
	}
	const [ok, decoded] = pcall(() => HttpService.JSONDecode(raw) as KillerPayload);
	if (!ok || !typeIs(decoded, "table")) {
		return undefined;
	}
	return decoded as KillerPayload;
}

// Nonce so a newer kill's 9 s auto-hide timer never hides the banner a fresh
// kill just re-showed.
let killedByShowSeq = 0;

function refreshSpectate() {
	const killer = decodeKiller();
	if (killer === undefined) {
		gameGui.Spectate.Visible = false;
		gameGui.WhoKilledYou.Visible = false;
		return;
	}
	if (endScreenRaw() !== undefined) {
		return; // the end screen hid everything — matches the old hide loop
	}
	const killedBy = gameGui.WhoKilledYou;
	killedBy.Content.KillerName.Text = killer.name;
	killedBy.Content.kills.Text = tostring(killer.kills);
	fetchThumbnail(killer.userId, (image) => {
		killedBy.Content.Person.Image = image;
	});
	killedBy.Visible = true;
	killedByShowSeq += 1;
	const seq = killedByShowSeq;
	// The original showKilledByScreen's 9 s auto-hide, run locally now.
	task.delay(9, () => {
		if (seq === killedByShowSeq) {
			killedBy.Visible = false;
		}
	});
	// The old enableSpectateScreen: Respawn is already Visible in the shell.
	gameGui.Spectate.Information.Respawn.Visible = true;
	gameGui.Spectate.Visible = true;
}

LocalPlayer.GetAttributeChangedSignal("CB_Killer").Connect(refreshSpectate);

// Click-dismiss for the killed-by banner — was a server-wired connection.
gameGui.WhoKilledYou.MouseButton1Click.Connect(() => {
	gameGui.WhoKilledYou.Visible = false;
});

// The Spectate Respawn button — the server validates (CB_Killer set, not in a
// menu-family flow) and runs the ResetAndInitialisePlayerMenuUI path.
gameGui.Spectate.Information.Respawn.MouseButton1Click.Connect(() => {
	fireReturnToMenu();
});

// Gamepad Y — the old server GamePadButtonYDown handler's spectate branch
// (its garage branch is client-local in garage.client.ts; the Game gui is
// disabled throughout the menu-family states so the two can never overlap).
UserInputService.InputBegan.Connect((input) => {
	if (input.UserInputType !== Enum.UserInputType.Gamepad1 || input.KeyCode !== Enum.KeyCode.ButtonY) {
		return;
	}
	if (gameGui.Enabled && gameGui.Spectate.Visible) {
		fireReturnToMenu();
	}
});

// ---- initial paint ---------------------------------------------------------

refreshEnabled();
refreshMoney();
applyChrome();
refreshEndScreen();
refreshSpectate();
