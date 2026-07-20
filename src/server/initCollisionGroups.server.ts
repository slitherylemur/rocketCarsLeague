// Registers the runtime collision groups for the car hitbox/damage system
// (see shared/collisionGroups.ts for what each group is). Runs at server
// startup, before any car spawns; group data replicates to clients.
//
// The BALL is deliberately absent here: it never engine-collides
// (CanCollide=false) and BallSim's queries are strict FilterType.Include
// lists (pitch STADIUM.collisionBottom/outer + groundPart + car HitboxMain),
// so no collision-group matrix is involved in ball behavior at all.
//
// Hitbox parts are CanCollide=true (spawnVehicle) but collide with NOTHING
// via this matrix — they exist purely as query surfaces: BallSim's include
// list reads HitboxMain, and the damage GetPartsInPart runs under
// HitboxQuery to see damageBlock. Car-vs-car and car-vs-map behavior is
// intentionally untouched (body-vs-body via the legacy "vehicle" group).

import { COLLISION_GROUPS } from "shared/collisionGroups";

const PhysicsService = game.GetService("PhysicsService");

const G = COLLISION_GROUPS;

// "vehicle"/"VehicleWheels" already exist in the place's registry; the pcall
// swallows the duplicate-registration error and guarantees every name below
// exists before the matrix writes.
for (const name of [G.Vehicle, G.VehicleWheels, G.Hitbox, G.HitboxQuery]) {
	pcall(() => PhysicsService.RegisterCollisionGroup(name));
}

// Hitbox: engine-collides with nothing. The ball's contact with HitboxMain
// is resolved by BallSim's include-list overlap query, not by the engine.
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

warn("[CollisionGroups] registered Hitbox/HitboxQuery and matrix (ball uses include-list queries, no groups)");
