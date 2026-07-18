// Full-screen ladder map (Top Table Phase 4b). Structure only, like
// RoundSummaryGui: the server (src/server/ui/LadderMapScreen.ts) builds the
// horizontal pitch cards + team chips into Board imperatively (everything
// scale-positioned so the whole Board can be zoom-tweened per viewer) and
// toggles Enabled. Rows (list-layout) is kept for the session-end CHAMPIONS
// screen (Phase 5) — same gui, the server swaps Title text and content.

import React from "@rbxts/react";

export function LadderMapGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "LadderMap",
			DisplayOrder: 3,
			Enabled: false,
			ResetOnSpawn: true,
			ScreenInsets: Enum.ScreenInsets.DeviceSafeInsets,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			React.createElement("Frame", {
				Name: "Backdrop",
				BackgroundColor3: new Color3(0, 0, 0),
				BackgroundTransparency: 0.35,
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
				Position: new UDim2(0.5, 0, 0.04, 0),
				Size: new UDim2(0.6, 0, 0.09, 0),
				Text: "THE LADDER",
				TextColor3: Color3.fromRGB(255, 200, 60),
				TextScaled: true,
				TextStrokeColor3: new Color3(0, 0, 0),
				TextStrokeTransparency: 0.4,
			} as never),
			// Ladder wrapper: all children are scale-positioned, so tweening this
			// frame's Size+Position zooms the whole map onto the viewer's table.
			React.createElement("Frame", {
				Name: "Board",
				AnchorPoint: new Vector2(0.5, 0.5),
				BackgroundTransparency: 1,
				Position: new UDim2(0.5, 0, 0.5, 0),
				Size: new UDim2(1, 0, 1, 0),
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
