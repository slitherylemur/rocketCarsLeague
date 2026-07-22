// Landing page shown on join and whenever the player returns to the menu.
// The padded title art intentionally overlaps an independently laid-out
// button stack, so its transparent margins do not create unwanted spacing.

import React from "@rbxts/react";

const FREDOKA = new Font("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal);
const TITLE_IMAGE = "rbxassetid://103972010667054";

function actionButton(
	name: string,
	label: string,
	layoutOrder: number,
	backgroundColor: Color3,
	textColor: Color3,
): React.Element {
	return React.createElement(
		"TextButton",
		{
			Name: name,
			AutoButtonColor: true,
			BackgroundColor3: backgroundColor,
			FontFace: FREDOKA,
			LayoutOrder: layoutOrder,
			Size: new UDim2(1, 0, 0.27, 0),
			Text: label,
			TextColor3: textColor,
			TextScaled: true,
			TextStrokeColor3: new Color3(0, 0, 0),
			TextStrokeTransparency: 1,
			TextXAlignment: Enum.TextXAlignment.Center,
		} as never,
		[
			React.createElement("UIShadow", {
				Name: "DropShadow",
				BlurRadius: new UDim(0, 10),
				Color: Color3.fromRGB(0, 0, 0),
				Offset: UDim2.fromOffset(0, 7),
				Spread: UDim2.fromOffset(2, 2),
				Transparency: 0.45,
			} as never),
			React.createElement("UIStroke", {
				Name: "Outline",
				ApplyStrokeMode: Enum.ApplyStrokeMode.Border,
				Color: Color3.fromRGB(255, 255, 255),
				Thickness: 2,
				Transparency: 0.55,
			} as never),
			React.createElement("UICorner", {
				Name: "UICorner",
				BottomLeftRadius: new UDim(0.2, 0),
				BottomRightRadius: new UDim(0.2, 0),
				TopLeftRadius: new UDim(0.2, 0),
				TopRightRadius: new UDim(0.2, 0),
			} as never),
			React.createElement("UIPadding", {
				Name: "UIPadding",
				PaddingBottom: new UDim(0.18, 0),
				PaddingTop: new UDim(0.18, 0),
			} as never),
		],
	);
}

export function LandingGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "Landing",
			DisplayOrder: 1,
			Enabled: false,
			// Client-owned (Phase 4): mounted once by bootstrap.client.ts and
			// driven by menu.client.ts — the engine must leave it alone.
			ResetOnSpawn: false,
			ScreenInsets: Enum.ScreenInsets.DeviceSafeInsets,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			React.createElement("Sound", {
				Name: "HoverSound",
				SoundId: "rbxassetid://6324801967",
				Volume: 0.35,
			} as never),
			React.createElement("ImageLabel", {
				Name: "Title",
				AnchorPoint: new Vector2(0.5, 0.5),
				BackgroundTransparency: 1,
				Image: TITLE_IMAGE,
				Position: new UDim2(0.75, 0, 0.27, 0),
				ScaleType: Enum.ScaleType.Fit,
				Size: new UDim2(0.52, 0, 0.85, 0),
				ZIndex: 2,
			} as never),
			React.createElement(
				"Frame",
				{
					Name: "Panel",
					AnchorPoint: new Vector2(0.5, 0.5),
					BackgroundTransparency: 1,
					Position: new UDim2(0.75, 0, 0.5, 0),
					Size: new UDim2(0.36, 0, 0.86, 0),
				} as never,
				[
					React.createElement(
						"Frame",
						{
							Name: "Buttons",
							BackgroundTransparency: 1,
							Position: new UDim2(0, 0, 0.46, 0),
							Size: new UDim2(1, 0, 0.46, 0),
						} as never,
						[
							React.createElement("UIListLayout", {
								Name: "UIListLayout",
								FillDirection: Enum.FillDirection.Vertical,
								HorizontalAlignment: Enum.HorizontalAlignment.Center,
								Padding: new UDim(0.055, 0),
								SortOrder: Enum.SortOrder.LayoutOrder,
								VerticalAlignment: Enum.VerticalAlignment.Center,
							} as never),
							actionButton(
								"JoinTeam",
								"PLAY",
								1,
								Color3.fromRGB(166, 235, 187),
								Color3.fromRGB(20, 76, 43),
							),
							actionButton(
								"CreateTeam",
								"FRIENDS TEAM",
								2,
								Color3.fromRGB(255, 218, 150),
								Color3.fromRGB(105, 62, 12),
							),
							actionButton(
								"Cars",
								"SELECT CAR",
								3,
								Color3.fromRGB(180, 210, 239),
								Color3.fromRGB(30, 52, 79),
							),
						],
					),
				],
			),
		],
	);
}
