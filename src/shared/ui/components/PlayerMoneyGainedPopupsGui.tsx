// GENERATED from the original place file's StarterGui/PlayerMoneyGainedPopups — every serialized,
// scriptable property is reproduced verbatim so the rendered tree matches the
// original PlayerMoneyGainedPopups ScreenGui exactly. Embedded LocalScripts are intentionally
// omitted here; their behaviour lives in src/client/uiClientBehaviors.client.ts.
// React owns the STRUCTURE only — translated game code mutates the mounted
// instances imperatively, exactly like the original operated on cloned templates.
/* eslint-disable */

import React from "@rbxts/react";

export function PlayerMoneyGainedPopupsGui(): React.Element {
	return (
	React.createElement("ScreenGui", {
		Name: "PlayerMoneyGainedPopups",
		AutoLocalize: true,
		ClipToDeviceSafeArea: true,
		DisplayOrder: 10,
		Enabled: true,
		// Was true in the place file — this gui is now CLIENT-mounted once by
		// src/client/ui/bootstrap.client.ts and must survive respawns
		// (src/client/ui/moneyPopups.client.ts parents popup labels into it).
		ResetOnSpawn: false,
		SafeAreaCompatibility: Enum.SafeAreaCompatibility.FullscreenExtension,
		ScreenInsets: Enum.ScreenInsets.CoreUISafeInsets,
		SelectionBehaviorDown: Enum.SelectionBehavior.Escape,
		SelectionBehaviorLeft: Enum.SelectionBehavior.Escape,
		SelectionBehaviorRight: Enum.SelectionBehavior.Escape,
		SelectionBehaviorUp: Enum.SelectionBehavior.Escape,
		SelectionGroup: false,
		ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
	} as never)
	);
}
