// Full-screen ladder map (Top Table Phase 4b). Structure only, like
// RoundSummaryGui: the server (src/server/ui/LadderMapScreen.ts) builds the
// vertical pitch cards + team name chips into Board imperatively (everything
// scale-positioned so the whole Board can be zoom-tweened per viewer) and
// toggles Enabled. The actual move/zoom tweens run CLIENT-side
// (src/client/ladderMap.client.ts), triggered by attributes the server sets.
// Rows (list-layout) is kept for the session-end CHAMPIONS screen (Phase 5) —
// same gui, the server swaps Title text and content.

import React from "@rbxts/react";

export function LadderMapGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "LadderMap",
			DisplayOrder: 3,
			Enabled: false,
			// Full-bleed: the solid Backdrop must cover the topbar/notch areas.
			IgnoreGuiInset: true,
			ResetOnSpawn: true,
			ScreenInsets: Enum.ScreenInsets.None,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			// Solid background — nothing of the world shows through.
			React.createElement("Frame", {
				Name: "Backdrop",
				BackgroundColor3: Color3.fromRGB(12, 14, 18),
				BackgroundTransparency: 0,
				BorderSizePixel: 0,
				Size: new UDim2(1, 0, 1, 0),
			} as never),
			React.createElement("TextLabel", {
				Name: "Title",
				AnchorPoint: new Vector2(0.5, 0),
				BackgroundTransparency: 1,
				FontFace: new Font(
					"rbxasset://fonts/families/FredokaOne.json",
					Enum.FontWeight.Regular,
					Enum.FontStyle.Normal,
				),
				Position: new UDim2(0.5, 0, 0.035, 0),
				Size: new UDim2(0.7, 0, 0.085, 0),
				Text: "THE LADDER",
				TextColor3: Color3.fromRGB(255, 200, 60),
				TextScaled: true,
				TextStrokeColor3: new Color3(0, 0, 0),
				TextStrokeTransparency: 0.4,
			} as never),
			// Backing panel behind the ladder: sharp corners + hard drop shadow.
			// Container is transparent so the Shadow child can sit behind Body.
			React.createElement(
				"Frame",
				{
					Name: "Panel",
					AnchorPoint: new Vector2(0.5, 0.5),
					BackgroundTransparency: 1,
					Position: new UDim2(0.5, 0, 0.47, 0),
					Size: new UDim2(0.965, 0, 0.66, 0),
				} as never,
				[
					React.createElement("Frame", {
						Name: "Shadow",
						AnchorPoint: new Vector2(0.5, 0.5),
						BackgroundColor3: new Color3(0, 0, 0),
						BackgroundTransparency: 0.45,
						BorderSizePixel: 0,
						Position: new UDim2(0.508, 0, 0.518, 0),
						Size: new UDim2(1, 0, 1, 0),
						ZIndex: 1,
					} as never),
					React.createElement(
						"Frame",
						{
							Name: "Body",
							AnchorPoint: new Vector2(0.5, 0.5),
							BackgroundColor3: Color3.fromRGB(22, 27, 34),
							BackgroundTransparency: 0,
							BorderSizePixel: 0,
							Position: new UDim2(0.5, 0, 0.5, 0),
							Size: new UDim2(1, 0, 1, 0),
							ZIndex: 2,
						} as never,
						[
							React.createElement("UIStroke", {
								ApplyStrokeMode: Enum.ApplyStrokeMode.Border,
								Color: Color3.fromRGB(58, 68, 82),
								Thickness: 1,
							} as never),
						],
					),
				],
			),
			// Ladder wrapper: all children are scale-positioned, so tweening this
			// frame's Size+Position zooms the whole map onto the viewer's table.
			React.createElement("Frame", {
				Name: "Board",
				AnchorPoint: new Vector2(0.5, 0.5),
				BackgroundTransparency: 1,
				Position: new UDim2(0.5, 0, 0.5, 0),
				Size: new UDim2(1, 0, 1, 0),
			} as never),
			// Bottom strip: the viewer's ladder position ("YOU ARE 3rd OF 8").
			React.createElement("TextLabel", {
				Name: "PositionLabel",
				AnchorPoint: new Vector2(0.5, 1),
				BackgroundTransparency: 1,
				FontFace: new Font(
					"rbxasset://fonts/families/FredokaOne.json",
					Enum.FontWeight.Regular,
					Enum.FontStyle.Normal,
				),
				Position: new UDim2(0.5, 0, 0.965, 0),
				Size: new UDim2(0.8, 0, 0.06, 0),
				Text: "",
				TextColor3: new Color3(1, 1, 1),
				TextScaled: true,
				TextStrokeColor3: new Color3(0, 0, 0),
				TextStrokeTransparency: 0.4,
			} as never),
			React.createElement(
				"Frame",
				{
					Name: "Rows",
					AnchorPoint: new Vector2(0.5, 0.5),
					BackgroundTransparency: 1,
					Position: new UDim2(0.5, 0, 0.56, 0),
					Size: new UDim2(0.9, 0, 0.8, 0),
				} as never,
				[
					React.createElement("UIListLayout", {
						Name: "UIListLayout",
						FillDirection: Enum.FillDirection.Vertical,
						HorizontalAlignment: Enum.HorizontalAlignment.Center,
						VerticalAlignment: Enum.VerticalAlignment.Center,
						Padding: new UDim(0.012, 0),
						SortOrder: Enum.SortOrder.LayoutOrder,
					} as never),
				],
			),
		],
	);
}
