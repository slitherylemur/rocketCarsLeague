// Rocket-League-style ball cam + camera zoom clamps.
//
// Zoom clamps: Roblox's stock limits let the wheel travel from first-person
// (0.5 studs — inside the driver's head) out to 400 studs. Both extremes are
// wrong for a car game, so CameraMinZoomDistance/CameraMaxZoomDistance are
// pinned here once at boot. The ball cam's own wheel zoom obeys the same
// [MIN_ZOOM, MAX_ZOOM] window, and the chosen distance is handed back to the
// engine camera on toggle so the framing never jumps between modes.
//
// Ball cam (default ON, toggled by the rebindable "BallCam" key — see
// DataStoreDefaults.keyBinds): while the local player drives a car and their
// pitch has a ball, the camera sits on the opposite side of the car from the
// ball — car in the foreground, ball centered — and aims at the ball. The
// camera orbits the CAR (Rocket League's framing), keeping the player's
// orbit distance and a height proportional to it; only the yaw chases the
// ball, through a shortest-arc exponential smooth so the camera swings
// around smoothly instead of snapping when the ball crosses over the car.
//
// Roblox camera integration:
//   - Normal play stays on the engine's Custom camera (subject = humanoid,
//     native zoom/occlusion). The ball cam takes CameraType.Scriptable only
//     while it is actually steering, and every disengage path (toggle off,
//     leaving the seat, dying, ball or car despawning) restores Custom +
//     the humanoid subject, so the stock camera always comes back.
//   - The menu camera (menuCamera.client.ts) also uses Scriptable; the ball
//     cam never engages while another owner holds a Scriptable camera, and
//     it can only be active while seated in a car, so the two cannot fight.
//   - Occlusion is a single raycast from the car toward the desired camera
//     position (walls pull the camera in, like the stock popper). The local
//     car, character and ball are excluded.

import { BALL_NAME } from "shared/ballSim/BallConfig";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";

const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const UserInputService = game.GetService("UserInputService");
const ContextActionService = game.GetService("ContextActionService");
const Workspace = game.GetService("Workspace");

const LocalPlayer = Players.LocalPlayer;
const PITCH_ATTRIBUTE = "CB_PitchId";

// ---------------------------------------------------------------------------
// Zoom clamps (apply to the normal camera AND the ball cam)
// ---------------------------------------------------------------------------

const MIN_ZOOM = 8; // close enough to read the car, never inside the driver
const MAX_ZOOM = 40; // far enough to see play develop, never a satellite view

LocalPlayer.CameraMinZoomDistance = MIN_ZOOM;
LocalPlayer.CameraMaxZoomDistance = MAX_ZOOM;

// ---------------------------------------------------------------------------
// Ball cam tunables
// ---------------------------------------------------------------------------

const HEIGHT_RATIO = 0.3; // camera height above the car, as a fraction of zoom
const PIVOT_LIFT = 2; // orbit around a point slightly above the car body
const AIM_LIFT = 1.5; // aim slightly above the ball's center
const YAW_RESPONSIVENESS = 12; // 1/s; higher = stiffer swing toward the ball
const ZOOM_STEP = 3; // studs per mouse-wheel notch
const WALL_PADDING = 0.5; // stand-off from an occluding surface
const DEFAULT_TOGGLE_KEY = Enum.KeyCode.C;
const GAMEPAD_TOGGLE_KEY = Enum.KeyCode.DPadUp;
const TOGGLE_ACTION = "ToggleBallCam";

let ballCamOn = true; // Rocket League defaults ball cam on; the key toggles it
let controlling = false; // whether we currently own the camera
let zoom = 22;
let yaw = 0; // horizontal angle of the camera offset around the car
let zoomSyncGeneration = 0;

// ---------------------------------------------------------------------------
// Scene lookups
// ---------------------------------------------------------------------------

/** The Base part of the car the local player is currently driving. */
function drivenVehicleBase(): BasePart | undefined {
	const character = LocalPlayer.Character;
	const humanoid = character?.FindFirstChildOfClass("Humanoid");
	if (!humanoid || humanoid.Health <= 0) {
		return undefined;
	}
	const seat = humanoid.SeatPart;
	const vehicleModel = seat?.Parent?.Parent; // Model.Seats.Seat (VehicleKeyHandler)
	const base = vehicleModel?.FindFirstChild("Base");
	return base && base.IsA("BasePart") ? base : undefined;
}

/** The simulated ball on the local player's pitch (same lookup as the
 * direction indicator). */
function localBall(): BasePart | undefined {
	const pitchId = LocalPlayer.GetAttribute(PITCH_ATTRIBUTE);
	if (!typeIs(pitchId, "string")) {
		return undefined;
	}
	for (const child of Workspace.GetChildren()) {
		if (child.Name === BALL_NAME && child.IsA("BasePart") && child.GetAttribute(PITCH_ATTRIBUTE) === pitchId) {
			return child;
		}
	}
	return undefined;
}

/** matchHud owns the camera during the victory scene (pitch FB_Phase ==
 * "Ended", re-asserted every RenderStepped) — the ball cam must stand down
 * for that whole phase, not just until the first Scriptable frame. */
function victorySceneActive(): boolean {
	const pitchId = LocalPlayer.GetAttribute(PITCH_ATTRIBUTE);
	if (!typeIs(pitchId, "string")) {
		return false;
	}
	const mapFolder = Workspace.FindFirstChild("Map");
	const pitch = mapFolder?.FindFirstChild(pitchId);
	return pitch?.GetAttribute("FB_Phase") === "Ended";
}

// ---------------------------------------------------------------------------
// Engage / disengage
// ---------------------------------------------------------------------------

function engage(camera: Camera, base: BasePart) {
	controlling = true;
	zoomSyncGeneration += 1; // cancel any pending zoom-restore from a disengage

	// Adopt the engine camera's current orbit distance so toggling on doesn't
	// jump the framing.
	const currentDistance = camera.CFrame.Position.sub(camera.Focus.Position).Magnitude;
	if (currentDistance > 1) {
		zoom = math.clamp(currentDistance, MIN_ZOOM, MAX_ZOOM);
	}

	// Start the yaw where the camera already is (relative to the car) and let
	// the smoothing swing it toward the ball — no snap on engage.
	const offset = camera.CFrame.Position.sub(base.Position);
	const flat = new Vector3(offset.X, 0, offset.Z);
	if (flat.Magnitude > 0.05) {
		yaw = math.atan2(flat.X, flat.Z);
	}
}

function disengage() {
	if (!controlling) {
		return;
	}
	controlling = false;

	const camera = Workspace.CurrentCamera;
	if (camera) {
		camera.CameraType = Enum.CameraType.Custom;
		const humanoid = LocalPlayer.Character?.FindFirstChildOfClass("Humanoid");
		if (humanoid) {
			camera.CameraSubject = humanoid;
		}
	}

	// Hand our zoom to the engine camera: pinning min=max forces its internal
	// zoom to the ball cam's distance, then the real clamps are restored. The
	// generation guards overlapping engage/disengage cycles.
	zoomSyncGeneration += 1;
	const generation = zoomSyncGeneration;
	const target = math.clamp(zoom, MIN_ZOOM, MAX_ZOOM);
	LocalPlayer.CameraMinZoomDistance = target;
	LocalPlayer.CameraMaxZoomDistance = target;
	task.delay(0.15, () => {
		if (generation === zoomSyncGeneration) {
			LocalPlayer.CameraMinZoomDistance = MIN_ZOOM;
			LocalPlayer.CameraMaxZoomDistance = MAX_ZOOM;
		}
	});
}

// ---------------------------------------------------------------------------
// Per-frame camera update
// ---------------------------------------------------------------------------

const TAU = 2 * math.pi;

function update(camera: Camera, base: BasePart, ball: BasePart, dt: number) {
	camera.CameraType = Enum.CameraType.Scriptable;

	const pivot = base.Position.add(new Vector3(0, PIVOT_LIFT, 0));

	// Yaw target: directly opposite the car→ball direction, so the ball stays
	// centered with the car in the foreground. If the ball is (nearly) straight
	// above/below the car there is no horizontal direction — keep the last yaw.
	const toBall = ball.Position.sub(base.Position);
	const flat = new Vector3(toBall.X, 0, toBall.Z);
	if (flat.Magnitude > 0.5) {
		const targetYaw = math.atan2(-flat.X, -flat.Z);
		// Shortest-arc delta, then exponential smoothing (framerate independent).
		const delta = ((targetYaw - yaw + math.pi) % TAU) - math.pi;
		yaw += delta * (1 - math.exp(-YAW_RESPONSIVENESS * dt));
	}

	// Fixed total distance: height is a fraction of zoom, the horizontal
	// component makes up the rest, so wheel zoom scales the whole rig.
	const height = HEIGHT_RATIO * zoom;
	const horizontal = math.sqrt(zoom * zoom - height * height);
	let cameraPosition = pivot.add(new Vector3(math.sin(yaw) * horizontal, height, math.cos(yaw) * horizontal));

	// Pull the camera in front of walls (arena boundary, goal frames).
	const rayParams = new RaycastParams();
	rayParams.FilterType = Enum.RaycastFilterType.Exclude;
	const excludes: Instance[] = [ball];
	const character = LocalPlayer.Character;
	if (character) {
		excludes.push(character);
	}
	const vehiclesFolder = Workspace.FindFirstChild("Vehicles");
	if (vehiclesFolder) {
		excludes.push(vehiclesFolder);
	}
	rayParams.FilterDescendantsInstances = excludes;
	const rayResult = Workspace.Raycast(pivot, cameraPosition.sub(pivot), rayParams);
	if (rayResult) {
		const pulledDistance = math.max(rayResult.Position.sub(pivot).Magnitude - WALL_PADDING, 1);
		cameraPosition = pivot.add(cameraPosition.sub(pivot).Unit.mul(pulledDistance));
	}

	// Aim at the ball. Guard the degenerate case of the ball flying through
	// the camera position itself (lookAt needs a direction).
	const aim = ball.Position.add(new Vector3(0, AIM_LIFT, 0));
	if (aim.sub(cameraPosition).Magnitude < 0.05) {
		return; // keep last frame's CFrame for this frame
	}
	camera.CFrame = CFrame.lookAt(cameraPosition, aim);
	camera.Focus = new CFrame(ball.Position);
}

RunService.BindToRenderStep("BallCam", Enum.RenderPriority.Camera.Value + 1, (dt) => {
	const camera = Workspace.CurrentCamera;
	if (!camera) {
		return;
	}
	const base = ballCamOn ? drivenVehicleBase() : undefined;
	const ball = base ? localBall() : undefined;
	if (!base || !ball || ball.Parent === undefined || victorySceneActive()) {
		disengage();
		return;
	}
	if (!controlling) {
		// Never steal a Scriptable camera another system owns (menu camera).
		if (camera.CameraType === Enum.CameraType.Scriptable) {
			return;
		}
		engage(camera, base);
	}
	update(camera, base, ball, dt);
});

// ---------------------------------------------------------------------------
// Inputs: wheel zoom while controlling, rebindable toggle key
// ---------------------------------------------------------------------------

UserInputService.InputChanged.Connect((input, gameProcessed) => {
	if (!controlling || gameProcessed) {
		return;
	}
	if (input.UserInputType === Enum.UserInputType.MouseWheel) {
		zoom = math.clamp(zoom - input.Position.Z * ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
	}
});

function onToggleAction(_actionName: string, inputState: Enum.UserInputState) {
	if (inputState === Enum.UserInputState.Begin) {
		ballCamOn = !ballCamOn;
	}
	return Enum.ContextActionResult.Pass;
}

// Bound once at boot and re-bound on every seating, so a rebind made in the
// keybindings menu applies from the next drive (same policy as the Horn key).
function bindToggleKey() {
	task.spawn(() => {
		let key: Enum.KeyCode = DEFAULT_TOGGLE_KEY;
		const [ok, saved] = pcall(() => FunctionsAndEvents.GetKeyBinding.InvokeServer("BallCam") as EnumItem | undefined);
		if (ok && saved !== undefined && tostring(saved.EnumType) === "KeyCode") {
			key = saved as Enum.KeyCode;
		}
		ContextActionService.UnbindAction(TOGGLE_ACTION);
		ContextActionService.BindAction(TOGGLE_ACTION, onToggleAction as never, false, key, GAMEPAD_TOGGLE_KEY);
	});
}

let seatedConnection: RBXScriptConnection | undefined;
function connectCharacter(character: Model) {
	if (seatedConnection) {
		seatedConnection.Disconnect();
	}
	const humanoid = character.WaitForChild("Humanoid") as Humanoid;
	seatedConnection = humanoid.Seated.Connect((isSeated) => {
		if (isSeated) {
			bindToggleKey();
		}
	});
}

LocalPlayer.CharacterAdded.Connect(connectCharacter);
if (LocalPlayer.Character) {
	task.spawn(() => connectCharacter(LocalPlayer.Character!));
}
bindToggleKey();
