// Shared configuration for the server-authoritative game ball.
//
// The ball follows the same server-authority model as the cars
// (SERVER_AUTHORITY_PLAN.md): the server owns the simulation and marks the
// part PredictionMode.On; every client predicts it so hits from the local
// (predicted) car resolve instantly, and the engine's rollback corrects
// mispredictions. ballRenderer.client.ts hides the simulated part and
// smooths only the correction jumps — the "Position smoothing" technique
// from the Roblox server-authority docs (soccer-template variation).
//
// Ball feel is pure Roblox physics — no scripted sim; these part
// properties are the only tuning surface.

export const BALL_NAME = "GameBall";

/** Diameter in studs (the part is BALL_SIZE³ with Shape = Ball). */
export const BALL_SIZE = 20;

// --- physical feel ---
// Engine collisions decide hit force, so mass is the main dial: lower =
// punted harder and further, higher = tankier. Cars weigh ~80 physically
// (Massless bodies, mass in wheels/seat). The ball uses the same trick —
// Massless sphere + welded dense core carrying all of BALL_MASS — because
// Massless is ignored on an assembly root and the sphere alone can't get
// below ~42 even at minimum density.
export const BALL_MASS = 15;
/** Edge length of the invisible 1-stud core; density = BALL_MASS / 1³. */
export const BALL_CORE_SIZE = 1;
// High friction + weight so ground contact grips and bleeds speed into
// roll instead of skating.
export const BALL_FRICTION = 1;
export const BALL_FRICTION_WEIGHT = 10;
/** Moderate bounce — high elasticity on a light ball made every touch a moon shot. */
export const BALL_ELASTICITY = 0.6;
/** High weight so the ball's bounce behavior dominates over map materials. */
export const BALL_ELASTICITY_WEIGHT = 20;

// --- client smoothing (soccer-template style) ---
/**
 * The renderer pins exactly to the simulated ball (zero visual latency)
 * until the sim jumps at least this far in one frame gap — which only
 * happens on a rollback correction or a remote hit arriving late.
 */
export const SMOOTH_ENGAGE_DISTANCE = 2;
/** Once the renderer is back within this distance it re-pins exactly. */
export const SMOOTH_RELEASE_DISTANCE = 0.5;
/** SmoothDamp time constant in seconds; smaller = snappier catch-up. */
export const SMOOTH_TIME = 0.15;
