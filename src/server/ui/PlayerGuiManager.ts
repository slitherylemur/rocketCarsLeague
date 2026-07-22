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
// After mounting, template state that the original applied by MUTATING the
// StarterGui templates (roundHandler: gamemode name, team score) is applied to
// the fresh instances — equivalent to cloning the mutated template.

import React from "@rbxts/react";
import ReactRoblox from "@rbxts/react-roblox";
import { GameGui } from "shared/ui/components/GameGui";
import { GarageGui } from "shared/ui/components/GarageGui";
import { CrateMenuGui } from "shared/ui/components/CrateMenuGui";
import { LandingGui } from "shared/ui/components/LandingGui";
import { CreateTeamGui, InvitePopupGui, RenamePopupGui } from "shared/ui/components/CarBallMenusGui";
import { RoundSummaryGui } from "shared/ui/components/RoundSummaryGui";
import { LadderMapGui } from "shared/ui/components/LadderMapGui";
import { NEXT_SELECTION_WIRINGS } from "shared/ui/components/guiMetadata";
import { StarterGuiState } from "./StarterGuiState";

interface PlayerRootInfo {
	root: ReactRoblox.Root;
	holder: Folder;
}

const roots = new Map<Player, PlayerRootInfo>();

function resolvePath(base: Instance, path: string): Instance | undefined {
	let current: Instance | undefined = base;
	for (const [part] of string.gmatch(path, "[^/]+")) {
		if (current === undefined) return undefined;
		current = current.FindFirstChild(part as string);
	}
	return current;
}

function buildTree(): React.Element {
	// Order matches the original StarterGui child order (Game, Garage,
	// CrateMenu, Steer). (Multipliers retired with the timed cash-multiplier
	// products. CLIENT-mounted now — src/client/ui/bootstrap.client.ts owns:
	// TimerGui [Phase 2]; MatchHud, FaceOff, Victory, MobileInterface,
	// PlayerMoneyGainedPopups, DataLoss [Phase 3].)
	return React.createElement(
		React.Fragment,
		undefined,
		React.createElement(GameGui, { key: "Game" }),
		React.createElement(GarageGui, { key: "Garage" }),
		React.createElement(CrateMenuGui, { key: "CrateMenu" }),
		// Car Ball landing page (Top Table Phase 1).
		React.createElement(LandingGui, { key: "Landing" }),
		// Top Table Phase 2 menus.
		React.createElement(CreateTeamGui, { key: "CreateTeam" }),
		React.createElement(InvitePopupGui, { key: "InvitePopup" }),
		React.createElement(RenamePopupGui, { key: "RenamePopup" }),
		React.createElement(RoundSummaryGui, { key: "RoundSummary" }),
		// Ladder map after the victory scene + summary (Top Table Phase 4b);
		// doubles as the session-end champions screen (Phase 5).
		React.createElement(LadderMapGui, { key: "LadderMap" }),
		// Steer NumberValue — a plain (non-UI) StarterGui child, cloned along
		// with everything else in the original. Value was 0 in the place file.
		React.createElement("NumberValue", { Name: "Steer", Value: 0, key: "Steer" } as never),
	);
}

function applyTemplateState(playerGui: Instance) {
	// roundHandler mutated the StarterGui TEMPLATES; fresh clones inherited the
	// values. Apply the tracked template state to the freshly mounted instances.
	const gameGui = playerGui.FindFirstChild("Game");
	if (gameGui) {
		const information = gameGui.FindFirstChild("Information") as Frame | undefined;
		if (information) information.Visible = StarterGuiState.Game.Information.Visible;
		const gamemode = resolvePath(gameGui, "Information/Gamemode") as TextLabel | undefined;
		if (gamemode) gamemode.Text = StarterGuiState.Game.Information.GamemodeText;
		const teamScore = gameGui.FindFirstChild("TeamScore") as Frame | undefined;
		if (teamScore) {
			teamScore.Visible = StarterGuiState.Game.TeamScore.Visible;
			const red = teamScore.FindFirstChild("Red") as TextLabel | undefined;
			if (red) red.Text = StarterGuiState.Game.TeamScore.RedText;
			const blue = teamScore.FindFirstChild("Blue") as TextLabel | undefined;
			if (blue) blue.Text = StarterGuiState.Game.TeamScore.BlueText;
		}
		const leaderboard = gameGui.FindFirstChild("Leaderboard") as Frame | undefined;
		if (leaderboard) leaderboard.Visible = StarterGuiState.Game.Leaderboard.Visible;
	}
}

function applyNextSelectionWirings(playerGui: Instance) {
	for (const [sourcePath, propName, targetPath] of NEXT_SELECTION_WIRINGS) {
		const source = resolvePath(playerGui, sourcePath);
		const target = resolvePath(playerGui, targetPath);
		if (source && target) {
			(source as unknown as Record<string, unknown>)[propName] = target;
		}
	}
}

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

		applyTemplateState(playerGui);
		applyNextSelectionWirings(playerGui);
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
