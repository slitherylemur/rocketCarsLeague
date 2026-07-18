// Full-screen end-of-round stats summary (Top Table §9). Structure only:
// footballMatch.showRoundSummary builds one stats column per player in your
// match into Columns (yours centered and bigger) and toggles Enabled.

import React from "@rbxts/react";

export function RoundSummaryGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "RoundSummary",
			DisplayOrder: 4,
			Enabled: false,
			ResetOnSpawn: true,
			ScreenInsets: Enum.ScreenInsets.DeviceSafeInsets,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			React.createElement("Frame", {
				Name: "Backdrop",
				BackgroundColor3: new Color3(0, 0, 0),
				BackgroundTransparency: 0.45,
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
				Position: new UDim2(0.5, 0, 0.06, 0),
				Size: new UDim2(0.6, 0, 0.1, 0),
				Text: "ROUND RESULTS",
				TextColor3: Color3.fromRGB(255, 170, 0),
				TextScaled: true,
				TextStrokeColor3: new Color3(0, 0, 0),
				TextStrokeTransparency: 0.4,
			} as never),
			React.createElement(
				"Frame",
				{
					Name: "Columns",
					AnchorPoint: new Vector2(0.5, 0.5),
					BackgroundTransparency: 1,
					Position: new UDim2(0.5, 0, 0.55, 0),
					Size: new UDim2(0.9, 0, 0.7, 0),
				} as never,
				[
					React.createElement("UIListLayout", {
						Name: "UIListLayout",
						FillDirection: Enum.FillDirection.Horizontal,
						HorizontalAlignment: Enum.HorizontalAlignment.Center,
						VerticalAlignment: Enum.VerticalAlignment.Center,
						Padding: new UDim(0.015, 0),
						SortOrder: Enum.SortOrder.LayoutOrder,
					} as never),
				],
			),
		],
	);
}
