// Football match HUD (new for the Rocket-League gamemode — not part of the
// original place file). Layout per design: three team player icons either
// side of a big center score, match countdown below it, plus a center-screen
// announce label (kickoff 3-2-1 / GOAL / winner).
//
// Same contract as every other ScreenGui here: React owns the STRUCTURE only.
// matchHud.client.ts fills the labels from the replicated FB_* attributes and
// clones ReplicatedStorage.Ui.PlayerIcon into the team rows; the server
// enables the gui when the player spawns into the match (SpawnInPlayer).

import React from "@rbxts/react";

function teamRow(name: string, layoutOrder: number, alignment: Enum.HorizontalAlignment): React.Element {
	return React.createElement(
		"Frame",
		{
			Name: name,
			BackgroundTransparency: 1,
			LayoutOrder: layoutOrder,
			Size: new UDim2(0.32, 0, 0.62, 0),
		} as never,
		[
			React.createElement("UIListLayout", {
				Name: "UIListLayout",
				FillDirection: Enum.FillDirection.Horizontal,
				HorizontalAlignment: alignment,
				VerticalAlignment: Enum.VerticalAlignment.Center,
				Padding: new UDim(0.02, 0),
				SortOrder: Enum.SortOrder.LayoutOrder,
			} as never),
		],
	);
}

export function MatchHudGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "MatchHud",
			DisplayOrder: 2,
			Enabled: false,
			ResetOnSpawn: true,
			ScreenInsets: Enum.ScreenInsets.DeviceSafeInsets,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			React.createElement(
				"Frame",
				{
					Name: "TopBar",
					AnchorPoint: new Vector2(0.5, 0),
					BackgroundTransparency: 1,
					Position: new UDim2(0.5, 0, 0, 4),
					Size: new UDim2(0.7, 0, 0.13, 0),
				} as never,
				[
					React.createElement("UIListLayout", {
						Name: "UIListLayout",
						FillDirection: Enum.FillDirection.Horizontal,
						HorizontalAlignment: Enum.HorizontalAlignment.Center,
						VerticalAlignment: Enum.VerticalAlignment.Center,
						Padding: new UDim(0.01, 0),
						SortOrder: Enum.SortOrder.LayoutOrder,
					} as never),
					teamRow("BlueTeam", 1, Enum.HorizontalAlignment.Right),
					React.createElement(
						"Frame",
						{
							Name: "Center",
							BackgroundTransparency: 1,
							LayoutOrder: 2,
							Size: new UDim2(0.3, 0, 1, 0),
						} as never,
						[
							React.createElement(
								"TextLabel",
								{
									Name: "Score",
									BackgroundTransparency: 1,
									FontFace: new Font(
										"rbxasset://fonts/families/GothamSSm.json",
										Enum.FontWeight.Heavy,
										Enum.FontStyle.Normal,
									),
									RichText: true,
									Size: new UDim2(1, 0, 0.6, 0),
									Text: "0 - 0",
									TextColor3: new Color3(1, 1, 1),
									TextScaled: true,
									TextStrokeColor3: new Color3(0, 0, 0),
									TextStrokeTransparency: 0.5,
								} as never,
							),
							React.createElement(
								"TextLabel",
								{
									Name: "Clock",
									BackgroundTransparency: 1,
									FontFace: new Font(
										"rbxasset://fonts/families/Zekton.json",
										Enum.FontWeight.Regular,
										Enum.FontStyle.Normal,
									),
									Position: new UDim2(0, 0, 0.6, 0),
									RichText: true,
									Size: new UDim2(1, 0, 0.36, 0),
									Text: "5:00",
									TextColor3: new Color3(1, 1, 1),
									TextScaled: true,
									TextStrokeColor3: new Color3(0, 0, 0),
									TextStrokeTransparency: 0.5,
								} as never,
							),
						],
					),
					teamRow("RedTeam", 3, Enum.HorizontalAlignment.Left),
				],
			),
			React.createElement(
				"TextLabel",
				{
					Name: "Announce",
					AnchorPoint: new Vector2(0.5, 0.5),
					BackgroundTransparency: 1,
					FontFace: new Font(
						"rbxasset://fonts/families/Bangers.json",
						Enum.FontWeight.Regular,
						Enum.FontStyle.Normal,
					),
					Position: new UDim2(0.5, 0, 0.35, 0),
					RichText: true,
					Size: new UDim2(0.8, 0, 0.16, 0),
					Text: "",
					TextColor3: new Color3(1, 1, 1),
					TextScaled: true,
					Visible: false,
				} as never,
				[
					React.createElement("UIStroke", {
						Name: "UIStroke",
						Color: new Color3(0, 0, 0),
						Thickness: 6,
					} as never),
				],
			),
		],
	);
}
