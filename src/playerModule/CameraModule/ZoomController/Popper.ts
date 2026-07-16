// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/ZoomController/Popper (ModuleScript)
//
//--------------------------------------------------------------------------------
// Popper.lua
// Prevents your camera from clipping through walls.
//--------------------------------------------------------------------------------

const Players = game.GetService("Players");

const camera = game.Workspace.CurrentCamera!;

// Shape supplied by ZoomController's TransformExtrapolator (Poppercam.lua) / ConstrainedSpring
// extrapolation. Structurally duplicated (not imported) to mirror the original's lack of a
// shared type declaration between these two sibling modules.
interface FocusExtrapolation {
	extrapolate: (t: number) => CFrame;
	posVelocity: Vector3;
	rotVelocity: Vector3;
}

function getTotalTransparency(part: BasePart): number {
	return 1 - (1 - part.Transparency) * (1 - part.LocalTransparencyModifier);
}

function eraseFromEnd<T>(t: Array<T>, toSize: number): void {
	for (let i = t.size(); i > toSize; i--) {
		t.remove(i - 1);
	}
}

let nearPlaneZ: number;
let projX: number;
let projY: number;

{
	const updateProjection = () => {
		const fov = math.rad(camera.FieldOfView);
		const view = camera.ViewportSize;
		const ar = view.X / view.Y;

		projY = 2 * math.tan(fov / 2);
		projX = ar * projY;
	};

	camera.GetPropertyChangedSignal("FieldOfView").Connect(updateProjection);
	camera.GetPropertyChangedSignal("ViewportSize").Connect(updateProjection);

	updateProjection();

	nearPlaneZ = camera.NearPlaneZ;
	camera.GetPropertyChangedSignal("NearPlaneZ").Connect(() => {
		nearPlaneZ = camera.NearPlaneZ;
	});
}

let blacklist: Instance[] = [];

{
	const charMap = new Map<Player, Model>();

	const refreshIgnoreList = () => {
		const newBlacklist: Instance[] = [];
		for (const [, character] of charMap) {
			newBlacklist.push(character);
		}
		blacklist = newBlacklist;
	};

	const playerAdded = (player: Player) => {
		const characterAdded = (character: Model) => {
			charMap.set(player, character);
			refreshIgnoreList();
		};
		const characterRemoving = () => {
			charMap.delete(player);
			refreshIgnoreList();
		};

		player.CharacterAdded.Connect(characterAdded);
		player.CharacterRemoving.Connect(characterRemoving);
		if (player.Character) {
			characterAdded(player.Character);
		}
	};

	const playerRemoving = (player: Player) => {
		charMap.delete(player);
		refreshIgnoreList();
	};

	Players.PlayerAdded.Connect(playerAdded);
	Players.PlayerRemoving.Connect(playerRemoving);

	for (const player of Players.GetPlayers()) {
		playerAdded(player);
	}
	refreshIgnoreList();
}

//--------------------------------------------------------------------------------------------
// Popper uses the level geometry find an upper bound on subject-to-camera distance.
//
// Hard limits are applied immediately and unconditionally. They are generally caused
// when level geometry intersects with the near plane (with exceptions, see below).
//
// Soft limits are only applied under certain conditions.
// They are caused when level geometry occludes the subject without actually intersecting
// with the near plane at the target distance.
//
// Soft limits can be promoted to hard limits and hard limits can be demoted to soft limits.
// We usually don"t want the latter to happen.
//
// A soft limit will be promoted to a hard limit if an obstruction
// lies between the current and target camera positions.
//--------------------------------------------------------------------------------------------

let subjectRoot: BasePart | undefined;
let subjectPart: BasePart | undefined;

camera.GetPropertyChangedSignal("CameraSubject").Connect(() => {
	const subject = camera.CameraSubject!;
	if (subject.IsA("Humanoid")) {
		subjectPart = subject.RootPart;
	} else if (subject.IsA("BasePart")) {
		subjectPart = subject;
	} else {
		subjectPart = undefined;
	}
});

function canOcclude(part: BasePart): boolean {
	// Occluders must be:
	// 1. Opaque
	// 2. Interactable
	// 3. Not in the same assembly as the subject

	return (
		getTotalTransparency(part) < 0.25 &&
		part.CanCollide &&
		subjectRoot !== (part.GetRootPart() ?? part) &&
		!part.IsA("TrussPart")
	);
}

// Offsets for the volume visibility test
const SCAN_SAMPLE_OFFSETS: Vector2[] = [
	new Vector2(0.4, 0.0),
	new Vector2(-0.4, 0.0),
	new Vector2(0.0, -0.4),
	new Vector2(0.0, 0.4),
	new Vector2(0.0, 0.2),
];

// Maximum number of rays that can be cast
const QUERY_POINT_CAST_LIMIT = 64;

//--------------------------------------------------------------------------------
// Piercing raycasts

function getCollisionPoint(origin: Vector3, dir: Vector3): LuaTuple<[Vector3, boolean]> {
	const originalSize = blacklist.size();

	let hitPart: BasePart | undefined;
	do {
		let hitPoint: Vector3;
		[hitPart, hitPoint] = workspace.FindPartOnRayWithIgnoreList(new Ray(origin, dir), blacklist, false, true);

		if (hitPart) {
			if (hitPart.CanCollide) {
				eraseFromEnd(blacklist, originalSize);
				return $tuple(hitPoint, true);
			}
			blacklist.push(hitPart);
		}
	} while (hitPart);

	eraseFromEnd(blacklist, originalSize);
	return $tuple(origin.add(dir), false);
}

//--------------------------------------------------------------------------------

function queryPoint(
	origin: Vector3,
	unitDir: Vector3,
	dist: number,
	lastPos?: Vector3,
): LuaTuple<[number, number]> {
	debug.profilebegin("queryPoint");

	const originalSize = blacklist.size();

	dist = dist + nearPlaneZ;
	const target = origin.add(unitDir.mul(dist));

	let softLimit = math.huge;
	let hardLimit = math.huge;
	let movingOrigin = origin;

	let numPierced = 0;

	let entryPart: BasePart | undefined;
	do {
		let entryPos: Vector3;
		[entryPart, entryPos] = workspace.FindPartOnRayWithIgnoreList(
			new Ray(movingOrigin, target.sub(movingOrigin)),
			blacklist,
			false,
			true,
		);
		numPierced += 1;

		if (entryPart) {
			// forces the current iteration into a hard limit to cap the number of raycasts
			const earlyAbort = numPierced >= QUERY_POINT_CAST_LIMIT;

			if (canOcclude(entryPart) || earlyAbort) {
				const wl: Instance[] = [entryPart];
				const exitPart = workspace.FindPartOnRayWithWhitelist(
					new Ray(target, entryPos.sub(target)),
					wl,
					true,
				)[0];

				const lim = entryPos.sub(origin).Magnitude;

				if (exitPart && !earlyAbort) {
					let promote = false;
					if (lastPos) {
						promote =
							workspace.FindPartOnRayWithWhitelist(new Ray(lastPos, target.sub(lastPos)), wl, true)[0] !==
								undefined ||
							workspace.FindPartOnRayWithWhitelist(new Ray(target, lastPos.sub(target)), wl, true)[0] !==
								undefined;
					}

					if (promote) {
						// Ostensibly a soft limit, but the camera has passed through it in the last frame, so promote to a hard limit.
						hardLimit = lim;
					} else if (dist < softLimit) {
						// Trivial soft limit
						softLimit = lim;
					}
				} else {
					// Trivial hard limit
					hardLimit = lim;
				}
			}

			blacklist.push(entryPart);
			movingOrigin = entryPos.sub(unitDir.mul(1e-3));
		}
	} while (hardLimit >= math.huge && entryPart !== undefined);

	eraseFromEnd(blacklist, originalSize);

	debug.profileend();
	return $tuple(softLimit - nearPlaneZ, hardLimit - nearPlaneZ);
}

function queryViewport(focus: CFrame, dist: number): LuaTuple<[number, number]> {
	debug.profilebegin("queryViewport");

	const fP = focus.Position;
	const fX = focus.RightVector;
	const fY = focus.UpVector;
	const fZ = focus.LookVector.mul(-1);

	const viewport = camera.ViewportSize;

	let hardBoxLimit = math.huge;
	let softBoxLimit = math.huge;

	// Center the viewport on the PoI, sweep points on the edge towards the target, and take the minimum limits
	for (let viewX = 0; viewX <= 1; viewX++) {
		const worldX = fX.mul((viewX - 0.5) * projX);

		for (let viewY = 0; viewY <= 1; viewY++) {
			const worldY = fY.mul((viewY - 0.5) * projY);

			const origin = fP.add(worldX.add(worldY).mul(nearPlaneZ));
			const lastPos = camera.ViewportPointToRay(viewport.X * viewX, viewport.Y * viewY).Origin;

			const [softPointLimit, hardPointLimit] = queryPoint(origin, fZ, dist, lastPos);

			if (hardPointLimit < hardBoxLimit) {
				hardBoxLimit = hardPointLimit;
			}
			if (softPointLimit < softBoxLimit) {
				softBoxLimit = softPointLimit;
			}
		}
	}
	debug.profileend();

	return $tuple(softBoxLimit, hardBoxLimit);
}

function testPromotion(focus: CFrame, dist: number, focusExtrapolation: FocusExtrapolation): boolean {
	debug.profilebegin("testPromotion");

	const fP = focus.Position;
	const fX = focus.RightVector;
	const fY = focus.UpVector;
	const fZ = focus.LookVector.mul(-1);

	{
		// Dead reckoning the camera rotation and focus
		debug.profilebegin("extrapolate");

		const SAMPLE_DT = 0.0625;
		const SAMPLE_MAX_T = 1.25;

		const maxDist = getCollisionPoint(fP, focusExtrapolation.posVelocity.mul(SAMPLE_MAX_T))[0].sub(fP).Magnitude;
		// Metric that decides how many samples to take
		const combinedSpeed = focusExtrapolation.posVelocity.Magnitude;

		for (
			let dt = 0;
			dt <= math.min(SAMPLE_MAX_T, focusExtrapolation.rotVelocity.Magnitude + maxDist / combinedSpeed);
			dt += SAMPLE_DT
		) {
			const cfDt = focusExtrapolation.extrapolate(dt); // Extrapolated CFrame at time dt

			if (queryPoint(cfDt.Position, cfDt.LookVector.mul(-1), dist)[0] >= dist) {
				return false;
			}
		}

		debug.profileend();
	}

	{
		// Test screen-space offsets from the focus for the presence of soft limits
		debug.profilebegin("testOffsets");

		for (const offset of SCAN_SAMPLE_OFFSETS) {
			const scaledOffset = offset;
			const pos = getCollisionPoint(fP, fX.mul(scaledOffset.X).add(fY.mul(scaledOffset.Y)))[0];
			if (queryPoint(pos, fP.add(fZ.mul(dist)).sub(pos).Unit, dist)[0] === math.huge) {
				return false;
			}
		}

		debug.profileend();
	}

	debug.profileend();
	return true;
}

function Popper(focus: CFrame, targetDist: number, focusExtrapolation: FocusExtrapolation): number {
	debug.profilebegin("popper");

	subjectRoot = subjectPart ? subjectPart.GetRootPart() : subjectPart;

	let dist = targetDist;
	const [soft, hard] = queryViewport(focus, targetDist);
	if (hard < dist) {
		dist = hard;
	}
	if (soft < dist && testPromotion(focus, targetDist, focusExtrapolation)) {
		dist = soft;
	}

	subjectRoot = undefined;

	debug.profileend();
	return dist;
}

export = Popper;
