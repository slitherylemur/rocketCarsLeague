// Client-side LadderMap builder + animation driver (migration Phase 7; see
// src/server/ui/LadderMapScreen.ts for the scene coordinator).
//
// The LadderMap ScreenGui is CLIENT-mounted (bootstrap.client.ts). The server
// still owns the blocking scene timeline; this script owns everything visual:
//
//   * LocalPlayer "CB_LadderData" (JSON) — set at scene start: build the board
//     (cards + team plates, staged exactly like the old server builder: plates
//     carry CB_ToX/CB_ToY targets, World carries CB_Move*/CB_Pan*, the gui
//     carries CB_CamCenter) and set LadderMap.Enabled = true. A "champions"
//     payload builds the session-end gold panel instead. Cleared — hide the
//     gui. Enabled ownership lives HERE, so matchHud.client.ts's
//     ladderMapCovering (reads LadderMap.Enabled) keeps working.
//   * ReplicatedStorage "CB_LadderAnim" — the phase triggers:
//       "cam:<duration>:<seq>"  → 3D camera rises above CB_CamCenter while the
//                                 Canvas fades in over the second half.
//       "move:<duration>:<seq>" → snap the cam phase's end state (Canvas
//                                 opaque), then tween every CB_To* plate and
//                                 the World camera-follow.
//       "pan:<duration>:<seq>"  → snap the move phase's end state (plates at
//                                 targets, World at CB_Move, final position
//                                 label), then tween the pan to the 🏆 pitch.
//     Triggers are ignored until the board is built, and the current trigger
//     is re-run right after building — data always replicates before the
//     first trigger, and a client that joins/rebuilds mid-scene snaps forward
//     instead of missing the scene. The snap-at-phase-start entries replace
//     the server's old authoritative post-phase snaps (it can no longer see
//     the instances).
//
// The <seq> nonce only makes consecutive values distinct so the attribute
// change always fires.
//
// Camera note: the camera is deliberately left Scriptable at the top of the
// rise — by then the opaque ladder UI covers the screen, and the shop-phase
// menu that follows installs its own camera (same handoff the victory scene
// already used).

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const TweenService = game.GetService("TweenService");
const HttpService = game.GetService("HttpService");
const LocalPlayer = Players.LocalPlayer;

const CAM_START_HEIGHT = 10;
const CAM_END_HEIGHT = 650;
// Straight-down look needs an explicit up vector (the default Y-up is
// degenerate). The pitch's long (goal-to-goal) axis runs along world Z, so
// the up vector must be along X for that axis to read HORIZONTAL on screen —
// matching the landscape pitch cards the UI fades into. -X up puts the
// better pitches (gold is first along the line) toward the top of screen.
const CAM_UP = new Vector3(-1, 0, 0);

// ---- ladder geometry (all Stage-scale; Stage is a fixed 16:9 letterbox) ---
// Copied verbatim from the old server builder (LadderMapScreen pre-Phase-7):
// world-space X runs RIGHT-TO-LEFT down the ladder — slot 0 (gold/top table)
// rightmost, one SLOT_W further left per table, muckabout past the bottom
// table on the far left. Coordinates go negative — the camera pans.

const STAGE_ASPECT = 16 / 9;
const CARD_ASPECT = 1.75; // landscape pitch card, w/h in PIXELS
const PITCH_W = 0.52; // card width in world scale
const CARD_H = (PITCH_W * STAGE_ASPECT) / CARD_ASPECT; // ≈0.53 — pixel aspect holds because Stage is 16:9
const PITCH_GAP = 0.1; // gap between neighbouring pitches
const SLOT_W = PITCH_W + PITCH_GAP;
const ROW_Y = 0.5;

// Camera scales: focused (your pitch fills most of the screen) and the
// panned-out ladder overview.
const FOCUS_SCALE = 1.5;
const PAN_SCALE = 0.95;

// Team plates (world scale) — one per team, parented to World so they can
// tween BETWEEN pitches.
const PLATE_W = 0.2;
const PLATE_H = 0.145;
const PLATE_DX = 0.15; // half-centre offset from the card centre

const GOLD_TINT = Color3.fromRGB(236, 195, 58); // brighter gold — reads as gold, not brown
const MUD_TINT = Color3.fromRGB(139, 94, 60); // #8B5E3C
const GREEN_TINT = Color3.fromRGB(61, 139, 87); // #3D8B57
const MUCK_TINT = Color3.fromRGB(52, 63, 74); // neutral slate — not a real table
const TITLE_GOLD = Color3.fromRGB(255, 200, 60);
const PITCH_IMAGE = "rbxassetid://137005280957670"; // landscape pitch lines
const BLACK = new Color3(0, 0, 0);
const WHITE = new Color3(1, 1, 1);
const SHADOW_TRANSPARENCY = 0.4;

const TITLE_FONT = new Font(
	"rbxasset://fonts/families/FredokaOne.json",
	Enum.FontWeight.Regular,
	Enum.FontStyle.Normal,
);
const PLATE_FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

// ---- payload shapes (mirror of src/server/ui/LadderMapScreen.ts) ----------

interface LadderEntryPayload {
	teamId: string;
	name: string;
	color: [number, number, number];
	from: number;
	to: number;
	images: string[];
}

interface LadderDataPayload {
	kind: "ladder";
	teamCount: number;
	entries: LadderEntryPayload[];
	camCenter?: [number, number, number];
}

interface ChampionsPayload {
	kind: "champions";
	teamName: string;
	memberNames: string[];
	rewardEach: number;
}

type LadderPayload = LadderDataPayload | ChampionsPayload;

// ---- gui lookups ----------------------------------------------------------

interface LadderCanvasShape extends CanvasGroup {
	Stage: Frame & { World: Frame };
	Title: TextLabel;
	PositionLabel: TextLabel;
	Rows: Frame;
}

interface LadderGuiShape extends ScreenGui {
	Canvas: LadderCanvasShape;
}

const playerGui = LocalPlayer.WaitForChild("PlayerGui");
const ladderGui = playerGui.WaitForChild("LadderMap") as LadderGuiShape;
const canvas = ladderGui.WaitForChild("Canvas") as LadderCanvasShape;
const world = (canvas.WaitForChild("Stage") as Frame).WaitForChild("World") as Frame;

// ---- world-coordinate helpers --------------------------------------------

interface LadderLayout {
	teamCount: number;
	realTables: number;
	hasMuckabout: boolean;
	slotCount: number;
}

function computeLayout(teamCount: number): LadderLayout {
	const realTables = math.max(1, math.floor(teamCount / 2));
	const hasMuckabout = teamCount > 1 && teamCount % 2 === 1;
	return { teamCount, realTables, hasMuckabout, slotCount: realTables + (hasMuckabout ? 1 : 0) };
}

/** World-space X centre of a ladder slot (0 = gold table, RIGHTMOST; higher
 * slots step leftward so the ladder descends right-to-left). */
function slotCenterX(slotIndex: number): number {
	return PITCH_W / 2 - slotIndex * SLOT_W;
}

/** THE 2D-camera function: the World Position that centres `slotIndex`'s
 * pitch on screen at zoom `scale` (World is anchored 0.5,0.5 inside Stage). */
function focusPositionFor(slotIndex: number, scale: number): UDim2 {
	return new UDim2(0.5 - (slotCenterX(slotIndex) - 0.5) * scale, 0, 0.5 - (ROW_Y - 0.5) * scale, 0);
}

/** Ladder slot a position lives on: consecutive pairing (2t, 2t+1 → table t),
 * odd leftover → the muckabout slot past the last real table. */
function slotForPosition(layout: LadderLayout, position: number): number {
	if (layout.hasMuckabout && position === layout.teamCount - 1) {
		return layout.realTables;
	}
	return math.min(layout.realTables - 1, math.max(0, math.floor(position / 2)));
}

/** Plate centre for a ladder position: left half for the even (upper) seat,
 * right half for the odd seat; muckabout team sits alone at its card centre. */
function plateCenterFor(layout: LadderLayout, position: number): Vector2 {
	const slot = slotForPosition(layout, position);
	if (layout.hasMuckabout && position === layout.teamCount - 1) {
		return new Vector2(slotCenterX(slot), ROW_Y);
	}
	const dx = position % 2 === 0 ? -PLATE_DX : PLATE_DX;
	return new Vector2(slotCenterX(slot) + dx, ROW_Y);
}

function ordinal(position: number): string {
	const lastTwo = position % 100;
	if (lastTwo >= 11 && lastTwo <= 13) {
		return `${position}th`;
	}
	const last = position % 10;
	return `${position}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

// ---- builders (verbatim ports of the old server builders) -----------------

/** Sharp-cornered drop shadow behind a container's Body (containers are
 * transparent because children always render above the parent's own fill). */
function addShadow(container: GuiObject, offsetX: number, offsetY: number) {
	const shadow = new Instance("Frame");
	shadow.Name = "Shadow";
	shadow.AnchorPoint = new Vector2(0.5, 0.5);
	shadow.Position = new UDim2(0.5 + offsetX, 0, 0.5 + offsetY, 0);
	shadow.Size = new UDim2(1, 0, 1, 0);
	shadow.BackgroundColor3 = BLACK;
	shadow.BackgroundTransparency = SHADOW_TRANSPARENCY;
	shadow.BorderSizePixel = 0;
	shadow.ZIndex = 1;
	shadow.Parent = container;
}

/** Centre badge text: 🏆 for the top table, 💩 for the bottom slot, plain
 * table numbers between. */
function badgeTextFor(layout: LadderLayout, slotIndex: number): string {
	if (slotIndex === 0) {
		return "🏆";
	}
	if (slotIndex === layout.slotCount - 1) {
		return "💩";
	}
	return tostring(slotIndex + 1);
}

function buildCard(layout: LadderLayout, slotIndex: number, muckabout: boolean) {
	const isBottomReal = slotIndex === layout.realTables - 1 && layout.realTables > 1;
	const tint = muckabout ? MUCK_TINT : slotIndex === 0 ? GOLD_TINT : isBottomReal ? MUD_TINT : GREEN_TINT;

	const card = new Instance("Frame");
	card.Name = `Card${slotIndex}`;
	card.AnchorPoint = new Vector2(0.5, 0.5);
	card.Position = new UDim2(slotCenterX(slotIndex), 0, ROW_Y, 0);
	card.Size = new UDim2(PITCH_W, 0, CARD_H, 0);
	card.BackgroundTransparency = 1;
	card.ZIndex = 2;

	addShadow(card, 0.03, 0.045);

	const body = new Instance("Frame");
	body.Name = "Body";
	body.AnchorPoint = new Vector2(0.5, 0.5);
	body.Position = new UDim2(0.5, 0, 0.5, 0);
	body.Size = new UDim2(1, 0, 1, 0);
	// Solid, undarkened tint — the cards must read bright against the dark
	// backdrop (a black-lerped tint looked murky/translucent in playtest).
	body.BackgroundColor3 = tint;
	body.BorderSizePixel = 0;
	body.ZIndex = 2;

	// Landscape pitch-lines image, natural orientation (goals left/right) —
	// the card IS pitch-shaped so it stretches exactly.
	const pitch = new Instance("ImageLabel");
	pitch.Name = "Pitch";
	pitch.AnchorPoint = new Vector2(0.5, 0.5);
	pitch.Position = new UDim2(0.5, 0, 0.5, 0);
	pitch.Size = new UDim2(1, 0, 1, 0);
	pitch.BackgroundTransparency = 1;
	pitch.BorderSizePixel = 0;
	pitch.Image = PITCH_IMAGE;
	pitch.ImageColor3 = WHITE;
	pitch.ScaleType = Enum.ScaleType.Stretch;
	pitch.ZIndex = 3;
	pitch.Parent = body;

	// Centre position badge. The muckabout card's single plate sits at the
	// card centre, so its badge moves to the top edge instead.
	const badge = new Instance("TextLabel");
	badge.Name = "Badge";
	badge.AnchorPoint = new Vector2(0.5, 0.5);
	badge.Position = muckabout ? new UDim2(0.5, 0, 0.14, 0) : new UDim2(0.5, 0, 0.5, 0);
	badge.Size = new UDim2(0.18, 0, 0.34, 0);
	badge.BackgroundTransparency = 1;
	badge.FontFace = TITLE_FONT;
	badge.TextScaled = true;
	badge.TextColor3 = WHITE;
	badge.TextStrokeColor3 = BLACK;
	badge.TextStrokeTransparency = 0.35;
	badge.Text = badgeTextFor(layout, slotIndex);
	badge.ZIndex = 4;
	badge.Parent = body;

	body.Parent = card;
	card.Parent = world;
}

function buildCards(layout: LadderLayout) {
	for (let slot = 0; slot < layout.realTables; slot++) {
		buildCard(layout, slot, false);
	}
	if (layout.hasMuckabout) {
		buildCard(layout, layout.realTables, true);
	}
}

/** Team plate: sharp-cornered drop-shadow box with the team name over a row
 * of member headshots, team-coloured. The returned frame is the tween target:
 * the move phase reads its CB_ToX/CB_ToY attributes. The viewer's own plate
 * gets a white outline so it reads instantly. */
function buildPlate(entry: LadderEntryPayload, isViewer: boolean, at: Vector2, to: Vector2): Frame {
	const color = new Color3(entry.color[0], entry.color[1], entry.color[2]);
	const plate = new Instance("Frame");
	plate.Name = `Plate_${entry.teamId}`;
	plate.AnchorPoint = new Vector2(0.5, 0.5);
	plate.Position = new UDim2(at.X, 0, at.Y, 0);
	plate.Size = new UDim2(PLATE_W, 0, PLATE_H, 0);
	plate.BackgroundTransparency = 1;
	plate.ZIndex = isViewer ? 6 : 5;
	plate.SetAttribute("CB_ToX", to.X);
	plate.SetAttribute("CB_ToY", to.Y);

	addShadow(plate, 0.045, 0.07);

	const body = new Instance("Frame");
	body.Name = "Body";
	body.AnchorPoint = new Vector2(0.5, 0.5);
	body.Position = new UDim2(0.5, 0, 0.5, 0);
	body.Size = new UDim2(1, 0, 1, 0);
	// Darkened team colour so the white name always reads.
	body.BackgroundColor3 = color.Lerp(BLACK, 0.4);
	body.BorderSizePixel = 0;
	body.ZIndex = 2;
	const stroke = new Instance("UIStroke");
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
	stroke.Color = isViewer ? WHITE : BLACK;
	stroke.Thickness = isViewer ? 3 : 1.5;
	stroke.Transparency = isViewer ? 0 : 0.25;
	stroke.Parent = body;

	const label = new Instance("TextLabel");
	label.Name = "TeamName";
	label.BackgroundTransparency = 1;
	label.Position = new UDim2(0.05, 0, 0.07, 0);
	label.Size = new UDim2(0.9, 0, 0.36, 0);
	label.FontFace = PLATE_FONT;
	label.TextScaled = true;
	label.TextColor3 = WHITE;
	label.TextStrokeColor3 = BLACK;
	label.TextStrokeTransparency = 0.6;
	label.Text = entry.name;
	label.ZIndex = 3;
	label.Parent = body;

	const icons = new Instance("Frame");
	icons.Name = "Icons";
	icons.BackgroundTransparency = 1;
	icons.Position = new UDim2(0.05, 0, 0.48, 0);
	icons.Size = new UDim2(0.9, 0, 0.44, 0);
	icons.ZIndex = 3;
	const iconLayout = new Instance("UIListLayout");
	iconLayout.FillDirection = Enum.FillDirection.Horizontal;
	iconLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center;
	iconLayout.VerticalAlignment = Enum.VerticalAlignment.Center;
	iconLayout.Padding = new UDim(0.03, 0);
	iconLayout.SortOrder = Enum.SortOrder.LayoutOrder;
	iconLayout.Parent = icons;
	for (let i = 0; i < entry.images.size(); i++) {
		const icon = new Instance("ImageLabel");
		icon.Name = "MemberIcon";
		icon.LayoutOrder = i;
		icon.Size = new UDim2(1, 0, 1, 0);
		icon.BackgroundColor3 = color.Lerp(BLACK, 0.65);
		icon.BorderSizePixel = 0;
		icon.Image = entry.images[i];
		icon.ZIndex = 3;
		const aspect = new Instance("UIAspectRatioConstraint");
		aspect.AspectRatio = 1;
		aspect.AspectType = Enum.AspectType.FitWithinMaxSize;
		aspect.Parent = icon;
		icon.Parent = icons;
	}
	icons.Parent = body;

	body.Parent = plate;
	plate.Parent = world;
	return plate;
}

// ---- board state ----------------------------------------------------------

function clearRows(rows: Frame) {
	for (const child of rows.GetChildren()) {
		if (child.IsA("Frame")) {
			child.Destroy();
		}
	}
}

function resetWorld() {
	world.ClearAllChildren();
	world.Size = new UDim2(1, 0, 1, 0);
	world.Position = new UDim2(0.5, 0, 0.5, 0);
	world.SetAttribute("CB_MoveX", undefined);
	world.SetAttribute("CB_MoveY", undefined);
	world.SetAttribute("CB_PanScale", undefined);
	world.SetAttribute("CB_PanX", undefined);
	world.SetAttribute("CB_PanY", undefined);
}

interface BuiltBoard {
	plateSnaps: { plate: Frame; to: Vector2 }[];
	movePosition: UDim2;
	panPosition: UDim2;
	finalLabel?: string;
}

let board: BuiltBoard | undefined;

function buildLadder(payload: LadderDataPayload) {
	const layout = computeLayout(payload.teamCount);
	const viewerTeamId = LocalPlayer.GetAttribute("CB_TeamId");

	canvas.Title.Text = "LEAGUE";
	canvas.Title.TextColor3 = TITLE_GOLD;
	canvas.PositionLabel.Visible = false;
	canvas.PositionLabel.Text = "";
	clearRows(canvas.Rows);
	resetWorld();
	// Invisible until the cam-phase fade — even if a stale show left it 0.
	canvas.GroupTransparency = 1;
	buildCards(layout);

	let viewerEntry: LadderEntryPayload | undefined;
	const plateSnaps: { plate: Frame; to: Vector2 }[] = [];
	for (const entry of payload.entries) {
		const isViewer = entry.teamId === viewerTeamId;
		if (isViewer) {
			viewerEntry = entry;
		}
		const fromAt = plateCenterFor(layout, entry.from);
		const toAt = plateCenterFor(layout, entry.to);
		const plate = buildPlate(entry, isViewer, fromAt, toAt);
		plateSnaps.push({ plate, to: toAt });
	}

	// 2D camera staging: viewers with a team start FOCUSED on their old pitch
	// (matching the 3D pitch they rise away from) and follow their team during
	// the move; spectators just get the overview.
	const fromSlot = viewerEntry ? slotForPosition(layout, viewerEntry.from) : 0;
	const toSlot = viewerEntry ? slotForPosition(layout, viewerEntry.to) : 0;
	const startScale = viewerEntry ? FOCUS_SCALE : PAN_SCALE;
	world.Size = new UDim2(startScale, 0, startScale, 0);
	world.Position = focusPositionFor(fromSlot, startScale);
	const movePosition = focusPositionFor(toSlot, startScale);
	world.SetAttribute("CB_MoveX", movePosition.X.Scale);
	world.SetAttribute("CB_MoveY", movePosition.Y.Scale);
	const panPosition = focusPositionFor(0, PAN_SCALE);
	world.SetAttribute("CB_PanScale", PAN_SCALE);
	world.SetAttribute("CB_PanX", panPosition.X.Scale);
	world.SetAttribute("CB_PanY", panPosition.Y.Scale);

	// 3D rise anchor (absent for menu spectators — cam phase then fades only).
	if (payload.camCenter !== undefined) {
		ladderGui.SetAttribute(
			"CB_CamCenter",
			new Vector3(payload.camCenter[0], payload.camCenter[1], payload.camCenter[2]),
		);
	} else {
		ladderGui.SetAttribute("CB_CamCenter", undefined);
	}

	let finalLabel: string | undefined = undefined;
	if (viewerEntry) {
		canvas.PositionLabel.Visible = true;
		canvas.PositionLabel.Text = `YOU ARE ${ordinal(viewerEntry.from + 1)} OF ${layout.teamCount}`;
		finalLabel = `YOU ARE NOW ${ordinal(viewerEntry.to + 1)} OF ${layout.teamCount}`;
	}
	board = { plateSnaps, movePosition, panPosition, finalLabel };
	ladderGui.Enabled = true;
}

function buildChampions(payload: ChampionsPayload) {
	board = undefined;
	canvas.Title.Text = "TOP TABLE CHAMPIONS";
	canvas.Title.TextColor3 = Color3.fromRGB(255, 215, 90);
	// The ladder show that just ran left its board on World — clear it so only
	// the champions panel shows, and force the canvas visible (the ladder
	// staged it transparent for the fade-in).
	resetWorld();
	clearRows(canvas.Rows);
	canvas.PositionLabel.Visible = false;
	canvas.GroupTransparency = 0;

	const container = new Instance("Frame");
	container.Name = "ChampionsPanel";
	container.LayoutOrder = 0;
	container.BackgroundTransparency = 1;
	container.Size = new UDim2(0.55, 0, 0.7, 0);
	addShadow(container, 0.015, 0.012);

	const panel = new Instance("Frame");
	panel.Name = "Body";
	panel.AnchorPoint = new Vector2(0.5, 0.5);
	panel.Position = new UDim2(0.5, 0, 0.5, 0);
	panel.Size = new UDim2(1, 0, 1, 0);
	panel.BackgroundColor3 = GOLD_TINT;
	panel.BackgroundTransparency = 0;
	panel.BorderSizePixel = 0;
	panel.ZIndex = 2;
	const stroke = new Instance("UIStroke");
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
	stroke.Color = Color3.fromRGB(255, 235, 160);
	stroke.Thickness = 3;
	stroke.Parent = panel;
	const layout = new Instance("UIListLayout");
	layout.FillDirection = Enum.FillDirection.Vertical;
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center;
	layout.VerticalAlignment = Enum.VerticalAlignment.Center;
	layout.Padding = new UDim(0.03, 0);
	layout.SortOrder = Enum.SortOrder.LayoutOrder;
	layout.Parent = panel;

	const nameLabel = new Instance("TextLabel");
	nameLabel.Name = "TeamName";
	nameLabel.LayoutOrder = 0;
	nameLabel.BackgroundTransparency = 1;
	nameLabel.FontFace = TITLE_FONT;
	nameLabel.TextScaled = true;
	nameLabel.TextColor3 = WHITE;
	nameLabel.TextStrokeColor3 = BLACK;
	nameLabel.TextStrokeTransparency = 0.3;
	nameLabel.Text = payload.teamName;
	nameLabel.Size = new UDim2(0.9, 0, 0.22, 0);
	nameLabel.ZIndex = 3;
	nameLabel.Parent = panel;

	for (let i = 0; i < payload.memberNames.size(); i++) {
		const member = new Instance("TextLabel");
		member.Name = "Member";
		member.LayoutOrder = i + 1;
		member.BackgroundTransparency = 1;
		member.FontFace = PLATE_FONT;
		member.TextScaled = true;
		member.TextColor3 = Color3.fromRGB(30, 24, 8);
		member.Text = payload.memberNames[i];
		member.Size = new UDim2(0.8, 0, 0.12, 0);
		member.ZIndex = 3;
		member.Parent = panel;
	}

	const reward = new Instance("TextLabel");
	reward.Name = "Reward";
	reward.LayoutOrder = payload.memberNames.size() + 1;
	reward.BackgroundTransparency = 1;
	reward.FontFace = PLATE_FONT;
	reward.TextScaled = true;
	reward.TextColor3 = Color3.fromRGB(20, 90, 40);
	reward.Text = `+$${payload.rewardEach} each!`;
	reward.Size = new UDim2(0.8, 0, 0.12, 0);
	reward.ZIndex = 3;
	reward.Parent = panel;

	panel.Parent = container;
	container.Parent = canvas.Rows;
	ladderGui.Enabled = true;
}

function hideBoard() {
	board = undefined;
	ladderGui.Enabled = false;
}

// ---- animation phases -----------------------------------------------------

function runCamPhase(duration: number) {
	canvas.GroupTransparency = 1;
	const fadeTime = duration / 2;

	const center = ladderGui.GetAttribute("CB_CamCenter");
	const camera = game.Workspace.CurrentCamera;
	if (typeIs(center, "Vector3") && camera) {
		// Drone shot: launch straight up off the pitch (Quad Out — most of the
		// altitude lands in the first half, so the whole pitch and its
		// neighbours are in view BEFORE the fading-in UI covers them).
		camera.CameraType = Enum.CameraType.Scriptable;
		camera.CFrame = CFrame.lookAt(center.add(new Vector3(0, CAM_START_HEIGHT, 0)), center, CAM_UP);
		TweenService.Create(camera, new TweenInfo(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			CFrame: CFrame.lookAt(center.add(new Vector3(0, CAM_END_HEIGHT, 0)), center, CAM_UP),
		}).Play();
	}

	// The ladder fades in over the second half of the rise.
	task.delay(duration - fadeTime, () => {
		if (ladderGui.Parent === undefined || !ladderGui.Enabled) {
			return;
		}
		TweenService.Create(canvas, new TweenInfo(fadeTime, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			GroupTransparency: 0,
		}).Play();
	});
}

function runMovePhase(duration: number) {
	// Snap the cam phase's end state first (the old server-side snap): the
	// board is fully faded in by now.
	canvas.GroupTransparency = 0;
	const info = new TweenInfo(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut);
	for (const child of world.GetChildren()) {
		const toX = child.GetAttribute("CB_ToX");
		const toY = child.GetAttribute("CB_ToY");
		if (child.IsA("GuiObject") && typeIs(toX, "number") && typeIs(toY, "number")) {
			TweenService.Create(child, info, { Position: new UDim2(toX, 0, toY, 0) }).Play();
		}
	}
	// The 2D camera follows the viewer's team to its new pitch.
	const moveX = world.GetAttribute("CB_MoveX");
	const moveY = world.GetAttribute("CB_MoveY");
	if (typeIs(moveX, "number") && typeIs(moveY, "number")) {
		TweenService.Create(world, info, { Position: new UDim2(moveX, 0, moveY, 0) }).Play();
	}
}

function runPanPhase(duration: number) {
	// Snap the move phase's end state first (the old server-side snap): plates
	// at their targets, camera on the viewer's new pitch, final label text.
	if (board !== undefined) {
		for (const snap of board.plateSnaps) {
			if (snap.plate.Parent !== undefined) {
				snap.plate.Position = new UDim2(snap.to.X, 0, snap.to.Y, 0);
			}
		}
		world.Position = board.movePosition;
		if (board.finalLabel !== undefined) {
			canvas.PositionLabel.Text = board.finalLabel;
		}
	}
	canvas.GroupTransparency = 0;
	const scale = world.GetAttribute("CB_PanScale");
	const panX = world.GetAttribute("CB_PanX");
	const panY = world.GetAttribute("CB_PanY");
	if (typeIs(scale, "number") && typeIs(panX, "number") && typeIs(panY, "number")) {
		const info = new TweenInfo(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut);
		TweenService.Create(world, info, {
			Size: new UDim2(scale, 0, scale, 0),
			Position: new UDim2(panX, 0, panY, 0),
		}).Play();
	}
}

function runAnim() {
	if (board === undefined) {
		// Not built (data attribute not processed yet, or a champions panel is
		// up) — ignore; buildLadder re-runs the current trigger after building.
		return;
	}
	const anim = ReplicatedStorage.GetAttribute("CB_LadderAnim");
	if (!typeIs(anim, "string")) {
		return;
	}
	const [phase, durationText] = string.match(anim, "^(%a+):([%d%.]+)");
	const duration = tonumber(durationText);
	if (!typeIs(phase, "string") || duration === undefined) {
		return;
	}
	if (phase === "cam") {
		runCamPhase(duration);
	} else if (phase === "move") {
		runMovePhase(duration);
	} else if (phase === "pan") {
		runPanPhase(duration);
	}
}

// ---- wiring ---------------------------------------------------------------

function refreshFromData() {
	const raw = LocalPlayer.GetAttribute("CB_LadderData");
	if (!typeIs(raw, "string") || raw === "") {
		hideBoard();
		return;
	}
	const [ok, decoded] = pcall(() => HttpService.JSONDecode(raw) as LadderPayload);
	if (!ok || !typeIs(decoded, "table")) {
		hideBoard();
		return;
	}
	const payload = decoded as LadderPayload;
	if (payload.kind === "champions") {
		buildChampions(payload);
	} else {
		buildLadder(payload);
		// A (re)build mid-scene: honor whatever phase is already staged so a
		// late client snaps forward instead of sitting on the initial board.
		runAnim();
	}
}

LocalPlayer.GetAttributeChangedSignal("CB_LadderData").Connect(refreshFromData);
ReplicatedStorage.GetAttributeChangedSignal("CB_LadderAnim").Connect(runAnim);
refreshFromData();
