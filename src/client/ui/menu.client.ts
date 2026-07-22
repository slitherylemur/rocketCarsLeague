// Client menu router (client-side UI migration, Phase 4).
//
// Landing / CreateTeam / InvitePopup / RenamePopup are CLIENT-owned ScreenGuis
// (mounted by bootstrap.client.ts). This script renders them from replicated
// state only — fully re-derivable at any instant:
//
//   * CB_FlowState (player attribute, written by the server's flow-state
//     machine): "menu" → Landing enabled; "lobby" → CreateTeam enabled;
//     anything else → both off.
//   * The lobby content comes from the ladder team's replicated Roblox Team
//     instance (player.Team) and its CB_TeamId / CB_TeamName / CB_Open /
//     CB_InPlay / CB_Pending / CB_Members attributes, plus each member's
//     CB_Ready player attribute — the client mirror of the server's old
//     refreshTeamPage.
//   * InvitePopup renders from the CB_Invite player attribute (JSON payload)
//     and the transient CB_InviteError failure text; Accept/Decline answer
//     with Intent_ResolveInvite.
//   * RenamePopup opens locally (rename button with CB_RenameCredits in hand
//     — the client-owned Garage's TeamNameStrip does the same from
//     garage.client.ts since Phase 5; the CB_RenamePrompt server ping is
//     retired), or when a purchased credit arrives (CB_RenameCredits watcher —
//     moved here from the server). Status text renders from CB_RenameStatus.
//     The Confirm button is wired by carBallMenu.client.ts (SubmitTeamName) —
//     NOT here, to avoid double-wiring.
//
// Button presses travel to the server on the UiIntents remotes; hover effects
// stay in uiClientBehaviors.client.ts (it binds via PlayerGui.ChildAdded and
// sees these client mounts too).

import { getUiIntentEvent } from "shared/UiIntents";

const Players = game.GetService("Players");
const HttpService = game.GetService("HttpService");
const SocialService = game.GetService("SocialService");

const LocalPlayer = Players.LocalPlayer;
const playerGui = LocalPlayer.WaitForChild("PlayerGui") as Instance;

const MENU_FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

// ---- instance shapes (mirroring the mounted components) --------------------

interface LandingGuiShape extends ScreenGui {
	Panel: Frame & { Buttons: Frame & { JoinTeam: TextButton; CreateTeam: TextButton; Cars: TextButton } };
}
type TeamMemberSlot = Frame & { Avatar: ImageLabel; PlayerName: TextLabel; ReadyTag: TextLabel };
interface CreateTeamGuiShape extends ScreenGui {
	Panel: Frame & {
		Header: Frame & { TeamName: TextLabel; Rename: TextButton };
		Members: Frame & { Slot1: TeamMemberSlot; Slot2: TeamMemberSlot; Slot3: TeamMemberSlot };
		PlayerList: ScrollingFrame & { EmptyHint: TextLabel };
		InviteFriends: TextButton;
		AllowRandoms: TextButton & { SwitchTrack: Frame & { SwitchKnob: Frame } };
		Play: TextButton;
		Leave: TextButton;
	};
}
interface InvitePopupShape extends ScreenGui {
	Panel: Frame & { Message: TextLabel; Accept: TextButton; Decline: TextButton };
}
interface RenamePopupShape extends ScreenGui {
	Panel: Frame & { NameBox: TextBox; Status: TextLabel; Confirm: TextButton; Close: TextButton };
}

const landing = playerGui.WaitForChild("Landing") as LandingGuiShape;
const teamPage = playerGui.WaitForChild("CreateTeam") as CreateTeamGuiShape;
const invitePopup = playerGui.WaitForChild("InvitePopup") as InvitePopupShape;
const renamePopup = playerGui.WaitForChild("RenamePopup") as RenamePopupShape;

// ---- replicated-state readers ----------------------------------------------

function flowState(): string | undefined {
	const state = LocalPlayer.GetAttribute("CB_FlowState");
	return typeIs(state, "string") ? state : undefined;
}

/** The local player's LADDER team instance (attribute-carrying), if any. */
function myTeam(): Team | undefined {
	const team = LocalPlayer.Team;
	if (team !== undefined && team.GetAttribute("CB_TeamId") !== undefined) {
		return team;
	}
	return undefined;
}

function teamDisplayName(team: Team): string {
	const name = team.GetAttribute("CB_TeamName");
	return typeIs(name, "string") ? name : team.Name;
}

/** Members in creation/join order (index 0 = creator = crown), from the
 * CB_Members userId array the registry publishes. Players the array mentions
 * but who have left the server are skipped. */
function teamMembers(team: Team): Player[] {
	const members: Player[] = [];
	const raw = team.GetAttribute("CB_Members");
	if (typeIs(raw, "string")) {
		const [ok, decoded] = pcall(() => HttpService.JSONDecode(raw) as number[]);
		if (ok && typeIs(decoded, "table")) {
			for (const userId of decoded) {
				if (typeIs(userId, "number")) {
					const member = Players.GetPlayerByUserId(userId);
					if (member) {
						members.push(member);
					}
				}
			}
			return members;
		}
	}
	// Fallback: membership via player.Team (order unknown).
	for (const player of Players.GetPlayers()) {
		if (player.Team === team) {
			members.push(player);
		}
	}
	return members;
}

function isReady(member: Player): boolean {
	return member.GetAttribute("CB_Ready") === true;
}

// ---- team page render (client mirror of the old server refreshTeamPage) ----

function clearInviteRows() {
	for (const child of teamPage.Panel.PlayerList.GetChildren()) {
		if (child.IsA("Frame")) {
			child.Destroy();
		}
	}
}

function buildInviteRow(other: Player): Frame {
	const row = new Instance("Frame");
	row.Name = "InviteRow";
	row.Size = new UDim2(1, -16, 0, 46);
	row.BackgroundColor3 = Color3.fromRGB(30, 43, 60);
	row.BorderSizePixel = 0;
	const rowCorner = new Instance("UICorner");
	rowCorner.CornerRadius = new UDim(0, 8);
	rowCorner.Parent = row;
	const rowStroke = new Instance("UIStroke");
	rowStroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
	rowStroke.Color = Color3.fromRGB(105, 135, 175);
	rowStroke.Transparency = 0.55;
	rowStroke.Parent = row;

	const avatar = new Instance("ImageLabel");
	avatar.Name = "Avatar";
	avatar.AnchorPoint = new Vector2(0, 0.5);
	avatar.BackgroundColor3 = Color3.fromRGB(46, 60, 80);
	avatar.BorderSizePixel = 0;
	avatar.Image = `rbxthumb://type=AvatarHeadShot&id=${other.UserId}&w=48&h=48`;
	avatar.Position = new UDim2(0, 8, 0.5, 0);
	avatar.Size = new UDim2(0, 34, 0, 34);
	const avatarCorner = new Instance("UICorner");
	avatarCorner.CornerRadius = new UDim(0.5, 0);
	avatarCorner.Parent = avatar;
	avatar.Parent = row;

	const nameLabel = new Instance("TextLabel");
	nameLabel.Name = "PlayerName";
	nameLabel.AnchorPoint = new Vector2(0, 0.5);
	nameLabel.BackgroundTransparency = 1;
	nameLabel.FontFace = MENU_FONT;
	nameLabel.Position = new UDim2(0, 52, 0.5, 0);
	nameLabel.Size = new UDim2(1, -180, 0, 22);
	nameLabel.Text = other.DisplayName;
	nameLabel.TextColor3 = new Color3(1, 1, 1);
	nameLabel.TextScaled = true;
	nameLabel.TextXAlignment = Enum.TextXAlignment.Left;
	nameLabel.Parent = row;

	const inviteButton = new Instance("TextButton");
	inviteButton.Name = "Invite";
	inviteButton.AnchorPoint = new Vector2(1, 0.5);
	inviteButton.AutoButtonColor = true;
	inviteButton.BackgroundColor3 = Color3.fromRGB(166, 235, 187);
	inviteButton.BorderSizePixel = 0;
	inviteButton.FontFace = MENU_FONT;
	inviteButton.Position = new UDim2(1, -8, 0.5, 0);
	inviteButton.Size = new UDim2(0, 108, 0, 30);
	inviteButton.Text = "INVITE";
	inviteButton.TextColor3 = Color3.fromRGB(20, 76, 43);
	inviteButton.TextScaled = true;
	const inviteCorner = new Instance("UICorner");
	inviteCorner.CornerRadius = new UDim(0, 15);
	inviteCorner.Parent = inviteButton;
	const invitePadding = new Instance("UIPadding");
	invitePadding.PaddingTop = new UDim(0, 6);
	invitePadding.PaddingBottom = new UDim(0, 6);
	invitePadding.Parent = inviteButton;
	inviteButton.MouseButton1Click.Connect(() => {
		inviteButton.Text = "SENT ✓";
		getUiIntentEvent("Intent_InvitePlayer").FireServer(other.UserId);
	});
	inviteButton.Parent = row;
	return row;
}

function renderTeamPage() {
	const team = myTeam();
	if (!team) {
		return;
	}
	const panel = teamPage.Panel;
	panel.Header.TeamName.Text = teamDisplayName(team).upper();
	const open = team.GetAttribute("CB_Open") === true;
	panel.AllowRandoms.SwitchTrack.BackgroundColor3 = open ? Color3.fromRGB(0, 190, 100) : Color3.fromRGB(75, 84, 98);
	panel.AllowRandoms.SwitchTrack.SwitchKnob.Position = UDim2.fromScale(open ? 0.73 : 0.27, 0.5);

	// Member cards: slot i shows members[i] (index 0 = creator = crown).
	const members = teamMembers(team);
	const slots = [panel.Members.Slot1, panel.Members.Slot2, panel.Members.Slot3];
	for (let i = 0; i < slots.size(); i++) {
		const slot = slots[i];
		const member = members[i] as Player | undefined;
		if (member) {
			slot.Avatar.Image = `rbxthumb://type=AvatarHeadShot&id=${member.UserId}&w=150&h=150`;
			slot.PlayerName.Text = i === 0 ? `👑 ${member.DisplayName}` : member.DisplayName;
			slot.PlayerName.TextColor3 = member === LocalPlayer ? Color3.fromRGB(255, 214, 120) : new Color3(1, 1, 1);
			slot.PlayerName.TextTransparency = 0;
			slot.ReadyTag.Visible = isReady(member);
		} else {
			slot.Avatar.Image = "";
			slot.PlayerName.Text = "EMPTY SLOT";
			slot.PlayerName.TextColor3 = new Color3(1, 1, 1);
			slot.PlayerName.TextTransparency = 0.5;
			slot.ReadyTag.Visible = false;
		}
	}

	// Play button doubles as the vote button once the team has 2+ members.
	let readyCount = 0;
	for (const member of members) {
		if (isReady(member)) {
			readyCount += 1;
		}
	}
	if (team.GetAttribute("CB_Pending") === true) {
		panel.Play.Text = "STARTING SOON…";
	} else if (members.size() <= 1) {
		panel.Play.Text = "PLAY";
	} else if (isReady(LocalPlayer)) {
		panel.Play.Text = `CANCEL — ${readyCount}/${members.size()} READY`;
	} else {
		panel.Play.Text = `READY UP (${readyCount}/${members.size()})`;
	}

	// Invitable players: everyone in the server not already on this team.
	clearInviteRows();
	let rowCount = 0;
	for (const other of Players.GetPlayers()) {
		if (other === LocalPlayer || other.Team === team) {
			continue;
		}
		rowCount += 1;
		buildInviteRow(other).Parent = panel.PlayerList;
	}
	panel.PlayerList.EmptyHint.Visible = rowCount === 0;
}

// ---- flow routing ----------------------------------------------------------

function applyFlowState() {
	const state = flowState();
	landing.Enabled = state === "menu";
	const lobby = state === "lobby";
	if (lobby) {
		renderTeamPage();
	}
	teamPage.Enabled = lobby;
}

// Team-scoped connections (attribute/name watchers on the current team and
// CB_Ready watchers per player), rebuilt whenever the team changes.
let teamConnections: RBXScriptConnection[] = [];

function rerenderIfLobby() {
	if (flowState() === "lobby") {
		renderTeamPage();
	}
}

function watchTeam() {
	for (const connection of teamConnections) {
		connection.Disconnect();
	}
	teamConnections = [];
	const team = myTeam();
	if (team) {
		teamConnections.push(team.AttributeChanged.Connect(() => rerenderIfLobby()));
		teamConnections.push(team.GetPropertyChangedSignal("Name").Connect(() => rerenderIfLobby()));
	}
	rerenderIfLobby();
}

// Per-player CB_Ready watchers (checkmarks) — any player can become a
// teammate, so watch them all and re-render when a change touches the lobby.
const readyConnections = new Map<Player, RBXScriptConnection>();

function watchPlayerReady(player: Player) {
	if (readyConnections.has(player)) {
		return;
	}
	readyConnections.set(
		player,
		player.GetAttributeChangedSignal("CB_Ready").Connect(() => rerenderIfLobby()),
	);
}

for (const player of Players.GetPlayers()) {
	watchPlayerReady(player);
}
Players.PlayerAdded.Connect((player) => {
	watchPlayerReady(player);
	// New arrival appears in the invite list (deferred like the old server
	// wiring, so registry state settles first).
	task.defer(rerenderIfLobby);
});
Players.PlayerRemoving.Connect((player) => {
	readyConnections.get(player)?.Disconnect();
	readyConnections.delete(player);
	task.defer(rerenderIfLobby);
});

LocalPlayer.GetAttributeChangedSignal("CB_FlowState").Connect(applyFlowState);
LocalPlayer.GetPropertyChangedSignal("Team").Connect(() => {
	watchTeam();
});

// ---- landing buttons -------------------------------------------------------

landing.Panel.Buttons.JoinTeam.MouseButton1Click.Connect(() => {
	getUiIntentEvent("Intent_PlayRandom").FireServer();
});
landing.Panel.Buttons.CreateTeam.MouseButton1Click.Connect(() => {
	getUiIntentEvent("Intent_CreateTeam").FireServer();
});
landing.Panel.Buttons.Cars.MouseButton1Click.Connect(() => {
	getUiIntentEvent("Intent_OpenGarage").FireServer();
});

// ---- team page buttons -----------------------------------------------------

teamPage.Panel.Play.MouseButton1Click.Connect(() => {
	getUiIntentEvent("Intent_ReadyVote").FireServer();
});
teamPage.Panel.Leave.MouseButton1Click.Connect(() => {
	getUiIntentEvent("Intent_LeaveTeam").FireServer();
});
teamPage.Panel.AllowRandoms.MouseButton1Click.Connect(() => {
	const team = myTeam();
	if (team) {
		getUiIntentEvent("Intent_SetTeamOpen").FireServer(!(team.GetAttribute("CB_Open") === true));
	}
});
teamPage.Panel.InviteFriends.MouseButton1Click.Connect(() => {
	// Roblox's native invite prompt is client-only — call it directly (the
	// server used to bounce this through the PromptGameInvite remote).
	pcall(() => {
		let canSend = true;
		pcall(() => {
			canSend = SocialService.CanSendGameInviteAsync(LocalPlayer);
		});
		if (canSend) {
			SocialService.PromptGameInvite(LocalPlayer);
		}
	});
});

// ---- invite popup ----------------------------------------------------------

interface InvitePayload {
	fromUserId: number;
	fromName: string;
	teamId: string;
	teamName: string;
}

function applyInviteState() {
	const failText = LocalPlayer.GetAttribute("CB_InviteError");
	if (typeIs(failText, "string") && failText !== "") {
		// Accept failed server-side (team launched/filled/disbanded during the
		// invite's lifetime) — buttons-hidden message, cleared after ~2.5 s.
		invitePopup.Panel.Message.Text = failText;
		invitePopup.Panel.Accept.Visible = false;
		invitePopup.Panel.Decline.Visible = false;
		invitePopup.Enabled = true;
		return;
	}
	const raw = LocalPlayer.GetAttribute("CB_Invite");
	if (typeIs(raw, "string") && raw !== "") {
		const [ok, invite] = pcall(() => HttpService.JSONDecode(raw) as InvitePayload);
		if (ok && typeIs(invite, "table")) {
			invitePopup.Panel.Message.Text = `${invite.fromName} invited you to ${invite.teamName}`;
			invitePopup.Panel.Accept.Visible = true;
			invitePopup.Panel.Decline.Visible = true;
			invitePopup.Enabled = true;
			return;
		}
	}
	invitePopup.Enabled = false;
}

invitePopup.Panel.Accept.MouseButton1Click.Connect(() => {
	getUiIntentEvent("Intent_ResolveInvite").FireServer(true);
});
invitePopup.Panel.Decline.MouseButton1Click.Connect(() => {
	getUiIntentEvent("Intent_ResolveInvite").FireServer(false);
});
LocalPlayer.GetAttributeChangedSignal("CB_Invite").Connect(applyInviteState);
LocalPlayer.GetAttributeChangedSignal("CB_InviteError").Connect(applyInviteState);

// ---- rename popup ----------------------------------------------------------
// Confirm → SubmitTeamName is wired by carBallMenu.client.ts; this script owns
// opening/closing and the status line.

function openRenamePopup(statusText?: string) {
	renamePopup.Panel.Status.Text = statusText ?? "";
	renamePopup.Enabled = true;
}

renamePopup.Panel.Close.MouseButton1Click.Connect(() => {
	renamePopup.Enabled = false;
});

teamPage.Panel.Header.Rename.MouseButton1Click.Connect(() => {
	const credits = LocalPlayer.GetAttribute("CB_RenameCredits");
	if (typeIs(credits, "number") && credits > 0) {
		openRenamePopup();
	} else {
		// No credit: the server prompts the rename-product purchase (or grants
		// a test credit when the product id is unset).
		getUiIntentEvent("Intent_RequestRename").FireServer();
	}
});

// (CB_RenamePrompt retired in Phase 5: the Garage TeamNameStrip is
// client-built now and opens the popup directly — see garage.client.ts.)

// Rename purchase completions open the naming popup (credits arrive
// asynchronously via purchaseHandler's receipt processor — this replaces the
// old server-side CB_RenameCredits watcher).
LocalPlayer.GetAttributeChangedSignal("CB_RenameCredits").Connect(() => {
	const credits = LocalPlayer.GetAttribute("CB_RenameCredits");
	if (typeIs(credits, "number") && credits > 0) {
		openRenamePopup();
	}
});

// Submission feedback: "" closes the popup (rename ok / no credit), the other
// values map to the old status lines.
LocalPlayer.GetAttributeChangedSignal("CB_RenameStatus").Connect(() => {
	const status = LocalPlayer.GetAttribute("CB_RenameStatus");
	if (status === "moderated") {
		renamePopup.Panel.Status.Text = "That name was moderated — try another";
	} else if (status === "error") {
		renamePopup.Panel.Status.Text = "Something went wrong — try again";
	} else if (status === "") {
		renamePopup.Enabled = false;
	}
	// "pending": leave the popup as-is while the server filters the name.
});

// ---- boot ------------------------------------------------------------------

watchTeam();
applyFlowState();
applyInviteState();
