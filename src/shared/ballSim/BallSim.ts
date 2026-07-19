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
//   4. World sweep: a spherecast along v*dt; on approach the velocity
//      reflects instantly — into-surface speed × worldBounce, along-surface
//      speed × (1 - worldFriction).
//   5. Car hits: closest point on each nearby Hitboxes box vs ball center;
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

const RunService = game.GetService("RunService");
const Players = game.GetService("Players");

const IS_SERVER = RunService.IsServer();

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
let errorLogged = false;
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

// World query filter: everything except the cars (hit separately via their
// Hitboxes), the ball itself and player characters. The renderer clone is
// CanQuery=false, so queries never see it. Running the queries under the
// GameBall collision group additionally excludes anything the matrix says
// the ball ignores.
const worldParams = new RaycastParams();
worldParams.FilterType = Enum.RaycastFilterType.Exclude;
worldParams.IgnoreWater = true;
worldParams.CollisionGroup = COLLISION_GROUPS.GameBall;

const carOverlapParams = new OverlapParams();
carOverlapParams.FilterType = Enum.RaycastFilterType.Include;
// GameBall × Hitbox is the only colliding pair inside the Vehicles folder,
// so this query returns exactly the hitbox parts (never body/wheels).
carOverlapParams.CollisionGroup = COLLISION_GROUPS.GameBall;

function refreshFilters(ball: BasePart) {
	const filter: Instance[] = [ball];
	const vehicles = game.Workspace.FindFirstChild("Vehicles");
	if (vehicles) {
		filter.push(vehicles);
	}
	for (const player of Players.GetPlayers()) {
		if (player.Character) {
			filter.push(player.Character);
		}
	}
	worldParams.FilterDescendantsInstances = filter;
	carOverlapParams.FilterDescendantsInstances = vehicles ? [vehicles] : [];
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

function stepBall(ball: BasePart, dt: number) {
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

	refreshFilters(ball);

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

	// 5. car hits via the Hitboxes boxes
	const nearby = game.Workspace.GetPartBoundsInRadius(position, radius, carOverlapParams);
	let hitCar: Model | undefined; // one contact per tick — first box wins
	for (const part of nearby) {
		if (hitCar !== undefined) {
			break;
		}
		if (part.Parent === undefined || (part.Parent.Name !== "Hitboxes" && part.Name !== "damageBlock")) {
			continue;
		}
		const contact = boxContact(ball, part, position, radius);
		if (contact === undefined) {
			continue;
		}
		hitCar = contact.carModel;

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

		// De-penetrate so the next tick starts outside the box.
		if (contact.penetration > 0) {
			position = position.add(n.mul(contact.penetration + SKIN));
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
			continue;
		}
		const [ok, err] = pcall(() => stepBall(ball, dt));
		if (!ok && !errorLogged) {
			errorLogged = true;
			warn(`[BallSim] ${err}`);
		}
	}
}

function adoptBall(child: Instance) {
	if (child.Name === BALL_NAME && child.IsA("BasePart")) {
		balls.add(child);
		errorLogged = false;
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

	const [ok, err] = pcall(() => {
		RunService.BindToSimulation((deltaTime: number) => tick(deltaTime));
	});
	if (ok) {
		print(`[BallSim] ${IS_SERVER ? "server" : "client"} bound via BindToSimulation`);
	} else {
		// Same fallback stance as VehicleSim: only for engines without the
		// server-authority beta.
		warn(`[BallSim] BindToSimulation unavailable (${err}); falling back to Heartbeat`);
		RunService.Heartbeat.Connect((deltaTime) => tick(deltaTime));
	}
}
