// Shared configuration for the server-authoritative game ball.
//
// The ball follows the same server-authority model as the cars
// (SERVER_AUTHORITY_PLAN.md): the server owns the simulation and marks the
// part PredictionMode.On; every client predicts it so hits from the local
// (predicted) car resolve instantly, and the engine's rollback corrects
// mispredictions. ballRenderer.client.ts hides the simulated part and
// smooths only the correction jumps.
//
// Ball feel is CUSTOM scripted physics (BallSim.ts, Rocket-League style) —
// engine collisions are off (CanCollide=false); BallSim does sweep tests
// against the map and closest-point tests against car Hitboxes and reflects
// velocity itself. See BALL_PHYSICS.md for the design and tuning guide.
//
// Tunables flow: this table holds the SERVER's authoritative values (and
// each client's smoothing values). Every "live" field is mirrored into an
// attribute on the ball part (ballTuneAttr name) — attributes replicate and
// roll back, so both peers' sims always read identical numbers. Editing a
// live field via the tuning HUD needs no respawn; only `size` does.

export const BALL_NAME = "GameBall";

/** Attribute name a live tunable is stored under on the ball part. */
export function ballTuneAttr(key: string): string {
	return `BT_${key}`;
}

export interface BallTunables {
	/** Diameter in studs. Respawn-scoped: applying a change respawns the ball. */
	size: number;

	// --- flight (Rocket League reference: gravity 650uu/s² on a 91uu-radius
	// ball ≈ 7.1 g/r; Roblox 196.2 on a 13-stud radius is 15 g/r, so ~0.5
	// scale matches RL's floaty arc) ---
	/** Fraction of Workspace.Gravity applied to the ball. */
	gravityScale: number;
	/** Per-second velocity decay in the air (RL ≈ 0.03; higher = dies down sooner). */
	drag: number;
	/** EXTRA per-second horizontal decay while rolling on the ground. */
	rollFriction: number;
	/** Below this speed while grounded the ball stops completely. */
	restSpeed: number;
	/** Hard speed cap, studs/s (RL caps at ~2.6× car top speed). */
	maxSpeed: number;

	// --- world bounces ---
	/** Restitution vs map: fraction of into-surface speed kept (RL 0.6). */
	worldBounce: number;
	/** Fraction of along-surface speed LOST per world bounce. */
	worldFriction: number;

	// --- car hits ---
	/** Restitution of the ball-vs-car relative velocity on a hit. */
	carBounce: number;
	/**
	 * Psyonix-style extra punch: added speed = hitPower × closing speed,
	 * along the car→ball direction. This is the main "how hard do touches
	 * feel" dial and is NOT applied back on the car.
	 */
	hitPower: number;
	/** Vertical scale on the hit direction (RL 0.35: flatter, drivable shots). */
	hitVerticalScale: number;
	/** Seconds before the same car can add another hitPower punch. */
	hitCooldown: number;

	// --- client smoothing (soccer-template style; per-client, not replicated) ---
	/** Renderer pins exactly to the sim until it jumps at least this far. */
	smoothEngageDistance: number;
	/** Once the renderer is back within this distance it re-pins exactly. */
	smoothReleaseDistance: number;
	/** SmoothDamp time constant in seconds; smaller = snappier catch-up. */
	smoothTime: number;
}

export const ballTunables: BallTunables = {
	size: 20,
	gravityScale: 0.55,
	drag: 0.1,
	rollFriction: 0.6,
	restSpeed: 4,
	maxSpeed: 300,
	worldBounce: 0.6,
	worldFriction: 0.25,
	carBounce: 0.5,
	hitPower: 1.2,
	hitVerticalScale: 0.1,
	hitCooldown: 0.15,
	smoothEngageDistance: 2,
	smoothReleaseDistance: 0.5,
	smoothTime: 0.15,
};

// Field metadata shared by the tuning HUD (row labels), the server remote
// (validation clamps + routing) and BallSim (live attr reads). Order here is
// the display order.
//   scope "respawn": part property — applying respawns the ball.
//   scope "live":    read from the ball's attributes every sim tick.
//   scope "client":  local rendering knob, applied on the editing client.
export interface BallFieldSpec {
	key: keyof BallTunables;
	label: string;
	min: number;
	max: number;
	scope: "respawn" | "live" | "client";
}

export const BALL_FIELDS: ReadonlyArray<BallFieldSpec> = [
	{ key: "size", label: "Size (diameter)", min: 1, max: 100, scope: "respawn" },
	{ key: "gravityScale", label: "Gravity scale", min: 0, max: 3, scope: "live" },
	{ key: "drag", label: "Air drag /s", min: 0, max: 5, scope: "live" },
	{ key: "rollFriction", label: "Roll friction /s", min: 0, max: 10, scope: "live" },
	{ key: "restSpeed", label: "Rest speed", min: 0, max: 50, scope: "live" },
	{ key: "maxSpeed", label: "Max speed", min: 10, max: 1000, scope: "live" },
	{ key: "worldBounce", label: "World bounce", min: 0, max: 1.5, scope: "live" },
	{ key: "worldFriction", label: "World friction", min: 0, max: 1, scope: "live" },
	{ key: "carBounce", label: "Car bounce", min: 0, max: 2, scope: "live" },
	{ key: "hitPower", label: "Hit power", min: 0, max: 10, scope: "live" },
	{ key: "hitVerticalScale", label: "Hit vertical scale", min: 0, max: 1, scope: "live" },
	{ key: "hitCooldown", label: "Hit cooldown (s)", min: 0, max: 2, scope: "live" },
	{ key: "smoothEngageDistance", label: "Smooth engage dist", min: 0, max: 100, scope: "client" },
	{ key: "smoothReleaseDistance", label: "Smooth release dist", min: 0, max: 50, scope: "client" },
	{ key: "smoothTime", label: "Smooth time (s)", min: 0.01, max: 2, scope: "client" },
];
