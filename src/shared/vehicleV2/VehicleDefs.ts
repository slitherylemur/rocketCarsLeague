// Vehicle V2 definition layer — maps every cosmetic template to a physics
// preset and derives its VISUAL wheel metadata (hardpoints, radii, steer
// flags, canonical-contact mapping) from the authored template at server
// startup. Physics never reads any of this (gate G-10) — it exists purely so
// the client can build a coherent render rig for any 4/6/8-wheel template.
//
// Derivation is runtime-from-the-real-asset on purpose: RocketCars.rbxlx is a
// git-LFS pointer in this repo and an offline pipeline would drift from live
// place edits (ADR §4.7). validateAllTemplates() prints a migration report so
// a bad template fails loudly at startup, never silently at spawn.

import { DEFAULT_PRESET_ID, PHYSICS_PRESETS } from "shared/vehicleV2/PhysicsPresets";

/** Template → physics preset. Anything not listed uses DEFAULT_PRESET_ID.
 * Families follow the catalogue's real footprint/stat classes (see the
 * subclass tuning audit in VEHICLE_V2_ADR.md §1). */
export const TEMPLATE_PRESETS: Record<string, string> = {
	// sports
	Lambo: "Sport",
	Bugati: "Sport",
	"Horse911": "Sport",
	"Horse911-95": "Sport",
	TokyoDrift: "Sport",
	MacaiylaCurve: "Sport",
	AvonSkyline65: "Sport",
	DogeChallenger: "Sport",
	// compacts
	ToyCorolla: "Compact",
	MyFirstCar: "Compact",
	BumperCar: "Compact",
	ToyVan: "Compact",
	// heavies
	Abrams: "Heavy",
	APC: "Heavy",
	ArmouredTruck: "Heavy",
	ArmouredTransport: "Heavy",
	FireTruck: "Heavy",
	// 6/8-wheel trucks
	MarketTruck: "Truck",
	TroopTransport: "Truck",
	MillitaryTransport: "Truck",
};

/** Explicit per-template overrides for exceptional models (ADR: never guess
 * silently). Keyed by template name; every field optional. */
export interface TemplateOverride {
	/** Force a wheel to steer / not steer regardless of the Z-position rule. */
	steerWheels?: Record<string, boolean>;
	/** Skip validation warnings the model is known to trip harmlessly. */
	allowMissingBoostPart?: boolean;
}

export const OVERRIDES: Record<string, TemplateOverride> = {
	// (none required by the current catalogue; MarketTruck/TroopTransport/
	// MillitaryTransport extra axles are rear by naming convention BR2/BL2/…
	// and pass the Z-position rule.)
};

export function presetIdFor(templateName: string): string {
	const mapped = TEMPLATE_PRESETS[templateName];
	if (mapped !== undefined && PHYSICS_PRESETS[mapped] !== undefined) {
		return mapped;
	}
	return DEFAULT_PRESET_ID;
}

// ---- visual wheel derivation ----------------------------------------------

export interface VisualWheelDef {
	name: string;
	/** Hardpoint in Base/root-local space (wheel center at rest). */
	localPos: Vector3;
	radius: number;
	steers: boolean;
	/** Canonical physics contact (0 FL, 1 FR, 2 BL, 3 BR) this wheel derives
	 * compression from. Extra axles map to the nearest same-side contact. */
	contactIndex: number;
}

export interface TemplateGeometry {
	wheels: VisualWheelDef[];
	problems: string[];
	/** Authored gameplay envelope from Hitboxes/HitboxMain. This remains the
	 * source of truth for the V2 rigid body and BallSim contact box. */
	hitboxSize?: Vector3;
	/** Hitbox pose relative to the legacy Base, captured before restructuring. */
	hitboxLocalCFrame?: CFrame;
}

/** Derive visual wheel metadata from a template model (server side, before
 * restructuring). Reads DisplayWheel poses relative to Base. */
export function deriveTemplateGeometry(template: Model): TemplateGeometry {
	const problems: string[] = [];
	const wheels: VisualWheelDef[] = [];
	const base = template.FindFirstChild("Base");
	const wheelsFolder = template.FindFirstChild("Wheels");
	if (!base || !base.IsA("BasePart")) {
		problems.push("missing Base part");
		return { wheels, problems };
	}
	const hitboxes = template.FindFirstChild("Hitboxes");
	const hitboxMain = hitboxes?.FindFirstChild("HitboxMain");
	let hitboxSize: Vector3 | undefined;
	let hitboxLocalCFrame: CFrame | undefined;
	if (hitboxMain?.IsA("BasePart")) {
		hitboxSize = hitboxMain.Size;
		hitboxLocalCFrame = base.CFrame.ToObjectSpace(hitboxMain.CFrame);
	} else {
		problems.push("missing Hitboxes/HitboxMain part");
	}
	if (!wheelsFolder) {
		problems.push("missing Wheels folder");
		return { wheels, problems, hitboxSize, hitboxLocalCFrame };
	}
	const baseCF = base.CFrame;
	const override = OVERRIDES[template.Name];

	// First pass: collect raw wheel entries.
	interface Raw {
		name: string;
		localPos: Vector3;
		radius: number;
	}
	const raws: Raw[] = [];
	for (const wheelModel of wheelsFolder.GetChildren()) {
		const display = wheelModel.FindFirstChild("DisplayWheel");
		const physical = wheelModel.FindFirstChild("Wheel");
		const source = display && display.IsA("BasePart") ? display : physical;
		if (!source || !source.IsA("BasePart")) {
			problems.push(`wheel ${wheelModel.Name}: no DisplayWheel/Wheel part`);
			continue;
		}
		// Wheel cylinders are X-axis aligned in these templates; radius = the
		// larger of the two non-axle dimensions / 2.
		const radius = math.max(source.Size.Y, source.Size.Z) / 2;
		raws.push({
			name: wheelModel.Name,
			localPos: baseCF.PointToObjectSpace(source.Position),
			radius,
		});
	}
	if (raws.size() < 4) {
		problems.push(`only ${raws.size()} usable wheels (need >= 4)`);
	}
	if (raws.size() === 0) {
		return { wheels, problems, hitboxSize, hitboxLocalCFrame };
	}

	// Steering rule: a wheel steers when its Z sits in the front half of the
	// wheel Z-span (forward = -Z), unless overridden. Canonical contact:
	// front-left = 0, front-right = 1, back-left = 2, back-right = 3, extra
	// axles map to the nearest canonical Z on their side.
	let minZ = math.huge;
	let maxZ = -math.huge;
	for (const raw of raws) {
		minZ = math.min(minZ, raw.localPos.Z);
		maxZ = math.max(maxZ, raw.localPos.Z);
	}
	const midZ = (minZ + maxZ) / 2;
	for (const raw of raws) {
		const isFront = raw.localPos.Z < midZ;
		let steers = isFront;
		const forced = override?.steerWheels?.[raw.name];
		if (forced !== undefined) {
			steers = forced;
		}
		const isLeft = raw.localPos.X < 0;
		const contactIndex = isFront ? (isLeft ? 0 : 1) : isLeft ? 2 : 3;
		wheels.push({ name: raw.name, localPos: raw.localPos, radius: raw.radius, steers, contactIndex });
	}
	return { wheels, problems, hitboxSize, hitboxLocalCFrame };
}

/** Startup migration report over the whole catalogue. Returns the number of
 * templates with problems (0 = all clean). */
export function validateAllTemplates(vehicleModels: Instance): number {
	let bad = 0;
	let total = 0;
	for (const child of vehicleModels.GetChildren()) {
		if (!child.IsA("Model")) {
			continue;
		}
		total += 1;
		const geometry = deriveTemplateGeometry(child);
		const presetId = presetIdFor(child.Name);
		if (geometry.problems.size() > 0) {
			bad += 1;
			warn(`[VehicleDefs] ${child.Name} (preset ${presetId}): ${geometry.problems.join("; ")}`);
		} else {
			print(
				`[VehicleDefs] ${child.Name}: preset ${presetId}, hitbox ${tostring(geometry.hitboxSize)}, ${geometry.wheels.size()} visual wheels (${geometry.wheels
					.filter((wheel) => wheel.steers)
					.size()} steering)`,
			);
		}
	}
	print(`[VehicleDefs] template validation: ${total - bad}/${total} clean`);
	return bad;
}
