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
const ATTR_VCAM_CFRAME = "FB_VictoryCamCFrame";
const ATTR_GAME_END_CUE = "FB_GameEndCue";
const ATTR_FOCAM_CFRAME = "FB_FaceOffCamCFrame";
const ATTR_BLUE_NAME = "FB_BlueName";
const ATTR_RED_NAME = "FB_RedName";
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

const gameEndSound = soundTemplate("GameEndSound", "rbxassetid://9119561696", 0.55);
const crowdAmbienceTemplate = soundTemplate("CrowdAmbience", "rbxassetid://124820656606411", 0.04);
crowdAmbienceTemplate.Looped = true;
const victoryCrowdSound = soundTemplate("VictoryCrowdSound", "rbxassetid://124820656606411", 0.22);
const kickoffSound = soundTemplate("KickoffSound", "rbxassetid://6238869231", 0.55);

task.spawn(() =>
	pcall(() =>
		ContentProvider.PreloadAsync([gameEndSound, crowdAmbienceTemplate, victoryCrowdSound, kickoffSound]),
	),
);

function playSound(template: Sound) {
	const sound = template.Clone();
	sound.Parent = SoundService;
	sound.Play();
	Debris.AddItem(sound, 15);
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
	const text = attrStringOn(currentPitch(), ATTR_ANNOUNCE);
	hud.Announce.Text = text;
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

function stopFaceOffCamera() {
	if (faceOffCamConnection) {
		faceOffCamConnection.Disconnect();
		faceOffCamConnection = undefined;
		// Hand the camera back to the driving/character camera (the victory
		// scene never does this — its scene flows into the menu camera).
		const camera = game.Workspace.CurrentCamera;
		if (camera) {
			camera.CameraType = Enum.CameraType.Custom;
		}
	}
}

function applyFaceOffCamera(pitch: Instance): boolean {
	const camera = game.Workspace.CurrentCamera;
	if (!camera) {
		return false;
	}
	const camCFrame = pitch.GetAttribute(ATTR_FOCAM_CFRAME);
	if (typeIs(camCFrame, "CFrame")) {
		camera.CameraType = Enum.CameraType.Scriptable;
		camera.CFrame = camCFrame;
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
	if (!pitch || attrStringOn(pitch, ATTR_PHASE) !== "Ended") {
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
			if (!current || attrStringOn(current, ATTR_PHASE) !== "Ended" || !applyVictoryCamera(current)) {
				stopVictoryCamera();
			}
		});
	}
}

function refreshAll() {
	refreshScore();
	refreshClock();
	refreshRound();
	refreshAnnounce();
	rebuildTeamRows();
	refreshFaceOff();
	handleFaceOffCamera();
	handleVictoryCamera();
}

// ---- wiring --------------------------------------------------------------

ReplicatedStorage.GetAttributeChangedSignal(ATTR_TIME).Connect(refreshClock);
ReplicatedStorage.GetAttributeChangedSignal(ATTR_ROUND).Connect(refreshRound);
ReplicatedStorage.GetAttributeChangedSignal(ATTR_GAME_END_CUE).Connect(() => playSound(gameEndSound));

// Per-pitch state signals: rebind whenever our pitch assignment changes.
let pitchConnections: RBXScriptConnection[] = [];
function bindPitch() {
	for (const connection of pitchConnections) {
		connection.Disconnect();
	}
	pitchConnections = [];
	const pitch = currentPitch();
	if (pitch) {
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_BLUE).Connect(refreshScore));
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_RED).Connect(refreshScore));
		pitchConnections.push(
			pitch.GetAttributeChangedSignal(ATTR_ANNOUNCE).Connect(() => {
				refreshAnnounce();
				if (attrStringOn(pitch, ATTR_ANNOUNCE) === "3") {
					playSound(kickoffSound);
				}
			}),
		);
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_PHASE).Connect(refreshAll));
		// The face-off camera arrives just before Phase="FaceOff" — react to both.
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_FOCAM_CFRAME).Connect(handleFaceOffCamera));
		// The victory camera arrives AFTER Phase="Ended" — react when it does.
		pitchConnections.push(
			pitch.GetAttributeChangedSignal(ATTR_VCAM_CFRAME).Connect(() => {
				handleVictoryCamera();
				if (attrStringOn(pitch, ATTR_PHASE) === "Ended" && typeIs(pitch.GetAttribute(ATTR_VCAM_CFRAME), "CFrame")) {
					playSound(victoryCrowdSound);
				}
			}),
		);
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
	if (child.Name === "MatchHud" || child.Name === "FaceOff") {
		task.defer(refreshAll);
	}
});

refreshAll();
