// GENERATED metadata for PlayerGuiManager (from the original place file).

// NextSelection* gamepad-navigation references that existed inside the
// original StarterGui tree. React cannot express instance references
// declaratively; PlayerGuiManager wires these after each mount.
// Paths are relative to PlayerGui, '/'-separated.
export const NEXT_SELECTION_WIRINGS: Array<[string, string, string]> = [
	["Garage/Inventory/Codes/TextBox", "NextSelectionLeft", "Garage/Shop/Purchases/Nuke"],
	["Garage/Shop/Crates", "NextSelectionRight", "Garage/Shop/Multipliers"],
	["Garage/Shop/Crates/Normal/1", "NextSelectionRight", "Garage/Shop/Multipliers/first2x/buy"],
	["Garage/Shop/Crates/Normal/2", "NextSelectionRight", "Garage/Shop/Multipliers/first2x/buy"],
	["Garage/Shop/Crates/Normal/3", "NextSelectionDown", "Garage/Shop/Purchases/VIP"],
	["Garage/Shop/Crates/Normal/3", "NextSelectionRight", "Garage/Shop/Multipliers/first2x/buy"],
	["Garage/Shop/Multipliers", "NextSelectionDown", "Garage/Shop/Purchases"],
	["Garage/Shop/Multipliers/first2x/buy", "NextSelectionDown", "Garage/Shop/Purchases/VIP"],
	["Garage/Shop/Multipliers/onePoint5/buy", "NextSelectionDown", "Garage/Shop/Purchases/VIP"],
	["Garage/Shop/Multipliers/second2x/buy", "NextSelectionDown", "Garage/Shop/Purchases/VIP"],
	["Garage/Shop/Multipliers/threeTimes/buy", "NextSelectionDown", "Garage/Shop/Purchases/VIP"],
	["Garage/Shop/Multipliers/threeTimes/buy", "NextSelectionRight", "Garage/Shop/Purchases/VIP"],
	["Garage/Shop/Purchases", "NextSelectionDown", "Garage/Inventory/Codes"],
	["Garage/Shop/Purchases/VIP", "NextSelectionDown", "Garage/Inventory/Codes/TextBox"],
	["Garage/Shop/Purchases/VIP", "NextSelectionLeft", "Garage/Shop/Multipliers/threeTimes/buy"],
	["Garage/Shop/Purchases/VIP", "NextSelectionRight", "Garage/Shop/Purchases/LowGravity"],
	["Garage/Shop/Purchases/LowGravity", "NextSelectionDown", "Garage/Inventory/Codes/TextBox"],
	["Garage/Shop/Purchases/LowGravity", "NextSelectionLeft", "Garage/Shop/Purchases/VIP"],
	["Garage/Shop/Purchases/LowGravity", "NextSelectionRight", "Garage/Shop/Purchases/Nuke"],
	["Garage/Shop/Purchases/Nuke", "NextSelectionDown", "Garage/Inventory/Codes/TextBox"],
	["Garage/Shop/Purchases/Nuke", "NextSelectionLeft", "Garage/Shop/Purchases/LowGravity"],
	["Garage/Shop/Purchases/Nuke", "NextSelectionRight", "Garage/Inventory/Codes/TextBox"],
];

// ResetOnSpawn per original ScreenGui — drives remount-on-respawn behaviour.
export const SCREEN_GUI_RESET_ON_SPAWN = new Map<string, boolean>([
	["Game", true],
	["MobileInterface", true],
	["Garage", true],
	["CrateMenu", true],
	["Multipliers", true],
	["TimerGui", true],
	["PlayerMoneyGainedPopups", true],
	["DataLoss", true],
]);
