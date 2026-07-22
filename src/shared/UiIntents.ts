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
// Most of these remotes are wired in LATER migration phases — they are defined
// now so the folder shape is final and both sides can adopt them incrementally.

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

/** Waits for the server-created UiIntents folder (client-safe). */
export function getUiIntentsFolder(): Folder {
	return ReplicatedStorage.WaitForChild(UI_INTENTS_FOLDER_NAME) as Folder;
}

/** Waits for one of the UiIntents RemoteEvents by (typed) name. */
export function getUiIntentEvent(name: UiIntentEventName | UiPushEventName): RemoteEvent {
	return getUiIntentsFolder().WaitForChild(name) as RemoteEvent;
}

/** Waits for one of the UiIntents RemoteFunctions by (typed) name. */
export function getUiIntentFunction(name: UiFunctionName): RemoteFunction {
	return getUiIntentsFolder().WaitForChild(name) as RemoteFunction;
}
