// Vehicle V2 spawn builder (server) — restructures a cloned catalogue
// template into the single-assembly match proxy. See VEHICLE_V2_ADR.md §3.
//
// Resulting model shape:
//
//   <Vehicle> (Model)            attrs: V2, TemplateId, PresetId, OwnerUserId
//     VehicleRoot (Part)         THE physics/predicted rigid body (PrimaryPart)
//       IdleSound/hornSound/driftSound/jumpSound   (moved from the old Base)
//     Hitboxes (Model)
//       HitboxMain (Part)        ball-contact box: welded, massless, query-only
//       damageBlock (Part)       damage query box: welded, massless, query-only
//     RenderSource (Model)       cosmetic geometry, ANCHORED + massless +
//                                non-colliding + non-query; every part carries
//                                an RS_Offset CFrame attribute (root-local
//                                pose) the client rig builds from. Physics
//                                never touches this folder.
//       RigWheel_<name> (Part)   DisplayWheel clones with RigWheelAttr metadata
//       ...body/cosmetic parts...
//
// The proxy contains NO SpringConstraint/HingeConstraint/CylindricalConstraint,
// no VehicleSeat, no physical wheels and no cosmetic mass — validated below
// (acceptance gates G-3/G-10/G-14).

import { COLLISION_GROUPS } from "shared/collisionGroups";
import { CarModelAttr, RigWheelAttr, V2_SCHEMA_VERSION } from "shared/vehicleV2/CarState";
import { getPreset } from "shared/vehicleV2/PhysicsPresets";
import { deriveTemplateGeometry, presetIdFor } from "shared/vehicleV2/VehicleDefs";
import * as CarSim from "shared/vehicleV2/CarSim";

const RENDER_SOURCE_NAME = "RenderSource";
/** Root-local pose attribute on every RenderSource part (rig build input). */
export const RS_OFFSET_ATTR = "RS_Offset";

function makeQueryBox(name: string, size: Vector3, offset: Vector3, root: BasePart): BasePart {
	const box = new Instance("Part");
	box.Name = name;
	box.Size = size;
	box.CFrame = root.CFrame.mul(new CFrame(offset));
	box.Transparency = 1;
	box.Massless = true;
	box.CanCollide = false;
	box.CanTouch = false;
	box.CanQuery = true;
	box.CollisionGroup = COLLISION_GROUPS.Hitbox;
	const weld = new Instance("WeldConstraint");
	weld.Part0 = root;
	weld.Part1 = box;
	weld.Parent = box;
	return box;
}

function neutralizeRenderPart(part: BasePart) {
	part.Anchored = true;
	part.Massless = true;
	part.CanCollide = false;
	part.CanTouch = false;
	part.CanQuery = false;
}

/** Restructure a freshly cloned template IN PLACE into the V2 proxy.
 * Returns the VehicleRoot, or undefined (with warnings) when the template is
 * not usable — the caller aborts the spawn. */
export function buildProxy(model: Model, templateName: string, owner?: Player): BasePart | undefined {
	const presetId = presetIdFor(templateName);
	const preset = getPreset(presetId);

	const oldBase = model.FindFirstChild("Base");
	if (!oldBase || !oldBase.IsA("BasePart")) {
		warn(`[VehicleV2] ${templateName}: no Base part — cannot build proxy`);
		return undefined;
	}

	// Visual wheel metadata BEFORE any restructuring (poses are template-space).
	const geometry = deriveTemplateGeometry(model);
	if (geometry.problems.size() > 0) {
		warn(`[VehicleV2] ${templateName}: ${geometry.problems.join("; ")} — spawning anyway with derived data`);
	}

	const baseCF = oldBase.CFrame;

	// ---- the rigid body ----
	const root = new Instance("Part");
	root.Name = "VehicleRoot";
	root.Size = preset.boxSize;
	// Place the box so its bottom sits where the old Base's bottom sat —
	// keeps spawn-height math (bounding-box lift) behaving.
	root.CFrame = baseCF.mul(new CFrame(0, (preset.boxSize.Y - oldBase.Size.Y) / 2, 0));
	root.Transparency = 1;
	root.CanCollide = true;
	root.CanTouch = false;
	root.CanQuery = true;
	root.CollisionGroup = COLLISION_GROUPS.Vehicle;
	root.Anchored = false;
	const volume = preset.boxSize.X * preset.boxSize.Y * preset.boxSize.Z;
	root.CustomPhysicalProperties = new PhysicalProperties(preset.mass / volume, preset.boxFriction, 0.1, 100, 1);
	root.RootPriority = 10;

	// Sounds move from the old Base onto the root (3D audio follows the sim).
	for (const soundName of ["IdleSound", "hornSound", "driftSound", "jumpSound"]) {
		const sound = oldBase.FindFirstChild(soundName);
		if (sound) {
			sound.Parent = root;
		}
	}

	// ---- render source ----
	const renderSource = new Instance("Model");
	renderSource.Name = RENDER_SOURCE_NAME;

	// Visual wheels: DisplayWheel (or Wheel) clones with rig metadata.
	const wheelsFolder = model.FindFirstChild("Wheels");
	if (wheelsFolder) {
		for (const def of geometry.wheels) {
			const wheelModel = wheelsFolder.FindFirstChild(def.name);
			if (!wheelModel) {
				continue;
			}
			const display = wheelModel.FindFirstChild("DisplayWheel") ?? wheelModel.FindFirstChild("Wheel");
			if (!display || !display.IsA("BasePart")) {
				continue;
			}
			const clone = display.Clone();
			clone.Name = `RigWheel_${def.name}`;
			for (const child of clone.GetChildren()) {
				if (child.IsA("JointInstance") || child.IsA("Constraint") || child.IsA("Attachment")) {
					child.Destroy();
				}
			}
			neutralizeRenderPart(clone);
			// Root-local pose of the wheel at REST (hardpoint), not its
			// current sprung pose: local position from the derived hardpoint.
			const worldPos = baseCF.PointToWorldSpace(def.localPos);
			const localPos = root.CFrame.PointToObjectSpace(worldPos);
			clone.SetAttribute(RS_OFFSET_ATTR, new CFrame(localPos));
			clone.SetAttribute(RigWheelAttr.LocalPos, localPos);
			clone.SetAttribute(RigWheelAttr.Radius, def.radius);
			clone.SetAttribute(RigWheelAttr.Steers, def.steers);
			clone.SetAttribute(RigWheelAttr.ContactIndex, def.contactIndex);
			clone.CFrame = root.CFrame.mul(new CFrame(localPos));
			// Drift trail: rebuilt fresh (cloning the authored one would carry
			// dangling attachment references). The rig toggles Enabled from the
			// DriftEngaged attribute.
			const turnPart = wheelModel.FindFirstChild("turn");
			const authoredTrail = turnPart?.FindFirstChild("Trail");
			if (authoredTrail && authoredTrail.IsA("Trail")) {
				const a0 = new Instance("Attachment");
				a0.Name = "trail";
				a0.Position = new Vector3(-0.25, -def.radius * 0.8, 0);
				a0.Parent = clone;
				const a1 = new Instance("Attachment");
				a1.Name = "trail2";
				a1.Position = new Vector3(0.25, -def.radius * 0.8, 0);
				a1.Parent = clone;
				const trail = authoredTrail.Clone();
				trail.Attachment0 = a0;
				trail.Attachment1 = a1;
				trail.Enabled = false;
				trail.Parent = clone;
			}
			clone.Parent = renderSource;
		}
	}

	// Body/cosmetic parts: everything visible that is not a wheel, seat,
	// hitbox or the Base slab.
	const skipRoots = new Set<Instance>();
	const seats = model.FindFirstChild("Seats");
	const hitboxes = model.FindFirstChild("Hitboxes");
	if (wheelsFolder) skipRoots.add(wheelsFolder);
	if (seats) skipRoots.add(seats);
	if (hitboxes) skipRoots.add(hitboxes);
	skipRoots.add(renderSource);

	const carryParts: BasePart[] = [];
	for (const descendant of model.GetDescendants()) {
		if (!descendant.IsA("BasePart") || descendant === oldBase || descendant === root) {
			continue;
		}
		let skipped = false;
		for (const skipRoot of skipRoots) {
			if (descendant.IsDescendantOf(skipRoot)) {
				skipped = true;
				break;
			}
		}
		if (!skipped && descendant.Transparency < 0.99) {
			carryParts.push(descendant);
		}
	}
	for (const part of carryParts) {
		for (const child of part.GetChildren()) {
			if (child.IsA("JointInstance") || child.IsA("Constraint")) {
				child.Destroy();
			}
		}
		neutralizeRenderPart(part);
		part.SetAttribute(RS_OFFSET_ATTR, root.CFrame.ToObjectSpace(part.CFrame));
		part.Parent = renderSource;
	}

	// BoostEffectPart carries emitters/trail/sound — keep it (invisible part,
	// so it wasn't carried above).
	const boostPart = model.FindFirstChild("BoostEffectPart");
	if (boostPart && boostPart.IsA("BasePart")) {
		for (const child of boostPart.GetChildren()) {
			if (child.IsA("JointInstance") || child.IsA("Constraint")) {
				child.Destroy();
			}
		}
		neutralizeRenderPart(boostPart);
		boostPart.SetAttribute(RS_OFFSET_ATTR, root.CFrame.ToObjectSpace(boostPart.CFrame));
		boostPart.Parent = renderSource;
	}

	// ---- strip the legacy physical structure ----
	if (wheelsFolder) wheelsFolder.Destroy();
	if (seats) seats.Destroy();
	if (hitboxes) hitboxes.Destroy();
	oldBase.Destroy();
	// Anything physical left at the model top level (old effect anchors etc.)
	// must not join the assembly.
	for (const child of model.GetChildren()) {
		if (child.IsA("BasePart") && child !== root) {
			neutralizeRenderPart(child);
			child.SetAttribute(RS_OFFSET_ATTR, root.CFrame.ToObjectSpace(child.CFrame));
			child.Parent = renderSource;
		}
	}

	// ---- query boxes ----
	const newHitboxes = new Instance("Model");
	newHitboxes.Name = "Hitboxes";
	makeQueryBox("HitboxMain", preset.hitboxSize, preset.hitboxOffset, root).Parent = newHitboxes;
	makeQueryBox("damageBlock", preset.hitboxSize.mul(1.02), preset.hitboxOffset, root).Parent = newHitboxes;

	root.Parent = model;
	newHitboxes.Parent = model;
	renderSource.Parent = model;
	model.PrimaryPart = root;

	// ---- identity ----
	model.SetAttribute(CarModelAttr.V2, V2_SCHEMA_VERSION);
	model.SetAttribute(CarModelAttr.TemplateId, templateName);
	model.SetAttribute(CarModelAttr.PresetId, presetId);
	model.SetAttribute(CarModelAttr.OwnerUserId, owner ? owner.UserId : 0);

	if (!validateProxy(model, root)) {
		return undefined;
	}
	return root;
}

/** Spawn-time contract validation (gates G-3/G-14 + the BallSim hitbox
 * contract). Loud and fatal — a broken proxy must never drive. */
function validateProxy(model: Model, root: BasePart): boolean {
	let ok = true;
	for (const descendant of model.GetDescendants()) {
		if (
			descendant.IsA("SpringConstraint") ||
			descendant.IsA("HingeConstraint") ||
			descendant.IsA("CylindricalConstraint") ||
			descendant.IsA("VehicleSeat") ||
			descendant.IsA("Humanoid")
		) {
			warn(`[VehicleV2] ${model.Name}: forbidden ${descendant.ClassName} ${descendant.GetFullName()}`);
			ok = false;
		}
		if (descendant.IsA("BasePart") && descendant !== root && !descendant.Anchored && !descendant.Massless) {
			warn(`[VehicleV2] ${model.Name}: unanchored massy part ${descendant.GetFullName()} would join the assembly`);
			ok = false;
		}
	}
	const hitboxes = model.FindFirstChild("Hitboxes");
	const hitboxMain = hitboxes?.FindFirstChild("HitboxMain");
	if (!hitboxMain || !hitboxMain.IsA("BasePart") || !hitboxMain.CanQuery) {
		warn(`[VehicleV2] ${model.Name}: BallSim hitbox contract (Hitboxes.HitboxMain, CanQuery) not met`);
		ok = false;
	}
	return ok;
}

// ---- driver association (replaces the VehicleSeat/weld lifecycle) ---------

interface DriverState {
	character: Model;
	snapshots: Array<{
		instance: BasePart | Decal;
		massless?: boolean;
		canCollide?: boolean;
		anchored?: boolean;
		transparency: number;
	}>;
	connections: RBXScriptConnection[];
}

const drivers = new Map<Player, DriverState>();

function neutralizeInstance(state: DriverState, instance: Instance) {
	if (instance.IsA("BasePart")) {
		state.snapshots.push({
			instance,
			massless: instance.Massless,
			canCollide: instance.CanCollide,
			anchored: instance.Anchored,
			transparency: instance.Transparency,
		});
		instance.Massless = true;
		instance.CanCollide = false;
		instance.CanTouch = false;
		instance.CanQuery = false;
		instance.Transparency = 1;
	} else if (instance.IsA("Decal")) {
		state.snapshots.push({ instance, transparency: instance.Transparency });
		instance.Transparency = 1;
	}
}

/** Hide + physically remove the avatar (it never joins the predicted
 * assembly), then mark the car as driven. The explicit association replaces
 * seat occupancy (ADR §3). */
export function associateDriver(player: Player, model: Model, root: BasePart) {
	releaseDriver(player);
	const character = player.Character;
	if (character) {
		const state: DriverState = { character, snapshots: [], connections: [] };
		drivers.set(player, state);
		pcall(() => {
			for (const descendant of character.GetDescendants()) {
				neutralizeInstance(state, descendant);
			}
			const humanoidRoot = character.FindFirstChild("HumanoidRootPart");
			if (humanoidRoot && humanoidRoot.IsA("BasePart")) {
				humanoidRoot.Anchored = true;
				humanoidRoot.CFrame = root.CFrame.mul(new CFrame(0, 2, 0));
			}
			const humanoid = character.FindFirstChildOfClass("Humanoid");
			if (humanoid) {
				humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None;
			}
		});
		state.connections.push(
			character.DescendantAdded.Connect((descendant) => {
				if (drivers.get(player) === state) {
					neutralizeInstance(state, descendant);
				}
			}),
		);
		state.connections.push(
			character.AncestryChanged.Connect((_, parent) => {
				if (parent === undefined && drivers.get(player) === state) {
					releaseDriver(player);
				}
			}),
		);
	}
	CarSim.setDriving(model, true);
}

/** Restore the avatar next to the car (or wherever it was) on drive end. */
export function releaseDriver(player: Player, restoreCFrame?: CFrame) {
	const state = drivers.get(player);
	if (!state) {
		return;
	}
	drivers.delete(player);
	for (const connection of state.connections) {
		connection.Disconnect();
	}
	pcall(() => {
		for (const snapshot of state.snapshots) {
			const instance = snapshot.instance;
			if (instance.Parent === undefined) {
				continue;
			}
			if (instance.IsA("BasePart")) {
				instance.Massless = snapshot.massless === true;
				instance.CanCollide = snapshot.canCollide === true;
				instance.CanTouch = true;
				instance.Anchored = snapshot.anchored === true;
			}
			instance.Transparency = snapshot.transparency;
		}
		const humanoidRoot = state.character.FindFirstChild("HumanoidRootPart");
		if (humanoidRoot && humanoidRoot.IsA("BasePart")) {
			humanoidRoot.Anchored = false;
			if (restoreCFrame) {
				humanoidRoot.CFrame = restoreCFrame;
			}
		}
		const humanoid = state.character.FindFirstChildOfClass("Humanoid");
		if (humanoid) {
			humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.Viewer;
		}
	});
}
