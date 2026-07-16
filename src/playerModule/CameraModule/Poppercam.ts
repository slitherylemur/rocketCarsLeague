// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/Poppercam (ModuleScript)
//
// Poppercam - Occlusion module that brings the camera closer to the subject when objects are blocking the view.

import BaseOcclusion from "./BaseOcclusion";
import ZoomController from "./ZoomController";

// Shape produced by TransformExtrapolator.Step and consumed by ZoomController.Update /
// Popper. Structurally duplicated (not imported) to mirror the original's lack of a shared
// type declaration between these sibling modules.
interface FocusExtrapolation {
	extrapolate: (t: number) => CFrame;
	posVelocity: Vector3;
	rotVelocity: Vector3;
}

const CF_IDENTITY = new CFrame();

function cframeToAxis(cframe: CFrame): Vector3 {
	const [axis, angle] = cframe.ToAxisAngle();
	return axis.mul(angle);
}

function axisToCFrame(axis: Vector3): CFrame {
	const angle = axis.Magnitude;
	if (angle > 1e-5) {
		return CFrame.fromAxisAngle(axis, angle);
	}
	return CF_IDENTITY;
}

function extractRotation(cf: CFrame): CFrame {
	const [, , , xx, yx, zx, xy, yy, zy, xz, yz, zz] = cf.GetComponents();
	return new CFrame(0, 0, 0, xx, yx, zx, xy, yy, zy, xz, yz, zz);
}

class TransformExtrapolator {
	private lastCFrame: CFrame | undefined = undefined;

	Step(dt: number, currentCFrame: CFrame): FocusExtrapolation {
		const lastCFrame = this.lastCFrame ?? currentCFrame;
		this.lastCFrame = currentCFrame;

		const currentPos = currentCFrame.Position;
		const currentRot = extractRotation(currentCFrame);

		const lastPos = lastCFrame.Position;
		const lastRot = extractRotation(lastCFrame);

		// Estimate velocities from the delta between now and the last frame
		// This estimation can be a little noisy.
		const dp = currentPos.sub(lastPos).div(dt);
		const dr = cframeToAxis(currentRot.mul(lastRot.Inverse())).div(dt);

		const extrapolate = (t: number): CFrame => {
			const p = dp.mul(t).add(currentPos);
			const r = axisToCFrame(dr.mul(t)).mul(currentRot);
			return r.add(p);
		};

		return {
			extrapolate,
			posVelocity: dp,
			rotVelocity: dr,
		};
	}

	Reset(): void {
		this.lastCFrame = undefined;
	}
}

/* [ The Module ] */
class Poppercam extends BaseOcclusion {
	private focusExtrapolator: TransformExtrapolator;

	constructor() {
		super();
		this.focusExtrapolator = new TransformExtrapolator();
	}

	GetOcclusionMode(): Enum.DevCameraOcclusionMode {
		return Enum.DevCameraOcclusionMode.Zoom;
	}

	Enable(enable: boolean): void {
		this.focusExtrapolator.Reset();
	}

	Update(
		renderDt: number,
		desiredCameraCFrame: CFrame,
		desiredCameraFocus: CFrame,
		cameraController?: unknown,
	): LuaTuple<[CFrame, CFrame]> {
		const rotatedFocus = new CFrame(desiredCameraFocus.Position, desiredCameraCFrame.Position).mul(
			new CFrame(0, 0, 0, -1, 0, 0, 0, 1, 0, 0, 0, -1),
		);
		const extrapolation = this.focusExtrapolator.Step(renderDt, rotatedFocus);
		const zoom = ZoomController.Update(renderDt, rotatedFocus, extrapolation);
		return $tuple(rotatedFocus.mul(new CFrame(0, 0, zoom)), desiredCameraFocus);
	}

	// Called when character is added
	CharacterAdded(character: Model, player: Player): void {}

	// Called when character is about to be removed
	CharacterRemoving(character: Model, player: Player): void {}

	OnCameraSubjectChanged(newSubject: unknown): void {}
}

export = Poppercam;
