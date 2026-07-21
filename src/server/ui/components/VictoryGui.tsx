// End-of-match victory overlay, shown over the victory lineup camera while
// FB_Phase is "Ended" and the pitch has a FB_WinnerSide.
//
// Same contract as every other ScreenGui here: React owns the STRUCTURE only.
// matchHud.client.ts fills the texts (the Title uses RichText <font size> so
// it can render far beyond TextScaled's 100px cap — sized per viewport, so it
// still fits on mobile), clones the winning roster's PlayerIcons into Icons,
// runs the Title pulse/tilt tween loops, and drives the corner confetti
// (shared/UiConfetti) inside the Confetti frame.

import React from "@rbxts/react";

const FREDOKA = new Font("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal);
const BANGERS = new Font("rbxasset://fonts/families/Bangers.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal);

export function VictoryGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "Victory",
			DisplayOrder: 3,
			Enabled: false,
			ResetOnSpawn: true,
			ScreenInsets: Enum.ScreenInsets.DeviceSafeInsets,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			// Confetti pieces are parented here at runtime; clipped so pieces
			// launched from off-screen corners never spill outside the viewport.
			React.createElement("Frame", {
				Name: "Confetti",
				BackgroundTransparency: 1,
				ClipsDescendants: true,
				Size: new UDim2(1, 0, 1, 0),
				ZIndex: 1,
			} as never),
			// Giant headline — "🏆 WINNERS 🏆" (gold) or "YOU LOSE !" (red).
			// RichText + client-computed <font size>; the label is just an
			// anchor for position, the pulse UIScale and the tilt Rotation.
			React.createElement(
				"TextLabel",
				{
					Name: "Title",
					AnchorPoint: new Vector2(0.5, 0.5),
					BackgroundTransparency: 1,
					FontFace: BANGERS,
					Position: new UDim2(0.5, 0, 0.18, 0),
					RichText: true,
					Size: new UDim2(0.95, 0, 0.3, 0),
					Text: "",
					TextColor3: Color3.fromRGB(255, 200, 60),
					TextWrapped: false,
					ZIndex: 3,
				} as never,
				[
					React.createElement("UIStroke", {
						Name: "UIStroke",
						Color: new Color3(0, 0, 0),
						Thickness: 4,
					} as never),
					React.createElement("UIScale", {
						Name: "Pulse",
						Scale: 1,
					} as never),
				],
			),
			// "BLUE TEAM WINS!" — small, side-colored, under the headline.
			React.createElement("TextLabel", {
				Name: "SubTitle",
				AnchorPoint: new Vector2(0.5, 0.5),
				BackgroundTransparency: 1,
				FontFace: FREDOKA,
				Position: new UDim2(0.5, 0, 0.36, 0),
				Size: new UDim2(0.55, 0, 0.05, 0),
				Text: "",
				TextColor3: new Color3(1, 1, 1),
				TextScaled: true,
				TextStrokeColor3: new Color3(0, 0, 0),
				TextStrokeTransparency: 0.4,
				ZIndex: 3,
			} as never),
			// The winning LADDER team's name.
			React.createElement(
				"TextLabel",
				{
					Name: "TeamName",
					AnchorPoint: new Vector2(0.5, 0.5),
					BackgroundTransparency: 1,
					FontFace: FREDOKA,
					Position: new UDim2(0.5, 0, 0.44, 0),
					Size: new UDim2(0.8, 0, 0.08, 0),
					Text: "",
					TextColor3: new Color3(1, 1, 1),
					TextScaled: true,
					ZIndex: 3,
				} as never,
				[
					React.createElement("UIStroke", {
						Name: "UIStroke",
						Color: new Color3(0, 0, 0),
						Thickness: 3,
					} as never),
				],
			),
			// Winning roster row: matchHud.client.ts clones PlayerIcon into it
			// with a side-colored ring, same as the face-off plates.
			React.createElement(
				"Frame",
				{
					Name: "Icons",
					AnchorPoint: new Vector2(0.5, 0),
					BackgroundTransparency: 1,
					Position: new UDim2(0.5, 0, 0.5, 0),
					Size: new UDim2(0.6, 0, 0.12, 0),
					ZIndex: 3,
				} as never,
				[
					React.createElement("UIListLayout", {
						Name: "UIListLayout",
						FillDirection: Enum.FillDirection.Horizontal,
						HorizontalAlignment: Enum.HorizontalAlignment.Center,
						VerticalAlignment: Enum.VerticalAlignment.Top,
						Padding: new UDim(0.03, 0),
						SortOrder: Enum.SortOrder.LayoutOrder,
					} as never),
				],
			),
		],
	);
}
