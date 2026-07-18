// Server-authoritative ball spawner (mirrors spawnVehicle's Phase 4 setup).
//
// Called once per loadMap(). The server creates the part at the map's
// center and marks it PredictionMode.On so clients are allowed to predict
// it (each client re-asserts On locally in ballRenderer.client.ts). Under
// Workspace.AuthorityMode = Server there is no SetNetworkOwner — the server
// simulates the ball and clients predict/rollback against it.

import { BALL_NAME, BALL_FIELDS, ballTunables, ballTuneAttr } from "shared/ballSim/BallConfig";
import { BallAttr } from "shared/ballSim/BallSim";
import { COLLISION_GROUPS } from "shared/collisionGroups";

const RunService = game.GetService("RunService");

const spawner = {} as {
	SpawnBall: (map: Instance) => void;
	DestroyBall: (map?: Instance) => void;
	/** Respawn a map's ball (defaults to the last SpawnBall map — the tuning
	 * HUD and the single-pitch kickoff use that form). */
	RespawnBall: (map?: Instance) => boolean;
	/** The live ball belonging to a map/pitch. */
	GetBall: (map: Instance) => BasePart | undefined;
};

// The map the ball last spawned on, so the tuning remote can respawn the
// ball with new tunables without involving roundHandler.
let currentMap: Instance | undefined;
// Multi-pitch: one live ball per map/pitch.
const ballByMap = new Map<Instance, BasePart>();

// Same rationale as spawnVehicle.markPredictable: client-side On alone left
// vehicles Authoritative, so the server marks the whole assembly On at spawn.
function markPredictable(root: Instance) {
	const [ok, err] = pcall(() => {
		RunService.SetPredictionMode(root, Enum.PredictionMode.On);
		for (const descendant of root.GetDescendants()) {
			RunService.SetPredictionMode(descendant, Enum.PredictionMode.On);
		}
	});
	if (!ok) {
		warn(`[BallSpawner] markPredictable failed: ${err}`);
	}
}

// Maps are Folders, each with a ground part the ball spawns over. Prefer the
// explicit ground part name; "ground" alone is a looser second pass.
function findGroundPart(map: Instance): BasePart | undefined {
	let loose: BasePart | undefined;
	for (const descendant of map.GetDescendants()) {
		if (!descendant.IsA("BasePart")) {
			continue;
		}
		const name = descendant.Name.lower();
		if (name === "groundpart" || name === "ground part") {
			return descendant;
		}
		if (loose === undefined && name === "ground") {
			loose = descendant;
		}
	}
	return loose;
}

// Fallback for maps without a ground part: axis-aligned bounds over every
// BasePart in the folder (Folders have no GetBoundingBox).
// Plain object return (NOT $tuple): a LuaTuple stored before destructuring
// only captures its first value — same fix as PitchManager.computeBounds.
function computePartBounds(map: Instance): { min: Vector3; max: Vector3 } | undefined {
	let minBound: Vector3 | undefined;
	let maxBound: Vector3 | undefined;
	for (const descendant of map.GetDescendants()) {
		if (!descendant.IsA("BasePart")) {
			continue;
		}
		const half = descendant.Size.div(2);
		const lo = descendant.Position.sub(half);
		const hi = descendant.Position.add(half);
		minBound = minBound === undefined ? lo : new Vector3(math.min(minBound.X, lo.X), math.min(minBound.Y, lo.Y), math.min(minBound.Z, lo.Z));
		maxBound = maxBound === undefined ? hi : new Vector3(math.max(maxBound.X, hi.X), math.max(maxBound.Y, hi.Y), math.max(maxBound.Z, hi.Z));
	}
	if (minBound === undefined || maxBound === undefined) {
		return undefined;
	}
	return { min: minBound, max: maxBound };
}

// Center of the map floor: the ground part's top surface if present,
// otherwise a downward raycast at the horizontal center of the map's bounds.
function findSpawnCenter(map: Instance): Vector3 | undefined {
	const ground = findGroundPart(map);
	if (ground) {
		return new Vector3(ground.Position.X, ground.Position.Y + ground.Size.Y / 2, ground.Position.Z);
	}

	const bounds = computePartBounds(map);
	if (bounds === undefined) {
		return undefined;
	}
	const minBound = bounds.min;
	const maxBound = bounds.max;
	const center = minBound.add(maxBound).div(2);

	const params = new RaycastParams();
	params.FilterType = Enum.RaycastFilterType.Include;
	params.FilterDescendantsInstances = [map, game.Workspace.Terrain];
	const down = new Vector3(0, -(maxBound.Y - minBound.Y + 200), 0);
	// Mid-height first so a roofed map (stadium) doesn't land the ball on
	// its roof; then from above the whole map.
	const hit =
		game.Workspace.Raycast(center, down, params) ??
		game.Workspace.Raycast(new Vector3(center.X, maxBound.Y + 100, center.Z), down, params);
	const floorY = hit !== undefined ? hit.Position.Y : minBound.Y;
	return new Vector3(center.X, floorY, center.Z);
}

spawner.DestroyBall = (map?: Instance) => {
	if (map) {
		const existing = ballByMap.get(map);
		if (existing) {
			existing.Destroy();
			ballByMap.delete(map);
		}
		return;
	}
	for (const [, ball] of ballByMap) {
		ball.Destroy();
	}
	ballByMap.clear();
};

spawner.SpawnBall = (map: Instance) => {
	spawner.DestroyBall(map);
	// Prune balls whose pitch was torn down (round reload).
	for (const [ownerMap, ball] of ballByMap) {
		if (ownerMap.Parent === undefined) {
			ball.Destroy();
			ballByMap.delete(ownerMap);
		}
	}
	currentMap = map;

	const floorCenter = findSpawnCenter(map);
	if (floorCenter === undefined) {
		warn(`[BallSpawner] no BaseParts found in map ${map.Name}; ball not spawned`);
		return;
	}
	// Drop in from slightly above the floor so the spawn reads as an event.
	const spawnPos = floorCenter.add(new Vector3(0, ballTunables.size / 2 + 10, 0));

	// Custom scripted physics (BallSim.ts): the engine resolves NO contacts
	// for the ball (CanCollide=false) and its gravity is cancelled by the
	// AntiGravity force — the engine only integrates position from the
	// velocity BallSim writes each sim tick.
	const ball = new Instance("Part");
	ball.Name = BALL_NAME;
	ball.Shape = Enum.PartType.Ball;
	ball.Size = new Vector3(ballTunables.size, ballTunables.size, ballTunables.size);
	ball.Material = Enum.Material.SmoothPlastic;
	ball.Color = Color3.fromRGB(255, 170, 0);
	ball.CastShadow = true;
	ball.Anchored = false;
	ball.CanCollide = false;
	// Invisible to every OTHER system's spatial queries (wheel ground rays,
	// the damage overlap, camera) — BallSim's own queries exclude the ball
	// explicitly, so nothing here needs CanQuery.
	ball.CanQuery = false;
	// .Touched would create a TouchTransmitter — an unpredictable class that
	// makes the engine refuse the assembly (see spawnVehicle damage notes).
	ball.CanTouch = false;
	// Group kept for the QUERY matrix: BallSim runs its world/hitbox queries
	// under GameBall, which includes map + Hitboxes and excludes car bodies
	// and wheels (initCollisionGroups.server.ts).
	ball.CollisionGroup = COLLISION_GROUPS.GameBall;
	ball.CFrame = new CFrame(spawnPos);

	// Engine-gravity canceller; BallSim keeps Force = mass × gravity per tick.
	const attachment = new Instance("Attachment");
	attachment.Name = "BallAttachment";
	attachment.Parent = ball;
	const antiGravity = new Instance("VectorForce");
	antiGravity.Name = "AntiGravity";
	antiGravity.Attachment0 = attachment;
	antiGravity.ApplyAtCenterOfMass = true;
	antiGravity.RelativeTo = Enum.ActuatorRelativeTo.World;
	antiGravity.Force = new Vector3(0, 0, 0);
	antiGravity.Parent = ball;

	// Live tunables + sim state as attributes: replicated to every client's
	// predicted sim and restored by rollback (BallSim reads them per tick).
	const tunables = ballTunables as unknown as Record<string, number>;
	for (const field of BALL_FIELDS) {
		if (field.scope === "live") {
			ball.SetAttribute(ballTuneAttr(field.key), tunables[field.key]);
		}
	}
	ball.SetAttribute(BallAttr.SimTime, 0);
	ball.SetAttribute(BallAttr.LastHitCar, "");
	ball.SetAttribute(BallAttr.LastHitTime, 0);
	// Clients use this to select their own ball in the multi-pitch arena.
	ball.SetAttribute("CB_PitchId", map.Name);

	ball.Parent = game.Workspace;
	ballByMap.set(map, ball);
	markPredictable(ball);

	warn(`[BallSpawner] spawned ${BALL_NAME} at ${spawnPos} (assemblyMass=${math.round(ball.AssemblyMass)})`);
};

spawner.GetBall = (map: Instance) => {
	return ballByMap.get(map);
};

spawner.RespawnBall = (map?: Instance) => {
	const target = map ?? currentMap;
	if (target === undefined || target.Parent === undefined) {
		warn("[BallSpawner] RespawnBall: no live map to respawn on");
		return false;
	}
	spawner.SpawnBall(target);
	return true;
};

export = spawner;
