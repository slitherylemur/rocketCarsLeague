// PlayerGuiManager — reproduces the original game's PlayerGui lifecycle with
// server-rendered React in place of StarterGui template cloning.
//
// Original lifecycle being reproduced:
//   * on PlayerAdded: initializePlayer manually cloned every StarterGui child
//     into PlayerGui (CharacterAutoLoads is false, so the engine hadn't).
//   * ResetAndInitialisePlayerMenuUI: destroyed ALL PlayerGui children, then
//     manually re-cloned every StarterGui child.
//   * SpawnInPlayer: destroyed ALL PlayerGui children, then player:LoadCharacter()
//     — the ENGINE then re-cloned StarterGui into PlayerGui (all these ScreenGuis
//     have ResetOnSpawn = true).
//
// mountAll() = "clone every StarterGui child" (every SERVER-owned ScreenGui +
// the Steer NumberValue — the client-owned ScreenGuis listed in buildTree's
// comment are mounted once by src/client/ui/bootstrap.client.ts instead).
// destroyAll() = the destroy-all loops (React roots are unmounted
// rather than Destroy()ed so the reconciler stays consistent; any non-React
// leftovers in PlayerGui — e.g. sounds parented there by the money popups — are
// destroyed exactly like the original loop did).
//
// A synchronous legacy root is used so instances exist the moment mountAll
// returns — the translated game code dot-accesses them immediately, exactly as
// it did after :Clone().
//
// (The old applyTemplateState/StarterGuiState step retired with the Game gui in
// Phase 6: the only template mutations were Game chrome, which the client now
// derives from the CB_Gamemode replicated attribute in gameHud.client.ts.)

import React from "@rbxts/react";
import ReactRoblox from "@rbxts/react-roblox";
import { RoundSummaryGui } from "shared/ui/components/RoundSummaryGui";
import { LadderMapGui } from "shared/ui/components/LadderMapGui";

interface PlayerRootInfo {
	root: ReactRoblox.Root;
	holder: Folder;
}

const roots = new Map<Player, PlayerRootInfo>();

function buildTree(): React.Element {
	// (Multipliers retired with the timed cash-multiplier products.
	// CLIENT-mounted now — src/client/ui/bootstrap.client.ts owns: TimerGui
	// [Phase 2]; MatchHud, FaceOff, Victory, MobileInterface,
	// PlayerMoneyGainedPopups, DataLoss [Phase 3]; Landing, CreateTeam,
	// InvitePopup, RenamePopup [Phase 4 — rendered by
	// src/client/ui/menu.client.ts from CB_FlowState & friends]; Garage,
	// CrateMenu [Phase 5 — rendered by src/client/ui/garage.client.ts +
	// crateAnimation.client.ts from the Ui_GetProfile snapshot & friends];
	// Game [Phase 6 — src/client/ui/gameHud.client.ts + gameUi.client.ts].)
	return React.createElement(
		React.Fragment,
		undefined,
		React.createElement(RoundSummaryGui, { key: "RoundSummary" }),
		// Ladder map after the victory scene + summary (Top Table Phase 4b);
		// doubles as the session-end champions screen (Phase 5).
		React.createElement(LadderMapGui, { key: "LadderMap" }),
		// Steer NumberValue — a plain (non-UI) StarterGui child, cloned along
		// with everything else in the original. Value was 0 in the place file.
		React.createElement("NumberValue", { Name: "Steer", Value: 0, key: "Steer" } as never),
	);
}

// (applyNextSelectionWirings removed in Phase 5, applyTemplateState in Phase 6
// — every remaining template mutation targeted the now client-owned Game gui.)

export const PlayerGuiManager = {
	/** Equivalent of the original "clone every StarterGui child into PlayerGui". */
	mountAll(player: Player) {
		const playerGui = player.WaitForChild("PlayerGui") as Instance;

		PlayerGuiManager.unmountAll(player);

		// The holder is only the React root container bookkeeping object; the
		// actual ScreenGuis are portaled into PlayerGui.
		const holder = new Instance("Folder");
		holder.Name = "ReactRootHolder";
		const root = ReactRoblox.createLegacyRoot(holder);
		roots.set(player, { root: root, holder: holder });

		root.render(ReactRoblox.createPortal(buildTree(), playerGui));
	},

	/** Unmount the React-owned UI without touching other PlayerGui children. */
	unmountAll(player: Player) {
		const info = roots.get(player);
		if (info) {
			info.root.unmount();
			info.holder.Destroy();
			roots.delete(player);
		}
	},

	/**
	 * Equivalent of the original destroy-all loop:
	 *   for i,v in pairs(player.PlayerGui:GetChildren()) do v:Destroy() end
	 * React-owned guis are unmounted (removing them); everything else that ended
	 * up in PlayerGui (sounds, TouchGui won't be visible server-side) is
	 * destroyed exactly like the original loop.
	 */
	destroyAll(player: Player) {
		PlayerGuiManager.unmountAll(player);
		const playerGui = player.FindFirstChild("PlayerGui");
		if (playerGui) {
			for (const v of playerGui.GetChildren()) {
				v.Destroy();
			}
		}
	},
};
