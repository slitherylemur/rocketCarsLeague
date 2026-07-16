//!strict (original directive)
/*
	PlayerModule - This module requires and instantiates the camera and control modules,
	and provides getters for developers to access methods on these singletons without
	having to modify Roblox-supplied scripts.

	2018 PlayerScripts Update - AllYourBlox
*/

import cameras from "./CameraModule";
import controls from "./ControlModule";

class PlayerModule {
	cameras: typeof cameras;
	controls: typeof controls;

	constructor() {
		// Original: require(script:WaitForChild("CameraModule")) /
		// require(script:WaitForChild("ControlModule")) — static imports of the
		// compiled siblings are equivalent.
		this.cameras = cameras;
		this.controls = controls;
	}

	GetCameras() {
		return this.cameras;
	}

	GetControls() {
		return this.controls;
	}

	GetClickToMoveController() {
		return (this.controls as unknown as { GetClickToMoveController(): unknown }).GetClickToMoveController();
	}
}

export = new PlayerModule();
