// garageIntents — the reusable NON-UI halves of the old
// src/server/Modules/UiModules/itemSelectedFunctions.ts (client-side UI
// migration, Phase 5). The Garage ScreenGui is client-owned now; tile clicks
// arrive as Intent_Equip*/Intent_PreviewVehicle/Intent_UnlockVehicle remotes
// and these bodies run the server-side effects the old callbacks had:
//
//   * ownership validation + DataUtilities equip-if-owned data writes;
//   * garage DISPLAY-CAR side effects (SpawnVehicle clientSided preview,
//     PaintVehicle, createMenuBoostTrail) — the display car is a server-owned
//     world object, so these must stay server-side;
//   * the trophy-gated car unlock (server-side re-check at click time).
//
// Everything PlayerGui-related from the old module (BuyButton/SpawnButton
// wiring, tile highlights, cash menu, horn preview SOUND) renders client-side
// in src/client/ui/garage.client.ts instead.

import spawnVehicle from "../Modules/spawnVehicle";
import DataUtilities from "../Modules/DataUtilities";
import { getCarTrophyCost } from "shared/carTrophyCosts";
import { Globals } from "../Globals";
import type { VehicleModel } from "../Classes/VehicleClass";

const ServerStorage = game.GetService("ServerStorage");

function vehicleModelExists(name: string): boolean {
	const folder = ServerStorage.FindFirstChild("VehicleModels");
	return folder !== undefined && folder.FindFirstChild(name) !== undefined;
}

/** Reset the display car's pose/state (old initializePlayer resetVehicle —
 * the crate-menu item preview path ran it before applying the preview). */
function resetVehicle(player: Player) {
	const carClass = Globals.vehiclesTable[player.UserId];
	if (carClass) {
		carClass.resetVehicle();
	}
}

/** Spawn the named car on the player's garage plate as a clientSided display
 * car (the old Body-callback/preview spawn). Works for owned AND locked cars —
 * previewing a locked car is exactly what the old locked path did. */
function spawnDisplayCar(player: Player, vehicleName: string) {
	const playerGarage = Globals.findPlayerGarage(player);
	if (!playerGarage || !vehicleModelExists(vehicleName)) {
		return;
	}
	spawnVehicle.SpawnVehicle(player, false, vehicleName, playerGarage.spawnPlate.CFrame, true);
}

const garageIntents = {
	resetVehicle: resetVehicle,

	/** Menu boost-trail visual: builds/retargets the display car's preview Beam
	 * + ParticleEmitter from a BoostTrails template (moved verbatim from
	 * itemSelectedFunctions.createMenuBoostTrail). */
	createMenuBoostTrail: (trailModel: Instance, car: VehicleModel) => {
		const att1 = car.BoostEffectPart.Attachment;
		const att2 = car.BoostEffectPart.Attachment2;

		const trail: Trail = trailModel.FindFirstChildWhichIsA("Trail")!;

		const beam: Beam | undefined = car.BoostEffectPart.FindFirstChildWhichIsA("Beam");

		if (beam) {
			beam.Texture = trail.Texture;
			beam.Color = trail.Color;
			beam.Transparency = trail.Transparency;
			beam.TextureLength = trail.TextureLength;
			beam.LightEmission = trail.LightEmission;
			beam.LightInfluence = trail.LightInfluence;
			beam.FaceCamera = trail.FaceCamera;
			beam.TextureMode = trail.TextureMode;
		} else {
			const width0 = math.abs(att1.Position.Y - att2.Position.Y);

			att1.Position = new Vector3(att1.Position.X, (att1.Position.Y + att2.Position.Y) / 2, att1.Position.Z);
			att2.Position = att1.Position.add(new Vector3(0, 0, -50));

			const newBeam = new Instance("Beam");
			newBeam.Texture = trail.Texture;
			newBeam.Color = trail.Color;
			newBeam.Transparency = trail.Transparency;
			newBeam.TextureLength = trail.TextureLength;
			newBeam.LightEmission = trail.LightEmission;
			newBeam.LightInfluence = trail.LightInfluence;
			newBeam.FaceCamera = trail.FaceCamera;
			newBeam.TextureMode = trail.TextureMode;
			newBeam.Width0 = width0;
			newBeam.Width1 = width0;
			newBeam.Parent = car.BoostEffectPart;
			newBeam.Enabled = true;
			newBeam.Attachment0 = att1;
			newBeam.Attachment1 = att2;
		}

		const particleEmitter: ParticleEmitter | undefined =
			car.BoostEffectPart.FindFirstChildWhichIsA("ParticleEmitter");

		if (particleEmitter) {
			const particle: ParticleEmitter = trailModel.FindFirstChildWhichIsA("ParticleEmitter")!;
			particleEmitter.Destroy();
			const pe = particle.Clone();
			pe.Parent = car.BoostEffectPart;
			pe.Enabled = true;
		} else {
			const particle: ParticleEmitter = trailModel.FindFirstChildWhichIsA("ParticleEmitter")!;

			const pe = particle.Clone();
			pe.Parent = car.BoostEffectPart;
			pe.Enabled = true;
		}
	},

	/** Intent_EquipVehicle: the old Body !locked callback body. Ownership is
	 * validated server-side; an unowned name degrades to a preview spawn (the
	 * old locked path's display half) with no data write. */
	equipVehicle: (player: Player, vehicleName: string) => {
		spawnDisplayCar(player, vehicleName);
		if (DataUtilities.PlayerHasItem(player, "vehicles", vehicleName)) {
			DataUtilities.EquipItemIfOwned(player, vehicleName, "equippedVehicle", "vehicles");
		}
	},

	/** Intent_PreviewVehicle: display-only spawn (locked-car tiles, tab
	 * re-opens). withTrail re-applies the equipped boost trail afterwards —
	 * the old setTab.Inventory("BoostTrail") sequence. */
	previewVehicle: (player: Player, vehicleName: string, withTrail?: boolean) => {
		spawnDisplayCar(player, vehicleName);
		if (withTrail === true) {
			pcall(() => {
				const equipedBoost = DataUtilities.GetEquippedItemOnVehicle(player, "boostTrail") as string;
				const trailModel = (ServerStorage as unknown as { BoostTrails: Folder }).BoostTrails.FindFirstChild(
					equipedBoost,
				);
				const car = Globals.vehiclesTable[player.UserId];
				if (trailModel && car) {
					garageIntents.createMenuBoostTrail(trailModel, car.model);
				}
			});
		}
	},

	/** Intent_UnlockVehicle: the old UnlockButtonPressed body — trophy
	 * threshold re-checked server-side at click time (cars are unlocked for
	 * FREE at their lifetime-trophy threshold; trophies are never spent). */
	unlockVehicle: (player: Player, vehicleName: string): boolean => {
		if (!vehicleModelExists(vehicleName)) {
			return false;
		}
		const cost = getCarTrophyCost(vehicleName);
		if (DataUtilities.GetTrophies(player) < cost) {
			return false;
		}
		DataUtilities.GivePlayerItem(player, "vehicles", vehicleName);
		DataUtilities.EquipItemIfOwned(player, vehicleName, "equippedVehicle", "vehicles");
		return true;
	},

	/** Intent_EquipColor: the old Colors callback body — paint the display car
	 * always (locked tiles previewed too), equip only when owned and not a
	 * preview-only click (crate-page content tiles never equip — parity with
	 * the old locked=true calls). */
	equipColor: (player: Player, colorName: string, previewOnly?: boolean) => {
		if (!(ServerStorage as unknown as { Colors: Folder }).Colors.FindFirstChild(colorName)) {
			return;
		}
		if (previewOnly === true) {
			pcall(() => resetVehicle(player));
		}
		const car = Globals.vehiclesTable[player.UserId];
		if (car) {
			car.PaintVehicle(colorName);
		}
		if (previewOnly !== true) {
			DataUtilities.EquipItemOnVehicleIfOwned(player, colorName, "colors", "color");
		}
	},

	/** Intent_EquipHorn: the old CarHorn callback's data half (the preview
	 * SOUND plays client-side now, from the mirrored ReplicatedStorage
	 * CarHorns templates). */
	equipHorn: (player: Player, hornName: string, previewOnly?: boolean) => {
		if (!(ServerStorage as unknown as { CarHorns: Folder }).CarHorns.FindFirstChild(hornName)) {
			return;
		}
		if (previewOnly === true) {
			pcall(() => resetVehicle(player));
			return;
		}
		DataUtilities.EquipItemOnVehicleIfOwned(player, hornName, "hornSounds", "hornSound");
	},

	/** Intent_EquipTrail: the old BoostTrail callback body — apply the preview
	 * beam to the display car always, equip only when owned and not preview. */
	equipTrail: (player: Player, trailName: string, previewOnly?: boolean) => {
		const trailModel = (ServerStorage as unknown as { BoostTrails: Folder }).BoostTrails.FindFirstChild(trailName);
		if (!trailModel) {
			return;
		}
		if (previewOnly === true) {
			pcall(() => resetVehicle(player));
		}
		const car = Globals.vehiclesTable[player.UserId];
		if (car) {
			pcall(() => garageIntents.createMenuBoostTrail(trailModel, car.model));
		}
		if (previewOnly !== true) {
			DataUtilities.EquipItemOnVehicleIfOwned(player, trailName, "boostTrails", "boostTrail");
		}
	},
};

export = garageIntents;
