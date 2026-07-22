// Typed access to the pre-existing remote instances in
// ReplicatedStorage.FunctionsAndEvents (these are instances in the place file,
// not created by code — except GeneralUtilFunc, created by ConnectClientFunction,
// and MenuCameraReady, created by initializePlayer; access those via
// FindFirstChild/WaitForChild, not the typed dot-access below).

// Phase 8 demolition pruned the typed entries whose remotes no longer have any
// code-side fire or consumer (the place-file instances themselves remain,
// harmlessly unused): ShowCrateAnimationEvent, GetPlayerPointToScreenSpace,
// the six GamePadButton*Down events, Throttle, SteerFloat, PartToCamera,
// DriveVehicle, UpdateBoostEffect and UpdateDriftEffect.
interface FunctionsAndEventsFolder extends Folder {
	KeyHandler: RemoteEvent;
	CreateClientSidedCar: RemoteEvent;
	ToggleMenuCamera: RemoteEvent;
	SetMenuCameraCFrame: RemoteEvent;
	UiTimer: RemoteEvent;
	EndScreen: RemoteEvent;
	spectatePlayer: RemoteEvent;
	infoUi: RemoteEvent;
	GetKeyBinding: RemoteFunction;
	SetKeyBinding: RemoteFunction;
	CloseToWin: RemoteEvent;
	PlayerReset: RemoteEvent;
}

const ReplicatedStorage = game.GetService("ReplicatedStorage");

// Direct index (not WaitForChild): the original scripts used
// `game.ReplicatedStorage.FunctionsAndEvents` dot-access, which errors when
// missing — FindFirstChild-free indexing preserves that.
export const FunctionsAndEvents = (ReplicatedStorage as unknown as { FunctionsAndEvents: FunctionsAndEventsFolder })
	.FunctionsAndEvents;
