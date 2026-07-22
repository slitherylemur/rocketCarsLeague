// GENERATED metadata (from the original place file's StarterGui tree).
// Client-only since Phase 8 (garage.client.ts is the single consumer; the
// server never touches gui metadata anymore).

// NextSelection* gamepad-navigation references that existed inside the
// original StarterGui tree. React cannot express instance references
// declaratively. Every entry lives inside the Garage, which is CLIENT-owned
// since Phase 5 — src/client/ui/garage.client.ts applies these after its
// mount. Paths are relative to PlayerGui, '/'-separated.
//
// (SCREEN_GUI_RESET_ON_SPAWN was dropped in Phase 8: every ScreenGui is
// client-mounted once with ResetOnSpawn=false, so the map had no consumers.)
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
