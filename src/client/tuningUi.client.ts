// Balance-testing HUD: value inputs for every ball tunable and every car
// tuning field, with a show/hide toggle. Front end for
// tuningRemotes.server.ts — see that file for what "apply" does on the
// server. Studio/creator only, mirroring the server-side authorization.
//
// Ball smoothing fields (smooth*) are client-side rendering knobs: applying
// them updates THIS client's shared ballTunables table (ballRenderer reads it
// live every frame). The physics fields go to the server and take effect on
// the ball respawn the apply triggers.

import { BALL_FIELDS, BALL_NAME, ballTunables, ballTuneAttr } from "shared/ballSim/BallConfig";
import { VehicleModelAttr } from "shared/vehicleSim/VehicleSim";
import { CAR_FIELDS } from "shared/vehicleSim/VehicleTuningFields";

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const RunService = game.GetService("RunService");

const player = Players.LocalPlayer;

if (RunService.IsStudio() || (game.CreatorType === Enum.CreatorType.User && player.UserId === game.CreatorId)) {
	const remotes = ReplicatedStorage.WaitForChild("TuningRemotes");
	const applyBallRemote = remotes.WaitForChild("ApplyBallTuning") as RemoteEvent;
	const applyVehicleRemote = remotes.WaitForChild("ApplyVehicleTuning") as RemoteEvent;
	const playerGui = player.WaitForChild("PlayerGui") as PlayerGui;

	const PANEL_WIDTH = 300;
	const ROW_HEIGHT = 26;
	const TEXT_COLOR = Color3.fromRGB(235, 235, 235);
	const BOX_COLOR = Color3.fromRGB(45, 45, 55);
	const BOX_INVALID_COLOR = Color3.fromRGB(120, 40, 40);

	const gui = new Instance("ScreenGui");
	gui.Name = "TuningHud";
	gui.ResetOnSpawn = false;
	gui.DisplayOrder = 50;
	gui.Parent = playerGui;

	const toggleButton = new Instance("TextButton");
	toggleButton.Name = "ToggleTuning";
	toggleButton.AnchorPoint = new Vector2(1, 0);
	toggleButton.Position = new UDim2(1, -8, 0, 8);
	toggleButton.Size = new UDim2(0, 96, 0, 28);
	toggleButton.BackgroundColor3 = Color3.fromRGB(30, 30, 38);
	toggleButton.BackgroundTransparency = 0.2;
	toggleButton.TextColor3 = TEXT_COLOR;
	toggleButton.Font = Enum.Font.GothamMedium;
	toggleButton.TextSize = 14;
	toggleButton.Text = "Show Tuning";
	toggleButton.Parent = gui;
	const toggleCorner = new Instance("UICorner");
	toggleCorner.Parent = toggleButton;

	const panel = new Instance("Frame");
	panel.Name = "TuningPanel";
	panel.AnchorPoint = new Vector2(1, 0);
	panel.Position = new UDim2(1, -8, 0, 42);
	panel.Size = new UDim2(0, PANEL_WIDTH, 0, 520);
	panel.BackgroundColor3 = Color3.fromRGB(22, 22, 28);
	panel.BackgroundTransparency = 0.1;
	panel.Visible = false;
	panel.Parent = gui;
	const panelCorner = new Instance("UICorner");
	panelCorner.Parent = panel;

	const scroll = new Instance("ScrollingFrame");
	scroll.Name = "Rows";
	scroll.Position = new UDim2(0, 6, 0, 6);
	scroll.Size = new UDim2(1, -12, 1, -12);
	scroll.BackgroundTransparency = 1;
	scroll.BorderSizePixel = 0;
	scroll.ScrollBarThickness = 6;
	scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y;
	scroll.CanvasSize = new UDim2(0, 0, 0, 0);
	scroll.Parent = panel;

	const layout = new Instance("UIListLayout");
	layout.Padding = new UDim(0, 4);
	layout.SortOrder = Enum.SortOrder.LayoutOrder;
	layout.Parent = scroll;

	let layoutOrder = 0;
	const nextOrder = () => ++layoutOrder;

	function addHeader(text: string) {
		const label = new Instance("TextLabel");
		label.Size = new UDim2(1, -8, 0, 24);
		label.BackgroundTransparency = 1;
		label.TextColor3 = Color3.fromRGB(255, 200, 90);
		label.Font = Enum.Font.GothamBold;
		label.TextSize = 16;
		label.TextXAlignment = Enum.TextXAlignment.Left;
		label.Text = text;
		label.LayoutOrder = nextOrder();
		label.Parent = scroll;
	}

	function addRow(labelText: string): TextBox {
		const row = new Instance("Frame");
		row.Size = new UDim2(1, -8, 0, ROW_HEIGHT);
		row.BackgroundTransparency = 1;
		row.LayoutOrder = nextOrder();
		row.Parent = scroll;

		const label = new Instance("TextLabel");
		label.Size = new UDim2(0.62, -4, 1, 0);
		label.BackgroundTransparency = 1;
		label.TextColor3 = TEXT_COLOR;
		label.Font = Enum.Font.Gotham;
		label.TextSize = 13;
		label.TextXAlignment = Enum.TextXAlignment.Left;
		label.TextTruncate = Enum.TextTruncate.AtEnd;
		label.Text = labelText;
		label.Parent = row;

		const box = new Instance("TextBox");
		box.Position = new UDim2(0.62, 0, 0, 1);
		box.Size = new UDim2(0.38, 0, 1, -2);
		box.BackgroundColor3 = BOX_COLOR;
		box.TextColor3 = TEXT_COLOR;
		box.Font = Enum.Font.Code;
		box.TextSize = 13;
		box.ClearTextOnFocus = false;
		box.Text = "";
		box.Parent = row;
		const boxCorner = new Instance("UICorner");
		boxCorner.CornerRadius = new UDim(0, 4);
		boxCorner.Parent = box;
		return box;
	}

	function addButton(text: string, onClick: () => void): TextButton {
		const button = new Instance("TextButton");
		button.Size = new UDim2(1, -8, 0, 28);
		button.BackgroundColor3 = Color3.fromRGB(60, 90, 150);
		button.TextColor3 = TEXT_COLOR;
		button.Font = Enum.Font.GothamMedium;
		button.TextSize = 14;
		button.Text = text;
		button.LayoutOrder = nextOrder();
		button.Parent = scroll;
		const corner = new Instance("UICorner");
		corner.Parent = button;
		button.MouseButton1Click.Connect(onClick);
		return button;
	}

	// Format without float noise: whole numbers stay whole, others get up to
	// 4 decimals with trailing zeros trimmed.
	function formatNumber(value: number): string {
		if (value === math.floor(value)) {
			return tostring(value);
		}
		const [trimmed] = string.gsub(string.format("%.4f", value), "%.?0+$", "");
		return trimmed;
	}

	// Read a box back into a number; undefined (and a red flash) on garbage.
	function parseBox(box: TextBox): number | undefined {
		const value = tonumber(box.Text);
		if (value === undefined || value !== value) {
			box.BackgroundColor3 = BOX_INVALID_COLOR;
			return undefined;
		}
		box.BackgroundColor3 = BOX_COLOR;
		return value;
	}

	// ---- ball section ----

	addHeader("Ball");
	const ballBoxes = new Map<string, TextBox>();
	for (const field of BALL_FIELDS) {
		ballBoxes.set(field.key, addRow(field.label));
	}

	// ---- car section ----

	addHeader("Car");
	const carBoxes = new Map<string, TextBox>();
	for (const field of CAR_FIELDS) {
		carBoxes.set(field.key, addRow(field.label));
	}

	// ---- status + actions ----

	const status = new Instance("TextLabel");

	function setStatus(text: string, isError: boolean) {
		status.TextColor3 = isError ? Color3.fromRGB(255, 120, 120) : Color3.fromRGB(140, 255, 140);
		status.Text = text;
	}

	function findLocalVehicleBase(): BasePart | undefined {
		const vehicles = game.Workspace.FindFirstChild("Vehicles");
		if (!vehicles) {
			return undefined;
		}
		for (const model of vehicles.GetChildren()) {
			if (model.IsA("Model") && model.GetAttribute(VehicleModelAttr.OwnerUserId) === player.UserId) {
				const base = model.FindFirstChild("Base");
				if (base && base.IsA("BasePart")) {
					return base;
				}
			}
		}
		return undefined;
	}

	function populateBall() {
		// Live fields show the ball's replicated attributes (authoritative,
		// includes other sessions' edits); size/smoothing come from the local
		// table (size mirrors the spawned part anyway, smoothing is local).
		const ball = game.Workspace.FindFirstChild(BALL_NAME);
		const tunables = ballTunables as unknown as Record<string, number>;
		for (const field of BALL_FIELDS) {
			const box = ballBoxes.get(field.key)!;
			let value = tunables[field.key];
			if (field.scope === "live" && ball !== undefined) {
				const attr = ball.GetAttribute(ballTuneAttr(field.key));
				if (typeIs(attr, "number")) {
					value = attr;
				}
			} else if (field.key === "size" && ball !== undefined && ball.IsA("BasePart")) {
				value = ball.Size.X;
			}
			box.Text = formatNumber(value);
			box.BackgroundColor3 = BOX_COLOR;
		}
	}

	function populateCar() {
		const base = findLocalVehicleBase();
		for (const field of CAR_FIELDS) {
			const box = carBoxes.get(field.key)!;
			const value = base ? base.GetAttribute(field.attr) : undefined;
			box.Text = typeIs(value, "number") ? formatNumber(value) : "";
			box.BackgroundColor3 = BOX_COLOR;
		}
		if (!base) {
			setStatus("No spawned car found — car values empty", true);
		}
	}

	addButton("Apply Ball (size change respawns)", () => {
		const payload: Record<string, number> = {};
		let invalid = 0;
		const tunables = ballTunables as unknown as Record<string, number>;
		for (const field of BALL_FIELDS) {
			const value = parseBox(ballBoxes.get(field.key)!);
			if (value === undefined) {
				invalid += 1;
				continue;
			}
			const clamped = math.clamp(value, field.min, field.max);
			payload[field.key] = clamped;
			// Local copy: smoothing fields take effect immediately on this
			// client; physics fields keep the UI in sync with what was sent.
			tunables[field.key] = clamped;
		}
		applyBallRemote.FireServer(payload);
		populateBall(); // shows the clamped values that were actually applied
		setStatus(invalid > 0 ? `Ball applied — ${invalid} invalid field(s) skipped` : "Ball tuning applied", invalid > 0);
	});

	addButton("Apply Car", () => {
		const payload: Record<string, number> = {};
		let invalid = 0;
		for (const field of CAR_FIELDS) {
			const value = parseBox(carBoxes.get(field.key)!);
			if (value === undefined) {
				invalid += 1;
				continue;
			}
			payload[field.key] = math.clamp(value, field.min, field.max);
		}
		applyVehicleRemote.FireServer(payload);
		setStatus(invalid > 0 ? `Car applied — ${invalid} invalid field(s) skipped` : "Car tuning applied", invalid > 0);
	});

	addButton("Refresh values", () => {
		populateBall();
		populateCar();
		setStatus("Values refreshed", false);
	});

	status.Size = new UDim2(1, -8, 0, 20);
	status.BackgroundTransparency = 1;
	status.Font = Enum.Font.Gotham;
	status.TextSize = 12;
	status.TextXAlignment = Enum.TextXAlignment.Left;
	status.TextTruncate = Enum.TextTruncate.AtEnd;
	status.Text = "";
	status.LayoutOrder = nextOrder();
	status.Parent = scroll;

	toggleButton.MouseButton1Click.Connect(() => {
		panel.Visible = !panel.Visible;
		toggleButton.Text = panel.Visible ? "Hide Tuning" : "Show Tuning";
		if (panel.Visible) {
			populateBall();
			populateCar();
		}
	});

	populateBall();
}
