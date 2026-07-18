// Landing page (TOP_TABLE design §5 — Phase 1). Shown on join and whenever
// the player returns to the menu: the garage car stays in frame on the left
// (menu camera), the gamemode title and the three actions sit in a right-hand
// column matching the existing garage layout. Server code (initializePlayer)
// wires the buttons and toggles Enabled.

import React from "@rbxts/react";

const FREDOKA = new Font("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal);

function actionButton(name: string, label: string, layoutOrder: number, color: Color3): React.Element {
	return React.createElement(
		"TextButton",
		{
			Name: name,
			AutoButtonColor: true,
			BackgroundColor3: color,
			FontFace: FREDOKA,
			LayoutOrder: layoutOrder,
			Size: new UDim2(1, 0, 0.13, 0),
			Text: label,
			TextColor3: new Color3(1, 1, 1),
			TextScaled: true,
			TextStrokeColor3: new Color3(0, 0, 0),
			TextStrokeTransparency: 0.8,
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
			ResetOnSpawn: true,
			ScreenInsets: Enum.ScreenInsets.DeviceSafeInsets,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			React.createElement(
				"Frame",
				{
					Name: "Panel",
					AnchorPoint: new Vector2(0.5, 0.5),
					BackgroundTransparency: 1,
					Position: new UDim2(0.75, 0, 0.5, 0),
					Size: new UDim2(0.34, 0, 0.72, 0),
				} as never,
				[
					React.createElement("UIListLayout", {
						Name: "UIListLayout",
						FillDirection: Enum.FillDirection.Vertical,
						HorizontalAlignment: Enum.HorizontalAlignment.Center,
						Padding: new UDim(0.025, 0),
						SortOrder: Enum.SortOrder.LayoutOrder,
						VerticalAlignment: Enum.VerticalAlignment.Center,
					} as never),
					React.createElement("TextLabel", {
						Name: "Title",
						BackgroundTransparency: 1,
						FontFace: FREDOKA,
						LayoutOrder: 2,
						Size: new UDim2(1, 0, 0.19, 0),
						Text: "⚽ CAR BALL 🏆",
						TextColor3: Color3.fromRGB(255, 170, 0),
						TextScaled: true,
						TextStrokeColor3: new Color3(0, 0, 0),
						TextStrokeTransparency: 0.4,
					} as never, [
						React.createElement("UIStroke", {
							Name: "TitleOutline",
							ApplyStrokeMode: Enum.ApplyStrokeMode.Contextual,
							Color: Color3.fromRGB(45, 20, 0),
							Thickness: 3,
							Transparency: 0.12,
						} as never),
						React.createElement("UIGradient", {
							Name: "GoldGradient",
							Color: new ColorSequence(Color3.fromRGB(255, 235, 80), Color3.fromRGB(255, 135, 0)),
							Rotation: 90,
						} as never),
					]),
					React.createElement("Frame", {
						Name: "Spacer",
						BackgroundTransparency: 1,
						LayoutOrder: 3,
						Size: new UDim2(1, 0, 0.04, 0),
					} as never),
					actionButton("JoinTeam", "JOIN TEAM", 4, new Color3(0, 0.784313798, 0.36470589)),
					actionButton("CreateTeam", "CREATE TEAM WITH FRIENDS", 5, new Color3(1, 0.65882355, 0.00392156886)),
					actionButton("Cars", "CARS", 6, Color3.fromRGB(45, 65, 90)),
				],
			),
		],
	);
}
