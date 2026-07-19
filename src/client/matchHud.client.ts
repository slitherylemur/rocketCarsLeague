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
const Debris = game.GetService("Debris");
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
const scoreCrowdSound = soundTemplate("ScoreCrowdSound", "rbxassetid://124820656606411", 0.55);
const victoryCrowdSound = soundTemplate("VictoryCrowdSound", "rbxassetid://124820656606411", 0.22);

function playSound(template: Sound) {
	const sound = template.Clone();
	sound.Parent = SoundService;
	sound.Play();
	Debris.AddItem(sound, 15);
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
		let lastBlue = attrNumberOn(pitch, ATTR_BLUE);
		let lastRed = attrNumberOn(pitch, ATTR_RED);
		const scoreChanged = () => {
			const blue = attrNumberOn(pitch, ATTR_BLUE);
			const red = attrNumberOn(pitch, ATTR_RED);
			if (blue > lastBlue || red > lastRed) {
				playSound(scoreCrowdSound);
			}
			lastBlue = blue;
			lastRed = red;
			refreshScore();
		};
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_BLUE).Connect(scoreChanged));
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_RED).Connect(scoreChanged));
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_ANNOUNCE).Connect(refreshAnnounce));
		pitchConnections.push(pitch.GetAttributeChangedSignal(ATTR_PHASE).Connect(refreshAll));
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
	if (child.Name === "MatchHud") {
		task.defer(refreshAll);
	}
});

refreshAll();
