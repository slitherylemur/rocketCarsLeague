// Client UI bootstrap (client-side UI migration, Phase 1; the single UI owner
// since Phase 8 demolished the server's PlayerGuiManager).
//
// Mounts EVERY ScreenGui into PlayerGui with ONE React legacy root portaled
// into PlayerGui — legacy root + portal so instances exist synchronously the
// moment render() returns (translated game code dot-accesses them).
//
// Client-created ScreenGuis never replicate to the server (which no longer
// touches PlayerGui at all); each component here sets ResetOnSpawn = false so
// the engine leaves them alone across respawns too — everything mounts
// exactly once per session and re-renders from replicated CB_*/FB_*
// attributes and the Ui_*/Intent_* remotes.

import React from "@rbxts/react";
import ReactRoblox from "@rbxts/react-roblox";
import { TimerGui } from "shared/ui/components/TimerGui";
import { MatchHudGui } from "shared/ui/components/MatchHudGui";
import { FaceOffGui } from "shared/ui/components/FaceOffGui";
import { VictoryGui } from "shared/ui/components/VictoryGui";
import { MobileInterfaceGui } from "shared/ui/components/MobileInterfaceGui";
import { PlayerMoneyGainedPopupsGui } from "shared/ui/components/PlayerMoneyGainedPopupsGui";
import { DataLossGui } from "shared/ui/components/DataLossGui";
import { LandingGui } from "shared/ui/components/LandingGui";
import { CreateTeamGui, InvitePopupGui, RenamePopupGui } from "shared/ui/components/CarBallMenusGui";
import { GarageGui } from "shared/ui/components/GarageGui";
import { CrateMenuGui } from "shared/ui/components/CrateMenuGui";
import { GameGui } from "shared/ui/components/GameGui";
import { RoundSummaryGui } from "shared/ui/components/RoundSummaryGui";
import { LadderMapGui } from "shared/ui/components/LadderMapGui";

const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;

const playerGui = LocalPlayer.WaitForChild("PlayerGui") as Instance;

// Mount list: [stable React key, component]. The key doubles as the expected
// ScreenGui name for greppability.
const MOUNTS: Array<[string, () => React.Element]> = [
	// Phase 2: shop/kickoff/interlude countdown label (rendered by
	// src/client/ui/timer.client.ts from replicated attributes).
	["TimerGui", TimerGui],
	// Phase 3: football match chrome — content rendered by
	// src/client/matchHud.client.ts from FB_*/CB_* attributes (which also
	// derives MatchHud.Enabled from the CB_PitchId player attribute).
	["MatchHud", MatchHudGui],
	["FaceOff", FaceOffGui],
	["Victory", VictoryGui],
	// Phase 3: touch driving buttons — enable/wiring fully owned by
	// src/client/VehicleKeyHandler.client.ts (mounted Enabled=false).
	["MobileInterface", MobileInterfaceGui],
	// Phase 3: empty shell filled by src/client/ui/moneyPopups.client.ts
	// from the Ui_MoneyGained remote.
	["PlayerMoneyGainedPopups", PlayerMoneyGainedPopupsGui],
	// Phase 3: Enabled derived from the CB_DataLoss player attribute by
	// src/client/ui/dataLoss.client.ts.
	["DataLoss", DataLossGui],
	// Phase 4: the menu flow — rendered by src/client/ui/menu.client.ts from
	// CB_FlowState, replicated Team state, CB_Invite and CB_RenameStatus.
	["Landing", LandingGui],
	["CreateTeam", CreateTeamGui],
	["InvitePopup", InvitePopupGui],
	["RenamePopup", RenamePopupGui],
	// Phase 5: the garage — pages/tiles rendered by src/client/ui/garage.client.ts
	// from the Ui_GetProfile snapshot + shared crate catalog; Enabled derives
	// from CB_FlowState == "garage".
	["Garage", GarageGui],
	// Phase 5: crate reveal animation gui — driven by crateAnimation.client.ts
	// from the Ui_CrateResult remote.
	["CrateMenu", CrateMenuGui],
	// Phase 6: the in-game HUD (money label, boost meter, spectate/killed-by,
	// dormant deathmatch chrome). Enabled + content derived by
	// src/client/ui/gameHud.client.ts from CB_FlowState / CB_Money / CB_Killer /
	// CB_Gamemode / CB_EndScreen; the legacy remote consumers (UiTimer,
	// spectatePlayer, infoUi, CloseToWin) stay in src/client/gameUi.client.ts.
	["Game", GameGui],
	// Phase 7: end-of-round stats columns — built by
	// src/client/ui/roundSummary.client.ts from the Ui_RoundSummary push with
	// the CB_Summary attribute as the state-shaped fallback.
	["RoundSummary", RoundSummaryGui],
	// Phase 7: ladder map / champions scene — board built and tweened by
	// src/client/ladderMap.client.ts from CB_LadderData + CB_LadderAnim (the
	// server keeps the blocking scene timeline).
	["LadderMap", LadderMapGui],
];

// The holder is only the React root container bookkeeping object; the actual
// ScreenGuis are portaled into PlayerGui.
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
