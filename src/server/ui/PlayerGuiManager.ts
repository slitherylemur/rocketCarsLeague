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
// Phase 7: the server-owned tree is EMPTY — every ScreenGui is client-mounted
// now (see buildTree's comment), so mountAll renders nothing and destroyAll's
// React half is a no-op. The module survives until the Phase 8 demolition
// because the lifecycle CALLS still run (initializePlayer / SpawnInPlayer /
// ResetAndInitialisePlayerMenuUI), and destroyAll's non-React sweep is still
// the original "destroy every PlayerGui child" loop — client-created guis
// never replicate to the server, so it only ever sees genuinely server-side
// strays (the client-owned UI is untouchable from here by construction).
//
// mountAll() = "clone every StarterGui child" — an empty set since Phase 7.
// destroyAll() = the destroy-all loops.
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

interface PlayerRootInfo {
	root: ReactRoblox.Root;
	holder: Folder;
}

const roots = new Map<Player, PlayerRootInfo>();

function buildTree(): React.Element {
	// EMPTY since Phase 7. (Multipliers retired with the timed cash-multiplier
	// products. CLIENT-mounted now — src/client/ui/bootstrap.client.ts owns:
	// TimerGui [Phase 2]; MatchHud, FaceOff, Victory, MobileInterface,
	// PlayerMoneyGainedPopups, DataLoss [Phase 3]; Landing, CreateTeam,
	// InvitePopup, RenamePopup [Phase 4 — rendered by
	// src/client/ui/menu.client.ts from CB_FlowState & friends]; Garage,
	// CrateMenu [Phase 5 — rendered by src/client/ui/garage.client.ts +
	// crateAnimation.client.ts from the Ui_GetProfile snapshot & friends];
	// Game [Phase 6 — src/client/ui/gameHud.client.ts + gameUi.client.ts];
	// RoundSummary, LadderMap [Phase 7 — roundSummary.client.ts /
	// ladderMap.client.ts from Ui_RoundSummary+CB_Summary / CB_LadderData].
	// The old Steer NumberValue StarterGui child is dropped too: zero
	// consumers anywhere — the sim's Steer is a vehicle attribute.)
	return React.createElement(React.Fragment, undefined);
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
