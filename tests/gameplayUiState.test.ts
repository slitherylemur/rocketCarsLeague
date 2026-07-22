// Menu/gameplay UI authority regression tests.

/* eslint-disable */
declare const check: (condition: boolean, label: string) => void;

import {
	isGameplayUiActive,
	isGarageFlowActive,
	LOCAL_CRATE_REVEAL_ATTR,
	shouldShowGarage,
} from "shared/ui/gameplayUiState";

function playerWith(attributes: Record<string, unknown>): Player {
	return {
		GetAttribute: (name: string) => attributes[name],
	} as unknown as Player;
}

{
	const player = playerWith({ CB_FlowState: "garage" });
	check(isGarageFlowActive(player), "garage flow is active outside a pitch");
	check(shouldShowGarage(player), "garage is visible in ordinary garage flow");
}

{
	const player = playerWith({ CB_FlowState: "garage", [LOCAL_CRATE_REVEAL_ATTR]: true });
	check(!shouldShowGarage(player), "crate reveal suppresses the underlying garage");
}

{
	const player = playerWith({ CB_FlowState: "garage", CB_PitchId: "Pitch1" });
	check(isGameplayUiActive(player), "pitch assignment is a hard gameplay signal");
	check(!isGarageFlowActive(player), "pitch assignment vetoes a stale garage state");
	check(!shouldShowGarage(player), "garage cannot overlay an assigned pitch");
}

check(isGameplayUiActive(playerWith({ CB_FlowState: "spawning" })), "spawning suppresses menu-only UI");
check(isGameplayUiActive(playerWith({ CB_FlowState: "match" })), "match suppresses menu-only UI");
check(!isGameplayUiActive(playerWith({ CB_FlowState: "menu" })), "landing menu is not gameplay");
check(!isGameplayUiActive(playerWith({ CB_FlowState: "lobby" })), "team lobby is not gameplay");
check(!isGameplayUiActive(playerWith({ CB_FlowState: "garage" })), "garage flow is not gameplay");
check(isGameplayUiActive(playerWith({ CB_FlowState: "spectating" })), "future non-menu states fail closed");
