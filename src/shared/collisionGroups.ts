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
	/** The game ball: collides with the world and car Hitboxes ONLY. */
	GameBall: "GameBall",
	/**
	 * Car Hitboxes parts (damageBlock): the ball's physical contact surface
	 * (big smooth box = predictable bounces) and the damage query volume.
	 * Collides with GameBall only — never the map, never other cars.
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
