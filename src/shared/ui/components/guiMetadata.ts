// GENERATED metadata for PlayerGuiManager (from the original place file).

// NextSelection* gamepad-navigation references that existed inside the
// original StarterGui tree. React cannot express instance references
// declaratively. Every entry lives inside the Garage, which is CLIENT-owned
// since Phase 5 — src/client/ui/garage.client.ts applies these after its
// mount (PlayerGuiManager no longer does).
// Paths are relative to PlayerGui, '/'-separated.
export const NEXT_SELECTION_WIRINGS: Array<[string, string, string]> = [
	// (Multipliers panel removed; Nuke + Low Gravity products removed. Layout
	// is now Purchases (VIP only) on the LEFT, Crates on the RIGHT.)
	["Garage/Inventory/Codes/TextBox", "NextSelectionLeft", "Garage/Shop/Purchases/VIP"],
	["Garage/Shop/Crates", "NextSelectionLeft", "Garage/Shop/Purchases"],
	["Garage/Shop/Crates/Normal/1", "NextSelectionLeft", "Garage/Shop/Purchases/VIP"],
	["Garage/Shop/Purchases", "NextSelectionDown", "Garage/Inventory/Codes"],
	["Garage/Shop/Purchases/VIP", "NextSelectionDown", "Garage/Inventory/Codes/TextBox"],
	["Garage/Shop/Purchases/VIP", "NextSelectionRight", "Garage/Shop/Crates/Normal/1"],
];

// ResetOnSpawn per original ScreenGui — drives remount-on-respawn behaviour.
export const SCREEN_GUI_RESET_ON_SPAWN = new Map<string, boolean>([
	["Game", true],
	["MobileInterface", true],
	// Garage/CrateMenu: client-mounted with ResetOnSpawn=false since Phase 5
	// (see src/client/ui/bootstrap.client.ts) — no longer in the server tree.
	// TimerGui: client-mounted with ResetOnSpawn=false (see
	// src/client/ui/bootstrap.client.ts) — no longer in the server tree.
	["PlayerMoneyGainedPopups", true],
	["DataLoss", true],
]);
