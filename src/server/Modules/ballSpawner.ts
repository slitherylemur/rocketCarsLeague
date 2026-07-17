// Server-authoritative ball spawner (mirrors spawnVehicle's Phase 4 setup).
//
// Called once per loadMap(). The server creates the part at the map's
// center and marks it PredictionMode.On so clients are allowed to predict
// it (each client re-asserts On locally in ballRenderer.client.ts). Under
// Workspace.AuthorityMode = Server there is no SetNetworkOwner — the server
// simulates the ball and clients predict/rollback against it.

import {
	BALL_NAME,
	BALL_SIZE,
	BALL_MASS,
	BALL_CORE_SIZE,
	BALL_FRICTION,
	BALL_ELASTICITY,
	BALL_FRICTION_WEIGHT,
	BALL_ELASTICITY_WEIGHT,
} from "shared/ballSim/BallConfig";

const RunService = game.GetService("RunService");

const spawner = {} as {
	SpawnBall: (map: Instance) => void;
	DestroyBall: () => void;
};

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
function computePartBounds(map: Instance): LuaTuple<[Vector3, Vector3]> | undefined {
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
	return $tuple(minBound, maxBound);
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
	const [minBound, maxBound] = bounds;
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

spawner.DestroyBall = () => {
	const existing = game.Workspace.FindFirstChild(BALL_NAME);
	if (existing) {
		existing.Destroy();
	}
};

spawner.SpawnBall = (map: Instance) => {
	spawner.DestroyBall();

	const floorCenter = findSpawnCenter(map);
	if (floorCenter === undefined) {
		warn(`[BallSpawner] no BaseParts found in map ${map.Name}; ball not spawned`);
		return;
	}
	// Drop in from slightly above the floor so the spawn reads as an event.
	const spawnPos = floorCenter.add(new Vector3(0, BALL_SIZE / 2 + 10, 0));

	// Massless is ignored on an assembly root, so the sphere alone can never
	// get below density-0.01 mass (~42 at 20 studs). Instead: massless sphere
	// welded to a tiny dense core that carries the whole BALL_MASS — the same
	// trick as the cars (Massless bodies, mass in the wheels/seat).
	const ball = new Instance("Part");
	ball.Name = BALL_NAME;
	ball.Shape = Enum.PartType.Ball;
	ball.Size = new Vector3(BALL_SIZE, BALL_SIZE, BALL_SIZE);
	ball.Material = Enum.Material.SmoothPlastic;
	ball.Color = Color3.fromRGB(255, 170, 0);
	ball.CastShadow = true;
	ball.Anchored = false;
	ball.CanCollide = true;
	// .Touched would create a TouchTransmitter — an unpredictable class that
	// makes the engine refuse the assembly (see spawnVehicle damage notes).
	ball.CanTouch = false;
	ball.Massless = true;
	ball.CustomPhysicalProperties = new PhysicalProperties(
		0.01,
		BALL_FRICTION,
		BALL_ELASTICITY,
		BALL_FRICTION_WEIGHT,
		BALL_ELASTICITY_WEIGHT,
	);
	ball.CFrame = new CFrame(spawnPos);

	const coreVolume = BALL_CORE_SIZE ** 3;
	const core = new Instance("Part");
	core.Name = "MassCore";
	core.Size = new Vector3(BALL_CORE_SIZE, BALL_CORE_SIZE, BALL_CORE_SIZE);
	core.Transparency = 1;
	core.CastShadow = false;
	core.CanCollide = false;
	core.CanQuery = false;
	core.CanTouch = false;
	core.CustomPhysicalProperties = new PhysicalProperties(BALL_MASS / coreVolume, 0.3, 0, 1, 0);
	// Core must win assembly-root selection (Massless parts can't root an
	// assembly that has a massed part, but be explicit).
	core.RootPriority = 10;
	core.CFrame = ball.CFrame;
	core.Parent = ball;

	const weld = new Instance("WeldConstraint");
	weld.Part0 = ball;
	weld.Part1 = core;
	weld.Parent = ball;

	ball.Parent = game.Workspace;
	markPredictable(ball);

	warn(`[BallSpawner] spawned ${BALL_NAME} at ${spawnPos} (assemblyMass=${math.round(ball.AssemblyMass)})`);
};

export = spawner;
