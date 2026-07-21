// Round-start face-off overlay (new for the Rocket-League gamemode). Two
// team name plates high on the screen — blue left, red right — with a big
// "VS" between them, shown over the face-off stage camera shot.
//
// Same contract as every other ScreenGui here: React owns the STRUCTURE only.
// matchHud.client.ts fills the names from the FB_BlueName/FB_RedName pitch
// attributes, tweens the plates in from the screen edges, and toggles the gui
// while FB_Phase is "FaceOff".

import React from "@rbxts/react";

const PLATE_BG = Color3.fromRGB(25, 32, 40);
const BLUE = Color3.fromRGB(79, 168, 255);
const RED = Color3.fromRGB(255, 80, 80);

function teamPlate(name: string, accent: Color3, anchorX: number, posXScale: number): React.Element {
	return React.createElement(
		"Frame",
		{
			Name: name,
			AnchorPoint: new Vector2(anchorX, 0.5),
			BackgroundColor3: PLATE_BG,
			BackgroundTransparency: 0.2,
			Position: new UDim2(posXScale, 0, 0.5, 0),
			Size: new UDim2(0.3, 0, 0.78, 0),
		} as never,
		[
			React.createElement("UICorner", {
				Name: "UICorner",
				CornerRadius: new UDim(0.22, 0),
			} as never),
			React.createElement("UIStroke", {
				Name: "UIStroke",
				ApplyStrokeMode: Enum.ApplyStrokeMode.Border,
				Color: accent,
				Thickness: 3,
				Transparency: 0.1,
			} as never),
			React.createElement("UIGradient", {
				Name: "UIGradient",
				Color: new ColorSequence(new Color3(1, 1, 1), Color3.fromRGB(160, 160, 160)),
				Rotation: 90,
			} as never),
			React.createElement("UIPadding", {
				Name: "UIPadding",
				PaddingBottom: new UDim(0.14, 0),
				PaddingLeft: new UDim(0.06, 0),
				PaddingRight: new UDim(0.06, 0),
				PaddingTop: new UDim(0.14, 0),
			} as never),
			React.createElement(
				"TextLabel",
				{
					Name: "TeamName",
					BackgroundTransparency: 1,
					FontFace: new Font(
						"rbxasset://fonts/families/FredokaOne.json",
						Enum.FontWeight.Regular,
						Enum.FontStyle.Normal,
					),
					Size: new UDim2(1, 0, 1, 0),
					Text: "",
					TextColor3: accent,
					TextScaled: true,
					TextStrokeColor3: new Color3(0, 0, 0),
					TextStrokeTransparency: 0.4,
				} as never,
			),
			// Roster row under the plate: matchHud.client.ts clones PlayerIcon
			// into it (with a team-colored UIStroke) for every player on the
			// side. A plate child so it slides in with the plate tween.
			React.createElement(
				"Frame",
				{
					Name: "Icons",
					AnchorPoint: new Vector2(0.5, 0),
					BackgroundTransparency: 1,
					Position: new UDim2(0.5, 0, 1.45, 0),
					Size: new UDim2(1, 0, 1.15, 0),
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

export function FaceOffGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "FaceOff",
			DisplayOrder: 3,
			Enabled: false,
			ResetOnSpawn: true,
			ScreenInsets: Enum.ScreenInsets.DeviceSafeInsets,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			React.createElement(
				"Frame",
				{
					Name: "Banner",
					AnchorPoint: new Vector2(0.5, 0),
					BackgroundTransparency: 1,
					Position: new UDim2(0.5, 0, 0.05, 0),
					Size: new UDim2(0.92, 0, 0.13, 0),
				} as never,
				[
					teamPlate("BluePlate", BLUE, 0, 0.04),
					teamPlate("RedPlate", RED, 1, 0.96),
					React.createElement(
						"TextLabel",
						{
							Name: "Vs",
							AnchorPoint: new Vector2(0.5, 0.5),
							BackgroundTransparency: 1,
							FontFace: new Font(
								"rbxasset://fonts/families/Bangers.json",
								Enum.FontWeight.Regular,
								Enum.FontStyle.Normal,
							),
							Position: new UDim2(0.5, 0, 0.5, 0),
							Size: new UDim2(0.12, 0, 1.05, 0),
							Text: "VS",
							TextColor3: new Color3(1, 1, 1),
							TextScaled: true,
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
			),
		],
	);
}
