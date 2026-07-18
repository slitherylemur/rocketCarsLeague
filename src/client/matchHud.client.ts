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
const TeamsService = game.GetService("Teams");
const LocalPlayer = Players.LocalPlayer;

// Mirror of FootballAttr in src/server/Modules/footballMatch.ts (shared
// module would drag server code into the client bundle; names are stable).
const ATTR_PHASE = "FB_Phase";
const ATTR_BLUE = "FB_BlueScore";
const ATTR_RED = "FB_RedScore";
const ATTR_TIME = "FB_TimeLeft";
const ATTR_ANNOUNCE = "FB_Announce";

const BLUE_HEX = "#4FA8FF";
const RED_HEX = "#FF5050";
const MAX_ICONS = 3;

interface PlayerIconUi extends Frame {
	Value: TextLabel;
	Person: ImageLabel;
}

interface MatchHudShape extends ScreenGui {
	TopBar: Frame & {
		BlueTeam: Frame;
		RedTeam: Frame;
		Center: Frame & { Score: TextLabel; Clock: TextLabel };
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

function attrNumber(name: string): number {
	const value = ReplicatedStorage.GetAttribute(name);
	return typeIs(value, "number") ? value : 0;
}

function attrString(name: string): string {
	const value = ReplicatedStorage.GetAttribute(name);
	return typeIs(value, "string") ? value : "";
}

function refreshScore() {
	const hud = currentHud();
	if (!hud) {
		return;
	}
	hud.TopBar.Center.Score.Text = `<font color="${BLUE_HEX}">${attrNumber(ATTR_BLUE)}</font> - <font color="${RED_HEX}">${attrNumber(ATTR_RED)}</font>`;
}

function refreshClock() {
	const hud = currentHud();
	if (!hud) {
		return;
	}
	const timeLeft = math.max(0, attrNumber(ATTR_TIME));
	const minutes = math.floor(timeLeft / 60);
	const seconds = timeLeft - minutes * 60;
	hud.TopBar.Center.Clock.Text = string.format("%d:%02d", minutes, seconds);
}

function refreshAnnounce() {
	const hud = currentHud();
	if (!hud) {
		return;
	}
	const text = attrString(ATTR_ANNOUNCE);
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

function rebuildRow(row: Frame, team: Team) {
	for (const child of row.GetChildren()) {
		if (child.Name === "PlayerIcon") {
			child.Destroy();
		}
	}

	const members = team.GetPlayers();
	members.sort((a, b) => a.Name < b.Name);

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
		icon.BackgroundColor3 = team.TeamColor.Color;
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
	const Teams = TeamsService as unknown as { Red: Team; Blue: Team };
	rebuildRow(hud.TopBar.BlueTeam, Teams.Blue);
	rebuildRow(hud.TopBar.RedTeam, Teams.Red);
}

function refreshAll() {
	refreshScore();
	refreshClock();
	refreshAnnounce();
	rebuildTeamRows();
}

// ---- wiring --------------------------------------------------------------

ReplicatedStorage.GetAttributeChangedSignal(ATTR_BLUE).Connect(refreshScore);
ReplicatedStorage.GetAttributeChangedSignal(ATTR_RED).Connect(refreshScore);
ReplicatedStorage.GetAttributeChangedSignal(ATTR_TIME).Connect(refreshClock);
ReplicatedStorage.GetAttributeChangedSignal(ATTR_ANNOUNCE).Connect(refreshAnnounce);
ReplicatedStorage.GetAttributeChangedSignal(ATTR_PHASE).Connect(refreshAll);

const Teams = TeamsService as unknown as { Red: Team; Blue: Team };
for (const team of [Teams.Red, Teams.Blue]) {
	team.PlayerAdded.Connect(() => task.defer(rebuildTeamRows));
	team.PlayerRemoved.Connect(() => task.defer(rebuildTeamRows));
}
Players.PlayerRemoving.Connect(() => task.defer(rebuildTeamRows));

// Repaint every fresh mount (the server remounts PlayerGui on each respawn).
LocalPlayer.WaitForChild("PlayerGui").ChildAdded.Connect((child) => {
	if (child.Name === "MatchHud") {
		task.defer(refreshAll);
	}
});

refreshAll();
