// RoundSummary renderer (client-side UI migration, Phase 7).
//
// The RoundSummary ScreenGui is CLIENT-mounted (bootstrap.client.ts); the
// server (footballMatch.showRoundSummary) composes the per-viewer stats
// payload and delivers it twice:
//   * pushed over the Ui_RoundSummary remote at scene start, and
//   * mirrored as the CB_Summary player attribute for the scene's duration
//     (state-shaped fallback: a client whose renderer connects mid-scene —
//     late replication, script restart — still paints from the attribute).
// Clearing CB_Summary at scene end hides the gui. The column layout below
// reproduces the server's old imperative buildSummaryColumn exactly (fonts,
// sizes, colors, ordering); the server keeps the ~6 s task.wait pacing that
// gates the round flow.

import { getUiIntentEvent } from "shared/UiIntents";

const Players = game.GetService("Players");
const HttpService = game.GetService("HttpService");
const LocalPlayer = Players.LocalPlayer;

interface SummaryColumn {
	order: number;
	self: boolean;
	name: string;
	trophies: number;
	champion: boolean;
	goals: number;
	kills: number;
	money: number;
}

interface SummaryPayload {
	duration: number;
	columns: SummaryColumn[];
}

interface SummaryGuiShape extends ScreenGui {
	Columns: Frame;
}

const playerGui = LocalPlayer.WaitForChild("PlayerGui");
const summaryGui = playerGui.WaitForChild("RoundSummary") as SummaryGuiShape;

const SUMMARY_FONT = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

function buildSummaryColumn(parent: Frame, column: SummaryColumn) {
	const isSelf = column.self;
	const frame = new Instance("Frame");
	frame.Name = "Column";
	frame.LayoutOrder = column.order;
	frame.BackgroundColor3 = Color3.fromRGB(25, 32, 40);
	frame.BackgroundTransparency = 0.15;
	frame.Size = isSelf ? new UDim2(0.24, 0, 0.7, 0) : new UDim2(0.17, 0, 0.55, 0);
	const corner = new Instance("UICorner");
	corner.CornerRadius = new UDim(0.06, 0);
	corner.Parent = frame;
	const layout = new Instance("UIListLayout");
	layout.FillDirection = Enum.FillDirection.Vertical;
	layout.HorizontalAlignment = Enum.HorizontalAlignment.Center;
	layout.VerticalAlignment = Enum.VerticalAlignment.Center;
	layout.Padding = new UDim(0.03, 0);
	layout.SortOrder = Enum.SortOrder.LayoutOrder;
	layout.Parent = frame;

	// Trophy gain is the hero row: top and biggest. "CHAMPIONS 🏆+2" makes it
	// obvious the double trophy comes from winning the champions round.
	const rows: Array<[string, string, Color3]> = [
		[
			"Trophy",
			column.champion ? `CHAMPIONS 🏆+${column.trophies}` : `🏆 +${column.trophies}`,
			column.trophies > 0 ? Color3.fromRGB(255, 215, 0) : Color3.fromRGB(150, 150, 150),
		],
		["Name", isSelf ? "YOU" : column.name, new Color3(1, 1, 1)],
		["Goals", `Goals: ${column.goals}`, Color3.fromRGB(255, 220, 120)],
		["Kills", `Kills: ${column.kills}`, Color3.fromRGB(255, 140, 120)],
		["Money", `+$${column.money}`, Color3.fromRGB(140, 255, 160)],
	];
	for (let i = 0; i < rows.size(); i++) {
		const label = new Instance("TextLabel");
		label.Name = rows[i][0];
		label.LayoutOrder = i;
		label.BackgroundTransparency = 1;
		label.FontFace = SUMMARY_FONT;
		label.TextScaled = true;
		label.TextColor3 = rows[i][2];
		label.Text = rows[i][1];
		label.Size = new UDim2(0.9, 0, i === 0 ? 0.28 : i === 1 ? 0.18 : 0.12, 0);
		if (i === 0 && column.champion) {
			label.TextStrokeTransparency = 0;
			label.TextStrokeColor3 = Color3.fromRGB(90, 60, 0);
		}
		label.Parent = frame;
	}
	frame.Parent = parent;
}

function decodePayload(raw: unknown): SummaryPayload | undefined {
	if (!typeIs(raw, "string") || raw === "") {
		return undefined;
	}
	const [ok, decoded] = pcall(() => HttpService.JSONDecode(raw) as SummaryPayload);
	if (!ok || !typeIs(decoded, "table") || !typeIs((decoded as SummaryPayload).columns, "table")) {
		return undefined;
	}
	return decoded as SummaryPayload;
}

function render(payload: SummaryPayload) {
	for (const child of summaryGui.Columns.GetChildren()) {
		if (child.IsA("Frame")) {
			child.Destroy();
		}
	}
	for (const column of payload.columns) {
		buildSummaryColumn(summaryGui.Columns, column);
	}
	summaryGui.Enabled = true;
}

function refreshFromAttribute() {
	const payload = decodePayload(LocalPlayer.GetAttribute("CB_Summary"));
	if (payload === undefined) {
		summaryGui.Enabled = false;
		return;
	}
	render(payload);
}

LocalPlayer.GetAttributeChangedSignal("CB_Summary").Connect(refreshFromAttribute);

// The push event and the mirror carry the same encoded payload; handling both
// is idempotent (the render rebuilds the columns wholesale).
task.spawn(() => {
	getUiIntentEvent("Ui_RoundSummary").OnClientEvent.Connect((...args: unknown[]) => {
		const payload = decodePayload(args[0]);
		if (payload !== undefined) {
			render(payload);
		}
	});
});

// Mid-scene (re)start: paint whatever the mirror currently holds.
refreshFromAttribute();
