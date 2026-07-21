// Full-screen ladder map shell (Top Table Phase 4b, redesigned 2026-07-22).
// Structure only: the server (src/server/ui/LadderMapScreen.ts) builds the
// horizontal pitch strip into Canvas.Stage.World imperatively and owns the
// timeline; the actual tweens run CLIENT-side (src/client/ladderMap.client.ts)
// off CB_* attributes the server stages.
//
// Layer contract:
//   * Canvas (CanvasGroup) — EVERYTHING visual sits inside it so the whole
//     screen can fade in (GroupTransparency 1→0) over the live 3D pitch rise.
//     Staged at 1 (invisible) by the server before each ladder show.
//   * Stage — fixed 16:9 letterbox inside Canvas. All ladder geometry is
//     computed in Stage-scale coordinates, so the layout the server bakes is
//     identical on every screen aspect (the Backdrop covers any bars).
//   * World — the "2D camera". Children (pitch cards + team plates) are
//     scale-positioned in ladder space; tweening World's Size/Position is how
//     every camera move (focus, follow, pan-to-top) happens.
//   * Rows — kept for the session-end CHAMPIONS screen (Phase 5): same gui,
//     the server swaps Title text and content.

import React from "@rbxts/react";

const TITLE_FONT = new Font(
	"rbxasset://fonts/families/FredokaOne.json",
	Enum.FontWeight.Regular,
	Enum.FontStyle.Normal,
);

export function LadderMapGui(): React.Element {
	return React.createElement(
		"ScreenGui",
		{
			Name: "LadderMap",
			DisplayOrder: 3,
			Enabled: false,
			// Full-bleed: the Backdrop must cover the topbar/notch areas.
			IgnoreGuiInset: true,
			ResetOnSpawn: true,
			ScreenInsets: Enum.ScreenInsets.None,
			ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
		} as never,
		[
			React.createElement(
				"CanvasGroup",
				{
					Name: "Canvas",
					BackgroundTransparency: 1,
					BorderSizePixel: 0,
					// Invisible until the client fades it in over the 3D rise.
					GroupTransparency: 1,
					Size: new UDim2(1, 0, 1, 0),
				} as never,
				[
					// Solid background — once the fade completes nothing of the
					// world shows through.
					React.createElement("Frame", {
						Name: "Backdrop",
						BackgroundColor3: Color3.fromRGB(12, 14, 18),
						BackgroundTransparency: 0,
						BorderSizePixel: 0,
						Size: new UDim2(1, 0, 1, 0),
						ZIndex: 1,
					} as never),
					// Fixed-aspect play area for the ladder strip.
					React.createElement(
						"Frame",
						{
							Name: "Stage",
							AnchorPoint: new Vector2(0.5, 0.5),
							BackgroundTransparency: 1,
							Position: new UDim2(0.5, 0, 0.5, 0),
							Size: new UDim2(1, 0, 1, 0),
							ZIndex: 2,
						} as never,
						[
							React.createElement("UIAspectRatioConstraint", {
								AspectRatio: 16 / 9,
								AspectType: Enum.AspectType.FitWithinMaxSize,
								DominantAxis: Enum.DominantAxis.Width,
							} as never),
							// The 2D camera: server-built ladder content, tweened
							// wholesale for every camera move.
							React.createElement("Frame", {
								Name: "World",
								AnchorPoint: new Vector2(0.5, 0.5),
								BackgroundTransparency: 1,
								Position: new UDim2(0.5, 0, 0.5, 0),
								Size: new UDim2(1, 0, 1, 0),
							} as never),
						],
					),
					React.createElement("TextLabel", {
						Name: "Title",
						AnchorPoint: new Vector2(0.5, 0),
						BackgroundTransparency: 1,
						FontFace: TITLE_FONT,
						Position: new UDim2(0.5, 0, 0.03, 0),
						Size: new UDim2(0.7, 0, 0.08, 0),
						Text: "THE LADDER",
						TextColor3: Color3.fromRGB(255, 200, 60),
						TextScaled: true,
						TextStrokeColor3: new Color3(0, 0, 0),
						TextStrokeTransparency: 0.4,
						ZIndex: 5,
					} as never),
					// Bottom strip: the viewer's ladder position ("YOU ARE 3rd OF 8").
					React.createElement("TextLabel", {
						Name: "PositionLabel",
						AnchorPoint: new Vector2(0.5, 1),
						BackgroundTransparency: 1,
						FontFace: TITLE_FONT,
						Position: new UDim2(0.5, 0, 0.97, 0),
						Size: new UDim2(0.8, 0, 0.055, 0),
						Text: "",
						TextColor3: new Color3(1, 1, 1),
						TextScaled: true,
						TextStrokeColor3: new Color3(0, 0, 0),
						TextStrokeTransparency: 0.4,
						ZIndex: 5,
					} as never),
					// Session-end CHAMPIONS content (Phase 5) goes here.
					React.createElement(
						"Frame",
						{
							Name: "Rows",
							AnchorPoint: new Vector2(0.5, 0.5),
							BackgroundTransparency: 1,
							Position: new UDim2(0.5, 0, 0.56, 0),
							Size: new UDim2(0.9, 0, 0.8, 0),
							ZIndex: 4,
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
			),
		],
	);
}
