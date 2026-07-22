// profileSnapshot — server half of the client-owned garage's data feed
// (client-side UI migration, Phase 5).
//
//   * Ui_GetProfile (RemoteFunction): returns one JSON-safe UiProfileSnapshot
//     (owned + equipped cosmetics, money, trophies, rename credits, VIP).
//   * CB_ProfileVersion (player attribute, counter): bumped whenever any of
//     the snapshot's datasets change — registerPlayer hooks DataStore2
//     OnUpdate on every owned/equipped store, which fires on every Set()
//     (equips, unlocks, crate grants, purchases). The client refetches the
//     snapshot when the version bumps.
//   * Module-load mirrors: ServerStorage.VehicleModels and
//     ServerStorage.CarHorns are cloned into ReplicatedStorage (same pattern
//     as CrateModule's Colors/BoostTrails copy) so the client can fill car
//     ViewportFrame tiles and play horn previews locally. The car-grid
//     CarCategory template joins the place-file ReplicatedStorage.Ui folder.
//     Each mirrored car model carries a DisplayName attribute (from its
//     VehicleSubClass module) for the tile label.

import DataStore2 from "../Modules/DataStore2";
import DataStoreDefaults from "../Modules/DataStoreDefaults";
import DataUtilities from "../Modules/DataUtilities";
import TeamRegistry from "../Modules/TeamRegistry";
import UiState from "./UiState";
import requireModule from "shared/requireModule";
import { getUiIntentFunction } from "shared/UiIntents";
import { PassIds } from "shared/Monetization";
import type { UiProfileSnapshot } from "shared/UiProfile";
import type { VehicleSubClassModule } from "../Classes/VehicleSubClass/subClassTypes";

const ReplicatedStorage = game.GetService("ReplicatedStorage");
const ServerStorage = game.GetService("ServerStorage");
const MarketplaceService = game.GetService("MarketplaceService");
const Players = game.GetService("Players");

// ---- client asset mirrors (module-load side effect, like CrateModule's
// Colors/BoostTrails copy) ----------------------------------------------------
// The old server-rendered tiles cloned ~30 car models into EVERY player's
// PlayerGui (each replicated per player); one shared ReplicatedStorage copy is
// strictly cheaper. Horn Sounds are tiny.

{
	const subClassFolder = (script.Parent!.Parent as unknown as { Classes: { VehicleSubClass: Folder } }).Classes
		.VehicleSubClass;

	const vehicleMirror = new Instance("Folder");
	vehicleMirror.Name = "VehicleModels";
	const vehicleModels = ServerStorage.FindFirstChild("VehicleModels");
	if (vehicleModels) {
		for (const model of vehicleModels.GetChildren()) {
			const clone = model.Clone();
			// Tile label: the subclass module's displayName (the old
			// itemPopulateSpecifics.Body read it server-side).
			const [ok, displayName] = pcall(() => {
				const subClassScript = subClassFolder.FindFirstChild(model.Name);
				if (subClassScript && subClassScript.IsA("ModuleScript")) {
					return (requireModule(subClassScript) as VehicleSubClassModule).displayName;
				}
				return model.Name;
			});
			clone.SetAttribute("DisplayName", ok && typeIs(displayName, "string") ? displayName : model.Name);
			clone.Parent = vehicleMirror;
		}
	} else {
		warn("[profileSnapshot] ServerStorage.VehicleModels missing — client car tiles will be empty");
	}
	vehicleMirror.Parent = ReplicatedStorage;

	const hornMirror = new Instance("Folder");
	hornMirror.Name = "CarHorns";
	const carHorns = ServerStorage.FindFirstChild("CarHorns");
	if (carHorns) {
		for (const sound of carHorns.GetChildren()) {
			sound.Clone().Parent = hornMirror;
		}
	}
	hornMirror.Parent = ReplicatedStorage;

	// The car-grid block template (old setTab cloned it from ServerStorage).
	const uiFolder = ReplicatedStorage.FindFirstChild("Ui");
	const carCategory = ServerStorage.FindFirstChild("CarCategory");
	if (uiFolder && carCategory && !uiFolder.FindFirstChild("CarCategory")) {
		carCategory.Clone().Parent = uiFolder;
	} else if (!carCategory) {
		warn("[profileSnapshot] ServerStorage.CarCategory missing — client car grid cannot build");
	}
}

// ---- VIP ownership cache ----------------------------------------------------
// UserOwnsGamePassAsync yields (web call) — prefetch on join, answer snapshots
// from cache. A failed lookup retries on the next snapshot request.

const vipCache = new Map<number, boolean>();

function fetchVip(player: Player): boolean | undefined {
	const [ok, owns] = pcall(() =>
		MarketplaceService.UserOwnsGamePassAsync(player.UserId as unknown as never, PassIds.Vip),
	);
	if (ok && typeIs(owns, "boolean")) {
		vipCache.set(player.UserId, owns);
		return owns;
	}
	return undefined;
}

Players.PlayerRemoving.Connect((player) => vipCache.delete(player.UserId));

// ---- snapshot ---------------------------------------------------------------

const DSDefaults = DataStoreDefaults as unknown as Record<string, unknown>;

function stringList(player: Player, itemType: string): string[] {
	const items = DataUtilities.GetPlayersItems(player, itemType);
	const out: string[] = [];
	if (typeIs(items, "table")) {
		for (const item of items as defined[]) {
			if (typeIs(item, "string")) {
				out.push(item);
			}
		}
	}
	return out;
}

function optionalString(value: unknown): string | undefined {
	return typeIs(value, "string") ? value : undefined;
}

function buildSnapshot(player: Player): UiProfileSnapshot {
	let vip = vipCache.get(player.UserId);
	if (vip === undefined) {
		vip = fetchVip(player);
	}
	return {
		money: DataStore2("money", player).Get(DSDefaults["money"]) as number,
		trophies: DataUtilities.GetTrophies(player),
		renameCredits: TeamRegistry.getRenameCredits(player),
		vip: vip === true,
		equippedVehicle: DataUtilities.getPlayerEquippedVehicle(player),
		equippedColor: optionalString(DataUtilities.GetEquippedItemOnVehicle(player, "color")),
		equippedHorn: optionalString(DataUtilities.GetEquippedItemOnVehicle(player, "hornSound")),
		equippedTrail: optionalString(DataUtilities.GetEquippedItemOnVehicle(player, "boostTrail")),
		ownedVehicles: stringList(player, "vehicles"),
		ownedColors: stringList(player, "colors"),
		ownedHorns: stringList(player, "hornSounds"),
		ownedTrails: stringList(player, "boostTrails"),
	};
}

// task.spawn: getUiIntentFunction WaitForChilds the UiIntents folder, which
// UiIntents.server.ts may not have created yet when this module first loads.
task.spawn(() => {
	getUiIntentFunction("Ui_GetProfile").OnServerInvoke = (player) => {
		const [ok, snapshot] = pcall(() => buildSnapshot(player));
		if (!ok) {
			warn(`[profileSnapshot] snapshot build failed for ${player.Name}: ${snapshot}`);
			return undefined;
		}
		return snapshot;
	};
});

// ---- version counter --------------------------------------------------------

/** Every DataStore2 key whose change invalidates a fetched snapshot. Money and
 * trophies are deliberately absent: they live-update as CB_Money/CB_Trophies
 * and would otherwise bump (and refetch) on every kill reward. */
const SNAPSHOT_KEYS = ["vehicles", "colors", "hornSounds", "boostTrails", "equippedVehicle", "vehicleCustomization"];

const profileSnapshot = {
	/** Bump CB_ProfileVersion — the client refetches Ui_GetProfile on change. */
	bumpProfileVersion(player: Player) {
		const current = player.GetAttribute("CB_ProfileVersion");
		UiState.setPlayerAttr(player, "CB_ProfileVersion", (typeIs(current, "number") ? current : 0) + 1);
	},

	/** Per-player wiring (called from initializePlayer): initial version plus
	 * OnUpdate hooks on every snapshot dataset — DataStore2 fires these on
	 * every Set(), which covers equips, trophy unlocks, crate grants and
	 * receipt-processor grants without touching each mutation site. */
	registerPlayer(player: Player) {
		UiState.setPlayerAttr(player, "CB_ProfileVersion", 1);
		for (const key of SNAPSHOT_KEYS) {
			DataStore2(key, player).OnUpdate(() => profileSnapshot.bumpProfileVersion(player));
		}
		task.spawn(() => fetchVip(player));
	},
};

export = profileSnapshot;
