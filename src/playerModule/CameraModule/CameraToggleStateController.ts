// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/CameraToggleStateController (ModuleScript)

//!strict

import CameraInputModule from "./CameraInput";
import CameraUIModule from "./CameraUI";
import CameraUtilsModule from "./CameraUtils";

const Input = CameraInputModule;
const CameraUI = CameraUIModule;
// Note: the original only requires CameraUtils when one of the two flags below is set (it is
// otherwise left nil, and never referenced). Requiring it unconditionally here is behaviorally
// identical since module require has no side effects and all uses of CameraUtils below remain
// guarded by the same flags as the original.
const CameraUtils = CameraUtilsModule;

const Players = game.GetService("Players");
const UserInputService = game.GetService("UserInputService");
const GameSettings = UserSettings().GetService("UserGameSettings");

let FFlagUserCameraToggleDontSetMouseIconEveryFrame: boolean;
{
	const [success, value] = pcall(() => UserSettings().IsUserFeatureEnabled("UserCameraToggleDontSetMouseIconEveryFrame"));
	FFlagUserCameraToggleDontSetMouseIconEveryFrame = success && (value as boolean);
}

let FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame: boolean;
{
	const [success, value] = pcall(() =>
		UserSettings().IsUserFeatureEnabled("UserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame"),
	);
	FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame = success && (value as boolean);
}

let Mouse: PlayerMouse | undefined;
if (!FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
	let LocalPlayer = Players.LocalPlayer;
	if (!LocalPlayer) {
		Players.GetPropertyChangedSignal("LocalPlayer").Wait();
		LocalPlayer = Players.LocalPlayer;
	}

	Mouse = LocalPlayer.GetMouse();
}

let lastTogglePan = false;
let lastTogglePanChange = tick();

const CROSS_MOUSE_ICON = "rbxasset://textures/Cursors/CrossMouseIcon.png";

let lockStateDirty = false;
let wasTogglePanOnTheLastTimeYouWentIntoFirstPerson = false;
let lastFirstPerson = false;

CameraUI.setCameraModeToastEnabled(false);

export = (isFirstPerson: boolean): void => {
	const togglePan = Input.getTogglePan();
	const toastTimeout = 3;

	if (isFirstPerson && togglePan !== lastTogglePan) {
		lockStateDirty = true;
	}

	if (lastTogglePan !== togglePan || tick() - lastTogglePanChange > toastTimeout) {
		const doShow = togglePan && tick() - lastTogglePanChange < toastTimeout;

		CameraUI.setCameraModeToastOpen(doShow);

		if (togglePan) {
			lockStateDirty = false;
		}
		lastTogglePanChange = tick();
		lastTogglePan = togglePan;
	}

	if (isFirstPerson !== lastFirstPerson) {
		if (isFirstPerson) {
			wasTogglePanOnTheLastTimeYouWentIntoFirstPerson = Input.getTogglePan();
			Input.setTogglePan(true);
		} else if (!lockStateDirty) {
			Input.setTogglePan(wasTogglePanOnTheLastTimeYouWentIntoFirstPerson);
		}
	}

	if (isFirstPerson) {
		if (Input.getTogglePan()) {
			if (FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
				CameraUtils.setMouseIconOverride(CROSS_MOUSE_ICON);
			} else {
				Mouse!.Icon = CROSS_MOUSE_ICON;
			}
			if (FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame) {
				CameraUtils.setMouseBehaviorOverride(Enum.MouseBehavior.LockCenter);
				CameraUtils.setRotationTypeOverride(Enum.RotationType.CameraRelative);
			} else {
				UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter;
				GameSettings.RotationType = Enum.RotationType.CameraRelative;
			}
		} else {
			if (FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
				CameraUtils.restoreMouseIcon();
			} else {
				Mouse!.Icon = "";
			}
			if (FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame) {
				CameraUtils.restoreMouseBehavior();
				CameraUtils.setRotationTypeOverride(Enum.RotationType.CameraRelative);
			} else {
				UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
				GameSettings.RotationType = Enum.RotationType.CameraRelative;
			}
		}
	} else if (Input.getTogglePan()) {
		if (FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
			CameraUtils.setMouseIconOverride(CROSS_MOUSE_ICON);
		} else {
			Mouse!.Icon = CROSS_MOUSE_ICON;
		}
		if (FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame) {
			CameraUtils.setMouseBehaviorOverride(Enum.MouseBehavior.LockCenter);
			CameraUtils.setRotationTypeOverride(Enum.RotationType.MovementRelative);
		} else {
			UserInputService.MouseBehavior = Enum.MouseBehavior.LockCenter;
			GameSettings.RotationType = Enum.RotationType.MovementRelative;
		}
	} else if (Input.getHoldPan()) {
		if (FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
			CameraUtils.restoreMouseIcon();
		} else {
			Mouse!.Icon = "";
		}
		if (FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame) {
			CameraUtils.setMouseBehaviorOverride(Enum.MouseBehavior.LockCurrentPosition);
			CameraUtils.setRotationTypeOverride(Enum.RotationType.MovementRelative);
		} else {
			UserInputService.MouseBehavior = Enum.MouseBehavior.LockCurrentPosition;
			GameSettings.RotationType = Enum.RotationType.MovementRelative;
		}
	} else {
		if (FFlagUserCameraToggleDontSetMouseIconEveryFrame) {
			CameraUtils.restoreMouseIcon();
		} else {
			Mouse!.Icon = "";
		}
		if (FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame) {
			CameraUtils.restoreMouseBehavior();
			CameraUtils.restoreRotationType();
		} else {
			UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
			GameSettings.RotationType = Enum.RotationType.MovementRelative;
		}
	}

	lastFirstPerson = isFirstPerson;
};
