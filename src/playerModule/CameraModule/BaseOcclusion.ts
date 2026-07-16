// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/BaseOcclusion (ModuleScript)
//
// BaseOcclusion - Abstract base class for character occlusion control modules
// 2018 Camera Update - AllYourBlox

/* [ The Module ] */
class BaseOcclusion {
	constructor() {}

	// Called when character is added
	CharacterAdded(char: Model, player: Player): void {}

	// Called when character is about to be removed
	CharacterRemoving(char: Model, player: Player): void {}

	OnCameraSubjectChanged(newSubject: unknown): void {}

	/* [ Derived classes are required to override and implement all of the following functions ] */
	GetOcclusionMode(): Enum.DevCameraOcclusionMode | undefined {
		// Must be overridden in derived classes to return an Enum.DevCameraOcclusionMode value
		warn("BaseOcclusion GetOcclusionMode must be overridden by derived classes");
		return undefined;
	}

	Enable(enabled: boolean): void {
		warn("BaseOcclusion Enable must be overridden by derived classes");
	}

	Update(dt: number, desiredCameraCFrame: CFrame, desiredCameraFocus: CFrame): LuaTuple<[CFrame, CFrame]> {
		warn("BaseOcclusion Update must be overridden by derived classes");
		return $tuple(desiredCameraCFrame, desiredCameraFocus);
	}
}

export = BaseOcclusion;
