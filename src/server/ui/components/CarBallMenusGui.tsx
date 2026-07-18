// Top Table Phase 2 menus: the team page (invites, allow-randoms, rename,
// play), the invite popup, and the rename popup. Structure only — server
// code (initializePlayer) wires buttons and fills texts; the rename Confirm
// is the one client-wired control (typed TextBox text never replicates), see
// carBallMenu.client.ts.

import React from "@rbxts/react";

const FREDOKA = new Font("rbxasset://fonts/families/FredokaOne.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal);
const GOTHAM = new Font("rbxasset://fonts/families/GothamSSm.json", Enum.FontWeight.Heavy, Enum.FontStyle.Normal);

function corner(radius: number): React.Element {
	return React.createElement("UICorner", {
		Name: "UICorner",
		BottomLeftRadius: new UDim(radius, 0),
		BottomRightRadius: new UDim(radius, 0),
		TopLeftRadius: new UDim(radius, 0),
		TopRightRadius: new UDim(radius, 0),
	} as never);
}

function button(
	name: string,
	label: string,
	layoutOrder: number,
	color: Color3,
	height = 0.1,
	position = UDim2.fromScale(0, 0),
	width = 1,
): React.Element {
	return React.createElement(
		"TextButton",
		{
			Name: name,
			AutoButtonColor: true,
			BackgroundColor3: color,
			FontFace: FREDOKA,
			LayoutOrder: layoutOrder,
			Position: position,
			Size: new UDim2(width, 0, height, 0),
			Text: label,
			TextColor3: new Color3(1, 1, 1),
			TextScaled: true,
			TextStrokeColor3: new Color3(0, 0, 0),
			TextStrokeTransparency: 0.8,
		} as never,
		[
			corner(0.2),
			React.createElement("UIShadow", { BlurRadius: new UDim(0, 9), Color: new Color3(0, 0, 0), Offset: UDim2.fromOffset(0, 6), Transparency: 0.45 } as never),
			React.createElement("UIStroke", { ApplyStrokeMode: Enum.ApplyStrokeMode.Border, Color: new Color3(1, 1, 1), Thickness: 2, Transparency: 0.65 } as never),
			React.createElement("UIPadding", { Name: "UIPadding", PaddingBottom: new UDim(0.15, 0), PaddingTop: new UDim(0.15, 0) } as never),
		],
	);
}

export function CreateTeamGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "CreateTeam",
			DisplayOrder: 1,
			Enabled: false,
			ResetOnSpawn: true,
			ScreenInsets: Enum.ScreenInsets.DeviceSafeInsets,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			React.createElement("Frame", {
				Name: "Backdrop",
				BackgroundColor3: Color3.fromRGB(7, 11, 18),
				BackgroundTransparency: 0.28,
				Size: UDim2.fromScale(1, 1),
			} as never),
			React.createElement(
				"Frame",
				{
					Name: "Panel",
					AnchorPoint: new Vector2(0.5, 0.5),
					BackgroundColor3: Color3.fromRGB(20, 27, 38),
					BackgroundTransparency: 0.06,
					Position: UDim2.fromScale(0.5, 0.51),
					Size: UDim2.fromScale(0.82, 0.82),
				} as never,
				[
					corner(0.025),
					React.createElement("UIShadow", {
						Name: "DropShadow",
						BlurRadius: new UDim(0, 22),
						Color: Color3.fromRGB(0, 0, 0),
						Offset: UDim2.fromOffset(0, 12),
						Spread: UDim2.fromOffset(5, 5),
						Transparency: 0.28,
					} as never),
					React.createElement("UIStroke", {
						Name: "PanelOutline",
						ApplyStrokeMode: Enum.ApplyStrokeMode.Border,
						Color: Color3.fromRGB(104, 130, 165),
						Thickness: 2,
						Transparency: 0.55,
					} as never),
					React.createElement("TextLabel", {
						Name: "TeamName",
						BackgroundTransparency: 1,
						FontFace: FREDOKA,
						Position: UDim2.fromScale(0.04, 0.035),
						Size: UDim2.fromScale(0.92, 0.11),
						Text: "YOUR TEAM",
						TextColor3: Color3.fromRGB(255, 170, 0),
						TextScaled: true,
						TextXAlignment: Enum.TextXAlignment.Left,
					} as never, [
						React.createElement("UIStroke", { Color: Color3.fromRGB(55, 25, 0), Thickness: 2, Transparency: 0.25 } as never),
					]),
					React.createElement("TextLabel", {
						Name: "SettingsTitle",
						BackgroundTransparency: 1,
						FontFace: GOTHAM,
						Position: UDim2.fromScale(0.05, 0.19),
						Size: UDim2.fromScale(0.39, 0.055),
						Text: "TEAM SETTINGS",
						TextColor3: Color3.fromRGB(170, 190, 215),
						TextScaled: true,
						TextXAlignment: Enum.TextXAlignment.Left,
					} as never),
					React.createElement("TextLabel", {
						Name: "InviteHint",
						BackgroundTransparency: 1,
						FontFace: GOTHAM,
						Position: UDim2.fromScale(0.53, 0.19),
						Size: UDim2.fromScale(0.42, 0.055),
						Text: "PLAYERS IN THIS SERVER",
						TextColor3: Color3.fromRGB(170, 190, 215),
						TextScaled: true,
						TextXAlignment: Enum.TextXAlignment.Left,
					} as never),
					React.createElement("Frame", {
						Name: "ColumnDivider",
						BackgroundColor3: Color3.fromRGB(100, 125, 155),
						BackgroundTransparency: 0.72,
						BorderSizePixel: 0,
						Position: UDim2.fromScale(0.49, 0.19),
						Size: UDim2.fromScale(0.002, 0.7),
					} as never),
					React.createElement(
						"ScrollingFrame",
						{
							Name: "PlayerList",
							AutomaticCanvasSize: Enum.AutomaticSize.Y,
							BackgroundColor3: Color3.fromRGB(12, 18, 28),
							BackgroundTransparency: 0.12,
							BorderSizePixel: 0,
							CanvasSize: new UDim2(0, 0, 0, 0),
							Position: UDim2.fromScale(0.53, 0.26),
							ScrollBarImageColor3: Color3.fromRGB(255, 170, 0),
							ScrollBarThickness: 7,
							Size: UDim2.fromScale(0.42, 0.43),
						} as never,
						[
							corner(0.025),
							React.createElement("UIStroke", { ApplyStrokeMode: Enum.ApplyStrokeMode.Border, Color: Color3.fromRGB(80, 105, 140), Thickness: 1, Transparency: 0.4 } as never),
							React.createElement("UIListLayout", {
								Name: "UIListLayout",
								FillDirection: Enum.FillDirection.Vertical,
								HorizontalAlignment: Enum.HorizontalAlignment.Center,
								Padding: new UDim(0, 7),
								SortOrder: Enum.SortOrder.LayoutOrder,
							} as never),
							React.createElement("UIPadding", { PaddingTop: new UDim(0, 8), PaddingBottom: new UDim(0, 8) } as never),
						],
					),
					button("InviteFriends", "👥  INVITE FRIENDS TO THIS GAME", 0, Color3.fromRGB(0, 125, 210), 0.1, UDim2.fromScale(0.53, 0.73), 0.42),
					React.createElement(
						"TextButton",
						{
							Name: "AllowRandoms",
							AutoButtonColor: true,
							BackgroundColor3: Color3.fromRGB(35, 48, 66),
							BorderSizePixel: 0,
							FontFace: GOTHAM,
							Position: UDim2.fromScale(0.05, 0.27),
							Size: UDim2.fromScale(0.39, 0.11),
							Text: "ALLOW RANDOM PLAYERS",
							TextColor3: new Color3(1, 1, 1),
							TextScaled: true,
							TextXAlignment: Enum.TextXAlignment.Left,
						} as never,
						[
							corner(0.16),
							React.createElement("UIPadding", { PaddingLeft: new UDim(0.05, 0), PaddingRight: new UDim(0.25, 0), PaddingTop: new UDim(0.25, 0), PaddingBottom: new UDim(0.25, 0) } as never),
							React.createElement("UIStroke", { ApplyStrokeMode: Enum.ApplyStrokeMode.Border, Color: Color3.fromRGB(95, 120, 150), Thickness: 2, Transparency: 0.45 } as never),
							React.createElement("Frame", {
								Name: "SwitchTrack",
								AnchorPoint: new Vector2(1, 0.5),
								BackgroundColor3: Color3.fromRGB(75, 84, 98),
								BorderSizePixel: 0,
								Position: UDim2.fromScale(0.95, 0.5),
								Size: UDim2.fromScale(0.19, 0.5),
							} as never, [
								corner(0.5),
								React.createElement("Frame", {
									Name: "SwitchKnob",
									AnchorPoint: new Vector2(0.5, 0.5),
									BackgroundColor3: new Color3(1, 1, 1),
									BorderSizePixel: 0,
									Position: UDim2.fromScale(0.27, 0.5),
									Size: UDim2.fromScale(0.38, 0.76),
								} as never, [corner(0.5)]),
							]),
						],
					),
					button("Rename", "✎  RENAME TEAM (R$)", 0, Color3.fromRGB(135, 65, 190), 0.1, UDim2.fromScale(0.05, 0.43), 0.39),
					button("Play", "PLAY WITH THIS TEAM", 0, Color3.fromRGB(0, 185, 90), 0.13, UDim2.fromScale(0.05, 0.61), 0.39),
					button("Back", "BACK", 0, Color3.fromRGB(185, 55, 55), 0.09, UDim2.fromScale(0.05, 0.79), 0.18),
				],
			),
		],
	);
}

export function InvitePopupGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "InvitePopup",
			DisplayOrder: 5,
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
					AnchorPoint: new Vector2(0.5, 0),
					BackgroundColor3: Color3.fromRGB(25, 32, 40),
					BackgroundTransparency: 0.15,
					Position: new UDim2(0.5, 0, 0.12, 0),
					Size: new UDim2(0.34, 0, 0.14, 0),
				} as never,
				[
					corner(0.12),
					React.createElement("TextLabel", {
						Name: "Message",
						BackgroundTransparency: 1,
						FontFace: GOTHAM,
						Position: new UDim2(0.03, 0, 0.06, 0),
						Size: new UDim2(0.94, 0, 0.45, 0),
						Text: "Bob invited you to Bob's Team",
						TextColor3: new Color3(1, 1, 1),
						TextScaled: true,
					} as never),
					React.createElement(
						"TextButton",
						{
							Name: "Accept",
							AutoButtonColor: true,
							BackgroundColor3: new Color3(0, 0.784313798, 0.36470589),
							FontFace: FREDOKA,
							Position: new UDim2(0.06, 0, 0.58, 0),
							Size: new UDim2(0.4, 0, 0.32, 0),
							Text: "ACCEPT",
							TextColor3: new Color3(1, 1, 1),
							TextScaled: true,
						} as never,
						[corner(0.25)],
					),
					React.createElement(
						"TextButton",
						{
							Name: "Decline",
							AutoButtonColor: true,
							BackgroundColor3: Color3.fromRGB(200, 60, 60),
							FontFace: FREDOKA,
							Position: new UDim2(0.54, 0, 0.58, 0),
							Size: new UDim2(0.4, 0, 0.32, 0),
							Text: "DECLINE",
							TextColor3: new Color3(1, 1, 1),
							TextScaled: true,
						} as never,
						[corner(0.25)],
					),
				],
			),
		],
	);
}

export function RenamePopupGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "RenamePopup",
			DisplayOrder: 6,
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
					BackgroundColor3: Color3.fromRGB(25, 32, 40),
					BackgroundTransparency: 0.1,
					Position: new UDim2(0.5, 0, 0.4, 0),
					Size: new UDim2(0.34, 0, 0.24, 0),
				} as never,
				[
					corner(0.08),
					React.createElement("TextLabel", {
						Name: "Title",
						BackgroundTransparency: 1,
						FontFace: FREDOKA,
						Position: new UDim2(0.03, 0, 0.04, 0),
						Size: new UDim2(0.94, 0, 0.2, 0),
						Text: "NAME YOUR TEAM",
						TextColor3: Color3.fromRGB(255, 170, 0),
						TextScaled: true,
					} as never),
					React.createElement(
						"TextBox",
						{
							Name: "NameBox",
							BackgroundColor3: new Color3(1, 1, 1),
							ClearTextOnFocus: false,
							FontFace: GOTHAM,
							PlaceholderText: "Team name (2-24 characters)",
							Position: new UDim2(0.06, 0, 0.3, 0),
							Size: new UDim2(0.88, 0, 0.24, 0),
							Text: "",
							TextColor3: new Color3(0, 0, 0),
							TextScaled: true,
						} as never,
						[corner(0.2)],
					),
					React.createElement("TextLabel", {
						Name: "Status",
						BackgroundTransparency: 1,
						FontFace: GOTHAM,
						Position: new UDim2(0.03, 0, 0.56, 0),
						Size: new UDim2(0.94, 0, 0.12, 0),
						Text: "",
						TextColor3: Color3.fromRGB(255, 120, 120),
						TextScaled: true,
					} as never),
					React.createElement(
						"TextButton",
						{
							Name: "Confirm",
							AutoButtonColor: true,
							BackgroundColor3: new Color3(0, 0.784313798, 0.36470589),
							FontFace: FREDOKA,
							Position: new UDim2(0.06, 0, 0.72, 0),
							Size: new UDim2(0.55, 0, 0.22, 0),
							Text: "CONFIRM",
							TextColor3: new Color3(1, 1, 1),
							TextScaled: true,
						} as never,
						[corner(0.25)],
					),
					React.createElement(
						"TextButton",
						{
							Name: "Close",
							AutoButtonColor: true,
							BackgroundColor3: Color3.fromRGB(90, 90, 90),
							FontFace: FREDOKA,
							Position: new UDim2(0.65, 0, 0.72, 0),
							Size: new UDim2(0.29, 0, 0.22, 0),
							Text: "CLOSE",
							TextColor3: new Color3(1, 1, 1),
							TextScaled: true,
						} as never,
						[corner(0.25)],
					),
				],
			),
		],
	);
}
