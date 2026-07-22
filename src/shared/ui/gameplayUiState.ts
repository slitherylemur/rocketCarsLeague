// Shared client-side authority rules for menu-only UI.
//
// CB_FlowState is the normal router. CB_PitchId is an independent, harder
// gameplay signal that prevents a delayed/stale menu state from painting over
// an already rostered player.

export const LOCAL_CRATE_REVEAL_ATTR = "CB_LocalCrateReveal";

export function isGameplayUiActive(player: Player): boolean {
	if (typeIs(player.GetAttribute("CB_PitchId"), "string")) {
		return true;
	}
	const state = player.GetAttribute("CB_FlowState");
	return typeIs(state, "string") && state !== "menu" && state !== "lobby" && state !== "garage";
}

export function isGarageFlowActive(player: Player): boolean {
	return player.GetAttribute("CB_FlowState") === "garage" && !typeIs(player.GetAttribute("CB_PitchId"), "string");
}

export function shouldShowGarage(player: Player): boolean {
	return isGarageFlowActive(player) && player.GetAttribute(LOCAL_CRATE_REVEAL_ATTR) !== true;
}
