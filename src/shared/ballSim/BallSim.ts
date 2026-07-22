// Custom scripted ball physics (Rocket-League style), server-authority
// compatible. See BALL_PHYSICS.md for the full design and tuning guide.
//
// The same module is initialized on the SERVER (initBallSim.server.ts) and
// on every CLIENT (initBallSim.client.ts) and ticks in BindToSimulation —
// the docs' "simulation sync" pattern, identical to VehicleSim. The ball is
// PredictionMode.On, so every client predicts it: hits from the local
// (predicted) car resolve instantly and the engine's rollback corrects
// mispredictions against the server's authoritative run of this same code.
//
// Physics model (per tick):
//   1. Engine contribution is neutralized: CanCollide=false (no engine
//      contacts) and an AntiGravity VectorForce cancels engine gravity, so
//      the engine only integrates position from the velocity we write.
//   2. Custom gravity (gravityScale) and air drag are integrated into v.
//   3. Ground probe (raycast down) de-penetrates the ball from the floor
//      and flags grounded for roll friction / rest.
//   4. World sweep: a spherecast along v*dt against ONLY the pitch's
//      STADIUM.collisionBottom / STADIUM.outer / groundPart (strict include
//      list); on approach the velocity reflects instantly — into-surface
//      speed × worldBounce, along-surface speed × (1 - worldFriction).
//   5. Car hits: closest point on each nearby HitboxMain box vs ball center;
//      the contact normal is (ballCenter - hitPoint).Unit. The ball-vs-car
//      RELATIVE velocity reflects (so both the ball's incoming speed and the
//      car's speed matter), then a Psyonix-style extra punch of
//      hitPower × closing speed is added along the car→ball direction with
//      its vertical component scaled by hitVerticalScale (flatter shots).
//      Applied to the ball only — the car feels nothing, as in RL.
//   6. Roll friction + full stop below restSpeed while grounded; speed cap.
//
// Rollback rules (same as VehicleSim): every value carried ACROSS ticks
// lives in an attribute on the ball (SimTime, the last-hit cooldown pair);
// all tunables are read from replicated BT_* attributes each tick so both
// peers simulate with identical numbers; timers compare sim time only.

import { BALL_NAME, BALL_FIELDS, ballTunables, ballTuneAttr } from "shared/ballSim/BallConfig";
import { COLLISION_GROUPS } from "shared/collisionGroups";
import { registerSimHook, SIM_ORDER_BALL } from "shared/simScheduler";

const RunService = game.GetService("RunService");
const Players = game.GetService("Players");

const IS_SERVER = RunService.IsServer();
// Per-pitch prediction scope: a client predicts and steps ONLY the ball on
// its own pitch (see tick); every other ball is authoritative on that client.
const LOCAL_PLAYER = IS_SERVER ? undefined : Players.LocalPlayer;

export const BallAttr = {
	SimTime: "BallSimTime",
	LastHitCar: "BallLastHitCar", // model name of the last car whose hitPower punch applied
	LastHitTime: "BallLastHitTime", // sim time of that punch (cooldown gate + client hit-sound stamp)
	LastHitSpeed: "BallLastHitSpeed", // closing speed of that punch (client hit-sound volume)
	LastBounceTime: "BallLastBounceTime", // sim time of the last world bounce (client bounce-sound stamp)
	LastBounceSpeed: "BallLastBounceSpeed", // into-surface speed of that bounce (client bounce-sound volume)
} as const;

// How far below the surface-touch distance the ground probe reaches: keeps
// `grounded` true through tiny bounces so roll friction & rest engage.
const GROUND_PROBE = 0.5;
// Sliding vs bouncing threshold (studs/s into the surface): below this the
// sweep just cancels the normal component instead of reflecting, so rolling
// contact doesn't micro-bounce.
const BOUNCE_MIN_SPEED = 2;
const SKIN = 0.05; // contact offset so the ball never re-penetrates

const liveKeys: string[] = [];
for (const field of BALL_FIELDS) {
	if (field.scope === "live") {
		liveKeys.push(field.key);
	}
}

// Multi-pitch (Top Table): one ball per pitch, all named BALL_NAME as
// Workspace children — every one is adopted and stepped.
const balls = new Set<BasePart>();
// Sim-step errors warn at most once per interval — visible when recurring
// (a permanently-swallowed error is silent divergence), without flooding.
const ERROR_WARN_INTERVAL = 5;
let lastErrorWarnAt: number | undefined;
// Server-only: tuning HUD edits, written into the BT_* attributes from
// inside the next sim step (attribute writes on predicted instances are only
// legal there) — the VehicleSim pending-op pattern.
let pendingTunables: Map<string, number> | undefined;

export function queueTunables(values: Map<string, number>) {
	if (!IS_SERVER) {
		return;
	}
	const pending = pendingTunables ?? new Map<string, number>();
	for (const [key, value] of values) {
		pending.set(key, value);
	}
	pendingTunables = pending;
}

function attrNumber(instance: Instance, name: string, fallback: number): number {
	const value = instance.GetAttribute(name);
	return typeIs(value, "number") ? value : fallback;
}

// Live tunable read: replicated attribute first, compiled default second.
function param(ball: BasePart, key: keyof typeof ballTunables): number {
	return attrNumber(ball, ballTuneAttr(key), ballTunables[key]);
}

// STRICT include-list collision. The ball part is CanCollide=false, so the
// engine resolves no contacts — these queries ARE the entire collision
// system, and they run as FilterType.Include over exactly:
//   - the ball's own pitch: STADIUM.collisionBottom + STADIUM.outer (the
//     arena shell), the pitch's groundPart (the floor), and every part under
//     the pitch's PartWallForBallProtection model (invisible containment
//     walls, optional per pitch);
//   - every car's Hitboxes.HitboxMain box (the car overlap query).
// Nothing else — goal parts, decor, detailed car bodies, wheels, player
// characters — can ever collide with the ball.
const worldParams = new RaycastParams();
worldParams.FilterType = Enum.RaycastFilterType.Include;
worldParams.IgnoreWater = true;

const carOverlapParams = new OverlapParams();
carOverlapParams.FilterType = Enum.RaycastFilterType.Include;
// HitboxMain sits in the Hitbox collision group, which collides with nothing
// — a query running as the default group would filter it out even though it
// is on the include list. HitboxQuery is the pseudo-group that "sees" Hitbox
// parts (same trick as the damage GetPartsInPart in VehicleClass).
carOverlapParams.CollisionGroup = COLLISION_GROUPS.HitboxQuery;

const PITCH_ATTRIBUTE = "CB_PitchId";
const STADIUM_NAME = "STADIUM";
const STADIUM_COLLIDER_NAMES = ["collisionBottom", "outer"];
const GROUND_PART_NAME = "groundPart";
const BALL_WALL_NAME = "PartWallForBallProtection";
const HITBOX_FOLDER_NAME = "Hitboxes";
const HITBOX_MAIN_NAME = "HitboxMain";

// Per-ball cache of its pitch's world colliders (the pitch never moves, so
// this only rebuilds when the pitch is torn down / the ball respawns).
interface WorldFilter {
	pitch: Instance;
	include: Instance[];
}
const worldFilterByBall = new Map<BasePart, WorldFilter>();
const missingFilterWarned = new Set<string>();

function buildWorldFilter(ball: BasePart): WorldFilter | undefined {
	const pitchId = ball.GetAttribute(PITCH_ATTRIBUTE);
	if (!typeIs(pitchId, "string")) {
		return undefined;
	}
	const mapFolder = game.Workspace.FindFirstChild("Map");
	const pitch = mapFolder !== undefined ? mapFolder.FindFirstChild(pitchId) : undefined;
	if (pitch === undefined) {
		return undefined;
	}
	const include: Instance[] = [];
	const stadium = pitch.FindFirstChild(STADIUM_NAME, true);
	if (stadium !== undefined) {
		for (const name of STADIUM_COLLIDER_NAMES) {
			const collider = stadium.FindFirstChild(name, true);
			if (collider !== undefined) {
				include.push(collider);
			}
		}
	}
	const ground = pitch.FindFirstChild(GROUND_PART_NAME, true);
	if (ground !== undefined) {
		include.push(ground);
	}
	const requiredCount = include.size();
	// FilterDescendantsInstances includes descendants, so listing the model
	// covers every wall part under it. Optional — not counted in the warning.
	const ballWall = pitch.FindFirstChild(BALL_WALL_NAME, true);
	if (ballWall !== undefined) {
		include.push(ballWall);
	}
	if (requiredCount < STADIUM_COLLIDER_NAMES.size() + 1 && !missingFilterWarned.has(pitchId)) {
		missingFilterWarned.add(pitchId);
		warn(
			`[BallSim] pitch ${pitchId}: expected ${STADIUM_NAME}.collisionBottom/${STADIUM_NAME}.outer + ${GROUND_PART_NAME}, found ${requiredCount} — ball collides with those only`,
		);
	}
	if (include.size() === 0) {
		return undefined;
	}
	return { pitch, include };
}

// True when the ball has a usable world filter; false = don't simulate yet
// (e.g. the pitch hasn't replicated to this client) rather than let the ball
// fall through a world it can't see.
function refreshFilters(ball: BasePart): boolean {
	let cached = worldFilterByBall.get(ball);
	if (cached !== undefined) {
		let valid = cached.pitch.Parent !== undefined;
		if (valid) {
			for (const collider of cached.include) {
				if (!collider.IsDescendantOf(game.Workspace)) {
					valid = false;
					break;
				}
			}
		}
		if (!valid) {
			worldFilterByBall.delete(ball);
			cached = undefined;
		}
	}
	if (cached === undefined) {
		cached = buildWorldFilter(ball);
		if (cached === undefined) {
			return false;
		}
		worldFilterByBall.set(ball, cached);
	}
	worldParams.FilterDescendantsInstances = cached.include;

	// Hitbox list from the maintained registry (no GetChildren/FindFirstChild
	// tree walks in the fixed-step path), filtered to THIS ball's pitch: a
	// ball only ever considers cars whose owner is participating on its own
	// pitch. A ball with no pitch id (test place / legacy) keeps the old
	// include-everything behaviour.
	const ballPitch = ball.GetAttribute(PITCH_ATTRIBUTE);
	const hitboxMains: Instance[] = [];
	for (const [model, entry] of hitboxRegistry) {
		if (model.Parent === undefined || entry.main.Parent === undefined) {
			hitboxRegistry.delete(model);
			continue;
		}
		if (ballPitch !== undefined && carPitchOf(model, entry) !== ballPitch) {
			continue;
		}
		hitboxMains.push(entry.main);
	}
	carOverlapParams.FilterDescendantsInstances = hitboxMains;
	return true;
}

// ---- vehicle hitbox registry ---------------------------------------------
// Maintained on spawn/despawn instead of rediscovered every simulation step.
// Both peers build it from the replicated Vehicles folder, so the include
// list is identical for the server sim and the predicting client.

interface HitboxEntry {
	main: BasePart;
	owner?: Player; // resolved lazily from the OwnerUserId attribute
	ownerUserId?: number;
}

const hitboxRegistry = new Map<Model, HitboxEntry>();
const OWNER_USER_ID_ATTR = "OwnerUserId"; // VehicleModelAttr.OwnerUserId (no import: avoid a sim<->sim cycle)

// The pitch a car participates on = its OWNER's replicated CB_PitchId player
// attribute (set by the match layer). Cached player handle; the attribute is
// read live so mid-round pitch moves take effect without respawns.
function carPitchOf(model: Model, entry: HitboxEntry): unknown {
	const userId = model.GetAttribute(OWNER_USER_ID_ATTR);
	if (!typeIs(userId, "number") || userId === 0) {
		return undefined; // unowned (showcase/garage) car — participates nowhere
	}
	if (entry.owner === undefined || entry.owner.UserId !== userId || entry.owner.Parent === undefined) {
		entry.owner = Players.GetPlayerByUserId(userId);
	}
	return entry.owner !== undefined ? entry.owner.GetAttribute(PITCH_ATTRIBUTE) : undefined;
}

function adoptVehicle(model: Instance) {
	if (!model.IsA("Model")) {
		return;
	}
	task.spawn(() => {
		// Under StreamingEnabled the hitbox folder can replicate several
		// seconds after the model — retry briefly instead of missing the car.
		const t0 = os.clock();
		while (model.Parent !== undefined && os.clock() - t0 < 20) {
			const hitboxes = model.FindFirstChild(HITBOX_FOLDER_NAME);
			const main = hitboxes !== undefined ? hitboxes.FindFirstChild(HITBOX_MAIN_NAME) : undefined;
			if (main !== undefined && main.IsA("BasePart")) {
				hitboxRegistry.set(model, { main });
				return;
			}
			task.wait(0.25);
		}
	});
}

function watchVehiclesFolder() {
	task.spawn(() => {
		const vehicles = game.Workspace.WaitForChild("Vehicles", math.huge)!;
		vehicles.ChildAdded.Connect(adoptVehicle);
		vehicles.ChildRemoved.Connect((model) => {
			if (model.IsA("Model")) {
				hitboxRegistry.delete(model);
			}
		});
		for (const child of vehicles.GetChildren()) {
			adoptVehicle(child);
		}
	});
}

interface CarContact {
	normal: Vector3;
	hitPoint: Vector3;
	penetration: number;
	carVelocity: Vector3;
	carModel: Model;
	carCenter: Vector3;
}

// Closest point on an (oriented box) hitbox part to the ball center; returns
// a contact when the ball overlaps it. Boxes only — exact and cheap.
function boxContact(ball: BasePart, part: BasePart, center: Vector3, radius: number): CarContact | undefined {
	const half = part.Size.div(2);
	const localCenter = part.CFrame.PointToObjectSpace(center);
	const clamped = new Vector3(
		math.clamp(localCenter.X, -half.X, half.X),
		math.clamp(localCenter.Y, -half.Y, half.Y),
		math.clamp(localCenter.Z, -half.Z, half.Z),
	);
	let normal: Vector3;
	let hitPoint: Vector3;
	let distance: number;
	if (localCenter === clamped) {
		// Ball center INSIDE the box (deep overlap / spawned into a car):
		// push out along center-to-center, which is always well-defined.
		hitPoint = part.Position;
		const away = center.sub(part.Position);
		normal = away.Magnitude > 1e-3 ? away.Unit : new Vector3(0, 1, 0);
		distance = 0;
	} else {
		hitPoint = part.CFrame.PointToWorldSpace(clamped);
		const away = center.sub(hitPoint);
		distance = away.Magnitude;
		if (distance > radius) {
			return undefined;
		}
		normal = distance > 1e-3 ? away.Unit : new Vector3(0, 1, 0);
	}
	const carModel = part.Parent !== undefined ? part.Parent.Parent : undefined;
	if (carModel === undefined || !carModel.IsA("Model")) {
		return undefined;
	}
	return {
		normal,
		hitPoint,
		penetration: radius - distance,
		carVelocity: part.GetVelocityAtPosition(hitPoint),
		carModel,
		carCenter: part.Position,
	};
}

// A ball with no usable world filter is not simulated — but the ENGINE still
// integrates it: with a stale/zero AntiGravity force an unanchored frozen
// ball freefalls through the CanCollide=false floor until the spawner's
// escape recovery respawns it, forever (the GoldPitch escape loop). Hold it
// in place instead — gravity cancelled, velocity zeroed — and, after a few
// seconds, say exactly WHY the filter is missing so broken pitch wiring is
// visible instead of masked by the recovery cycle.
const frozenSince = new Map<BasePart, number>();
const frozenWarned = new Set<BasePart>();

function describeFilterFailure(ball: BasePart): string {
	const pitchId = ball.GetAttribute(PITCH_ATTRIBUTE);
	if (!typeIs(pitchId, "string")) {
		return `ball has no ${PITCH_ATTRIBUTE} attribute`;
	}
	const mapFolder = game.Workspace.FindFirstChild("Map");
	if (mapFolder === undefined) {
		return "Workspace.Map missing";
	}
	const pitch = mapFolder.FindFirstChild(pitchId);
	if (pitch === undefined) {
		return `Workspace.Map.${pitchId} missing`;
	}
	return `pitch ${pitchId} has no ${STADIUM_NAME} colliders / ${GROUND_PART_NAME}`;
}

function holdFrozenBall(ball: BasePart) {
	if (!ball.Anchored) {
		const antiGravity = ball.FindFirstChild("AntiGravity");
		if (antiGravity !== undefined && antiGravity.IsA("VectorForce")) {
			antiGravity.Force = new Vector3(0, ball.AssemblyMass * game.Workspace.Gravity, 0);
		}
		ball.AssemblyLinearVelocity = new Vector3(0, 0, 0);
	}
	const t0 = frozenSince.get(ball) ?? os.clock();
	frozenSince.set(ball, t0);
	if (IS_SERVER && !frozenWarned.has(ball) && os.clock() - t0 > 3) {
		frozenWarned.add(ball);
		warn(`[BallSim] ball frozen >3s — ${describeFilterFailure(ball)}; holding it in place instead of freefalling`);
	}
}

function stepBall(ball: BasePart, dt: number) {
	// No world filter yet (pitch not replicated / parts missing): freeze the
	// sim rather than integrating gravity into a world with no floor.
	if (!refreshFilters(ball)) {
		holdFrozenBall(ball);
		return;
	}
	if (frozenSince.has(ball)) {
		frozenSince.delete(ball);
		frozenWarned.delete(ball);
	}

	const now = attrNumber(ball, BallAttr.SimTime, 0) + dt;
	ball.SetAttribute(BallAttr.SimTime, now);

	const gravityScale = param(ball, "gravityScale");
	const drag = param(ball, "drag");
	const rollFriction = param(ball, "rollFriction");
	const restSpeed = param(ball, "restSpeed");
	const maxSpeed = param(ball, "maxSpeed");
	const worldBounce = param(ball, "worldBounce");
	const worldFriction = param(ball, "worldFriction");
	const carBounce = param(ball, "carBounce");
	const hitPower = param(ball, "hitPower");
	const hitVerticalScale = param(ball, "hitVerticalScale");
	const hitCooldown = param(ball, "hitCooldown");

	const gravity = game.Workspace.Gravity;
	const radius = ball.Size.X / 2;

	// Keep the engine's gravity fully cancelled (mass or Workspace.Gravity
	// may change); our own gravity is integrated below.
	const antiGravity = ball.FindFirstChild("AntiGravity");
	if (antiGravity !== undefined && antiGravity.IsA("VectorForce")) {
		antiGravity.Force = new Vector3(0, ball.AssemblyMass * gravity, 0);
	}

	let position = ball.Position;
	let positionChanged = false;
	let v = ball.AssemblyLinearVelocity;

	// 2. custom gravity + air drag
	v = v.add(new Vector3(0, -gravity * gravityScale * dt, 0));
	v = v.mul(math.max(0, 1 - drag * dt));

	// 3. ground probe: de-penetrate + grounded flag
	let grounded = false;
	let groundNormal = new Vector3(0, 1, 0);
	const probe = game.Workspace.Raycast(position, new Vector3(0, -(radius + GROUND_PROBE), 0), worldParams);
	if (probe !== undefined) {
		grounded = true;
		groundNormal = probe.Normal;
		const clearance = position.Y - probe.Position.Y;
		if (clearance < radius) {
			position = position.add(new Vector3(0, radius - clearance + SKIN, 0));
			positionChanged = true;
		}
	}

	// 4. world sweep along this tick's motion
	const travel = v.mul(dt);
	if (travel.Magnitude > 1e-4) {
		const sweep = game.Workspace.Spherecast(position, radius, travel, worldParams);
		if (sweep !== undefined) {
			const n = sweep.Normal;
			const vn = v.Dot(n);
			if (vn < -BOUNCE_MIN_SPEED) {
				// Real impact: instant reflection with bounce + surface friction.
				const tangential = v.sub(n.mul(vn));
				v = tangential.mul(1 - worldFriction).add(n.mul(-vn * worldBounce));
				// Advance to the contact point so we never tunnel.
				position = position.add(travel.Unit.mul(math.max(sweep.Distance - SKIN, 0)));
				positionChanged = true;
				// Bounce stamp for the client's impact sounds (ballRenderer):
				// attributes, so the stamp predicts and rolls back with the sim.
				ball.SetAttribute(BallAttr.LastBounceTime, now);
				ball.SetAttribute(BallAttr.LastBounceSpeed, -vn);
			} else if (vn < 0) {
				// Grazing/rolling contact: just slide (cancel the into-surface part).
				v = v.sub(n.mul(vn));
			}
			if (n.Y > 0.5) {
				grounded = true;
				groundNormal = n;
			}
		}
	}

	// 5. car hits via the HitboxMain boxes (the overlap's include list holds
	// exactly those parts; the name guard is belt-and-braces).
	//
	// One contact per tick, chosen DETERMINISTICALLY: GetPartBoundsInRadius
	// returns results in no guaranteed order, so "first box wins" could pick
	// a different car on client and server from identical physics state — a
	// guaranteed misprediction whenever two cars pinch the ball. The deepest
	// penetration wins instead (ties broken by model name), which both peers
	// compute identically from the same state.
	const nearby = game.Workspace.GetPartBoundsInRadius(position, radius, carOverlapParams);
	let best: CarContact | undefined;
	for (const part of nearby) {
		if (part.Name !== HITBOX_MAIN_NAME || part.Parent === undefined) {
			continue;
		}
		const contact = boxContact(ball, part, position, radius);
		if (contact === undefined) {
			continue;
		}
		if (
			best === undefined ||
			contact.penetration > best.penetration + 1e-6 ||
			(math.abs(contact.penetration - best.penetration) <= 1e-6 && contact.carModel.Name < best.carModel.Name)
		) {
			best = contact;
		}
	}
	if (best !== undefined) {
		const contact = best;

		const n = contact.normal;
		const relV = v.sub(contact.carVelocity);
		const closing = -relV.Dot(n); // how fast ball and car approach along the normal

		if (closing > 0) {
			// Relative-velocity reflection: ball speed INTO the car and car
			// speed INTO the ball both feed this, per the design goal.
			const reflected = relV.add(n.mul(closing * (1 + carBounce)));
			v = contact.carVelocity.add(reflected);

			// Psyonix-style extra punch, cooldown-gated per car so a car
			// pushing the ball for several frames doesn't machine-gun it.
			const lastCar = ball.GetAttribute(BallAttr.LastHitCar);
			const lastTime = attrNumber(ball, BallAttr.LastHitTime, -math.huge);
			if (lastCar !== contact.carModel.Name || now - lastTime >= hitCooldown) {
				let hitDir = position.sub(contact.carCenter);
				hitDir = new Vector3(hitDir.X, hitDir.Y * hitVerticalScale, hitDir.Z);
				const dir = hitDir.Magnitude > 1e-3 ? hitDir.Unit : n;
				v = v.add(dir.mul(hitPower * closing));
				ball.SetAttribute(BallAttr.LastHitCar, contact.carModel.Name);
				ball.SetAttribute(BallAttr.LastHitTime, now);
				ball.SetAttribute(BallAttr.LastHitSpeed, closing);
			}
		}

		// De-penetrate so the next tick starts outside the box — but never
		// THROUGH a wall: a car pinching the ball against the arena shell (the
		// goal mouth, classically) would otherwise push the centre past the
		// wall, and the next tick's world sweep starts overlapping/behind it
		// and reports no hit — the ball tunnels out of the pitch. Clamp the
		// push at the first world collider and kill the into-wall velocity.
		if (contact.penetration > 0) {
			const push = n.mul(contact.penetration + SKIN);
			const wallHit = game.Workspace.Spherecast(position, radius, push, worldParams);
			if (wallHit !== undefined) {
				position = position.add(push.Unit.mul(math.max(wallHit.Distance - SKIN, 0)));
				const wallNormal = wallHit.Normal;
				const intoWall = v.Dot(wallNormal);
				if (intoWall < 0) {
					v = v.sub(wallNormal.mul(intoWall));
				}
			} else {
				position = position.add(push);
			}
			positionChanged = true;
		}
	}

	// 6. roll friction, rest stop, speed cap
	if (grounded) {
		const horizontal = new Vector3(v.X, 0, v.Z).mul(math.max(0, 1 - rollFriction * dt));
		v = new Vector3(horizontal.X, v.Y, horizontal.Z);
		if (v.Magnitude < restSpeed) {
			v = new Vector3(0, 0, 0);
		}
	}
	const speed = v.Magnitude;
	if (speed > maxSpeed) {
		v = v.mul(maxSpeed / speed);
	}

	// write back
	ball.AssemblyLinearVelocity = v;
	if (positionChanged) {
		ball.CFrame = ball.CFrame.Rotation.add(position);
	}
	// Visual spin: roll without slipping on the ground, slow decay in the air.
	if (grounded && speed > restSpeed) {
		ball.AssemblyAngularVelocity = groundNormal.Cross(v).div(radius);
	} else if (!grounded) {
		ball.AssemblyAngularVelocity = ball.AssemblyAngularVelocity.mul(math.max(0, 1 - 0.5 * dt));
	} else {
		ball.AssemblyAngularVelocity = new Vector3(0, 0, 0);
	}
}

// ---- lifecycle (mirrors VehicleSim.initialize) ----

function tick(dt: number) {
	// Tuning HUD edits (server only) — the sanctioned in-sim attribute write,
	// applied to EVERY live ball so all pitches share the same numbers.
	if (IS_SERVER && pendingTunables !== undefined) {
		const pending = pendingTunables;
		pendingTunables = undefined;
		for (const ball of balls) {
			if (ball.Parent !== undefined) {
				for (const [key, value] of pending) {
					ball.SetAttribute(ballTuneAttr(key), value);
				}
			}
		}
	}

	for (const ball of balls) {
		if (ball.Parent === undefined) {
			balls.delete(ball);
			worldFilterByBall.delete(ball);
			frozenSince.delete(ball);
			frozenWarned.delete(ball);
			continue;
		}
		// A client simulates ONLY its own pitch's ball (the one it predicts —
		// ballRenderer scopes the prediction marking the same way). Stepping
		// every pitch's ball here made N pitches cost N sims on every client,
		// and writing velocities to authoritative (unpredicted) balls just
		// fought replication. The server still steps every live ball. A ball
		// with no pitch id keeps the old step-everywhere behaviour.
		if (!IS_SERVER) {
			const ballPitch = ball.GetAttribute(PITCH_ATTRIBUTE);
			if (ballPitch !== undefined && ballPitch !== LOCAL_PLAYER!.GetAttribute(PITCH_ATTRIBUTE)) {
				continue;
			}
		}
		const [ok, err] = pcall(() => stepBall(ball, dt));
		if (!ok) {
			const clock = os.clock();
			if (lastErrorWarnAt === undefined || clock - lastErrorWarnAt > ERROR_WARN_INTERVAL) {
				lastErrorWarnAt = clock;
				warn(`[BallSim] ${err}`);
			}
		}
	}
}

function adoptBall(child: Instance) {
	if (child.Name === BALL_NAME && child.IsA("BasePart")) {
		balls.add(child);
		lastErrorWarnAt = undefined;
	}
}

let initialized = false;

export function initialize() {
	if (initialized) {
		return;
	}
	initialized = true;

	game.Workspace.ChildAdded.Connect(adoptBall);
	for (const child of game.Workspace.GetChildren()) {
		adoptBall(child);
	}
	watchVehiclesFolder();

	// The shared scheduler owns the single BindToSimulation (explicit
	// SIM_RATE_HZ frequency); the ball hook runs strictly AFTER the vehicle
	// hook on every peer so car→ball interactions resolve in the same order
	// on original ticks and rollback replays alike.
	registerSimHook("BallSim", SIM_ORDER_BALL, (deltaTime) => tick(deltaTime));
	print(`[BallSim] ${IS_SERVER ? "server" : "client"} registered on the shared simulation scheduler`);
}
