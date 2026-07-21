// Server-side population of the LadderMap ScreenGui (Top Table Phase 4b) and
// its session-end CHAMPIONS reuse (Phase 5). Same contract as
// footballMatch.showRoundSummary: React owns the static structure
// (components/LadderMapGui.tsx), this module builds the per-viewer children
// imperatively and toggles Enabled — no remotes.
//
// The ladder is a HORIZONTAL row of VERTICAL pitch cards (gold left → mud
// right, muckabout beyond it). The pitch image asset is landscape (goals
// left/right), so each card shows it rotated 90° — goals top/bottom — with
// the blue-side team's name chip over the top half and the red-side team's
// over the bottom half. The viewer's own team is a white YOU disc instead of
// a name chip, and the bottom of the screen states their ladder position.
//
// Animation contract: this module only STAGES the animation — chips carry
// CB_ToX/CB_ToY target attributes, the Board carries CB_Zoom* attributes, and
// the gui-level CB_Anim attribute ("move:<dur>:<seq>" / "zoom:<dur>:<seq>")
// tells src/client/ladderMap.client.ts to run the tweens locally (smooth,
// unlike server-side TweenService whose property writes replicate at network
// rate and stutter). The server still owns the timeline: it waits out each
// phase and then SNAPS the final property values so state is correct even for
// a client that missed the trigger.

import type { MovementEntry } from "../Modules/MatchDirector";

const Players = game.GetService("Players");

// Choreography (showLadderMap blocks for the sum, ~7 s):
const SETTLE_TIME = 1; // chips sit at their OLD slots
const MOVE_TIME = 1.5; // chips tween to their NEW slots
const MOVED_HOLD = 1;
const ZOOM_TIME = 1; // Board zooms onto the viewer's new table
const ZOOM_HOLD = 2.5;
const CHAMPIONS_TIME = 8;

const GOLD_TINT = Color3.fromRGB(201, 162, 39); // #C9A227
const MUD_TINT = Color3.fromRGB(139, 94, 60); // #8B5E3C
const GREEN_TINT = Color3.fromRGB(61, 139, 87); // #3D8B57
const BLUE_SIDE = Color3.fromRGB(79, 168, 255);
const RED_SIDE = Color3.fromRGB(255, 80, 80);
const TITLE_GOLD = Color3.fromRGB(255, 200, 60);
const PITCH_IMAGE = "rbxassetid://82665164784111";
const BLACK = new Color3(0, 0, 0);
const WHITE = new Color3(1, 1, 1);

const TITLE_FONT = new Font(
	"rbxasset://fonts/families/FredokaOne.json",
	Enum.FontWeight.Regular,
	Enum.FontStyle.Normal,
);
const CHIP_FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

interface LadderGuiShape extends ScreenGui {
	Title: TextLabel;
	Rows: Frame;
	Board: Frame;
	Panel: Frame;
	PositionLabel: TextLabel;
}

function ladderGuiOf(player: Player): LadderGuiShape | undefined {
	const playerGui = player.FindFirstChild("PlayerGui");
	const gui = playerGui && playerGui.FindFirstChild("LadderMap");
	if (
		gui &&
		gui.IsA("ScreenGui") &&
		gui.FindFirstChild("Title") &&
		gui.FindFirstChild("Rows") &&
		gui.FindFirstChild("Board") &&
		gui.FindFirstChild("Panel") &&
		gui.FindFirstChild("PositionLabel")
	) {
		return gui as LadderGuiShape;
	}
	return undefined;
}

function clearRows(rows: Frame) {
	for (const child of rows.GetChildren()) {
		if (child.IsA("Frame")) {
			child.Destroy();
		}
	}
}

function resetBoard(board: Frame) {
	board.ClearAllChildren();
	board.Size = new UDim2(1, 0, 1, 0);
	board.Position = new UDim2(0.5, 0, 0.5, 0);
	board.SetAttribute("CB_ZoomScale", undefined);
	board.SetAttribute("CB_ZoomX", undefined);
	board.SetAttribute("CB_ZoomY", undefined);
}

function hideAll() {
	for (const player of Players.GetPlayers()) {
		pcall(() => {
			const gui = ladderGuiOf(player);
			if (gui) {
				gui.Enabled = false;
			}
		});
	}
}

// Monotonic sequence baked into CB_Anim so consecutive triggers with the same
// phase+duration still fire GetAttributeChangedSignal on the client.
let animSeq = 0;

// ---- ladder geometry (all Board-scale coordinates) -----------------------

const CARD_Y = 0.47; // vertical center of the card row (matches Panel center)
// Pitch cards are PORTRAIT with a fixed pixel aspect (w/h) enforced by a
// UIAspectRatioConstraint, so the rotated pitch image fills them exactly on
// every screen aspect. The Y size is only a generous fit-within budget.
const CARD_ASPECT = 0.68;
const CARD_H_BUDGET = 0.55;
const CHIP_ROW_DY = 0.13; // name chip rows above/below the card center
const CHIP_H = 0.062;
const VIEWER_DISC = 0.12; // YOU disc diameter (square via aspect constraint)
const SHADOW_TRANSPARENCY = 0.45;

interface LadderLayout {
	teamCount: number;
	realTables: number;
	hasMuckabout: boolean;
	slotCount: number;
	cardW: number;
}

function computeLayout(teamCount: number): LadderLayout {
	const realTables = math.max(1, math.floor(teamCount / 2));
	const hasMuckabout = teamCount > 1 && teamCount % 2 === 1;
	const slotCount = realTables + (hasMuckabout ? 1 : 0);
	// Cards + 0.3-card gaps fit in 0.9 of the screen width.
	const cardW = math.min(0.17, 0.9 / (1.3 * slotCount - 0.3));
	return { teamCount, realTables, hasMuckabout, slotCount, cardW };
}

function cardCenterX(layout: LadderLayout, index: number): number {
	const totalW = layout.cardW * (1.3 * layout.slotCount - 0.3);
	return 0.5 - totalW / 2 + layout.cardW / 2 + index * 1.3 * layout.cardW;
}

/** Chip center for a ladder position: consecutive pairing (2t, 2t+1 → table
 * t; even index = top/blue half, odd = bottom/red half), odd leftover →
 * muckabout (single chip, card center). */
function chipCenterFor(layout: LadderLayout, position: number): Vector2 {
	if (layout.hasMuckabout && position === layout.teamCount - 1) {
		return new Vector2(cardCenterX(layout, layout.realTables), CARD_Y);
	}
	const tableIndex = math.min(layout.realTables - 1, math.floor(position / 2));
	const dy = position % 2 === 0 ? -CHIP_ROW_DY : CHIP_ROW_DY;
	return new Vector2(cardCenterX(layout, tableIndex), CARD_Y + dy);
}

// ---- ladder builders ------------------------------------------------------

/** Sharp-cornered drop shadow behind a container's Body (containers are
 * transparent because children always render above the parent's own fill). */
function addShadow(container: GuiObject, offsetX: number, offsetY: number, round: boolean) {
	const shadow = new Instance("Frame");
	shadow.Name = "Shadow";
	shadow.AnchorPoint = new Vector2(0.5, 0.5);
	shadow.Position = new UDim2(0.5 + offsetX, 0, 0.5 + offsetY, 0);
	shadow.Size = new UDim2(1, 0, 1, 0);
	shadow.BackgroundColor3 = BLACK;
	shadow.BackgroundTransparency = SHADOW_TRANSPARENCY;
	shadow.BorderSizePixel = 0;
	shadow.ZIndex = 1;
	if (round) {
		const corner = new Instance("UICorner");
		corner.CornerRadius = new UDim(1, 0);
		corner.Parent = shadow;
	}
	shadow.Parent = container;
}

function buildCard(
	board: Frame,
	layout: LadderLayout,
	index: number,
	tint: Color3 | undefined,
	titleText: string,
	withSideStrips: boolean,
) {
	const card = new Instance("Frame");
	card.Name = `Card${index}`;
	card.AnchorPoint = new Vector2(0.5, 0.5);
	card.Position = new UDim2(cardCenterX(layout, index), 0, CARD_Y, 0);
	card.Size = new UDim2(layout.cardW, 0, CARD_H_BUDGET, 0);
	card.BackgroundTransparency = 1;
	card.ZIndex = 2;
	const aspect = new Instance("UIAspectRatioConstraint");
	aspect.AspectRatio = CARD_ASPECT;
	aspect.AspectType = Enum.AspectType.FitWithinMaxSize;
	aspect.DominantAxis = Enum.DominantAxis.Width;
	aspect.Parent = card;

	addShadow(card, 0.05, 0.035, false);

	const body = new Instance("Frame");
	body.Name = "Body";
	body.AnchorPoint = new Vector2(0.5, 0.5);
	body.Position = new UDim2(0.5, 0, 0.5, 0);
	body.Size = new UDim2(1, 0, 1, 0);
	body.BorderSizePixel = 0;
	body.ZIndex = 2;
	if (tint) {
		// Darkened solid tint keeps the gold/green/mud reading without the old
		// washed-out translucency.
		body.BackgroundColor3 = tint.Lerp(BLACK, 0.25);
		body.BackgroundTransparency = 0;
	} else {
		body.BackgroundColor3 = Color3.fromRGB(20, 24, 29);
		body.BackgroundTransparency = 0;
		const stroke = new Instance("UIStroke");
		stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
		stroke.Color = WHITE;
		stroke.Thickness = 2;
		stroke.Parent = body;
	}

	// The pitch asset is LANDSCAPE (goals left/right); the card is portrait.
	// Default Stretch would squash it, so it renders rotated 90° — goals
	// top/bottom. Sized (1/aspect, aspect) of the card, which is exactly the
	// card's own pixel size transposed because the aspect constraint fixes
	// width/height = CARD_ASPECT.
	const pitch = new Instance("ImageLabel");
	pitch.Name = "Pitch";
	pitch.AnchorPoint = new Vector2(0.5, 0.5);
	pitch.Position = new UDim2(0.5, 0, 0.5, 0);
	pitch.Size = new UDim2(1 / CARD_ASPECT, 0, CARD_ASPECT, 0);
	pitch.Rotation = 90;
	pitch.BackgroundTransparency = 1;
	pitch.BorderSizePixel = 0;
	pitch.Image = PITCH_IMAGE;
	pitch.ImageColor3 = WHITE;
	pitch.ScaleType = Enum.ScaleType.Stretch;
	pitch.ZIndex = 2;
	pitch.Parent = body;

	if (withSideStrips) {
		// Thin pitch-side strips: blue along the top goal line, red along the
		// bottom — anchors each name chip's half.
		const makeStrip = (name: string, yScale: number, color: Color3) => {
			const strip = new Instance("Frame");
			strip.Name = name;
			strip.BackgroundColor3 = color;
			strip.BackgroundTransparency = 0.1;
			strip.BorderSizePixel = 0;
			strip.Position = new UDim2(0.05, 0, yScale, 0);
			strip.Size = new UDim2(0.9, 0, 0.035, 0);
			strip.ZIndex = 3;
			strip.Parent = body;
		};
		makeStrip("BlueStrip", 0.02, BLUE_SIDE);
		makeStrip("RedStrip", 0.945, RED_SIDE);
	}

	const title = new Instance("TextLabel");
	title.Name = "TableTitle";
	title.BackgroundTransparency = 1;
	// Real tables keep the ordinal in the pitch center (their chips cover the
	// halves); the muckabout's single chip sits center, so its title goes top.
	title.Position = withSideStrips ? new UDim2(0.1, 0, 0.4, 0) : new UDim2(0.1, 0, 0.06, 0);
	title.Size = new UDim2(0.8, 0, 0.2, 0);
	title.FontFace = TITLE_FONT;
	title.TextScaled = true;
	title.TextColor3 = WHITE;
	title.TextStrokeColor3 = BLACK;
	title.TextStrokeTransparency = 0.5;
	title.Text = titleText;
	title.ZIndex = 4;
	title.Parent = body;

	body.Parent = card;
	card.Parent = board;
}

function ordinal(position: number): string {
	const lastTwo = position % 100;
	if (lastTwo >= 11 && lastTwo <= 13) {
		return `${position}th`;
	}
	const last = position % 10;
	return `${position}${last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th"}`;
}

function buildCards(board: Frame, layout: LadderLayout) {
	for (let t = 0; t < layout.realTables; t++) {
		const isBottom = t === layout.realTables - 1 && layout.realTables > 1;
		const tint = t === 0 ? GOLD_TINT : isBottom ? MUD_TINT : GREEN_TINT;
		buildCard(board, layout, t, tint, ordinal(t + 1), true);
	}
	if (layout.hasMuckabout) {
		buildCard(board, layout, layout.realTables, undefined, ordinal(layout.realTables + 1), false);
	}
}

/** Name chip (or the viewer's YOU disc). The returned frame is the tween
 * target: the client driver reads its CB_ToX/CB_ToY attributes. */
function buildChip(
	board: Frame,
	layout: LadderLayout,
	entry: MovementEntry,
	isViewer: boolean,
	at: Vector2,
	to: Vector2,
): Frame {
	const chip = new Instance("Frame");
	chip.Name = `Chip_${entry.teamId}`;
	chip.AnchorPoint = new Vector2(0.5, 0.5);
	chip.Position = new UDim2(at.X, 0, at.Y, 0);
	chip.BackgroundTransparency = 1;
	chip.ZIndex = isViewer ? 6 : 5;
	chip.SetAttribute("CB_ToX", to.X);
	chip.SetAttribute("CB_ToY", to.Y);

	if (isViewer) {
		// White YOU disc — bigger than the name chips, black text, no arrow.
		chip.Size = new UDim2(VIEWER_DISC, 0, VIEWER_DISC, 0);
		const aspect = new Instance("UIAspectRatioConstraint");
		aspect.AspectRatio = 1;
		aspect.Parent = chip;

		addShadow(chip, 0.05, 0.05, true);

		const body = new Instance("Frame");
		body.Name = "Body";
		body.AnchorPoint = new Vector2(0.5, 0.5);
		body.Position = new UDim2(0.5, 0, 0.5, 0);
		body.Size = new UDim2(1, 0, 1, 0);
		body.BackgroundColor3 = WHITE;
		body.BorderSizePixel = 0;
		body.ZIndex = 2;
		const corner = new Instance("UICorner");
		corner.CornerRadius = new UDim(1, 0);
		corner.Parent = body;
		const stroke = new Instance("UIStroke");
		stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
		stroke.Color = BLACK;
		stroke.Thickness = 2;
		stroke.Transparency = 0.3;
		stroke.Parent = body;

		const label = new Instance("TextLabel");
		label.Name = "Label";
		label.AnchorPoint = new Vector2(0.5, 0.5);
		label.Position = new UDim2(0.5, 0, 0.5, 0);
		label.Size = new UDim2(0.72, 0, 0.42, 0);
		label.BackgroundTransparency = 1;
		label.FontFace = CHIP_FONT;
		label.TextScaled = true;
		label.TextColor3 = BLACK;
		label.Text = "YOU";
		label.ZIndex = 3;
		label.Parent = body;

		body.Parent = chip;
	} else {
		chip.Size = new UDim2(0.92 * layout.cardW, 0, CHIP_H, 0);

		addShadow(chip, 0.018, 0.11, false);

		const body = new Instance("Frame");
		body.Name = "Body";
		body.AnchorPoint = new Vector2(0.5, 0.5);
		body.Position = new UDim2(0.5, 0, 0.5, 0);
		body.Size = new UDim2(1, 0, 1, 0);
		// Darkened team color so the white name always reads.
		body.BackgroundColor3 = entry.color.Lerp(BLACK, 0.45);
		body.BorderSizePixel = 0;
		body.ZIndex = 2;
		const stroke = new Instance("UIStroke");
		stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
		stroke.Color = BLACK;
		stroke.Thickness = 1;
		stroke.Transparency = 0.3;
		stroke.Parent = body;

		const label = new Instance("TextLabel");
		label.Name = "Label";
		label.AnchorPoint = new Vector2(0.5, 0.5);
		label.Position = new UDim2(0.5, 0, 0.5, 0);
		label.Size = new UDim2(0.9, 0, 0.72, 0);
		label.BackgroundTransparency = 1;
		label.FontFace = CHIP_FONT;
		label.TextScaled = true;
		label.TextColor3 = WHITE;
		label.TextStrokeColor3 = BLACK;
		label.TextStrokeTransparency = 0.6;
		label.Text = entry.name;
		label.ZIndex = 3;
		label.Parent = body;

		body.Parent = chip;
	}

	chip.Parent = board;
	return chip;
}

const LadderMapScreen = {
	/**
	 * Full-screen animated ladder map: a horizontal row of vertical pitch
	 * cards (gold left → mud right, muckabout beyond), a name chip on each
	 * pitch half (blue top, red bottom). Chips start at their OLD
	 * (fromPosition) slots, tween to the NEW (toPosition) ones, then each
	 * viewer's Board zooms onto their new table (teamless viewers skip the
	 * zoom). Tweens run client-side; this blocks ~7 s and snaps final state.
	 */
	showLadderMap(entries: MovementEntry[]) {
		if (entries.size() === 0) {
			return;
		}
		const layout = computeLayout(entries.size());

		interface PlayerBuild {
			gui: LadderGuiShape;
			board: Frame;
			chipSnaps: { chip: Frame; to: Vector2 }[];
			finalLabel?: string;
			hasZoom: boolean;
		}
		const builds: PlayerBuild[] = [];

		for (const player of Players.GetPlayers()) {
			pcall(() => {
				const gui = ladderGuiOf(player);
				if (!gui) {
					return;
				}
				const viewerTeamId = player.GetAttribute("CB_TeamId");
				gui.Title.Text = "LEAGUE LADDER";
				gui.Title.TextColor3 = TITLE_GOLD;
				gui.Panel.Visible = true;
				gui.PositionLabel.Visible = false;
				gui.PositionLabel.Text = "";
				clearRows(gui.Rows);
				const board = gui.Board;
				resetBoard(board);
				buildCards(board, layout);

				const chipSnaps: { chip: Frame; to: Vector2 }[] = [];
				let finalLabel: string | undefined = undefined;
				let hasZoom = false;
				for (const entry of entries) {
					const isViewer = entry.teamId === viewerTeamId;
					const fromAt = chipCenterFor(layout, entry.fromPosition);
					const toAt = chipCenterFor(layout, entry.toPosition);
					const chip = buildChip(board, layout, entry, isViewer, fromAt, toAt);
					chipSnaps.push({ chip, to: toAt });
					if (isViewer) {
						gui.PositionLabel.Visible = true;
						gui.PositionLabel.Text = `YOU ARE ${ordinal(entry.fromPosition + 1)} OF ${layout.teamCount}`;
						finalLabel = `YOU ARE NOW ${ordinal(entry.toPosition + 1)} OF ${layout.teamCount}`;
						// Zoom the Board so the viewer's NEW card (and both its
						// chips) grows toward the panel center.
						const focusIndex =
							layout.hasMuckabout && entry.nextMuckabout
								? layout.realTables
								: math.min(layout.realTables - 1, math.floor(entry.toPosition / 2));
						const focusX = cardCenterX(layout, focusIndex);
						const scale = math.min(1.5, 0.4 / layout.cardW);
						board.SetAttribute("CB_ZoomScale", scale);
						board.SetAttribute("CB_ZoomX", 0.5 - (focusX - 0.5) * scale);
						board.SetAttribute("CB_ZoomY", 0.47 - (CARD_Y - 0.5) * scale);
						hasZoom = true;
					}
				}
				gui.Enabled = true;
				builds.push({ gui, board, chipSnaps, finalLabel, hasZoom });
			});
		}

		task.wait(SETTLE_TIME);
		animSeq += 1;
		for (const build of builds) {
			pcall(() => build.gui.SetAttribute("CB_Anim", `move:${MOVE_TIME}:${animSeq}`));
		}
		task.wait(MOVE_TIME + MOVED_HOLD);
		animSeq += 1;
		for (const build of builds) {
			pcall(() => {
				// Snap the authoritative end state (a client that missed the
				// trigger lands here via replication), then start the zoom.
				for (const snap of build.chipSnaps) {
					snap.chip.Position = new UDim2(snap.to.X, 0, snap.to.Y, 0);
				}
				if (build.finalLabel !== undefined) {
					build.gui.PositionLabel.Text = build.finalLabel;
				}
				if (build.hasZoom) {
					build.gui.SetAttribute("CB_Anim", `zoom:${ZOOM_TIME}:${animSeq}`);
				}
			});
		}
		task.wait(ZOOM_TIME + ZOOM_HOLD);
		hideAll();
	},

	/** Session-end CHAMPIONS screen (Phase 5): gold panel with the top-table
	 * team + its members, shown to everyone. Blocks ~8 s. */
	showChampions(teamName: string, memberNames: string[], rewardEach: number) {
		for (const player of Players.GetPlayers()) {
			pcall(() => {
				const gui = ladderGuiOf(player);
				if (!gui) {
					return;
				}
				gui.Title.Text = "TOP TABLE CHAMPIONS";
				gui.Title.TextColor3 = Color3.fromRGB(255, 215, 90);
				// The ladder show that just ran left its (possibly zoomed) cards
				// on the Board — clear it so only the champions panel shows.
				resetBoard(gui.Board);
				clearRows(gui.Rows);
				gui.Panel.Visible = false;
				gui.PositionLabel.Visible = false;

				const container = new Instance("Frame");
				container.Name = "ChampionsPanel";
				container.LayoutOrder = 0;
				container.BackgroundTransparency = 1;
				container.Size = new UDim2(0.55, 0, 0.7, 0);
				addShadow(container, 0.015, 0.012, false);

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
				nameLabel.Text = teamName;
				nameLabel.Size = new UDim2(0.9, 0, 0.22, 0);
				nameLabel.ZIndex = 3;
				nameLabel.Parent = panel;

				for (let i = 0; i < memberNames.size(); i++) {
					const member = new Instance("TextLabel");
					member.Name = "Member";
					member.LayoutOrder = i + 1;
					member.BackgroundTransparency = 1;
					member.FontFace = CHIP_FONT;
					member.TextScaled = true;
					member.TextColor3 = Color3.fromRGB(30, 24, 8);
					member.Text = memberNames[i];
					member.Size = new UDim2(0.8, 0, 0.12, 0);
					member.ZIndex = 3;
					member.Parent = panel;
				}

				const reward = new Instance("TextLabel");
				reward.Name = "Reward";
				reward.LayoutOrder = memberNames.size() + 1;
				reward.BackgroundTransparency = 1;
				reward.FontFace = CHIP_FONT;
				reward.TextScaled = true;
				reward.TextColor3 = Color3.fromRGB(20, 90, 40);
				reward.Text = `+$${rewardEach} each!`;
				reward.Size = new UDim2(0.8, 0, 0.12, 0);
				reward.ZIndex = 3;
				reward.Parent = panel;

				panel.Parent = container;
				container.Parent = gui.Rows;
				gui.Enabled = true;
			});
		}
		task.wait(CHAMPIONS_TIME);
		hideAll();
	},
};

export default LadderMapScreen;
