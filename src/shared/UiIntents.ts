// UiIntents — typed accessor for the runtime-created ReplicatedStorage.UiIntents
// folder (client-side UI migration, Phase 1 scaffolding).
//
// The server creates the folder and every remote at startup
// (src/server/ui/UiIntents.server.ts); this module is the shared name registry
// plus the CLIENT-side WaitForChild-based accessor — same runtime-remotes
// pattern as ReplicatedStorage.CarBall (see src/server/Modules/TeamRegistry.ts).
//
// Naming convention:
//   * Intent_* — client → server RemoteEvents ("the player pressed X").
//   * Ui_*     — server → client RemoteEvents (pushed UI payloads) and the
//                Ui_GetProfile RemoteFunction (client-invoked profile snapshot).
//
// The migration is complete (Phase 8): every remote listed here has exactly
// one server side and one client side — keep it that way when adding names.

const ReplicatedStorage = game.GetService("ReplicatedStorage");

export const UI_INTENTS_FOLDER_NAME = "UiIntents";

/** Client → server intent RemoteEvents. */
export const UI_INTENT_EVENT_NAMES = [
	"Intent_PlayRandom",
	"Intent_CreateTeam",
	"Intent_OpenGarage",
	"Intent_ExitToLanding",
	"Intent_ReadyVote",
	"Intent_LeaveTeam",
	"Intent_SetTeamOpen",
	"Intent_InvitePlayer",
	"Intent_ResolveInvite",
	"Intent_RequestRename",
	"Intent_ReturnToMenu",
	"Intent_EquipVehicle",
	"Intent_EquipColor",
	"Intent_EquipHorn",
	"Intent_EquipTrail",
	"Intent_UnlockVehicle",
	"Intent_PreviewVehicle",
	"Intent_OpenCrate",
	"Intent_ViewCrate",
] as const;
export type UiIntentEventName = (typeof UI_INTENT_EVENT_NAMES)[number];

/** Server → client push RemoteEvents. */
export const UI_PUSH_EVENT_NAMES = ["Ui_MoneyGained", "Ui_CrateResult", "Ui_RoundSummary"] as const;
export type UiPushEventName = (typeof UI_PUSH_EVENT_NAMES)[number];

/** Client-invoked RemoteFunctions. */
export const UI_FUNCTION_NAMES = ["Ui_GetProfile"] as const;
export type UiFunctionName = (typeof UI_FUNCTION_NAMES)[number];

/**
 * Runtime-replicated sound templates for client-rendered UI (Phase 3): the
 * money-popup sounds live in ServerStorage.Sounds in the place file, which the
 * client cannot read — UiIntents.server.ts clones them into this folder (under
 * UiIntents) at startup so moneyPopups.client.ts can play the exact same
 * assets locally.
 */
export const UI_SOUNDS_FOLDER_NAME = "UiSounds";
export const UI_SOUND_NAMES = ["cashSmall", "cashBig", "killCoins1", "killCoins2"] as const;
export type UiSoundName = (typeof UI_SOUND_NAMES)[number];

/** Waits for the server-created UiIntents folder (client-safe). */
export function getUiIntentsFolder(): Folder {
	return ReplicatedStorage.WaitForChild(UI_INTENTS_FOLDER_NAME) as Folder;
}

/** Waits for the server-replicated UI sound templates folder (client-safe). */
export function getUiSoundsFolder(): Folder {
	return getUiIntentsFolder().WaitForChild(UI_SOUNDS_FOLDER_NAME) as Folder;
}

/** Waits for one of the UiIntents RemoteEvents by (typed) name. */
export function getUiIntentEvent(name: UiIntentEventName | UiPushEventName): RemoteEvent {
	return getUiIntentsFolder().WaitForChild(name) as RemoteEvent;
}

/** Waits for one of the UiIntents RemoteFunctions by (typed) name. */
export function getUiIntentFunction(name: UiFunctionName): RemoteFunction {
	return getUiIntentsFolder().WaitForChild(name) as RemoteFunction;
}
