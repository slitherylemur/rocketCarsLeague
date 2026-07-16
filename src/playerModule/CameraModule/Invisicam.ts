// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/Invisicam (ModuleScript)
//
// Invisicam - Occlusion module that makes objects occluding character view semi-transparent
// 2018 Camera Update - AllYourBlox

import BaseOcclusion from "./BaseOcclusion";

/* [ Top Level Roblox Services ] */
const PlayersService = game.GetService("Players");

// Anything Invisicam can drive LocalTransparencyModifier on (Texture extends Decal, so it's
// covered by the Decal arm of this union).
type Fadeable = BasePart | Decal;

/* [ Constants ] */
const ZERO_VECTOR3 = new Vector3(0, 0, 0);
const USE_STACKING_TRANSPARENCY = true; // Multiple items between the subject and camera get transparency values that add up to TARGET_TRANSPARENCY
const TARGET_TRANSPARENCY = 0.75; // Classic Invisicam's Value, also used by new invisicam for parts hit by head and torso rays
const TARGET_TRANSPARENCY_PERIPHERAL = 0.5; // Used by new SMART_CIRCLE mode for items not hit by head and torso rays

const MODE = {
	// CUSTOM: 1, 		-- Retired, unused
	LIMBS: 2, // Track limbs
	MOVEMENT: 3, // Track movement
	CORNERS: 4, // Char model corners
	CIRCLE1: 5, // Circle of casts around character
	CIRCLE2: 6, // Circle of casts around character, camera relative
	LIMBMOVE: 7, // LIMBS mode + MOVEMENT mode
	SMART_CIRCLE: 8, // More sample points on and around character
	CHAR_OUTLINE: 9, // Dynamic outline around the character
} as const;

const LIMB_TRACKING_SET: Record<string, boolean> = {
	// Body parts common to R15 and R6
	Head: true,

	// Body parts unique to R6
	["Left Arm"]: true,
	["Right Arm"]: true,
	["Left Leg"]: true,
	["Right Leg"]: true,

	// Body parts unique to R15
	LeftLowerArm: true,
	RightLowerArm: true,
	LeftUpperLeg: true,
	RightUpperLeg: true,
};

const CORNER_FACTORS: Vector3[] = [
	new Vector3(1, 1, -1),
	new Vector3(1, -1, -1),
	new Vector3(-1, -1, -1),
	new Vector3(-1, 1, -1),
];

const CIRCLE_CASTS = 10;
const MOVE_CASTS = 3;
const SMART_CIRCLE_CASTS = 24;
const SMART_CIRCLE_INCREMENT = (2.0 * math.pi) / SMART_CIRCLE_CASTS;
const CHAR_OUTLINE_CASTS = 24;

// Used to sanitize user-supplied functions
function AssertTypes(param: unknown, ...types: string[]): void {
	const allowedTypes = new Set<string>();
	let typeString = "";
	for (const typeName of types) {
		allowedTypes.add(typeName);
		typeString = typeString + (typeString === "" ? "" : " or ") + typeName;
	}
	const theType = type(param);
	assert(allowedTypes.has(theType), `${typeString} type expected, got: ${theType}`);
}

// Helper function for Determinant of 3x3, not in CameraUtils for performance reasons
function Det3x3(
	a: number,
	b: number,
	c: number,
	d: number,
	e: number,
	f: number,
	g: number,
	h: number,
	i: number,
): number {
	// NOTE: the original Lua declares this function's return type as `nemubr` (a typo for
	// `number`); corrected here since TypeScript requires a resolvable type. No behavior change.
	return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

// Smart Circle mode needs the intersection of 2 rays that are known to be in the same plane
// because they are generated from cross products with a common vector. This function is computing
// that intersection, but it's actually the general solution for the point halfway between where
// two skew lines come nearest to each other, which is more forgiving.
function RayIntersection(p0: Vector3, v0: Vector3, p1: Vector3, v1: Vector3): Vector3 {
	const v2 = v0.Cross(v1);
	const d1 = p1.X - p0.X;
	const d2 = p1.Y - p0.Y;
	const d3 = p1.Z - p0.Z;
	const denom = Det3x3(v0.X, -v1.X, v2.X, v0.Y, -v1.Y, v2.Y, v0.Z, -v1.Z, v2.Z);

	if (denom === 0) {
		return ZERO_VECTOR3; // No solution (rays are parallel)
	}

	const t0 = Det3x3(d1, -v1.X, v2.X, d2, -v1.Y, v2.Y, d3, -v1.Z, v2.Z) / denom;
	const t1 = Det3x3(v0.X, d1, v2.X, v0.Y, d2, v2.Y, v0.Z, d3, v2.Z) / denom;
	const s0 = p0.add(v0.mul(t0));
	const s1 = p1.add(v1.mul(t1));
	const s = s0.add(s1.sub(s0).mul(0.5));

	// 0.25 studs is a threshold for deciding if the rays are
	// close enough to be considered intersecting, found through testing
	if (s1.sub(s0).Magnitude < 0.25) {
		return s;
	} else {
		return ZERO_VECTOR3;
	}
}

/* [ The Module ] */
class Invisicam extends BaseOcclusion {
	char: Model | undefined;
	humanoidRootPart: BasePart | undefined;
	torsoPart: BasePart | undefined;
	headPart: BasePart | undefined;

	childAddedConn: RBXScriptConnection | undefined;
	childRemovedConn: RBXScriptConnection | undefined;

	// Map of modes to behavior fns (bound closures replace the original's stored-unbound-method
	// table, since roblox-ts instance methods are not freely re-callable with an explicit self
	// the way Lua colon-methods are; behavior is identical since `this` never changes).
	behaviors: Map<number, (castPoints: Vector3[]) => void>;

	mode: number;
	behaviorFunction: (castPoints: Vector3[]) => void;

	savedHits: Map<Fadeable, number>; // Objects currently being faded in/out
	trackedLimbs: Set<BasePart>; // Used in limb-tracking casting modes

	camera: Camera | undefined;

	enabled: boolean;

	constructor() {
		super();

		this.char = undefined;
		this.humanoidRootPart = undefined;
		this.torsoPart = undefined;
		this.headPart = undefined;

		this.childAddedConn = undefined;
		this.childRemovedConn = undefined;

		this.behaviors = new Map<number, (castPoints: Vector3[]) => void>([
			[MODE.LIMBS, (castPoints) => this.LimbBehavior(castPoints)],
			[MODE.MOVEMENT, (castPoints) => this.MoveBehavior(castPoints)],
			[MODE.CORNERS, (castPoints) => this.CornerBehavior(castPoints)],
			[MODE.CIRCLE1, (castPoints) => this.CircleBehavior(castPoints)],
			[MODE.CIRCLE2, (castPoints) => this.CircleBehavior(castPoints)],
			[MODE.LIMBMOVE, (castPoints) => this.LimbMoveBehavior(castPoints)],
			[MODE.SMART_CIRCLE, (castPoints) => this.SmartCircleBehavior(castPoints)],
			[MODE.CHAR_OUTLINE, (castPoints) => this.CharacterOutlineBehavior(castPoints)],
		]);

		this.mode = MODE.SMART_CIRCLE;
		this.behaviorFunction = (castPoints) => this.SmartCircleBehavior(castPoints);

		this.savedHits = new Map<Fadeable, number>(); // Objects currently being faded in/out
		this.trackedLimbs = new Set<BasePart>(); // Used in limb-tracking casting modes

		this.camera = game.Workspace.CurrentCamera;

		this.enabled = false;
	}

	Enable(enable: boolean): void {
		this.enabled = enable;

		if (!enable) {
			this.Cleanup();
		}
	}

	GetOcclusionMode(): Enum.DevCameraOcclusionMode {
		return Enum.DevCameraOcclusionMode.Invisicam;
	}

	/* [ Module functions ] */
	LimbBehavior(castPoints: Vector3[]): void {
		for (const limb of this.trackedLimbs) {
			castPoints.push(limb.Position);
		}
	}

	MoveBehavior(castPoints: Vector3[]): void {
		for (let i = 1; i <= MOVE_CASTS; i++) {
			const position = this.humanoidRootPart!.Position;
			const velocity = this.humanoidRootPart!.Velocity;
			const horizontalSpeed = new Vector3(velocity.X, 0, velocity.Z).Magnitude / 2;
			const offsetVector = this.humanoidRootPart!.CFrame.LookVector.mul((i - 1) * horizontalSpeed);
			castPoints.push(position.add(offsetVector));
		}
	}

	CornerBehavior(castPoints: Vector3[]): void {
		const cframe = this.humanoidRootPart!.CFrame;
		const centerPoint = cframe.Position;
		const rotation = cframe.sub(centerPoint);
		const halfSize = this.char!.GetExtentsSize().div(2); // NOTE: Doesn't update w/ limb animations
		castPoints.push(centerPoint);
		for (const factor of CORNER_FACTORS) {
			castPoints.push(centerPoint.add(rotation.mul(halfSize.mul(factor))));
		}
	}

	CircleBehavior(castPoints: Vector3[]): void {
		let cframe: CFrame;
		if (this.mode === MODE.CIRCLE1) {
			cframe = this.humanoidRootPart!.CFrame;
		} else {
			const camCFrame = this.camera!.CoordinateFrame;
			cframe = camCFrame.sub(camCFrame.Position).add(this.humanoidRootPart!.Position);
		}
		castPoints.push(cframe.Position);
		for (let i = 0; i <= CIRCLE_CASTS - 1; i++) {
			const angle = ((2 * math.pi) / CIRCLE_CASTS) * i;
			const offset = new Vector3(math.cos(angle), math.sin(angle), 0).mul(3);
			castPoints.push(cframe.mul(offset));
		}
	}

	LimbMoveBehavior(castPoints: Vector3[]): void {
		this.LimbBehavior(castPoints);
		this.MoveBehavior(castPoints);
	}

	CharacterOutlineBehavior(castPoints: Vector3[]): void {
		const torsoUp = this.torsoPart!.CFrame.UpVector.Unit;
		const torsoRight = this.torsoPart!.CFrame.RightVector.Unit;

		// Torso cross of points for interior coverage
		castPoints.push(this.torsoPart!.CFrame.Position);
		castPoints.push(this.torsoPart!.CFrame.Position.add(torsoUp));
		castPoints.push(this.torsoPart!.CFrame.Position.sub(torsoUp));
		castPoints.push(this.torsoPart!.CFrame.Position.add(torsoRight));
		castPoints.push(this.torsoPart!.CFrame.Position.sub(torsoRight));
		if (this.headPart) {
			castPoints.push(this.headPart.CFrame.Position);
		}

		const cframe = new CFrame(
			ZERO_VECTOR3,
			new Vector3(this.camera!.CoordinateFrame.LookVector.X, 0, this.camera!.CoordinateFrame.LookVector.Z),
		);
		const centerPoint = this.torsoPart ? this.torsoPart.Position : this.humanoidRootPart!.Position;

		const partsWhitelist: Instance[] = [this.torsoPart!];
		if (this.headPart) {
			partsWhitelist.push(this.headPart);
		}

		for (let i = 1; i <= CHAR_OUTLINE_CASTS; i++) {
			const angle = (2 * math.pi * i) / CHAR_OUTLINE_CASTS;
			let offset = cframe.mul(new Vector3(math.cos(angle), math.sin(angle), 0).mul(3));

			offset = new Vector3(offset.X, math.max(offset.Y, -2.25), offset.Z);

			const ray = new Ray(centerPoint.add(offset), offset.mul(-3));
			const [hit, hitPoint] = game.Workspace.FindPartOnRayWithWhitelist(ray, partsWhitelist, false);

			if (hit) {
				// Use hit point as the cast point, but nudge it slightly inside the character so that bumping up against
				// walls is less likely to cause a transparency glitch
				castPoints.push(hitPoint.add(centerPoint.sub(hitPoint).Unit.mul(0.2)));
			}
		}
	}

	SmartCircleBehavior(castPoints: Vector3[]): void {
		const torsoUp = this.torsoPart!.CFrame.UpVector.Unit;
		const torsoRight = this.torsoPart!.CFrame.RightVector.Unit;

		// SMART_CIRCLE mode includes rays to head and 5 to the torso.
		// Hands, arms, legs and feet are not included since they
		// are not canCollide and can therefore go inside of parts
		castPoints.push(this.torsoPart!.CFrame.Position);
		castPoints.push(this.torsoPart!.CFrame.Position.add(torsoUp));
		castPoints.push(this.torsoPart!.CFrame.Position.sub(torsoUp));
		castPoints.push(this.torsoPart!.CFrame.Position.add(torsoRight));
		castPoints.push(this.torsoPart!.CFrame.Position.sub(torsoRight));
		if (this.headPart) {
			castPoints.push(this.headPart.CFrame.Position);
		}

		const cameraOrientation = this.camera!.CFrame.sub(this.camera!.CFrame.Position);
		const torsoPoint = new Vector3(0, 0.5, 0).add(
			this.torsoPart ? this.torsoPart.Position : this.humanoidRootPart!.Position,
		);
		const radius = 2.5;

		// This loop first calculates points in a circle of radius 2.5 around the torso of the character, in the
		// plane orthogonal to the camera's lookVector. Each point is then raycast to, to determine if it is within
		// the free space surrounding the player (not inside anything). Two iterations are done to adjust points that
		// are inside parts, to try to move them to valid locations that are still on their camera ray, so that the
		// circle remains circular from the camera's perspective, but does not cast rays into walls or parts that are
		// behind, below or beside the character and not really obstructing view of the character. This minimizes
		// the undesirable situation where the character walks up to an exterior wall and it is made invisible even
		// though it is behind the character.
		for (let i = 1; i <= SMART_CIRCLE_CASTS; i++) {
			const angle = SMART_CIRCLE_INCREMENT * i - 0.5 * math.pi;
			const offset = new Vector3(math.cos(angle), math.sin(angle), 0).mul(radius);
			const circlePoint = torsoPoint.add(cameraOrientation.mul(offset));

			// Vector from camera to point on the circle being tested
			const vp = circlePoint.sub(this.camera!.CFrame.Position);

			const ray = new Ray(torsoPoint, circlePoint.sub(torsoPoint));
			const [hit, hp, hitNormal] = game.Workspace.FindPartOnRayWithIgnoreList(ray, [this.char!], false, false);
			let castPoint = circlePoint;

			if (hit) {
				const hprime = hp.add(hitNormal.Unit.mul(0.1)); // Slightly offset hit point from the hit surface
				const v0 = hprime.sub(torsoPoint); // Vector from torso to offset hit point

				const perp = v0.Cross(vp).Unit;

				// Vector from the offset hit point, along the hit surface
				const v1 = perp.Cross(hitNormal).Unit;

				// Vector from camera to offset hit
				const vprime = hprime.sub(this.camera!.CFrame.Position).Unit;

				// This dot product checks to see if the vector along the hit surface would hit the correct
				// side of the invisicam cone, or if it would cross the camera look vector and hit the wrong side
				if (v0.Unit.Dot(v1.mul(-1)) < v0.Unit.Dot(vprime)) {
					castPoint = RayIntersection(hprime, v1, circlePoint, vp);

					if (castPoint.Magnitude > 0) {
						const ray2 = new Ray(hprime, castPoint.sub(hprime));
						const [hit2, hitPoint2, hitNormal2] = game.Workspace.FindPartOnRayWithIgnoreList(
							ray2,
							[this.char!],
							false,
							false,
						);

						if (hit2) {
							const hprime2 = hitPoint2.add(hitNormal2.Unit.mul(0.1));
							castPoint = hprime2;
						}
					} else {
						castPoint = hprime;
					}
				} else {
					castPoint = hprime;
				}

				const ray3 = new Ray(torsoPoint, castPoint.sub(torsoPoint));
				const [hit3, hitPoint3] = game.Workspace.FindPartOnRayWithIgnoreList(ray3, [this.char!], false, false);

				if (hit3) {
					const castPoint2 = hitPoint3.sub(castPoint.sub(torsoPoint).Unit.mul(0.1));
					castPoint = castPoint2;
				}
			}

			castPoints.push(castPoint);
		}
	}

	CheckTorsoReference(): void {
		if (this.char) {
			this.torsoPart = this.char.FindFirstChild("Torso") as BasePart | undefined;
			if (!this.torsoPart) {
				this.torsoPart = this.char.FindFirstChild("UpperTorso") as BasePart | undefined;
				if (!this.torsoPart) {
					this.torsoPart = this.char.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
				}
			}

			this.headPart = this.char.FindFirstChild("Head") as BasePart | undefined;
		}
	}

	CharacterAdded(char: Model, player: Player): void {
		// We only want the LocalPlayer's character
		if (player !== PlayersService.LocalPlayer) return;

		if (this.childAddedConn) {
			this.childAddedConn.Disconnect();
			this.childAddedConn = undefined;
		}
		if (this.childRemovedConn) {
			this.childRemovedConn.Disconnect();
			this.childRemovedConn = undefined;
		}

		this.char = char;

		this.trackedLimbs = new Set<BasePart>();
		const childAdded = (child: Instance) => {
			if (child.IsA("BasePart")) {
				if (LIMB_TRACKING_SET[child.Name]) {
					this.trackedLimbs.add(child);
				}

				if (child.Name === "Torso" || child.Name === "UpperTorso") {
					this.torsoPart = child;
				}

				if (child.Name === "Head") {
					this.headPart = child;
				}
			}
		};

		const childRemoved = (child: Instance) => {
			this.trackedLimbs.delete(child as BasePart);

			// If removed/replaced part is 'Torso' or 'UpperTorso' double check that we still have a TorsoPart to use
			this.CheckTorsoReference();
		};

		this.childAddedConn = char.ChildAdded.Connect(childAdded);
		this.childRemovedConn = char.ChildRemoved.Connect(childRemoved);
		for (const child of this.char.GetChildren()) {
			childAdded(child);
		}
	}

	SetMode(newMode: number): void {
		AssertTypes(newMode, "number");
		for (const [, modeNum] of pairs(MODE)) {
			if (modeNum === newMode) {
				this.mode = newMode;
				this.behaviorFunction = this.behaviors.get(this.mode)!;
				return;
			}
		}
		error("Invalid mode number");
	}

	GetObscuredParts(): Map<Fadeable, number> {
		return this.savedHits;
	}

	// Want to turn off Invisicam? Be sure to call this after.
	Cleanup(): void {
		for (const [hit, originalFade] of this.savedHits) {
			hit.LocalTransparencyModifier = originalFade;
		}
	}

	Update(dt: number, desiredCameraCFrame: CFrame, desiredCameraFocus: CFrame): LuaTuple<[CFrame, CFrame]> {
		// Bail if there is no Character
		if (!this.enabled || !this.char) {
			return $tuple(desiredCameraCFrame, desiredCameraFocus);
		}

		this.camera = game.Workspace.CurrentCamera;

		// TODO: Move this to a GetHumanoidRootPart helper, probably combine with CheckTorsoReference
		// Make sure we still have a HumanoidRootPart
		if (!this.humanoidRootPart) {
			const humanoid = this.char.FindFirstChildOfClass("Humanoid");
			if (humanoid && humanoid.RootPart) {
				this.humanoidRootPart = humanoid.RootPart;
			} else {
				// Not set up with Humanoid? Try and see if there's one in the Character at all:
				this.humanoidRootPart = this.char.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
				if (!this.humanoidRootPart) {
					// Bail out, since we're relying on HumanoidRootPart existing
					return $tuple(desiredCameraCFrame, desiredCameraFocus);
				}
			}

			// TODO: Replace this with something more sensible
			let ancestryChangedConn: RBXScriptConnection | undefined;
			ancestryChangedConn = this.humanoidRootPart.AncestryChanged.Connect((child, parent) => {
				if (child === this.humanoidRootPart && !parent) {
					this.humanoidRootPart = undefined;
					if (ancestryChangedConn && ancestryChangedConn.Connected) {
						ancestryChangedConn.Disconnect();
						ancestryChangedConn = undefined;
					}
				}
			});
		}

		if (!this.torsoPart) {
			this.CheckTorsoReference();
			if (!this.torsoPart) {
				// Bail out, since we're relying on Torso existing, should never happen since we fall back to using HumanoidRootPart as torso
				return $tuple(desiredCameraCFrame, desiredCameraFocus);
			}
		}

		// Make a list of world points to raycast to
		const castPoints: Vector3[] = [];
		this.behaviorFunction(castPoints);

		// Cast to get a list of objects between the camera and the cast points
		const currentHits = new Set<Fadeable>();
		const ignoreList: Instance[] = [this.char];
		const add = (hit: Fadeable) => {
			currentHits.add(hit);
			if (!this.savedHits.has(hit)) {
				this.savedHits.set(hit, hit.LocalTransparencyModifier);
			}
		};

		let hitParts: BasePart[];
		let hitPartCount = 0;

		// Hash table to treat head-ray-hit parts differently than the rest of the hit parts hit by other rays
		// head/torso ray hit parts will be more transparent than peripheral parts when USE_STACKING_TRANSPARENCY is enabled
		const headTorsoRayHitParts = new Set<BasePart>();

		let perPartTransparencyHeadTorsoHits = TARGET_TRANSPARENCY;
		let perPartTransparencyOtherHits = TARGET_TRANSPARENCY;

		if (USE_STACKING_TRANSPARENCY) {
			// This first call uses head and torso rays to find out how many parts are stacked up
			// for the purpose of calculating required per-part transparency
			const headPoint = this.headPart ? this.headPart.CFrame.Position : castPoints[0];
			const torsoPoint = this.torsoPart ? this.torsoPart.CFrame.Position : castPoints[1];
			hitParts = this.camera!.GetPartsObscuringTarget([headPoint, torsoPoint], ignoreList) as BasePart[];

			// Count how many things the sample rays passed through, including decals. This should only
			// count decals facing the camera, but GetPartsObscuringTarget does not return surface normals,
			// so my compromise for now is to just let any decal increase the part count by 1. Only one
			// decal per part will be considered.
			for (const hitPart of hitParts) {
				hitPartCount = hitPartCount + 1; // count the part itself
				headTorsoRayHitParts.add(hitPart);
				for (const child of hitPart.GetChildren()) {
					if (child.IsA("Decal") || child.IsA("Texture")) {
						hitPartCount = hitPartCount + 1; // count first decal hit, then break
						break;
					}
				}
			}

			if (hitPartCount > 0) {
				perPartTransparencyHeadTorsoHits = math.pow(
					0.5 * TARGET_TRANSPARENCY + (0.5 * TARGET_TRANSPARENCY) / hitPartCount,
					1 / hitPartCount,
				);
				perPartTransparencyOtherHits = math.pow(
					0.5 * TARGET_TRANSPARENCY_PERIPHERAL + (0.5 * TARGET_TRANSPARENCY_PERIPHERAL) / hitPartCount,
					1 / hitPartCount,
				);
			}
		}

		// Now get all the parts hit by all the rays
		hitParts = this.camera!.GetPartsObscuringTarget(castPoints, ignoreList) as BasePart[];

		const partTargetTransparency = new Map<Fadeable, number>();

		// Include decals and textures
		for (const hitPart of hitParts) {
			const targetTransparency = headTorsoRayHitParts.has(hitPart)
				? perPartTransparencyHeadTorsoHits
				: perPartTransparencyOtherHits;
			partTargetTransparency.set(hitPart, targetTransparency);

			// If the part is not already as transparent or more transparent than what invisicam requires, add it to the list of
			// parts to be modified by invisicam
			if (hitPart.Transparency < targetTransparency) {
				add(hitPart);
			}

			// Check all decals and textures on the part
			for (const child of hitPart.GetChildren()) {
				if (child.IsA("Decal") || child.IsA("Texture")) {
					if (child.Transparency < targetTransparency) {
						partTargetTransparency.set(child, targetTransparency);
						add(child);
					}
				}
			}
		}

		// Invisibilize objects that are in the way, restore those that aren't anymore
		for (const [hitPart, originalLTM] of this.savedHits) {
			if (currentHits.has(hitPart)) {
				// LocalTransparencyModifier gets whatever value is required to print the part's total transparency to equal perPartTransparency
				hitPart.LocalTransparencyModifier =
					hitPart.Transparency < 1
						? (partTargetTransparency.get(hitPart)! - hitPart.Transparency) / (1.0 - hitPart.Transparency)
						: 0;
			} else {
				// Restore original pre-invisicam value of LTM
				hitPart.LocalTransparencyModifier = originalLTM;
				this.savedHits.delete(hitPart);
			}
		}

		// Invisicam does not change the camera values
		return $tuple(desiredCameraCFrame, desiredCameraFocus);
	}
}

export = Invisicam;
