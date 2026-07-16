// GENERATED from the original place file's StarterGui/TimerGui — every serialized,
// scriptable property is reproduced verbatim so the rendered tree matches the
// original TimerGui ScreenGui exactly. Embedded LocalScripts are intentionally
// omitted here; their behaviour lives in src/client/uiClientBehaviors.client.ts.
// React owns the STRUCTURE only — translated game code mutates the mounted
// instances imperatively, exactly like the original operated on cloned templates.
/* eslint-disable */

import React from "@rbxts/react";

export function TimerGui(): React.Element {
	return (
	React.createElement("ScreenGui", {
		Name: "TimerGui",
		AutoLocalize: true,
		ClipToDeviceSafeArea: true,
		DisplayOrder: 0,
		Enabled: false,
		ResetOnSpawn: true,
		SafeAreaCompatibility: Enum.SafeAreaCompatibility.FullscreenExtension,
		ScreenInsets: Enum.ScreenInsets.CoreUISafeInsets,
		SelectionBehaviorDown: Enum.SelectionBehavior.Escape,
		SelectionBehaviorLeft: Enum.SelectionBehavior.Escape,
		SelectionBehaviorRight: Enum.SelectionBehavior.Escape,
		SelectionBehaviorUp: Enum.SelectionBehavior.Escape,
		SelectionGroup: false,
		ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
	} as never, [
		React.createElement("TextLabel", {
			Name: "TextLabel",
			Active: false,
			AnchorPoint: new Vector2(0, 0),
			AutoLocalize: true,
			AutomaticSize: Enum.AutomaticSize.None,
			BackgroundColor3: new Color3(1, 1, 1),
			BackgroundTransparency: 1,
			BorderColor3: new Color3(0.105882362, 0.164705887, 0.207843155),
			BorderMode: Enum.BorderMode.Outline,
			BorderSizePixel: 1,
			ClipsDescendants: false,
			Draggable: false,
			FontFace: new Font("rbxasset://fonts/families/Bangers.json", Enum.FontWeight.Regular, Enum.FontStyle.Normal),
			InputSink: Enum.InputSink.None,
			Interactable: true,
			LayoutOrder: 0,
			LineHeight: 1,
			MaxVisibleGraphemes: -1,
			OpenTypeFeatures: "",
			Position: new UDim2(0.332207978, 0, 0, 0),
			RichText: false,
			Rotation: 0,
			Selectable: false,
			SelectionBehaviorDown: Enum.SelectionBehavior.Escape,
			SelectionBehaviorLeft: Enum.SelectionBehavior.Escape,
			SelectionBehaviorRight: Enum.SelectionBehavior.Escape,
			SelectionBehaviorUp: Enum.SelectionBehavior.Escape,
			SelectionGroup: false,
			SelectionOrder: 0,
			Size: new UDim2(0.667792082, 0, 1, 0),
			SizeConstraint: Enum.SizeConstraint.RelativeXY,
			Text: "Spawning in 2",
			TextColor3: new Color3(1, 1, 1),
			TextDirection: Enum.TextDirection.Auto,
			TextScaled: true,
			TextSize: 14,
			TextStrokeColor3: new Color3(0, 0, 0),
			TextStrokeTransparency: 1,
			TextTransparency: 0,
			TextTruncate: Enum.TextTruncate.None,
			TextWrapped: true,
			TextXAlignment: Enum.TextXAlignment.Center,
			TextYAlignment: Enum.TextYAlignment.Center,
			Visible: true,
			ZIndex: 1,
		} as never, [
			React.createElement("UIStroke", {
				Name: "UIStroke",
				ApplyStrokeMode: Enum.ApplyStrokeMode.Contextual,
				BorderOffset: new UDim(0, 0),
				BorderStrokePosition: Enum.BorderStrokePosition.Outer,
				Color: new Color3(0, 0, 0),
				Enabled: true,
				LineJoinMode: Enum.LineJoinMode.Round,
				StrokeSizingMode: Enum.StrokeSizingMode.FixedSize,
				Thickness: 9.30000019,
				Transparency: 0,
				ZIndex: 1,
			} as never),
		]),
	])
	);
}
