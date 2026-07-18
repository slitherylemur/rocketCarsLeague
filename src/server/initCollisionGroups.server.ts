// Registers the runtime collision groups and the full collidability matrix
// for the ball/hitbox interaction (see shared/collisionGroups.ts for what
// each group is). Runs at server startup, before any car or ball spawns;
// group data replicates to clients, so the predicted simulations use the
// same matrix.
//
// Ball feel rationale: the ball must bounce off the big smooth damageBlock
// hitbox (predictable, Rocket-League-style contacts), NOT the detailed car
// body or the spinning suspended wheels. Car-vs-car and car-vs-map behavior
// is intentionally untouched: Hitbox parts collide with GameBall and nothing
// else, so making them CanCollide=true (spawnVehicle) has no other effect.

import { COLLISION_GROUPS } from "shared/collisionGroups";

const PhysicsService = game.GetService("PhysicsService");

const G = COLLISION_GROUPS;

// "vehicle"/"VehicleWheels" already exist in the place's registry; the pcall
// swallows the duplicate-registration error and guarantees every name below
// exists before the matrix writes.
for (const name of [G.Vehicle, G.VehicleWheels, G.GameBall, G.Hitbox, G.HitboxQuery]) {
	pcall(() => PhysicsService.RegisterCollisionGroup(name));
}

// GameBall: the world (map/ground = Default) and car hitboxes only.
PhysicsService.CollisionGroupSetCollidable(G.GameBall, G.Default, true);
PhysicsService.CollisionGroupSetCollidable(G.GameBall, G.Vehicle, false);
PhysicsService.CollisionGroupSetCollidable(G.GameBall, G.VehicleWheels, false);
PhysicsService.CollisionGroupSetCollidable(G.GameBall, G.Hitbox, true);
PhysicsService.CollisionGroupSetCollidable(G.GameBall, G.GameBall, true);

// Hitbox: GameBall only (set above). Explicitly never the map, car bodies,
// wheels, or other hitboxes — car-vs-car contact stays body-vs-body.
PhysicsService.CollisionGroupSetCollidable(G.Hitbox, G.Default, false);
PhysicsService.CollisionGroupSetCollidable(G.Hitbox, G.Vehicle, false);
PhysicsService.CollisionGroupSetCollidable(G.Hitbox, G.VehicleWheels, false);
PhysicsService.CollisionGroupSetCollidable(G.Hitbox, G.Hitbox, false);

// HitboxQuery: parts are never assigned this group; it exists so the damage
// overlap query can run under a group that "collides" with Hitbox parts only.
PhysicsService.CollisionGroupSetCollidable(G.HitboxQuery, G.Hitbox, true);
PhysicsService.CollisionGroupSetCollidable(G.HitboxQuery, G.Default, false);
PhysicsService.CollisionGroupSetCollidable(G.HitboxQuery, G.Vehicle, false);
PhysicsService.CollisionGroupSetCollidable(G.HitboxQuery, G.VehicleWheels, false);
PhysicsService.CollisionGroupSetCollidable(G.HitboxQuery, G.GameBall, false);

warn("[CollisionGroups] registered GameBall/Hitbox/HitboxQuery and matrix");
