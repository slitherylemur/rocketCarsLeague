// Typed access to the pre-existing remote instances in
// ReplicatedStorage.FunctionsAndEvents (these are instances in the place file,
// not created by code — except GeneralUtilFunc, created by ConnectClientFunction,
// and MenuCameraReady, created by initializePlayer; access those via
// FindFirstChild/WaitForChild, not the typed dot-access below).

interface FunctionsAndEventsFolder extends Folder {
	KeyHandler: RemoteEvent;
	PartToCamera: RemoteEvent;
	CreateClientSidedCar: RemoteEvent;
	ToggleMenuCamera: RemoteEvent;
	SetMenuCameraCFrame: RemoteEvent;
	UiTimer: RemoteEvent;
	EndScreen: RemoteEvent;
	spectatePlayer: RemoteEvent;
	infoUi: RemoteEvent;
	ShowCrateAnimationEvent: RemoteFunction;
	Throttle: RemoteEvent;
	SteerFloat: RemoteEvent;
	GamePadButtonXDown: RemoteEvent;
	GamePadButtonYDown: RemoteEvent;
	GamePadButtonR2Down: RemoteEvent;
	GamePadButtonBDown: RemoteEvent;
	GamePadButtonR1Down: RemoteEvent;
	GamePadButtonL1Down: RemoteEvent;
	GetKeyBinding: RemoteFunction;
	SetKeyBinding: RemoteFunction;
	GetPlayerPointToScreenSpace: RemoteFunction;
	CloseToWin: RemoteEvent;
	PlayerReset: RemoteEvent;
	DriveVehicle: RemoteEvent;
	UpdateBoostEffect: RemoteEvent;
	UpdateDriftEffect: RemoteEvent;
}

const ReplicatedStorage = game.GetService("ReplicatedStorage");

// Direct index (not WaitForChild): the original scripts used
// `game.ReplicatedStorage.FunctionsAndEvents` dot-access, which errors when
// missing — FindFirstChild-free indexing preserves that.
export const FunctionsAndEvents = (ReplicatedStorage as unknown as { FunctionsAndEvents: FunctionsAndEventsFolder })
	.FunctionsAndEvents;
