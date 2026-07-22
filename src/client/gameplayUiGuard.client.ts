// Last-line client invariant for menu-only ScreenGuis.
//
// Individual UI controllers still own normal visibility. This guard only acts
// once gameplay has begun, correcting any late async callback or remote that
// attempts to re-enable a menu layer over the match.

import { isGameplayUiActive } from "shared/ui/gameplayUiState";

const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;
const playerGui = LocalPlayer.WaitForChild("PlayerGui");

const MENU_ONLY_SCREENS = new Set([
	"Garage",
	"CrateMenu",
	"Landing",
	"CreateTeam",
	"InvitePopup",
	"RenamePopup",
	"LootboxRestrictedPopup",
]);

const watched = new Map<ScreenGui, RBXScriptConnection>();

function enforceScreen(screen: ScreenGui) {
	if (isGameplayUiActive(LocalPlayer) && screen.Enabled) {
		screen.Enabled = false;
	}
}

function enforceAll() {
	if (!isGameplayUiActive(LocalPlayer)) {
		return;
	}
	for (const child of playerGui.GetChildren()) {
		if (child.IsA("ScreenGui") && MENU_ONLY_SCREENS.has(child.Name)) {
			enforceScreen(child);
		}
	}
}

function watch(instance: Instance) {
	if (!instance.IsA("ScreenGui") || !MENU_ONLY_SCREENS.has(instance.Name) || watched.has(instance)) {
		return;
	}
	const connection = instance.GetPropertyChangedSignal("Enabled").Connect(() => enforceScreen(instance));
	watched.set(instance, connection);
	instance.Destroying.Connect(() => {
		watched.get(instance)?.Disconnect();
		watched.delete(instance);
	});
	enforceScreen(instance);
}

for (const child of playerGui.GetChildren()) {
	watch(child);
}
playerGui.ChildAdded.Connect((child) => {
	watch(child);
	task.defer(enforceAll);
});
LocalPlayer.GetAttributeChangedSignal("CB_FlowState").Connect(enforceAll);
LocalPlayer.GetAttributeChangedSignal("CB_PitchId").Connect(enforceAll);

enforceAll();
