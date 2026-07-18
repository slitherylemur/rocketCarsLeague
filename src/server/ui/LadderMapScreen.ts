// Server-side population of the LadderMap ScreenGui (Top Table Phase 4b) and
// its session-end CHAMPIONS reuse (Phase 5). Same contract as
// footballMatch.showRoundSummary: React owns the static structure
// (components/LadderMapGui.tsx), this module builds the per-viewer children
// imperatively and toggles Enabled — no remotes.
//
// The ladder is a HORIZONTAL row of pitch cards (gold left → mud right,
// muckabout square beyond it) with team chips BELOW each card (blue side
// left, red side right). Chips start at their OLD table slots and tween to
// the NEW ones, then the Board zooms onto the viewer's new table — all
// server-side TweenService tweens on the PlayerGui instances (same pattern
// as VehicleClass.CreateMoneyUiAnimation).

import type { MovementEntry } from "../Modules/MatchDirector";

const Players = game.GetService("Players");
const TweenService = game.GetService("TweenService");

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
}

function ladderGuiOf(player: Player): LadderGuiShape | undefined {
	const playerGui = player.FindFirstChild("PlayerGui");
	const gui = playerGui && playerGui.FindFirstChild("LadderMap");
	if (
		gui &&
		gui.IsA("ScreenGui") &&
		gui.FindFirstChild("Title") &&
		gui.FindFirstChild("Rows") &&
		gui.FindFirstChild("Board")
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

// ---- ladder geometry (all Board-scale coordinates) -----------------------

const CARD_Y = 0.4; // vertical center of the card row

interface LadderLayout {
	teamCount: number;
	realTables: number;
	hasMuckabout: boolean;
	slotCount: number;
	cardW: number;
	cardH: number;
	chipY: number;
	arrowY: number;
	focusY: number; // vertical zoom focus (card + its chips)
}

function computeLayout(teamCount: number): LadderLayout {
	const realTables = math.max(1, math.floor(teamCount / 2));
	const hasMuckabout = teamCount > 1 && teamCount % 2 === 1;
	const slotCount = realTables + (hasMuckabout ? 1 : 0);
	// Cards + 0.35-card gaps fit in 0.86 of the screen; H = 1.5×W scale reads
	// as a squarish, slightly landscape pitch on a 16:9 screen.
	const cardW = math.min(0.18, 0.86 / (1.35 * slotCount - 0.35));
	const cardH = cardW * 1.5;
	const chipY = CARD_Y + cardH / 2 + 0.055;
	const arrowY = chipY - 0.075;
	const focusY = (CARD_Y - cardH / 2 + chipY + 0.05) / 2;
	return { teamCount, realTables, hasMuckabout, slotCount, cardW, cardH, chipY, arrowY, focusY };
}

function cardCenterX(layout: LadderLayout, index: number): number {
	const totalW = layout.cardW * (1.35 * layout.slotCount - 0.35);
	return 0.5 - totalW / 2 + layout.cardW / 2 + index * 1.35 * layout.cardW;
}

/** Chip center for a ladder position: consecutive pairing (2t, 2t+1 → table
 * t; even index = left/blue slot, odd = right/red), odd leftover → muckabout. */
function chipCenterFor(layout: LadderLayout, position: number): Vector2 {
	if (layout.hasMuckabout && position === layout.teamCount - 1) {
		return new Vector2(cardCenterX(layout, layout.realTables), layout.chipY);
	}
	const tableIndex = math.min(layout.realTables - 1, math.floor(position / 2));
	const dir = position % 2 === 0 ? -1 : 1;
	return new Vector2(cardCenterX(layout, tableIndex) + dir * 0.285 * layout.cardW, layout.chipY);
}

// ---- ladder builders ------------------------------------------------------

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
	card.Size = new UDim2(layout.cardW, 0, layout.cardH, 0);
	card.ZIndex = 2;
	if (tint) {
		card.BackgroundColor3 = tint;
		card.BackgroundTransparency = 0.12;
	} else {
		card.BackgroundColor3 = Color3.fromRGB(15, 18, 22);
		card.BackgroundTransparency = 0.5;
		// "Dashed" white border — UIStroke can't dash, solid white stands in.
		const stroke = new Instance("UIStroke");
		stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
		stroke.Color = new Color3(1, 1, 1);
		stroke.Thickness = 2;
		stroke.Parent = card;
	}
	const corner = new Instance("UICorner");
	corner.CornerRadius = new UDim(0.06, 0);
	corner.Parent = card;

	if (withSideStrips) {
		// Thin pitch-side strips: blue left edge, red right edge (inset a
		// little vertically so they don't poke out of the rounded corners).
		const makeStrip = (name: string, xScale: number, color: Color3) => {
			const strip = new Instance("Frame");
			strip.Name = name;
			strip.BackgroundColor3 = color;
			strip.BackgroundTransparency = 0.15;
			strip.BorderSizePixel = 0;
			strip.Position = new UDim2(xScale, 0, 0.06, 0);
			strip.Size = new UDim2(0.05, 0, 0.88, 0);
			strip.ZIndex = 3;
			strip.Parent = card;
		};
		makeStrip("BlueStrip", 0, BLUE_SIDE);
		makeStrip("RedStrip", 0.95, RED_SIDE);
	}

	const title = new Instance("TextLabel");
	title.Name = "TableTitle";
	title.BackgroundTransparency = 1;
	title.Position = new UDim2(0.08, 0, 0.04, 0);
	title.Size = new UDim2(0.84, 0, 0.2, 0);
	title.FontFace = TITLE_FONT;
	title.TextScaled = true;
	title.TextColor3 = new Color3(1, 1, 1);
	title.TextStrokeColor3 = new Color3(0, 0, 0);
	title.TextStrokeTransparency = 0.5;
	title.Text = titleText;
	title.ZIndex = 3;
	title.Parent = card;

	card.Parent = board;
}

function buildCards(board: Frame, layout: LadderLayout) {
	for (let t = 0; t < layout.realTables; t++) {
		const isBottom = t === layout.realTables - 1 && layout.realTables > 1;
		const tint = t === 0 ? GOLD_TINT : isBottom ? MUD_TINT : GREEN_TINT;
		const titleText = t === 0 ? "Table 1 — Gold" : isBottom ? `Table ${t + 1} — Mud` : `Table ${t + 1}`;
		buildCard(board, layout, t, tint, titleText, true);
	}
	if (layout.hasMuckabout) {
		buildCard(board, layout, layout.realTables, undefined, "Muckabout", false);
	}
}

function buildChip(
	board: Frame,
	layout: LadderLayout,
	entry: MovementEntry,
	isViewer: boolean,
	at: Vector2,
): TextLabel {
	const chip = new Instance("TextLabel");
	chip.Name = `Chip_${entry.teamId}`;
	chip.AnchorPoint = new Vector2(0.5, 0.5);
	chip.Position = new UDim2(at.X, 0, at.Y, 0);
	chip.Size = isViewer
		? new UDim2(0.62 * layout.cardW, 0, 0.068, 0)
		: new UDim2(0.55 * layout.cardW, 0, 0.05, 0);
	chip.ZIndex = isViewer ? 6 : 5;
	chip.BackgroundColor3 = isViewer ? entry.color.Lerp(new Color3(1, 1, 1), 0.2) : entry.color;
	chip.FontFace = CHIP_FONT;
	chip.TextScaled = true;
	chip.TextColor3 = new Color3(1, 1, 1);
	chip.TextStrokeColor3 = new Color3(0, 0, 0);
	chip.TextStrokeTransparency = 0.2;
	chip.Text = `${entry.name}${isViewer ? " (YOU)" : ""}`;
	const corner = new Instance("UICorner");
	corner.CornerRadius = new UDim(0.4, 0);
	corner.Parent = chip;
	const stroke = new Instance("UIStroke");
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border;
	stroke.Color = isViewer ? new Color3(1, 1, 1) : new Color3(0, 0, 0);
	stroke.Thickness = isViewer ? 3 : 1;
	stroke.Parent = chip;
	chip.Parent = board;
	return chip;
}

function buildViewerArrow(board: Frame, layout: LadderLayout, x: number): TextLabel {
	const arrow = new Instance("TextLabel");
	arrow.Name = "ViewerArrow";
	arrow.AnchorPoint = new Vector2(0.5, 0.5);
	arrow.BackgroundTransparency = 1;
	arrow.Position = new UDim2(x, 0, layout.arrowY, 0);
	arrow.Size = new UDim2(0.06, 0, 0.06, 0);
	arrow.ZIndex = 7;
	arrow.FontFace = TITLE_FONT;
	arrow.TextScaled = true;
	arrow.TextColor3 = TITLE_GOLD;
	arrow.TextStrokeColor3 = new Color3(0, 0, 0);
	arrow.TextStrokeTransparency = 0.2;
	arrow.Text = "▼";
	arrow.Parent = board;
	return arrow;
}

const LadderMapScreen = {
	/**
	 * Full-screen animated ladder map: a horizontal row of pitch cards (gold
	 * left → mud right, muckabout beyond), team chips below each card on
	 * their pitch side. Chips start at their OLD (fromPosition) slots, tween
	 * to the NEW (toPosition) ones, then each viewer's Board zooms onto their
	 * new table (teamless viewers skip the zoom). Blocks ~7 s.
	 */
	showLadderMap(entries: MovementEntry[]) {
		if (entries.size() === 0) {
			return;
		}
		const layout = computeLayout(entries.size());
		const moveInfo = new TweenInfo(MOVE_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.InOut);
		const zoomInfo = new TweenInfo(ZOOM_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);

		interface PlayerBuild {
			board: Frame;
			moveTweens: Tween[];
			zoomGoal?: { size: UDim2; position: UDim2 };
		}
		const builds: PlayerBuild[] = [];

		for (const player of Players.GetPlayers()) {
			pcall(() => {
				const gui = ladderGuiOf(player);
				if (!gui) {
					return;
				}
				const viewerTeamId = player.GetAttribute("CB_TeamId");
				gui.Title.Text = "THE LADDER";
				gui.Title.TextColor3 = TITLE_GOLD;
				clearRows(gui.Rows);
				const board = gui.Board;
				resetBoard(board);
				buildCards(board, layout);

				const moveTweens: Tween[] = [];
				let zoomGoal: { size: UDim2; position: UDim2 } | undefined = undefined;
				for (const entry of entries) {
					const isViewer = entry.teamId === viewerTeamId;
					const fromAt = chipCenterFor(layout, entry.fromPosition);
					const toAt = chipCenterFor(layout, entry.toPosition);
					const chip = buildChip(board, layout, entry, isViewer, fromAt);
					moveTweens.push(
						TweenService.Create(chip, moveInfo, { Position: new UDim2(toAt.X, 0, toAt.Y, 0) }),
					);
					if (isViewer) {
						// Big arrow floating just above the viewer's chip, moving with it.
						const arrow = buildViewerArrow(board, layout, fromAt.X);
						moveTweens.push(
							TweenService.Create(arrow, moveInfo, {
								Position: new UDim2(toAt.X, 0, layout.arrowY, 0),
							}),
						);
						// Zoom the Board so the viewer's NEW card (and both its
						// chips) grows toward screen center.
						const focusIndex =
							layout.hasMuckabout && entry.nextMuckabout
								? layout.realTables
								: math.min(layout.realTables - 1, math.floor(entry.toPosition / 2));
						const focusX = cardCenterX(layout, focusIndex);
						const scale = math.min(3, 0.45 / layout.cardW);
						zoomGoal = {
							size: new UDim2(scale, 0, scale, 0),
							position: new UDim2(
								0.5 - (focusX - 0.5) * scale,
								0,
								0.5 - (layout.focusY - 0.5) * scale,
								0,
							),
						};
					}
				}
				gui.Enabled = true;
				builds.push({ board, moveTweens, zoomGoal });
			});
		}

		task.wait(SETTLE_TIME);
		for (const build of builds) {
			for (const tween of build.moveTweens) {
				pcall(() => tween.Play());
			}
		}
		task.wait(MOVE_TIME + MOVED_HOLD);
		for (const build of builds) {
			const goal = build.zoomGoal;
			if (goal !== undefined) {
				pcall(() =>
					TweenService.Create(build.board, zoomInfo, { Size: goal.size, Position: goal.position }).Play(),
				);
			}
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

				const panel = new Instance("Frame");
				panel.Name = "ChampionsPanel";
				panel.LayoutOrder = 0;
				panel.BackgroundColor3 = GOLD_TINT;
				panel.BackgroundTransparency = 0.1;
				panel.Size = new UDim2(0.55, 0, 0.7, 0);
				const corner = new Instance("UICorner");
				corner.CornerRadius = new UDim(0.06, 0);
				corner.Parent = panel;
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
				nameLabel.TextColor3 = new Color3(1, 1, 1);
				nameLabel.TextStrokeColor3 = new Color3(0, 0, 0);
				nameLabel.TextStrokeTransparency = 0.3;
				nameLabel.Text = teamName;
				nameLabel.Size = new UDim2(0.9, 0, 0.22, 0);
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
				reward.Parent = panel;

				panel.Parent = gui.Rows;
				gui.Enabled = true;
			});
		}
		task.wait(CHAMPIONS_TIME);
		hideAll();
	},
};

export default LadderMapScreen;
