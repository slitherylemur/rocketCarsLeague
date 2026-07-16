// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/CameraUtils (ModuleScript)
//
// CameraUtils - Math utility functions shared by multiple camera scripts
// 2018 Camera Update - AllYourBlox

//!strict

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

const Players = game.GetService("Players");
const UserInputService = game.GetService("UserInputService");
const UserGameSettings = UserSettings().GetService("UserGameSettings");

function round(num: number): number {
	return math.floor(num + 0.5);
}

// Critically damped spring class for fluid motion effects
class Spring {
	freq: number;
	goal: Vector3;
	pos: Vector3;
	vel: Vector3;

	// Initialize to a given undamped frequency and default position
	constructor(freq: number, pos: Vector3) {
		this.freq = freq;
		this.goal = pos;
		this.pos = pos;
		this.vel = Vector3.zero;
	}

	// Advance the spring simulation by `dt` seconds
	step(dt: number): Vector3 {
		const f: number = this.freq * 2.0 * math.pi;
		const g: Vector3 = this.goal;
		const p0: Vector3 = this.pos;
		const v0: Vector3 = this.vel;

		const offset = p0.sub(g);
		const decay = math.exp(-f * dt);

		const p1 = offset.mul(1 + f * dt).add(v0.mul(dt)).mul(decay).add(g);
		const v1 = v0.mul(1 - f * dt).sub(offset.mul(f * f * dt)).mul(decay);

		this.pos = p1;
		this.vel = v1;

		return p1;
	}
}

// map a value from one range to another
function map(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
	return ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

// maps a value from one range to another, clamping to the output range. order does not matter
function mapClamp(x: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
	return math.clamp(
		((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin,
		math.min(outMin, outMax),
		math.max(outMin, outMax),
	);
}

// Ritter's loose bounding sphere algorithm
function getLooseBoundingSphere(parts: BasePart[]): LuaTuple<[Vector3, number]> {
	const points = table.create<Vector3>(parts.size());
	for (const [idx, part] of pairs(parts)) {
		points[idx - 1] = part.Position;
	}

	// pick an arbitrary starting point
	const x = points[0];

	// get y, the point furthest from x
	let y = x;
	let yDist = 0;

	for (const p of points) {
		const pDist = p.sub(x).Magnitude;

		if (pDist > yDist) {
			y = p;
			yDist = pDist;
		}
	}

	// get z, the point furthest from y
	let z = y;
	let zDist = 0;

	for (const p of points) {
		const pDist = p.sub(y).Magnitude;

		if (pDist > zDist) {
			z = p;
			zDist = pDist;
		}
	}

	// use (y, z) as the initial bounding sphere
	let sc = y.add(z).mul(0.5);
	let sr = y.sub(z).Magnitude * 0.5;

	// expand sphere to fit any outlying points
	for (const p of points) {
		const pDist = p.sub(sc).Magnitude;

		if (pDist > sr) {
			// shift to midpoint
			sc = sc.add(p.sub(sc).Unit.mul((pDist - sr) * 0.5));

			// expand
			sr = (pDist + sr) * 0.5;
		}
	}

	return $tuple(sc, sr);
}

// canonicalize an angle to +-180 degrees
function sanitizeAngle(a: number): number {
	return ((a + math.pi) % (2 * math.pi)) - math.pi;
}

// From TransparencyController
function Round(num: number, places: number): number {
	const decimalPivot = 10 ** places;
	return math.floor(num * decimalPivot + 0.5) / decimalPivot;
}

function IsFinite(val: number): boolean {
	return val === val && val !== math.huge && val !== -math.huge;
}

function IsFiniteVector3(vec3: Vector3): boolean {
	return IsFinite(vec3.X) && IsFinite(vec3.Y) && IsFinite(vec3.Z);
}

// Legacy implementation renamed
function GetAngleBetweenXZVectors(v1: Vector3, v2: Vector3): number {
	return math.atan2(v2.X * v1.Z - v2.Z * v1.X, v2.X * v1.X + v2.Z * v1.Z);
}

function RotateVectorByAngleAndRound(camLook: Vector3, rotateAngle: number, roundAmount: number): number {
	if (camLook.Magnitude > 0) {
		camLook = camLook.Unit;
		const currAngle = math.atan2(camLook.Z, camLook.X);
		const newAngle = round((math.atan2(camLook.Z, camLook.X) + rotateAngle) / roundAmount) * roundAmount;
		return newAngle - currAngle;
	}
	return 0;
}

// K is a tunable parameter that changes the shape of the S-curve
// the larger K is the more straight/linear the curve gets
const k = 0.35;
const lowerK = 0.8;
function SCurveTranform(t: number): number {
	t = math.clamp(t, -1, 1);
	if (t >= 0) {
		return (k * t) / (k - t + 1);
	}
	return -((lowerK * -t) / (lowerK + t + 1));
}

const DEADZONE = 0.1;
function toSCurveSpace(t: number): number {
	return (1 + DEADZONE) * (2 * math.abs(t) - 1) - DEADZONE;
}

function fromSCurveSpace(t: number): number {
	return t / 2 + 0.5;
}

function GamepadLinearToCurve(thumbstickPosition: Vector2): Vector2 {
	const onAxis = (axisValue: number): number => {
		let sign = 1;
		if (axisValue < 0) {
			sign = -1;
		}
		let point = fromSCurveSpace(SCurveTranform(toSCurveSpace(math.abs(axisValue))));
		point = point * sign;
		return math.clamp(point, -1, 1);
	};
	return new Vector2(onAxis(thumbstickPosition.X), onAxis(thumbstickPosition.Y));
}

// This function converts 4 different, redundant enumeration types to one standard so the values can be compared
function ConvertCameraModeEnumToStandard(
	enumValue:
		| Enum.TouchCameraMovementMode
		| Enum.ComputerCameraMovementMode
		| Enum.DevTouchCameraMovementMode
		| Enum.DevComputerCameraMovementMode,
): Enum.ComputerCameraMovementMode | Enum.DevComputerCameraMovementMode {
	if (enumValue === Enum.TouchCameraMovementMode.Default) {
		return Enum.ComputerCameraMovementMode.Follow;
	}

	if (enumValue === Enum.ComputerCameraMovementMode.Default) {
		return Enum.ComputerCameraMovementMode.Classic;
	}

	if (
		enumValue === Enum.TouchCameraMovementMode.Classic ||
		enumValue === Enum.DevTouchCameraMovementMode.Classic ||
		enumValue === Enum.DevComputerCameraMovementMode.Classic ||
		enumValue === Enum.ComputerCameraMovementMode.Classic
	) {
		return Enum.ComputerCameraMovementMode.Classic;
	}

	if (
		enumValue === Enum.TouchCameraMovementMode.Follow ||
		enumValue === Enum.DevTouchCameraMovementMode.Follow ||
		enumValue === Enum.DevComputerCameraMovementMode.Follow ||
		enumValue === Enum.ComputerCameraMovementMode.Follow
	) {
		return Enum.ComputerCameraMovementMode.Follow;
	}

	if (
		enumValue === Enum.TouchCameraMovementMode.Orbital ||
		enumValue === Enum.DevTouchCameraMovementMode.Orbital ||
		enumValue === Enum.DevComputerCameraMovementMode.Orbital ||
		enumValue === Enum.ComputerCameraMovementMode.Orbital
	) {
		return Enum.ComputerCameraMovementMode.Orbital;
	}

	if (
		enumValue === Enum.ComputerCameraMovementMode.CameraToggle ||
		enumValue === Enum.DevComputerCameraMovementMode.CameraToggle
	) {
		return Enum.ComputerCameraMovementMode.CameraToggle;
	}

	// Note: Only the Dev versions of the Enums have UserChoice as an option
	if (
		enumValue === Enum.DevTouchCameraMovementMode.UserChoice ||
		enumValue === Enum.DevComputerCameraMovementMode.UserChoice
	) {
		return Enum.DevComputerCameraMovementMode.UserChoice;
	}

	// For any unmapped options return Classic camera
	return Enum.ComputerCameraMovementMode.Classic;
}

// --- Mouse icon override (only ever invoked by callers when
// FFlagUserCameraToggleDontSetMouseIconEveryFrame is true; defined unconditionally here since
// that guard is always re-checked at every call site, matching the original's conditional
// function definition without needing to conditionally extend the exported table). ---

function getMouse(): PlayerMouse {
	let localPlayer = Players.LocalPlayer;
	if (!localPlayer) {
		Players.GetPropertyChangedSignal("LocalPlayer").Wait();
		localPlayer = Players.LocalPlayer;
	}
	return localPlayer.GetMouse();
}

let savedMouseIcon = "";
let lastMouseIconOverride: string | undefined = undefined;
function setMouseIconOverride(icon: string): void {
	const mouse = getMouse();
	// Only save the icon if it was written by another script.
	if (mouse.Icon !== lastMouseIconOverride) {
		savedMouseIcon = mouse.Icon;
	}

	mouse.Icon = icon;
	lastMouseIconOverride = icon;
}

function restoreMouseIcon(): void {
	const mouse = getMouse();
	// Only restore if it wasn't overwritten by another script.
	if (mouse.Icon === lastMouseIconOverride) {
		mouse.Icon = savedMouseIcon;
	}
	lastMouseIconOverride = undefined;
}

// --- Mouse behavior / rotation type override (see note above: defined unconditionally,
// guarded at call sites by FFlagUserCameraToggleDontSetMouseBehaviorOrRotationTypeEveryFrame). ---

let savedMouseBehavior: Enum.MouseBehavior = Enum.MouseBehavior.Default;
let lastMouseBehaviorOverride: Enum.MouseBehavior | undefined = undefined;
function setMouseBehaviorOverride(value: Enum.MouseBehavior): void {
	if (UserInputService.MouseBehavior !== lastMouseBehaviorOverride) {
		savedMouseBehavior = UserInputService.MouseBehavior;
	}

	UserInputService.MouseBehavior = value;
	lastMouseBehaviorOverride = value;
}

function restoreMouseBehavior(): void {
	if (UserInputService.MouseBehavior === lastMouseBehaviorOverride) {
		UserInputService.MouseBehavior = savedMouseBehavior;
	}
	lastMouseBehaviorOverride = undefined;
}

let savedRotationType: Enum.RotationType = Enum.RotationType.MovementRelative;
let lastRotationTypeOverride: Enum.RotationType | undefined = undefined;
function setRotationTypeOverride(value: Enum.RotationType): void {
	if (UserGameSettings.RotationType !== lastRotationTypeOverride) {
		savedRotationType = UserGameSettings.RotationType;
	}

	UserGameSettings.RotationType = value;
	lastRotationTypeOverride = value;
}

function restoreRotationType(): void {
	if (UserGameSettings.RotationType === lastRotationTypeOverride) {
		UserGameSettings.RotationType = savedRotationType;
	}
	lastRotationTypeOverride = undefined;
}

const CameraUtils = {
	Spring,
	map,
	mapClamp,
	getLooseBoundingSphere,
	sanitizeAngle,
	Round,
	IsFinite,
	IsFiniteVector3,
	GetAngleBetweenXZVectors,
	RotateVectorByAngleAndRound,
	GamepadLinearToCurve,
	ConvertCameraModeEnumToStandard,
	setMouseIconOverride,
	restoreMouseIcon,
	setMouseBehaviorOverride,
	restoreMouseBehavior,
	setRotationTypeOverride,
	restoreRotationType,
};

export = CameraUtils;
