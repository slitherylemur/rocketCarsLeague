// UiState — the server's single doorway for publishing UI state to clients as
// attributes (client-side UI migration, Phase 1 scaffolding).
//
// Client UI renders FROM replicated state instead of the server mutating
// PlayerGui instances: per-player state lives as attributes on the Player,
// global state as attributes on ReplicatedStorage (both replicate to every
// client automatically). Funnelling every write through this module keeps the
// attribute names greppable and the ownership story clear.

const ReplicatedStorage = game.GetService("ReplicatedStorage");

/** High-level UI flow the player is in (CB_FlowState player attribute). */
export type FlowState = "menu" | "lobby" | "garage" | "spawning" | "match";

export const UiState = {
	/** Publishes the player's high-level UI flow (CB_FlowState attribute). */
	setFlowState(player: Player, state: FlowState) {
		player.SetAttribute("CB_FlowState", state);
	},

	/** Publishes a per-player UI attribute (pass undefined to clear). */
	setPlayerAttr(player: Player, name: string, value: AttributeValue | undefined) {
		player.SetAttribute(name, value);
	},

	/** Publishes a global UI attribute on ReplicatedStorage (undefined clears). */
	setReplicatedAttr(name: string, value: AttributeValue | undefined) {
		ReplicatedStorage.SetAttribute(name, value);
	},
};

export default UiState;
