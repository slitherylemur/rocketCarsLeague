// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/ZoomController (ModuleScript)
//
//!strict
// Zoom
// Controls the distance between the focus and the camera.

import Popper from "./Popper";

const ZOOM_STIFFNESS = 4.5;
const ZOOM_DEFAULT = 12.5;
const ZOOM_ACCELERATION = 0.0375;

const MIN_FOCUS_DIST = 0.5;
const DIST_OPAQUE = 1;

// Shape supplied to Popper as the `focusExtrapolation` parameter (produced by Poppercam's
// TransformExtrapolator). Structurally duplicated (not imported) to mirror the original's
// lack of a shared type declaration between these sibling modules.
interface FocusExtrapolation {
	extrapolate: (t: number) => CFrame;
	posVelocity: Vector3;
	rotVelocity: Vector3;
}

let cameraMinZoomDistance!: number;
let cameraMaxZoomDistance!: number;

{
	const player = game.GetService("Players").LocalPlayer;

	const updateBounds = () => {
		cameraMinZoomDistance = player.CameraMinZoomDistance;
		cameraMaxZoomDistance = player.CameraMaxZoomDistance;
	};

	updateBounds();

	player.GetPropertyChangedSignal("CameraMinZoomDistance").Connect(updateBounds);
	player.GetPropertyChangedSignal("CameraMaxZoomDistance").Connect(updateBounds);
}

class ConstrainedSpring {
	freq: number; // Undamped frequency (Hz)
	x: number; // Current position
	v: number; // Current velocity
	minValue: number; // Minimum bound
	maxValue: number; // Maximum bound
	goal: number; // Goal position

	constructor(freq: number, x: number, minValue: number, maxValue: number) {
		x = math.clamp(x, minValue, maxValue);

		this.freq = freq;
		this.x = x;
		this.v = 0;
		this.minValue = minValue;
		this.maxValue = maxValue;
		this.goal = x;
	}

	Step(dt: number): number {
		const freq = this.freq * 2 * math.pi; // Convert from Hz to rad/s
		const x = this.x;
		const v = this.v;
		const minValue = this.minValue;
		const maxValue = this.maxValue;
		const goal = this.goal;

		// Solve the spring ODE for position and velocity after time t, assuming critical damping:
		//   2*f*x'[t] + x''[t] = f^2*(g - x[t])
		// Knowns are x[0] and x'[0].
		// Solve for x[t] and x'[t].

		const offset = goal - x;
		const step = freq * dt;
		const decay = math.exp(-step);

		let x1 = goal + (v * dt - offset * (step + 1)) * decay;
		let v1 = ((offset * freq - v) * step + v) * decay;

		// Constrain
		if (x1 < minValue) {
			x1 = minValue;
			v1 = 0;
		} else if (x1 > maxValue) {
			x1 = maxValue;
			v1 = 0;
		}

		this.x = x1;
		this.v = v1;

		return x1;
	}
}

const zoomSpring = new ConstrainedSpring(ZOOM_STIFFNESS, ZOOM_DEFAULT, MIN_FOCUS_DIST, cameraMaxZoomDistance);

function stepTargetZoom(z: number, dz: number, zoomMin: number, zoomMax: number): number {
	z = math.clamp(z + dz * (1 + z * ZOOM_ACCELERATION), zoomMin, zoomMax);
	if (z < DIST_OPAQUE) {
		z = dz <= 0 ? zoomMin : DIST_OPAQUE;
	}
	return z;
}

let zoomDelta = 0;

const Zoom = {
	Update(renderDt: number, focus: CFrame, extrapolation: FocusExtrapolation): number {
		let poppedZoom = math.huge;

		if (zoomSpring.goal > DIST_OPAQUE) {
			// Make a pessimistic estimate of zoom distance for this step without accounting for poppercam
			const maxPossibleZoom = math.max(
				zoomSpring.x,
				stepTargetZoom(zoomSpring.goal, zoomDelta, cameraMinZoomDistance, cameraMaxZoomDistance),
			);

			// Run the Popper algorithm on the feasible zoom range, [MIN_FOCUS_DIST, maxPossibleZoom]
			poppedZoom =
				Popper(focus.mul(new CFrame(0, 0, MIN_FOCUS_DIST)), maxPossibleZoom - MIN_FOCUS_DIST, extrapolation) +
				MIN_FOCUS_DIST;
		}

		zoomSpring.minValue = MIN_FOCUS_DIST;
		zoomSpring.maxValue = math.min(cameraMaxZoomDistance, poppedZoom);

		return zoomSpring.Step(renderDt);
	},

	GetZoomRadius(): number {
		return zoomSpring.x;
	},

	SetZoomParameters(targetZoom: number, newZoomDelta: number): void {
		zoomSpring.goal = targetZoom;
		zoomDelta = newZoomDelta;
	},

	ReleaseSpring(): void {
		zoomSpring.x = zoomSpring.goal;
		zoomSpring.v = 0;
	},
};

export = Zoom;
