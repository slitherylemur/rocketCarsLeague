// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/BaseCharacterController (ModuleScript)
//
// BaseCharacterController - Abstract base class for character controllers, not intended to be
// directly instantiated.
//
// 2018 PlayerScripts Update - AllYourBlox

//!strict

const ZERO_VECTOR3: Vector3 = new Vector3(0, 0, 0);

// The Module
class BaseCharacterController {
	enabled = false;
	moveVector: Vector3 = ZERO_VECTOR3;
	moveVectorIsCameraRelative = true;
	isJumping = false;

	OnRenderStepped(dt: number): void {
		// By default, nothing to do
	}

	GetMoveVector(): Vector3 {
		return this.moveVector;
	}

	IsMoveVectorCameraRelative(): boolean {
		return this.moveVectorIsCameraRelative;
	}

	GetIsJumping(): boolean {
		return this.isJumping;
	}

	// Override in derived classes to set self.enabled and return boolean indicating
	// whether Enable/Disable was successful. Return true if controller is already in the requested state.
	//
	// Typed with a trailing `...args` rest parameter (absent from the original Lua signature)
	// solely so that derived controllers matching the original's varying call patterns (e.g.
	// ClickToMove's Enable(enable, userChoice, touchJumpController) or the touch controllers'
	// Enable(enable, uiParentFrame)) remain valid TypeScript overrides of this base method;
	// this does not change runtime behavior since the original Lua base was never called
	// directly (see the error() below) and derived classes always define their own Enable body.
	Enable(enable: boolean, ...args: unknown[]): boolean {
		error("BaseCharacterController:Enable must be overridden in derived classes and should not be called.");
		return false;
	}
}

export = BaseCharacterController;
