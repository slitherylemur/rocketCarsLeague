// Rocket League boost pads (server-authoritative).
//
// Pitches are authored with MegaBoost / MiniBoost models (each containing
// colorPart parts) somewhere under the pitch folder. This script watches
// Workspace.Map for pitch clones, finds the pads, and runs the Rocket League
// pickup rules: mini pads grant 25 boost and respawn in 4 seconds, mega pads
// grant a full 100 and respawn in 10 seconds. There is NO passive meter
// regen any more — pads are the only refill (VehicleSim.grantBoost).
//
// Pickup is a per-Heartbeat proximity check against driven vehicles, not a
// .Touched connection: a TouchTransmitter inside a predicted assembly makes
// the prediction system reject it (same reasoning as the damage query in
// VehicleClass). A pad is consumed even by a full-boost car — Rocket
// League's pad-starving rule — and the grant clamps at the meter cap inside
// the sim step.

import * as VehicleSim from "shared/vehicleSim/VehicleSim";

const RunService = game.GetService("RunService");

const MEGA_NAME = "MegaBoost";
const MINI_NAME = "MiniBoost";
const MEGA_GRANT = 100; // full tank — Rocket League big pad
// At the current drain rate (4 boost every 0.2 seconds), this provides about
// 1.25 seconds of continuous boost.
const MINI_GRANT = 25;
const MEGA_RESPAWN = 10; // seconds — Rocket League big pad
const MINI_RESPAWN = 4; // seconds — Rocket League small pad

// colorPart looks: lit warm white-yellow-orange while active, dim black while
// on cooldown.
const ACTIVE_COLOR = Color3.fromRGB(255, 214, 130);
const ACTIVE_TRANSPARENCY = 0;
const INACTIVE_COLOR = Color3.fromRGB(0, 0, 0);
const INACTIVE_TRANSPARENCY = 0.5;

// Pickup volume: the pad's footprint plus some slack, reaching well above the
// visual so a car (or a low aerial) driving over it collects — Rocket League
// pads have tall cylinder hitboxes.
const PICKUP_RADIUS_SLACK = 3; // studs beyond the pad's horizontal extent
const PICKUP_HEIGHT_ABOVE = 10; // studs above the pad's top
const PICKUP_DEPTH_BELOW = 2; // studs below the pad's bottom

interface Pad {
	mega: boolean;
	colorParts: BasePart[];
	center: Vector3;
	radiusSq: number;
	minY: number;
	maxY: number;
	active: boolean;
	reactivateAt: number; // os.clock() time; only meaningful while inactive
}

const mapFolder = game.Workspace.WaitForChild("Map") as Folder;
const vehiclesFolder = game.Workspace.WaitForChild("Vehicles") as Folder;

const padsByPitch = new Map<Instance, Pad[]>();

function setPadVisuals(pad: Pad, active: boolean) {
	for (const part of pad.colorParts) {
		part.Color = active ? ACTIVE_COLOR : INACTIVE_COLOR;
		part.Transparency = active ? ACTIVE_TRANSPARENCY : INACTIVE_TRANSPARENCY;
	}
}

function buildPad(model: Model, mega: boolean): Pad | undefined {
	const colorParts: BasePart[] = [];
	let minBound: Vector3 | undefined;
	let maxBound: Vector3 | undefined;
	for (const descendant of model.GetDescendants()) {
		if (!descendant.IsA("BasePart")) {
			continue;
		}
		if (descendant.Name === "colorPart") {
			colorParts.push(descendant);
		}
		const half = descendant.Size.div(2);
		const lo = descendant.Position.sub(half);
		const hi = descendant.Position.add(half);
		minBound =
			minBound === undefined
				? lo
				: new Vector3(math.min(minBound.X, lo.X), math.min(minBound.Y, lo.Y), math.min(minBound.Z, lo.Z));
		maxBound =
			maxBound === undefined
				? hi
				: new Vector3(math.max(maxBound.X, hi.X), math.max(maxBound.Y, hi.Y), math.max(maxBound.Z, hi.Z));
	}
	if (minBound === undefined || maxBound === undefined) {
		warn(`[boostPads] ${model.GetFullName()} has no BaseParts — skipped`);
		return undefined;
	}
	const center = minBound.add(maxBound).div(2);
	const radius = math.max(maxBound.X - minBound.X, maxBound.Z - minBound.Z) / 2 + PICKUP_RADIUS_SLACK;
	const pad: Pad = {
		mega,
		colorParts,
		center,
		radiusSq: radius * radius,
		minY: minBound.Y - PICKUP_DEPTH_BELOW,
		maxY: maxBound.Y + PICKUP_HEIGHT_ABOVE,
		active: true,
		reactivateAt: 0,
	};
	setPadVisuals(pad, true);
	return pad;
}

function scanPitch(pitchFolder: Instance) {
	const pads: Pad[] = [];
	let megaCount = 0;
	let miniCount = 0;
	for (const descendant of pitchFolder.GetDescendants()) {
		if (!descendant.IsA("Model") || (descendant.Name !== MEGA_NAME && descendant.Name !== MINI_NAME)) {
			continue;
		}
		const mega = descendant.Name === MEGA_NAME;
		const pad = buildPad(descendant, mega);
		if (pad) {
			pads.push(pad);
			if (mega) {
				megaCount += 1;
			} else {
				miniCount += 1;
			}
		}
	}
	padsByPitch.set(pitchFolder, pads);
	warn(`[boostPads] ${pitchFolder.Name}: ${megaCount} mega / ${miniCount} mini pad(s)`);
}

// Pitch clones are translated into place BEFORE being parented to
// Workspace.Map (PitchManager), so pad positions are final on ChildAdded.
for (const child of mapFolder.GetChildren()) {
	scanPitch(child);
}
mapFolder.ChildAdded.Connect((child) => scanPitch(child));
mapFolder.ChildRemoved.Connect((child) => padsByPitch.delete(child));

RunService.Heartbeat.Connect(() => {
	const now = os.clock();

	// Snapshot the driven cars once per frame; parked cars don't eat pads.
	const vehicles: Array<{ model: Model; position: Vector3 }> = [];
	for (const model of vehiclesFolder.GetChildren()) {
		const base = model.FindFirstChild("Base");
		if (base && base.IsA("BasePart") && base.GetAttribute(VehicleSim.VehicleAttr.Driving) === true) {
			vehicles.push({ model: model as Model, position: base.Position });
		}
	}

	for (const [, pads] of padsByPitch) {
		for (const pad of pads) {
			if (!pad.active) {
				if (now >= pad.reactivateAt) {
					pad.active = true;
					setPadVisuals(pad, true);
				}
				continue;
			}
			for (const vehicle of vehicles) {
				const position = vehicle.position;
				if (position.Y < pad.minY || position.Y > pad.maxY) {
					continue;
				}
				const dx = position.X - pad.center.X;
				const dz = position.Z - pad.center.Z;
				if (dx * dx + dz * dz > pad.radiusSq) {
					continue;
				}
				VehicleSim.grantBoost(vehicle.model, pad.mega ? MEGA_GRANT : MINI_GRANT);
				pad.active = false;
				pad.reactivateAt = now + (pad.mega ? MEGA_RESPAWN : MINI_RESPAWN);
				setPadVisuals(pad, false);
				break; // first car wins; the pad is now on cooldown
			}
		}
	}
});
