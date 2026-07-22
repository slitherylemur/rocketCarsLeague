// Top Table Phase 2 menus: the team page (invites, allow-randoms, rename,
// play), the invite popup, and the rename popup. Structure only — CLIENT-owned
// since migration Phase 4: mounted by src/client/ui/bootstrap.client.ts, wired
// and filled by src/client/ui/menu.client.ts from replicated state
// (CB_FlowState / Team attributes / CB_Invite / CB_RenameStatus). The rename
// Confirm is wired by carBallMenu.client.ts (typed TextBox text never
// replicates on its own).

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

// Landing-style pastel action button (light fill, dark text, soft shadow).
function pastelButton(
	name: string,
	label: string,
	position: UDim2,
	size: UDim2,
	backgroundColor: Color3,
	textColor: Color3,
	anchorPoint = new Vector2(0, 0),
): React.Element {
	return React.createElement(
		"TextButton",
		{
			Name: name,
			AnchorPoint: anchorPoint,
			AutoButtonColor: true,
			BackgroundColor3: backgroundColor,
			FontFace: FREDOKA,
			Position: position,
			Size: size,
			Text: label,
			TextColor3: textColor,
			TextScaled: true,
		} as never,
		[
			corner(0.22),
			React.createElement("UIShadow", { BlurRadius: new UDim(0, 9), Color: new Color3(0, 0, 0), Offset: UDim2.fromOffset(0, 6), Transparency: 0.45 } as never),
			React.createElement("UIStroke", { ApplyStrokeMode: Enum.ApplyStrokeMode.Border, Color: new Color3(1, 1, 1), Thickness: 2, Transparency: 0.55 } as never),
			React.createElement("UIPadding", {
				Name: "UIPadding",
				PaddingBottom: new UDim(0.18, 0),
				PaddingLeft: new UDim(0.06, 0),
				PaddingRight: new UDim(0.06, 0),
				PaddingTop: new UDim(0.18, 0),
			} as never),
		],
	);
}

function sectionTitle(name: string, text: string, position: UDim2, size: UDim2): React.Element {
	return React.createElement("TextLabel", {
		Name: name,
		BackgroundTransparency: 1,
		FontFace: GOTHAM,
		Position: position,
		Size: size,
		Text: text,
		TextColor3: Color3.fromRGB(150, 172, 200),
		TextScaled: true,
		TextXAlignment: Enum.TextXAlignment.Left,
	} as never);
}

// One of the three fixed member cards; the server fills Avatar/PlayerName
// (or shows the empty-slot state) in refreshTeamPage.
function memberSlot(index: number): React.Element {
	return React.createElement(
		"Frame",
		{
			Name: `Slot${index}`,
			BackgroundColor3: Color3.fromRGB(30, 41, 56),
			BorderSizePixel: 0,
			LayoutOrder: index,
			Size: UDim2.fromScale(0.32, 1),
		} as never,
		[
			corner(0.08),
			React.createElement("UIStroke", { ApplyStrokeMode: Enum.ApplyStrokeMode.Border, Color: Color3.fromRGB(80, 105, 140), Thickness: 1, Transparency: 0.4 } as never),
			React.createElement(
				"ImageLabel",
				{
					Name: "Avatar",
					AnchorPoint: new Vector2(0.5, 0),
					BackgroundColor3: Color3.fromRGB(46, 60, 80),
					BorderSizePixel: 0,
					Image: "",
					Position: UDim2.fromScale(0.5, 0.08),
					Size: UDim2.fromScale(0.6, 0.58),
				} as never,
				[corner(0.5), React.createElement("UIAspectRatioConstraint", { AspectRatio: 1 } as never)],
			),
			React.createElement("TextLabel", {
				Name: "PlayerName",
				BackgroundTransparency: 1,
				FontFace: GOTHAM,
				Position: UDim2.fromScale(0.05, 0.72),
				Size: UDim2.fromScale(0.9, 0.2),
				Text: "EMPTY SLOT",
				TextColor3: new Color3(1, 1, 1),
				TextScaled: true,
				TextTransparency: 0.5,
			} as never),
			// Vote-start state pill (server toggles visibility per member).
			React.createElement(
				"TextLabel",
				{
					Name: "ReadyTag",
					AnchorPoint: new Vector2(1, 0),
					BackgroundColor3: Color3.fromRGB(166, 235, 187),
					BorderSizePixel: 0,
					FontFace: GOTHAM,
					Position: UDim2.fromScale(0.96, 0.06),
					Size: UDim2.fromScale(0.42, 0.16),
					Text: "READY ✓",
					TextColor3: Color3.fromRGB(20, 76, 43),
					TextScaled: true,
					Visible: false,
					ZIndex: 2,
				} as never,
				[
					corner(0.5),
					React.createElement("UIPadding", { PaddingBottom: new UDim(0.18, 0), PaddingLeft: new UDim(0.1, 0), PaddingRight: new UDim(0.1, 0), PaddingTop: new UDim(0.18, 0) } as never),
				],
			),
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
					Position: UDim2.fromScale(0.5, 0.5),
					Size: UDim2.fromScale(0.56, 0.86),
				} as never,
				[
					corner(0.03),
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
					// -- Header: team name + rename beside it (like the garage strip)
					React.createElement(
						"Frame",
						{
							Name: "Header",
							BackgroundTransparency: 1,
							Position: UDim2.fromScale(0.05, 0.035),
							Size: UDim2.fromScale(0.9, 0.1),
						} as never,
						[
							React.createElement("TextLabel", {
								Name: "TeamName",
								BackgroundTransparency: 1,
								FontFace: FREDOKA,
								Size: UDim2.fromScale(0.66, 1),
								Text: "YOUR TEAM",
								TextColor3: Color3.fromRGB(255, 170, 0),
								TextScaled: true,
								TextXAlignment: Enum.TextXAlignment.Left,
							} as never, [
								React.createElement("UIStroke", { Color: Color3.fromRGB(55, 25, 0), Thickness: 2, Transparency: 0.25 } as never),
							]),
							pastelButton(
								"Rename",
								"✎ RENAME (R$ …)",
								UDim2.fromScale(1, 0.5),
								UDim2.fromScale(0.3, 0.78),
								Color3.fromRGB(216, 180, 254),
								Color3.fromRGB(76, 29, 149),
								new Vector2(1, 0.5),
							),
						],
					),
					// -- Your team: three fixed member cards
					sectionTitle("MembersTitle", "YOUR TEAM", UDim2.fromScale(0.05, 0.16), UDim2.fromScale(0.5, 0.042)),
					React.createElement(
						"Frame",
						{
							Name: "Members",
							BackgroundTransparency: 1,
							Position: UDim2.fromScale(0.05, 0.21),
							Size: UDim2.fromScale(0.9, 0.235),
						} as never,
						[
							React.createElement("UIListLayout", {
								Name: "UIListLayout",
								FillDirection: Enum.FillDirection.Horizontal,
								HorizontalAlignment: Enum.HorizontalAlignment.Center,
								Padding: new UDim(0.02, 0),
								SortOrder: Enum.SortOrder.LayoutOrder,
							} as never),
							memberSlot(1),
							memberSlot(2),
							memberSlot(3),
						],
					),
					// -- Invite: in-server list with avatars + off-server friends prompt
					sectionTitle("InviteTitle", "INVITE PLAYERS", UDim2.fromScale(0.05, 0.465), UDim2.fromScale(0.4, 0.042)),
					pastelButton(
						"InviteFriends",
						"📨 INVITE ROBLOX FRIENDS",
						UDim2.fromScale(0.95, 0.458),
						UDim2.fromScale(0.34, 0.055),
						Color3.fromRGB(180, 210, 239),
						Color3.fromRGB(30, 52, 79),
						new Vector2(1, 0),
					),
					React.createElement(
						"ScrollingFrame",
						{
							Name: "PlayerList",
							AutomaticCanvasSize: Enum.AutomaticSize.Y,
							BackgroundColor3: Color3.fromRGB(12, 18, 28),
							BackgroundTransparency: 0.12,
							BorderSizePixel: 0,
							CanvasSize: new UDim2(0, 0, 0, 0),
							Position: UDim2.fromScale(0.05, 0.525),
							ScrollBarImageColor3: Color3.fromRGB(255, 170, 0),
							ScrollBarThickness: 7,
							Size: UDim2.fromScale(0.9, 0.195),
						} as never,
						[
							corner(0.04),
							React.createElement("UIStroke", { ApplyStrokeMode: Enum.ApplyStrokeMode.Border, Color: Color3.fromRGB(80, 105, 140), Thickness: 1, Transparency: 0.4 } as never),
							React.createElement("UIListLayout", {
								Name: "UIListLayout",
								FillDirection: Enum.FillDirection.Vertical,
								HorizontalAlignment: Enum.HorizontalAlignment.Center,
								Padding: new UDim(0, 6),
								SortOrder: Enum.SortOrder.LayoutOrder,
							} as never),
							React.createElement("UIPadding", { PaddingTop: new UDim(0, 8), PaddingBottom: new UDim(0, 8) } as never),
							React.createElement("TextLabel", {
								Name: "EmptyHint",
								BackgroundTransparency: 1,
								FontFace: GOTHAM,
								Size: new UDim2(1, -24, 0, 44),
								Text: "No other players in this server yet — use INVITE ROBLOX FRIENDS to bring people in!",
								TextColor3: Color3.fromRGB(150, 172, 200),
								TextScaled: true,
								TextWrapped: true,
								Visible: false,
							} as never),
						],
					),
					// -- Compact allow-randoms toggle row
					React.createElement(
						"TextButton",
						{
							Name: "AllowRandoms",
							AutoButtonColor: true,
							BackgroundColor3: Color3.fromRGB(35, 48, 66),
							BorderSizePixel: 0,
							Position: UDim2.fromScale(0.05, 0.745),
							Size: UDim2.fromScale(0.9, 0.07),
							Text: "",
						} as never,
						[
							corner(0.3),
							React.createElement("UIStroke", { ApplyStrokeMode: Enum.ApplyStrokeMode.Border, Color: Color3.fromRGB(95, 120, 150), Thickness: 2, Transparency: 0.45 } as never),
							React.createElement("TextLabel", {
								Name: "Label",
								AnchorPoint: new Vector2(0, 0.5),
								BackgroundTransparency: 1,
								FontFace: GOTHAM,
								Position: UDim2.fromScale(0.03, 0.5),
								Size: UDim2.fromScale(0.72, 0.55),
								Text: "ALLOW RANDOM PLAYERS TO JOIN",
								TextColor3: new Color3(1, 1, 1),
								TextScaled: true,
								TextXAlignment: Enum.TextXAlignment.Left,
							} as never),
							React.createElement("Frame", {
								Name: "SwitchTrack",
								AnchorPoint: new Vector2(1, 0.5),
								BackgroundColor3: Color3.fromRGB(75, 84, 98),
								BorderSizePixel: 0,
								Position: UDim2.fromScale(0.97, 0.5),
								Size: UDim2.fromScale(0.11, 0.62),
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
					// -- Bottom bar: Play + Leave Team
					pastelButton(
						"Play",
						"PLAY",
						UDim2.fromScale(0.05, 0.845),
						UDim2.fromScale(0.52, 0.115),
						Color3.fromRGB(166, 235, 187),
						Color3.fromRGB(20, 76, 43),
					),
					pastelButton(
						"Leave",
						"LEAVE TEAM",
						UDim2.fromScale(0.95, 0.845),
						UDim2.fromScale(0.36, 0.115),
						Color3.fromRGB(250, 177, 170),
						Color3.fromRGB(120, 30, 24),
						new Vector2(1, 0),
					),
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
			// Client-owned (Phase 4) — see CreateTeamGui above.
			ResetOnSpawn: false,
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
			// Client-owned (Phase 4) — see CreateTeamGui above.
			ResetOnSpawn: false,
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
