// Client UI bootstrap (client-side UI migration, Phase 1).
//
// Mounts the CLIENT-owned ScreenGuis into PlayerGui with ONE React legacy
// root portaled into PlayerGui — the same mount technique as the server's
// PlayerGuiManager (legacy root + portal), so instances exist synchronously
// the moment render() returns.
//
// Client-created ScreenGuis never replicate to the server, so the server's
// destroy-all PlayerGui loops (ResetAndInitialisePlayerMenuUI / SpawnInPlayer)
// cannot touch them; each component here sets ResetOnSpawn = false so the
// engine leaves them alone across respawns too. One ScreenGui = one owner:
// anything mounted here must NOT also be mounted by the server's
// PlayerGuiManager.
//
// Later migration phases move more components from the server tree into
// MOUNTS below.

import React from "@rbxts/react";
import ReactRoblox from "@rbxts/react-roblox";
import { TimerGui } from "shared/ui/components/TimerGui";

const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;

const playerGui = LocalPlayer.WaitForChild("PlayerGui") as Instance;

// Mount list: [stable React key, component]. The key doubles as the expected
// ScreenGui name for greppability.
const MOUNTS: Array<[string, () => React.Element]> = [
	// Phase 2: shop/kickoff/interlude countdown label (rendered by
	// src/client/ui/timer.client.ts from replicated attributes).
	["TimerGui", TimerGui],
];

// The holder is only the React root container bookkeeping object; the actual
// ScreenGuis are portaled into PlayerGui (mirrors PlayerGuiManager.mountAll).
const holder = new Instance("Folder");
holder.Name = "ClientUiRootHolder";
const root = ReactRoblox.createLegacyRoot(holder);

root.render(
	ReactRoblox.createPortal(
		React.createElement(
			React.Fragment,
			undefined,
			MOUNTS.map(([key, component]) => React.createElement(component, { key })),
		),
		playerGui,
	),
);
