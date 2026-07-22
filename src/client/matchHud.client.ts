// Renders the football MatchHud from replicated state:
//   * FB_* attributes on ReplicatedStorage (footballMatch.ts writes them) —
//     scores, match clock, phase, center-screen announce text.
//   * Team membership (player.Team replicates) — the three player icons per
//     side, cloned from ReplicatedStorage.Ui.PlayerIcon like the old
//     Leaderboard row did.
//
// The server-rendered UI is destroyed and remounted on every respawn
// (PlayerGuiManager), so nothing here caches instances: every update
// re-resolves the current MatchHud, and a PlayerGui.ChildAdded repaints the
// fresh mount with the latest state.

import { startUiConfetti } from "shared/UiConfetti";

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const RunService = game.GetService("RunService");
const SoundService = game.GetService("SoundService");
const TweenService = game.GetService("TweenService");
const Debris = game.GetService("Debris");
const ContentProvider = game.GetService("ContentProvider");
const LocalPlayer = Players.LocalPlayer;

// Mirror of FootballAttr in src/server/Modules/footballMatch.ts (shared
// module would drag server code into the client bundle; names are stable).
const ATTR_PHASE = "FB_Phase";
const ATTR_BLUE = "FB_BlueScore";
const ATTR_RED = "FB_RedScore";
const ATTR_TIME = "FB_TimeLeft";
const ATTR_ANNOUNCE = "FB_Announce";
// Announce color moved out of the text: a <font> tag inside FB_Announce
// pushed scorer announces past the 50-char attribute limit server-side.
const ATTR_ANNOUNCE_COLOR = "FB_AnnounceColor";
const ATTR_VCAM_CFRAME = "FB_VictoryCamCFrame";
const ATTR_GAME_END_CUE = "FB_GameEndCue";
const ATTR_FOCAM_CFRAME = "FB_FaceOffCamCFrame";
const ATTR_BLUE_NAME = "FB_BlueName";
const ATTR_RED_NAME = "FB_RedName";
// Victory overlay: footballMatch.playVictoryScene sets these on the pitch
// while the lineup camera runs, and clears them before the ladder map.
const ATTR_WINNER_SIDE = "FB_WinnerSide";
const ATTR_WINNER_NAME = "FB_WinnerName";
// Coin-flip reveal on a drawn pitch — confetti burst only, no headline.
const ATTR_FLIP_SIDE = "FB_FlipSide";
// Session round counter (Phase 5) — footballMatch.beginRound sets both.
const ATTR_ROUND = "CB_Round";
const ATTR_ROUND_MAX = "CB_SessionRounds";

const BLUE_HEX = "#4FA8FF";
const RED_HEX = "#FF5050";
const MAX_ICONS = 3;

function soundTemplate(name: string, soundId: string, volume: number): Sound {
	const sound = new Instance("Sound");
	sound.Name = name;
	sound.SoundId = soundId;
	sound.Volume = volume;
	return sound;
}

const gameEndSound = soundTemplate("GameEndSound", "rbxassetid://129649904589836", 0.55);
const crowdAmbienceTemplate = soundTemplate("CrowdAmbience", "rbxassetid://124820656606411", 0.04);
crowdAmbienceTemplate.Looped = true;
const kickoffSound = soundTemplate("KickoffSound", "rbxassetid://6238869231", 0.55);
// Crowd cheer is two layered clips played together; goals add the air horn
// 0.1s after the cheer starts.
const cheerSoundA = soundTemplate("CheerSoundA", "rbxassetid://119778631567454", 0.5);
const cheerSoundB = soundTemplate("CheerSoundB", "rbxassetid://78361773621951", 0.5);
const airHornSound = soundTemplate("AirHornSound", "rbxassetid://132844961288199", 0.55);
const booSound = soundTemplate("BooSound", "rbxassetid://140141868547789", 0.5);
const confettiPopSound = soundTemplate("ConfettiPopSound", "rbxassetid://135913294904080", 0.55);
const drumRollSound = soundTemplate("DrumRollSound", "rbxassetid://96716438915825", 0.55);

task.spawn(() =>
	pcall(() =>
		ContentProvider.PreloadAsync([
			gameEndSound,
			crowdAmbienceTemplate,
			kickoffSound,
			cheerSoundA,
			cheerSoundB,
			airHornSound,
			booSound,
			confettiPopSound,
			drumRollSound,
		]),
	),
);

function playSound(template: Sound) {
	const sound = template.Clone();
	sound.Parent = SoundService;
	sound.Play();
	Debris.AddItem(sound, 15);
}

function playCheer(withAirHorn: boolean) {
	playSound(cheerSoundA);
	playSound(cheerSoundB);
	if (withAirHorn) {
		task.delay(0.1, () => playSound(airHornSound));
	}
}

let crowdAmbience: Sound | undefined;

function updateCrowdAmbience() {
	if (currentPitch()) {
		if (!crowdAmbience) {
			crowdAmbience = crowdAmbienceTemplate.Clone();
			crowdAmbience.Parent = SoundService;
			crowdAmbience.Play();
		}
	} else if (crowdAmbience) {
		crowdAmbience.Destroy();
		crowdAmbience = undefined;
	}
}

interface PlayerIconUi extends Frame {
	Value: TextLabel;
	Person: ImageLabel;
}

interface MatchHudShape extends ScreenGui {
	TopBar: Frame & {
		BlueTeam: Frame;
		RedTeam: Frame;
		Center: Frame & { Score: TextLabel; Clock: TextLabel; Round: TextLabel };
	};
	Announce: TextLabel;
}

function currentHud(): MatchHudShape | undefined {
	const playerGui = LocalPlayer.FindFirstChild("PlayerGui");
	const hud = playerGui && playerGui.FindFirstChild("MatchHud");
	if (hud && hud.IsA("ScreenGui") && hud.FindFirstChild("TopBar") && hud.FindFirstChild("Announce")) {
		return hud as MatchHudShape;
	}
	return undefined;
}

// Phase 3b: score/phase/announce live on the LOCAL PLAYER'S PITCH folder
// (CB_PitchId attribute names it under Workspace.Map); the shared clock stays
// global on ReplicatedStorage.
function currentPitch(): Instance | undefined {
	const pitchId = LocalPlayer.GetAttribute("CB_PitchId");
	if (!typeIs(pitchId, "string")) {
		return undefined;
	}
	const mapFolder = game.Workspace.FindFirstChild("Map");
	return mapFolder ? mapFolder.FindFirstChild(pitchId) : undefined;
}

function attrNumberOn(source: Instance | undefined, name: string): number {
	const value = source ? source.GetAttribute(name) : undefined;
	return typeIs(value, "number") ? value : 0;
}

function attrStringOn(source: Instance | undefined, name: string): string {
	const value = source ? source.GetAttribute(name) : undefined;
	return typeIs(value, "string") ? value : "";
}

function refreshScore() {
	const hud = currentHud();
	if (!hud) {
		return;
	}
	const pitch = currentPitch();
	hud.TopBar.Center.Score.Text = `<font color="${BLUE_HEX}">${attrNumberOn(pitch, ATTR_BLUE)}</font> - <font color="${RED_HEX}">${attrNumberOn(pitch, ATTR_RED)}</font>`;
}

function refreshClock() {
	const hud = currentHud();
	if (!hud) {
		return;
	}
	const timeLeft = math.max(0, attrNumberOn(ReplicatedStorage, ATTR_TIME));
	const minutes = math.floor(timeLeft / 60);
	const seconds = timeLeft - minutes * 60;
	hud.TopBar.Center.Clock.Text = string.format("%d:%02d", minutes, seconds);
}

function refreshRound() {
	const hud = currentHud();
	if (!hud) {
		return;
	}
	const pitch = currentPitch();
	if (attrStringOn(pitch, ATTR_PHASE) === "FreePlay") {
		hud.TopBar.Center.Round.Text = "FREEPLAY";
		return;
	}
	const round = attrNumberOn(ReplicatedStorage, ATTR_ROUND);
	const roundMax = attrNumberOn(ReplicatedStorage, ATTR_ROUND_MAX);
	hud.TopBar.Center.Round.Text = round > 0 && roundMax > 0 ? `Round ${round}/${roundMax}` : "";
}

function refreshAnnounce() {
	const hud = currentHud();
	if (!hud) {
		return;
	}
	const pitch = currentPitch();
	const text = attrStringOn(pitch, ATTR_ANNOUNCE);
	const colorHex = attrStringOn(pitch, ATTR_ANNOUNCE_COLOR);
	// Server sends plain text (names already rich-text-escaped); the color
	// wrap happens here so the attribute stays under the 50-char limit.
	hud.Announce.Text = colorHex !== "" && text !== "" ? `<font color="${colorHex}">${text}</font>` : text;
	hud.Announce.Visible = text !== "";
}

// ---- team icon rows ------------------------------------------------------

const thumbnailCache = new Map<number, string>();

function playerThumbnail(player: Player): string | undefined {
	return thumbnailCache.get(player.UserId);
}

function fetchThumbnail(player: Player) {
	if (thumbnailCache.has(player.UserId)) {
		return;
	}
	task.spawn(() => {
		const [ok, content] = pcall(() => {
			const [image] = Players.GetUserThumbnailAsync(
				player.UserId,
				Enum.ThumbnailType.HeadShot,
				Enum.ThumbnailSize.Size420x420,
			);
			return image;
		});
		if (ok) {
			thumbnailCache.set(player.UserId, content as string);
			rebuildTeamRows();
			rebuildFaceOffIcons();
			refreshVictory();
		}
	});
}

// Sides are per-match dressing set by the server as a CB_Side player
// attribute (ladder teams own player.Team, so the old Red/Blue Roblox Teams
// no longer hold members). CB_Side alone is not unique: every simultaneous
// pitch has a Blue and Red side, so the pitch assignment must match too.
function playersOnSide(side: string): Player[] {
	const out: Player[] = [];
	const pitchId = LocalPlayer.GetAttribute("CB_PitchId");
	if (!typeIs(pitchId, "string")) {
		return out;
	}
	for (const player of Players.GetPlayers()) {
		if (player.GetAttribute("CB_PitchId") === pitchId && player.GetAttribute("CB_Side") === side) {
			out.push(player);
		}
	}
	out.sort((a, b) => a.Name < b.Name);
	return out;
}

function rebuildRow(row: Frame, members: Player[], color: Color3) {
	for (const child of row.GetChildren()) {
		if (child.Name === "PlayerIcon") {
			child.Destroy();
		}
	}

	let shown = 0;
	for (const member of members) {
		if (shown >= MAX_ICONS) {
			break;
		}
		shown += 1;
		const icon = (
			ReplicatedStorage as unknown as { Ui: { PlayerIcon: PlayerIconUi } }
		).Ui.PlayerIcon.Clone();
		icon.LayoutOrder = shown;
		icon.BackgroundColor3 = color;
		icon.Value.Visible = false; // kill count slot from the deathmatch row
		const thumb = playerThumbnail(member);
		if (thumb !== undefined) {
			icon.Person.Image = thumb;
		} else {
			fetchThumbnail(member);
		}
		icon.Parent = row;
	}
}

function rebuildTeamRows() {
	const hud = currentHud();
	if (!hud) {
		return;
	}
	rebuildRow(hud.TopBar.BlueTeam, playersOnSide("Blue"), Color3.fromRGB(79, 168, 255));
	rebuildRow(hud.TopBar.RedTeam, playersOnSide("Red"), Color3.fromRGB(255, 80, 80));
}

// ---- face-off overlay + camera ------------------------------------------
//
// While FB_Phase is "FaceOff" the server poses both teams on the stage and
// publishes the stage camera shot as FB_FaceOffCamCFrame. The overlay shows
// the two team name plates (FB_BlueName/FB_RedName) sliding in from the
// screen edges with the VS fading in between them. Unlike the victory camera
// (whose scene flows into the ladder map / menu camera), the face-off hands
// control straight back to the driving camera, so leaving the phase restores
// CameraType.Custom here.

interface FaceOffShape extends ScreenGui {
	Banner: Frame & {
		BluePlate: Frame & { TeamName: TextLabel };
		RedPlate: Frame & { TeamName: TextLabel };
		Vs: TextLabel;
	};
}

// ---- face-off roster icons ----------------------------------------------
// One PlayerIcon clone per rostered player, under each plate's Icons row,
// ringed with the side's color. Same thumbnail cache as the top bar.

const FACEOFF_BLUE = Color3.fromRGB(79, 168, 255);
const FACEOFF_RED = Color3.fromRGB(255, 80, 80);

function faceOffIconsRow(plate: Frame): Frame | undefined {
	const icons = plate.FindFirstChild("Icons");
	return icons && icons.IsA("Frame") ? icons : undefined;
}

function fillFaceOffIcons(row: Frame | undefined, members: Player[], accent: Color3) {
	if (!row) {
		return;
	}
	for (const child of row.GetChildren()) {
		if (child.Name === "PlayerIcon") {
			child.Destroy();
		}
	}
	let shown = 0;
	for (const member of members) {
		shown += 1;
		const icon = (
			ReplicatedStorage as unknown as { Ui: { PlayerIcon: PlayerIconUi } }
		).Ui.PlayerIcon.Clone();
		icon.LayoutOrder = shown;
		icon.BackgroundColor3 = accent;
		icon.Value.Visible = false; // kill count slot from the deathmatch row
		// Square inside the row regardless of the template's authored size.
		icon.Size = UDim2.fromScale(1, 1);
		if (!icon.FindFirstChildOfClass("UIAspectRatioConstraint")) {
			const aspect = new Instance("UIAspectRatioConstraint");
			aspect.AspectRatio = 1;
			aspect.Parent = icon;
		}
		const stroke = new Instance("UIStroke");
		stroke.Name = "TeamStroke";
		stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
		stroke.Color = accent;
		stroke.Thickness = 3;
		stroke.Parent = icon;
		const thumb = playerThumbnail(member);
		if (thumb !== undefined) {
			icon.Person.Image = thumb;
		} else {
			fetchThumbnail(member);
		}
		icon.Parent = row;
	}
}

function rebuildFaceOffIcons() {
	const gui = currentFaceOff();
	if (!gui || !gui.Enabled) {
		return;
	}
	fillFaceOffIcons(faceOffIconsRow(gui.Banner.BluePlate), playersOnSide("Blue"), FACEOFF_BLUE);
	fillFaceOffIcons(faceOffIconsRow(gui.Banner.RedPlate), playersOnSide("Red"), FACEOFF_RED);
}

function currentFaceOff(): FaceOffShape | undefined {
	const playerGui = LocalPlayer.FindFirstChild("PlayerGui");
	const gui = playerGui && playerGui.FindFirstChild("FaceOff");
	if (gui && gui.IsA("ScreenGui") && gui.FindFirstChild("Banner")) {
		return gui as FaceOffShape;
	}
	return undefined;
}

// Rest positions authored in FaceOffGui.tsx — the entrance tween returns to
// them, and hiding resets them for the (possibly remounted) next show.
const FACEOFF_BLUE_POS = new UDim2(0.04, 0, 0.5, 0);
const FACEOFF_RED_POS = new UDim2(0.96, 0, 0.5, 0);
const FACEOFF_SLIDE = new TweenInfo(0.35, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);
const FACEOFF_VS_FADE = new TweenInfo(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);

let faceOffShown = false;

function vsStrokeOf(gui: FaceOffShape): UIStroke | undefined {
	return gui.Banner.Vs.FindFirstChildOfClass("UIStroke");
}

function showFaceOff(gui: FaceOffShape, pitch: Instance) {
	const blueName = attrStringOn(pitch, ATTR_BLUE_NAME);
	const redName = attrStringOn(pitch, ATTR_RED_NAME);
	gui.Banner.BluePlate.TeamName.Text = blueName !== "" ? blueName : "BLUE TEAM";
	gui.Banner.RedPlate.TeamName.Text = redName !== "" ? redName : "RED TEAM";
	gui.Enabled = true;
	// Unconditional (not gated on faceOffShown): a respawn remount mid-segment
	// rebuilds the gui empty, and this repaints the fresh rows.
	rebuildFaceOffIcons();
	if (faceOffShown) {
		return;
	}
	faceOffShown = true;
	gui.Banner.BluePlate.Position = new UDim2(-0.35, 0, 0.5, 0);
	gui.Banner.RedPlate.Position = new UDim2(1.35, 0, 0.5, 0);
	gui.Banner.Vs.TextTransparency = 1;
	const stroke = vsStrokeOf(gui);
	if (stroke) {
		stroke.Transparency = 1;
	}
	TweenService.Create(gui.Banner.BluePlate, FACEOFF_SLIDE, { Position: FACEOFF_BLUE_POS }).Play();
	TweenService.Create(gui.Banner.RedPlate, FACEOFF_SLIDE, { Position: FACEOFF_RED_POS }).Play();
	task.delay(0.25, () => {
		const current = currentFaceOff();
		if (!faceOffShown || !current) {
			return;
		}
		TweenService.Create(current.Banner.Vs, FACEOFF_VS_FADE, { TextTransparency: 0 }).Play();
		const currentStroke = vsStrokeOf(current);
		if (currentStroke) {
			TweenService.Create(currentStroke, FACEOFF_VS_FADE, { Transparency: 0 }).Play();
		}
	});
}

function hideFaceOff(gui: FaceOffShape) {
	faceOffShown = false;
	gui.Enabled = false;
	gui.Banner.BluePlate.Position = FACEOFF_BLUE_POS;
	gui.Banner.RedPlate.Position = FACEOFF_RED_POS;
	gui.Banner.Vs.TextTransparency = 0;
	const stroke = vsStrokeOf(gui);
	if (stroke) {
		stroke.Transparency = 0;
	}
}

function refreshFaceOff() {
	const gui = currentFaceOff();
	if (!gui) {
		faceOffShown = false;
		return;
	}
	const pitch = currentPitch();
	if (pitch && attrStringOn(pitch, ATTR_PHASE) === "FaceOff") {
		showFaceOff(gui, pitch);
	} else {
		hideFaceOff(gui);
	}
}

let faceOffCamConnection: RBXScriptConnection | undefined;

// Widened during the face-off so the whole lineup fits the authored shot;
// the driver's own FOV is captured on entry and restored on exit.
const FACEOFF_FOV = 75;
let faceOffPrevFov: number | undefined;

function stopFaceOffCamera() {
	if (faceOffCamConnection) {
		faceOffCamConnection.Disconnect();
		faceOffCamConnection = undefined;
		// Hand the camera back to the driving/character camera (the victory
		// scene never does this — its scene flows into the menu camera).
		const camera = game.Workspace.CurrentCamera;
		if (camera) {
			camera.CameraType = Enum.CameraType.Custom;
			if (faceOffPrevFov !== undefined) {
				camera.FieldOfView = faceOffPrevFov;
			}
		}
		faceOffPrevFov = undefined;
	}
}

function applyFaceOffCamera(pitch: Instance): boolean {
	const camera = game.Workspace.CurrentCamera;
	if (!camera) {
		return false;
	}
	const camCFrame = pitch.GetAttribute(ATTR_FOCAM_CFRAME);
	if (typeIs(camCFrame, "CFrame")) {
		if (faceOffPrevFov === undefined) {
			faceOffPrevFov = camera.FieldOfView;
		}
		camera.CameraType = Enum.CameraType.Scriptable;
		camera.CFrame = camCFrame;
		camera.FieldOfView = FACEOFF_FOV;
		return true;
	}
	return false;
}

function handleFaceOffCamera() {
	const pitch = currentPitch();
	if (!pitch || attrStringOn(pitch, ATTR_PHASE) !== "FaceOff") {
		stopFaceOffCamera();
		return;
	}
	if (!applyFaceOffCamera(pitch)) {
		// Cam attribute hasn't replicated yet — the FB_FaceOffCamCFrame signal
		// (bindPitch) re-runs this the moment it arrives.
		return;
	}
	if (!faceOffCamConnection) {
		faceOffCamConnection = RunService.RenderStepped.Connect(() => {
			const current = currentPitch();
			if (!current || attrStringOn(current, ATTR_PHASE) !== "FaceOff" || !applyFaceOffCamera(current)) {
				stopFaceOffCamera();
			}
		});
	}
}

// ---- victory overlay -----------------------------------------------------
//
// While FB_Phase is "Ended" AND the pitch has a FB_WinnerSide, the Victory
// ScreenGui (VictoryGui.tsx) overlays the lineup camera shot: a giant
// pulsing/tilting "🏆 WINNERS 🏆" (gold) or "YOU LOSE !" (red) headline,
// "<SIDE> TEAM WINS!" in the side color, the winning ladder team's name, its
// roster icons, and corner-launched confetti in two shades of the side color.

interface VictoryShape extends ScreenGui {
	Confetti: Frame;
	Title: TextLabel & { Pulse: UIScale };
	SubTitle: TextLabel;
	TeamName: TextLabel;
	Icons: Frame;
}

const VICTORY_GOLD = Color3.fromRGB(255, 200, 60);
const VICTORY_LOSE_RED = Color3.fromRGB(255, 60, 60);

// Repeating + reversing, with different periods so the pulse and the tilt
// drift out of phase instead of breathing in sync.
const VICTORY_PULSE = new TweenInfo(0.8, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true);
const VICTORY_TILT = new TweenInfo(1.3, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true);

function currentVictory(): VictoryShape | undefined {
	const playerGui = LocalPlayer.FindFirstChild("PlayerGui");
	const gui = playerGui && playerGui.FindFirstChild("Victory");
	if (gui && gui.IsA("ScreenGui") && gui.FindFirstChild("Title") && gui.FindFirstChild("Confetti")) {
		return gui as VictoryShape;
	}
	return undefined;
}

// Effects are bound to ONE mounted gui instance: a respawn remount destroys
// it (killing the tweens with it), and the repaint then restarts the effects
// against the fresh mount.
let victoryFxGui: VictoryShape | undefined;
let victoryTweens: Tween[] = [];
let victoryConfettiStop: (() => void) | undefined;
// Scene sounds fire once per victory/flip reveal; a respawn remount mid-scene
// re-runs showVictory/showFlipConfetti against the fresh gui and must not
// replay them. Cleared when the scene actually ends (hideVictory).
let victorySceneSoundPlayed = false;

function playVictorySceneSound(won: boolean) {
	if (victorySceneSoundPlayed) {
		return;
	}
	victorySceneSoundPlayed = true;
	// The confetti pop rides along with the UI particle burst, which fires for
	// every reveal (winners see their color, losers see the winner's).
	playSound(confettiPopSound);
	if (won) {
		playCheer(false);
	} else {
		playSound(booSound);
	}
}

function stopVictoryFx() {
	for (const tween of victoryTweens) {
		tween.Cancel();
	}
	victoryTweens = [];
	if (victoryConfettiStop) {
		victoryConfettiStop();
		victoryConfettiStop = undefined;
	}
	victoryFxGui = undefined;
}

function startVictoryFx(gui: VictoryShape, sideColor: Color3) {
	stopVictoryFx();
	victoryFxGui = gui;
	const lightShade = sideColor.Lerp(new Color3(1, 1, 1), 0.5);
	victoryConfettiStop = startUiConfetti(gui.Confetti, [sideColor, lightShade]);
	gui.Title.Pulse.Scale = 0.94;
	gui.Title.Rotation = -3;
	const pulse = TweenService.Create(gui.Title.Pulse, VICTORY_PULSE, { Scale: 1.06 });
	const tilt = TweenService.Create(gui.Title, VICTORY_TILT, { Rotation: 3 });
	pulse.Play();
	tilt.Play();
	victoryTweens = [pulse, tilt];
}

// RichText <font size> beats TextScaled's 100px cap. Sized off the viewport
// (height-capped, and width-capped by the text's rough character count) so
// the headline is giant on desktop yet still fits a phone screen.
function setGiantTitle(label: TextLabel, text: string, widthChars: number) {
	const camera = game.Workspace.CurrentCamera;
	const viewport = camera ? camera.ViewportSize : new Vector2(1280, 720);
	const fontSize = math.floor(math.min(viewport.Y * 0.17, (viewport.X * 0.92) / (widthChars * 0.45)));
	label.Text = `<font size="${math.max(fontSize, 24)}">${text}</font>`;
}

function showVictory(gui: VictoryShape, pitch: Instance, winnerSide: string) {
	const sideColor = winnerSide === "Blue" ? FACEOFF_BLUE : FACEOFF_RED;
	const mySide = LocalPlayer.GetAttribute("CB_Side");
	const lost = typeIs(mySide, "string") && mySide !== "" && mySide !== winnerSide;
	if (lost) {
		gui.Title.TextColor3 = VICTORY_LOSE_RED;
		setGiantTitle(gui.Title, "YOU LOSE !", 10);
	} else {
		gui.Title.TextColor3 = VICTORY_GOLD;
		setGiantTitle(gui.Title, "🏆 WINNERS 🏆", 13);
	}
	// Black, not the side color: the victory camera looks at the winner's
	// goal, so side-colored text would vanish into the same-colored backdrop.
	gui.SubTitle.Text = `${winnerSide.upper()} TEAM WINS!`;
	gui.SubTitle.TextColor3 = new Color3(0, 0, 0);
	gui.TeamName.Text = attrStringOn(pitch, ATTR_WINNER_NAME);
	// Winning roster icons, ringed in the side color — same builder as the
	// face-off plates (and the same thumbnail cache).
	fillFaceOffIcons(gui.Icons, playersOnSide(winnerSide), sideColor);
	gui.Enabled = true;
	if (victoryFxGui !== gui) {
		startVictoryFx(gui, sideColor);
	}
	playVictorySceneSound(!lost);
}

// Coin-flip reveal on a drawn pitch: the promoted side's confetti burst only.
// The center announce ("<SIDE> MOVES UP!") owns the text, so every label
// stays empty and the (invisible) title just carries the idle tween loop.
function showFlipConfetti(gui: VictoryShape, flipSide: string) {
	gui.Title.Text = "";
	gui.SubTitle.Text = "";
	gui.TeamName.Text = "";
	fillFaceOffIcons(gui.Icons, [], new Color3(1, 1, 1));
	gui.Enabled = true;
	if (victoryFxGui !== gui) {
		startVictoryFx(gui, flipSide === "Blue" ? FACEOFF_BLUE : FACEOFF_RED);
	}
	// Drawn pitch: cheer if the flip promoted OUR side, boo if it didn't.
	const mySide = LocalPlayer.GetAttribute("CB_Side");
	const flipLost = typeIs(mySide, "string") && mySide !== "" && mySide !== flipSide;
	playVictorySceneSound(!flipLost);
}

function hideVictory(gui: VictoryShape) {
	stopVictoryFx();
	victorySceneSoundPlayed = false;
	gui.Enabled = false;
	gui.Title.Rotation = 0;
	gui.Title.Pulse.Scale = 1;
}

function refreshVictory() {
	const gui = currentVictory();
	if (!gui) {
		stopVictoryFx();
		return;
	}
	const pitch = currentPitch();
	if (pitch === undefined || attrStringOn(pitch, ATTR_PHASE) !== "Ended") {
		hideVictory(gui);
		return;
	}
	const winnerSide = attrStringOn(pitch, ATTR_WINNER_SIDE);
	const flipSide = attrStringOn(pitch, ATTR_FLIP_SIDE);
	if (winnerSide === "Blue" || winnerSide === "Red") {
		showVictory(gui, pitch, winnerSide);
	} else if (flipSide === "Blue" || flipSide === "Red") {
		showFlipConfetti(gui, flipSide);
	} else {
		hideVictory(gui);
	}
}

// Victory scene camera: when our pitch's match ends, aim at its
// VictoryCamera shot (winners are posed in front of their goal). The server
// sets FB_Phase="Ended" FIRST and the cam attributes only ~0.2s later, so this
// also runs from the FB_VictoryCam* attribute signals (bindPitch). While the
// scene lasts, other camera owners (default/driving camera on respawn) can
// flip CameraType back — so once the shot is known it is re-asserted every
// RenderStepped until the phase leaves "Ended" or the pitch goes away. The
// menu camera takes over when the shop phase remounts the UI (CB_PitchId is
// cleared by footballMatch.stop(), which ends the loop).
let victoryCamConnection: RBXScriptConnection | undefined;

// The ladder map's 3D pitch rise (ladderMap.client.ts) needs the camera while
// its gui is enabled — the victory shot must stand down for it, or the two
// would fight over camera.CFrame every frame.
function ladderMapCovering(): boolean {
	const playerGui = LocalPlayer.FindFirstChild("PlayerGui");
	const gui = playerGui && playerGui.FindFirstChild("LadderMap");
	return gui !== undefined && gui.IsA("ScreenGui") && gui.Enabled;
}

function stopVictoryCamera() {
	if (victoryCamConnection) {
		victoryCamConnection.Disconnect();
		victoryCamConnection = undefined;
	}
}

function applyVictoryCamera(pitch: Instance): boolean {
	const camera = game.Workspace.CurrentCamera;
	if (!camera) {
		return false;
	}
	// The server selects CameraWinParts/Red or CameraWinParts/Blue and
	// publishes that authored part's exact CFrame. Falls back to the legacy
	// VictoryCamera part if the authored side part is missing.
	const camCFrame = pitch.GetAttribute(ATTR_VCAM_CFRAME);
	if (typeIs(camCFrame, "CFrame")) {
		camera.CameraType = Enum.CameraType.Scriptable;
		camera.CFrame = camCFrame;
		return true;
	}
	const cameraPart = pitch.FindFirstChild("VictoryCamera");
	if (cameraPart && cameraPart.IsA("BasePart")) {
		camera.CameraType = Enum.CameraType.Scriptable;
		camera.CFrame = cameraPart.CFrame;
		return true;
	}
	return false;
}

function handleVictoryCamera() {
	const pitch = currentPitch();
	if (!pitch || attrStringOn(pitch, ATTR_PHASE) !== "Ended" || ladderMapCovering()) {
		stopVictoryCamera();
		return;
	}
	if (!applyVictoryCamera(pitch)) {
		// Cam attributes haven't replicated yet — the FB_VictoryCam* signals
		// (bindPitch) re-run this the moment they arrive.
		return;
	}
	if (!victoryCamConnection) {
		victoryCamConnection = RunService.RenderStepped.Connect(() => {
			const current = currentPitch();
			if (
				!current ||
				attrStringOn(current, ATTR_PHASE) !== "Ended" ||
				ladderMapCovering() ||
				!applyVictoryCamera(current)
			) {
				stopVictoryCamera();
			}
		});
	}
}

// The scoreboard bar has no place over the face-off presentation — the
// FaceOff overlay owns the screen until the phase moves on to Kickoff.
function refreshTopBarVisibility() {
	const hud = currentHud();
	if (!hud) {
		return;
	}
	hud.TopBar.Visible = attrStringOn(currentPitch(), ATTR_PHASE) !== "FaceOff";
}

function refreshAll() {
	refreshScore();
	refreshClock();
	refreshRound();
	refreshAnnounce();
	refreshTopBarVisibility();
	rebuildTeamRows();
	refreshFaceOff();
	refreshVictory();
	handleFaceOffCamera();
	handleVictoryCamera();
}

// ---- wiring --------------------------------------------------------------

ReplicatedStorage.GetAttributeChangedSignal(ATTR_TIME).Connect(refreshClock);
ReplicatedStorage.GetAttributeChangedSignal(ATTR_ROUND).Connect(refreshRound);
ReplicatedStorage.GetAttributeChangedSignal(ATTR_GAME_END_CUE).Connect(() => playSound(gameEndSound));

// Per-pitch state signals: rebind whenever our pitch assignment changes.
let pitchConnections: RBXScriptConnection[] = [];
// Mid-round pitches (footballMatch.createMidRoundPitch) can replicate AFTER
// our CB_PitchId attribute: currentPitch() is nil at bind time, nothing below
// connects, and without this watch the HUD would freeze on its last paint
// (the "stuck on Waiting for players..." bug) — no announces, no face-off
// camera. Rebind the moment the named folder lands under Workspace.Map.
let pitchWatchConnection: RBXScriptConnection | undefined;
function bindPitch() {
	for (const connection of pitchConnections) {
		connection.Disconnect();
	}
	pitchConnections = [];
	if (pitchWatchConnection) {
		pitchWatchConnection.Disconnect();
		pitchWatchConnection = undefined;
	}
	// New pitch = new scene context; without this a mid-scene pitch swap could
	// leave the played flag set and mute the next reveal's sounds.
	victorySceneSoundPlayed = false;
	const pitch = currentPitch();
	if (!pitch) {
		const pitchId = LocalPlayer.GetAttribute("CB_PitchId");
		const mapFolder = game.Workspace.FindFirstChild("Map");
		if (typeIs(pitchId, "string") && mapFolder) {
			pitchWatchConnection = mapFolder.ChildAdded.Connect((child) => {
				if (child.Name === pitchId) {
					task.defer(bindPitch);
				}
			});
		}
	}
	if (pitch) {
		// Round rebuilds DESTROY-then-CLONE pitch folders with the same names
		// (PitchManager.buildPitches), and CB_PitchId round-trips undefined →
		// the same string inside one replication step, so it can coalesce and
		// never fire client-side. The connections below would then stay bound
		// to the destroyed folder — no face-off camera, frozen scores/announces
		// for the round. The old folder leaving the tree is the reliable edge.
		pitchConnections.push(
			pitch.AncestryChanged.Connect(() => {
				if (!pitch.IsDescendantOf(game)) {
					task.defer(bindPitch);
				}
			}),
		);
		// Goal sounds key off score INCREASES only (kickoff resets the scores
		// back to 0 and must stay silent): cheer + air horn when our side
		// scores (or we have no side — spectating), boo when we concede.
		let lastBlueScore = attrNumberOn(pitch, ATTR_BLUE);
		let lastRedScore = attrNumberOn(pitch, ATTR_RED);
		const onGoalScored = (scoringSide: string) => {
			const mySide = LocalPlayer.GetAttribute("CB_Side");
			const conceded = typeIs(mySide, "string") && mySide !== "" && mySide !== scoringSide;
			if (conceded) {
				playSound(booSound);
			} else {
				playCheer(true);
			}
		};
		pitchConnections.push(
			pitch.GetAttributeChangedSignal(ATTR_BLUE).Connect(() => {
				refreshScore();
				const score = attrNumberOn(pitch, ATTR_BLUE);
				if (score > lastBlueScore) {
					onGoalScored("Blue");
				}
				lastBlueScore = score;
			}),
		);
		pitchConnections.push(
			pitch.GetAttributeChangedSignal(ATTR_RED).Connect(() => {
				refreshScore();
				const score = attrNumberOn(pitch, ATTR_RED);
				if (score > lastRedScore) {
					onGoalScored("Red");
				}
				lastRedScore = score;
			}),
		);
		pitchConnections.push(
			pitch.GetAttributeChangedSignal(ATTR_ANNOUNCE).Connect(() => {
				refreshAnnounce();
				const announce = attrStringOn(pitch, ATTR_ANNOUNCE);
				if (announce === "3") {
					playSound(kickoffSound);
				} else if (announce === "COIN FLIP...") {
					// Suspense beat before FB_FlipSide reveals the result.
					playSound(drumRollSound);
				}
			}),
		);
		// Color lands just before the text; refresh on it too so a color-only
		// change (same text, different scorer side) still re-renders.
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_ANNOUNCE_COLOR).Connect(refreshAnnounce));
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_PHASE).Connect(refreshAll));
		// Winner side lands ~0.2s after Phase="Ended" (camera first) and is
		// cleared when the scene ends — both edges drive the overlay.
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_WINNER_SIDE).Connect(refreshVictory));
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_FLIP_SIDE).Connect(refreshVictory));
		// The face-off camera arrives just before Phase="FaceOff" — react to both.
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_FOCAM_CFRAME).Connect(handleFaceOffCamera));
		// The victory camera arrives AFTER Phase="Ended" — react when it does.
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_VCAM_CFRAME).Connect(handleVictoryCamera));
	}
	updateCrowdAmbience();
	refreshAll();
}
LocalPlayer.GetAttributeChangedSignal("CB_PitchId").Connect(bindPitch);
bindPitch();

function watchSide(player: Player) {
	player.GetAttributeChangedSignal("CB_Side").Connect(() => task.defer(rebuildTeamRows));
	player.GetAttributeChangedSignal("CB_PitchId").Connect(() => task.defer(rebuildTeamRows));
}
Players.PlayerAdded.Connect((player) => {
	watchSide(player);
	task.defer(rebuildTeamRows);
});
for (const player of Players.GetPlayers()) {
	watchSide(player);
}
Players.PlayerRemoving.Connect(() => task.defer(rebuildTeamRows));

// Repaint every fresh mount (the server remounts PlayerGui on each respawn).
LocalPlayer.WaitForChild("PlayerGui").ChildAdded.Connect((child) => {
	if (child.Name === "MatchHud" || child.Name === "FaceOff" || child.Name === "Victory") {
		task.defer(refreshAll);
	}
});

refreshAll();
