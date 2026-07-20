// Collision group names, in one place. "Default", "vehicle" and
// "VehicleWheels" predate this file ("vehicle"/"VehicleWheels" are assigned
// per part in spawnVehicle.makeWheelsUncollidable; the registry lives in the
// place file). The rest are registered at runtime by
// initCollisionGroups.server.ts, which also owns the collidability matrix.

export const COLLISION_GROUPS = {
	Default: "Default",
	/** Every non-wheel car part, including the car's detailed body. */
	Vehicle: "vehicle",
	/** Wheel parts: collide with the world only, never with car bodies. */
	VehicleWheels: "VehicleWheels",
	// (GameBall and BallProtectionWall are gone: the ball never
	// engine-collides and BallSim's queries are strict include lists, so the
	// ball needs no group and the invisible protection walls were deleted.)
	/**
	 * Car Hitboxes parts (HitboxMain/damageBlock): pure query surfaces —
	 * BallSim's include-list overlap reads HitboxMain, the damage
	 * GetPartsInPart reads damageBlock. Engine-collides with nothing: never
	 * the map, never cars, never the ball (which is CanCollide=false).
	 */
	Hitbox: "Hitbox",
	/**
	 * Query-only pseudo-group — no part is ever assigned it. The damage
	 * GetPartsInPart in VehicleClass runs under this group so it sees Hitbox
	 * parts (which no longer collide with Default, the group queries default
	 * to) and nothing else.
	 */
	HitboxQuery: "HitboxQuery",
} as const;
