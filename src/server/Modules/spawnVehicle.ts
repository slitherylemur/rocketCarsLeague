// Original: ServerStorage/Modules/spawnVehicle (ModuleScript)

import { Globals } from "../Globals";
import { COLLISION_GROUPS } from "shared/collisionGroups";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import requireModule from "shared/requireModule";
import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import type { VehicleClass, VehicleModel } from "../Classes/VehicleClass";
import type { VehicleSubClassModule } from "../Classes/VehicleSubClass/subClassTypes";

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const physicsService = game.GetService("PhysicsService");
const RunService = game.GetService("RunService");

Globals.vehiclesTable = {};

// Which character the player's current vehicle was spawned for. The deferred
// CharacterRemoving handler below can fire AFTER SpawnInPlayer has already
// LoadCharacter'd and spawned the next round's car — killing the new car
// mid-SeatPlayer (the "second game: no car, camera stuck" bug). The handler
// only kills when the removing character still owns the current vehicle.
const vehicleCharacter = new Map<number, Model>();

// Under Workspace.AuthorityMode = Server there is no network ownership: the
// server simulates every assembly and SetNetworkOwner throws.
//
// IMPORTANT: Workspace.AuthorityMode is NOT script-readable in the current
// beta (the property access throws), so it cannot be used for detection —
// reading it and defaulting to false silently re-enabled the ENTIRE classic
// choreography (anchor-during-seat + SetNetworkOwner) under server authority,
// which anchors a predicted assembly mid-seat and skips markPredictable.
// The game is committed to server authority, so this is a constant; flip it
// only to A/B against classic netcode in a place that actually runs classic.
const SERVER_AUTHORITY = true;
function isServerAuthority(): boolean {
	let readable = false;
	let result = SERVER_AUTHORITY;
	pcall(() => {
		const mode = tostring((game.Workspace as unknown as Record<string, unknown>).AuthorityMode);
		readable = true;
		result = mode === "Enum.AuthorityMode.Server" || mode === "Server";
	});
	return readable ? result : SERVER_AUTHORITY;
}

// Phase 4: the car must be predictable on the owner's client. Client-side
// SetPredictionMode(On) alone left the car Authoritative, so the server also
// marks every predictable part/constraint of drivable cars On at spawn.
// (Remote clients still set them Off locally in initVehicleSim.client.ts.)
function canPredict(instance: Instance): boolean {
	return (
		instance.IsA("BasePart") ||
		instance.IsA("Model") ||
		instance.IsA("Folder") ||
		instance.IsA("Attachment") ||
		instance.IsA("Constraint") ||
		instance.IsA("JointInstance")
	);
}

function markPredictable(root: Instance) {
	const [ok, err] = pcall(() => {
		if (canPredict(root)) {
			RunService.SetPredictionMode(root, Enum.PredictionMode.On);
		}
		for (const descendant of root.GetDescendants()) {
			if (canPredict(descendant)) {
				RunService.SetPredictionMode(descendant, Enum.PredictionMode.On);
			}
		}
	});
	if (!ok) {
		warn(`[SpawnVehicle] markPredictable failed: ${err}`);
	}
}

function GetSpawnCFrame(humanoidRootPart: BasePart, vehicleModel: Model): CFrame {
	const spawnCFrame = (game.Workspace as unknown as { spawnPartTemp: BasePart }).spawnPartTemp.CFrame;
	return spawnCFrame;
}

function SeatPlayer(player: Player, newModel: Model) {
	warn(`[SeatPlayer] ENTER player=${player.Name} vehicle=${newModel.GetFullName()}`);
	const seat = newModel.FindFirstChildWhichIsA("VehicleSeat", true);
	if (!seat) {
		warn(`[SeatPlayer] ABORT no VehicleSeat on ${newModel.GetFullName()}`);
		return;
	}
	const character = player.Character;
	if (!character) {
		warn(`[SeatPlayer] ABORT player.Character is nil`);
		return;
	}
	const humanoid = character.WaitForChild("Humanoid") as Humanoid;
	const root = character.WaitForChild("HumanoidRootPart") as BasePart;

	// If the character ever ends up as assembly root, make sure the car wins.
	const base = newModel.FindFirstChild("Base");
	if (base && base.IsA("BasePart")) {
		base.RootPriority = 10;
	}
	seat.RootPriority = 10;

	if (!newModel.PrimaryPart) {
		warn(`[SeatPlayer] ABORT no PrimaryPart on ${newModel.GetFullName()}`);
		return;
	}

	// Anchor while moving: an unanchored character at map height falls, dies to
	// fall damage, PlayerDamaged resets them to the menu and KillVehicle tears
	// the car apart mid-spawn (the 10s-wait failure mode we observed).
	root.Anchored = true;
	root.CFrame = seat.CFrame.add(seat.CFrame.UpVector.mul(3));
	warn(`[SeatPlayer] anchored+moved char to ${root.Position}; vehicle at ${newModel.GetPrimaryPartCFrame().Position}`);

	RunService.Stepped.Wait();
	task.wait(0.1);

	if (!newModel.Parent || !newModel.PrimaryPart || !seat.Parent) {
		warn(`[SeatPlayer] ABORT vehicle destroyed before Sit`);
		root.Anchored = false;
		return;
	}

	// Unanchor BEFORE Sit: the car Base is anchored during the whole seating
	// sequence (see SpawnVehicle), so the seat weld resolves by snapping the
	// character into the seat — the car cannot be moved by anything.
	root.Anchored = false;
	seat.Sit(humanoid);
	warn(`[SeatPlayer] EXIT vehiclePos=${newModel.GetPrimaryPartCFrame().Position} seated=${humanoid.Sit}`);
}

// (InitialiseControl and its Humanoid.Seated → drive() trigger were removed
// in Phase 2: the shared sim's tick gates on VehicleSeat.Occupant directly,
// so there is no per-vehicle drive loop to start anymore.)

function makeWheelsUncollidable(vehicleModel: VehicleModel) {
	const hitboxes = vehicleModel.FindFirstChild("Hitboxes");
	for (const part of vehicleModel.GetDescendants()) {
		if (part.IsA("BasePart")) {
			if (part.Parent!.Parent === vehicleModel.Wheels) {
				//physicsService:SetPartCollisionGroup(part, "VehicleWheels")
				part.CollisionGroup = "VehicleWheels";
			} else if (hitboxes !== undefined && part.IsDescendantOf(hitboxes)) {
				// Pure query surfaces: BallSim's include-list overlap reads
				// HitboxMain (the ball bounces off this big smooth box instead
				// of the detailed body and wheels) and the damage
				// GetPartsInPart reads damageBlock. The Hitbox group
				// engine-collides with nothing (initCollisionGroups.server.ts),
				// so car-vs-car and car-vs-map behavior is unchanged; CanQuery
				// is what the spatial queries need.
				part.CollisionGroup = COLLISION_GROUPS.Hitbox;
				part.CanCollide = false;
				part.CanQuery = true;
			} else {
				//physicsService:SetPartCollisionGroup(part, "vehicle")
				part.CollisionGroup = "vehicle";
			}
		}
	}
}

const spawnVehicleModule = {
	SpawnVehicle(player: Player, drivable: boolean, vehicleName: string, spawnCFrame: CFrame, clientSided?: boolean) {
		warn(
			`[SpawnVehicle] ENTER player=${player.Name} drivable=${drivable} clientSided=${clientSided === true} vehicleName=${vehicleName} spawnPos=${spawnCFrame.Position}`,
		);
		// Original: require(game.ServerStorage.Classes.VehicleSubClass:FindFirstChild(vehicleName, true))
		// The compiled subclass ModuleScripts live under <TS root>/Classes/VehicleSubClass.
		// requireModule preserves the original's lazy, name-based dynamic require.
		const subClassFolder = (script.Parent!.Parent as unknown as { Classes: { VehicleSubClass: Folder } }).Classes
			.VehicleSubClass;
		const VehicleClass = requireModule(
			subClassFolder.FindFirstChild(vehicleName, true) as ModuleScript,
		) as VehicleSubClassModule;

		spawnVehicleModule.KillVehicle(player);

		const [newVehicle, model] = VehicleClass.new(player);
		Globals.vehiclesTable[player.UserId] = newVehicle;
		const ownerCharacter = player.Character;
		if (ownerCharacter) {
			vehicleCharacter.set(player.UserId, ownerCharacter);
		} else {
			vehicleCharacter.delete(player.UserId);
		}
		let newModel: VehicleModel | undefined = model;

		if (!newModel) {
			warn(`[SpawnVehicle] ABORT VehicleClass.new returned no model for ${vehicleName}`);
			return;
		}
		warn(
			`[SpawnVehicle] created NEW clone (not menu car) model=${newModel.Name} parent=${newModel.Parent?.GetFullName() ?? "nil"}`,
		);

		if (clientSided) {
			//newModel.Parent = ReplicatedStorage
			const playerGarage = Globals.findPlayerGarage(player);
			if (playerGarage && playerGarage.FindFirstChild("VehicleFolder")) {
				playerGarage.FindFirstChild("VehicleFolder")!.ClearAllChildren();
				if (!newModel) {
					task.wait(0.5);
					if (!newModel) {
						return;
					}
				}
				newModel.Parent = playerGarage.FindFirstChild("VehicleFolder");
			} else if (playerGarage) {
				const vehicleFolder = new Instance("Folder");
				vehicleFolder.Name = "VehicleFolder";
				vehicleFolder.Parent = playerGarage;
				newModel.Parent = vehicleFolder;
			}

			FunctionsAndEvents.CreateClientSidedCar.FireClient(player, newModel);
			if (newModel.FindFirstChild("TeamHighlight")) {
				(newModel.FindFirstChild("TeamHighlight") as Highlight).Enabled = false;
			}

			if (newModel.Base.FindFirstChild("HealthBar")) {
				newModel.Base.FindFirstChild("HealthBar")!.Destroy();
			}

			// task.wait(.1)

			// newModel.Parent = workspace.MenuVehicles

			// for i, part in pairs(newModel:GetDescendants()) do
			// 	if part:IsA("BasePart") and part.Parent.Parent.Name ~= "Wheels"	then
			// 		part.CanCollide = false
			// 	end
			// end
		} else {
			newModel.Parent = (game.Workspace as unknown as { Vehicles: Folder }).Vehicles;
			newModel.Name = `${newModel.Name}${player.UserId}`;
			warn(`[SpawnVehicle] parented match vehicle to ${newModel.GetFullName()}`);
		}

		const modelSize = newModel.GetExtentsSize();

		// Classic netcode only: hold the car server-side through the whole
		// seating sequence. Sitting in a VehicleSeat auto-transfers network
		// ownership of the car assembly to the seated client — whose replica of
		// the character is often still at the lobby spawn (below the map). That
		// client then "solves" the seat weld from its stale state and drags the
		// car body under the map. An anchored assembly is server-owned and
		// immovable, so the race cannot happen; it is unanchored right before
		// SetNetworkOwner below, once the client has had the correct spawn state
		// replicated.
		//
		// Under server authority no ownership transfer exists — the server
		// simulates the car for its whole life — and anchoring a soon-predicted
		// assembly through the seat sequence confuses the rollback system, so
		// the whole dance is skipped.
		if (drivable && !isServerAuthority()) {
			newModel.Base.Anchored = true;
		}

		newModel.SetPrimaryPartCFrame(spawnCFrame.add(new Vector3(0, modelSize.Y / 2, 0)));
		warn(
			`[SpawnVehicle] placed at ${newModel.GetPrimaryPartCFrame().Position} (extentsY/2=${modelSize.Y / 2})`,
		);

		makeWheelsUncollidable(newModel);

		if (drivable) {
			//task.wait(1)
			// pcall(function()
			// 	newModel:WaitForChild("Base")
			// end)

			warn(`[SpawnVehicle] WaitForChild Vehicles/${newModel.Name}`);
			(game.Workspace as unknown as { Vehicles: Folder }).Vehicles.WaitForChild(newModel.Name);
			warn(`[SpawnVehicle] InitialiseControl; Character=${player.Character?.GetFullName() ?? "nil"}`);

			if (isServerAuthority()) {
				markPredictable(newModel);
			}

			SeatPlayer(player, newModel);

			(
				player as unknown as {
					PlayerGui: { Game: { BoostMeter: CanvasGroup } };
				}
			).PlayerGui.Game.BoostMeter.Visible = true;

			task.wait(2);
		}

		// Garage display cars (clientSided) don't need network ownership — and
		// SetNetworkOwner throws if the assembly is anchored / not yet simulated,
		// which aborts setTab.Inventory mid-setup and breaks the spawn button flow.
		if (!clientSided) {
			let loopTimer = 0;
			while (!newModel.IsDescendantOf(game.Workspace)) {
				task.wait(0.5);
				loopTimer += 1;
				if (loopTimer === 10) {
					warn(`[SpawnVehicle] ABORT timed out waiting for Workspace ancestry`);
					return;
				}
			}

			// Release the car to physics only now: the client has received the
			// anchored (server-authoritative) spawn state, so it starts
			// simulating from the correct position when it takes ownership.
			if (newModel.Base.Anchored) {
				newModel.Base.Anchored = false;
				RunService.Stepped.Wait();
			}

			// Classic (AuthorityMode = Client) only — kept so the old netcode
			// still behaves identically for baseline/parity comparisons.
			if (!isServerAuthority()) {
				const [ok, err] = pcall(() => {
					newModel.Base.SetNetworkOwner(player);
				});
				if (!ok) {
					warn(`[SpawnVehicle] SetNetworkOwner failed: ${err}`);
				}
			}
		}

		warn(
			`[SpawnVehicle] EXIT drivable=${drivable} clientSided=${clientSided === true} model=${newModel.GetFullName()}`,
		);
	},

	KillVehicle(player: Player, doubleO?: boolean) {
		const existing = Globals.vehiclesTable[player.UserId];
		warn(
			`[KillVehicle] player=${player.Name} hasVehicle=${existing !== undefined} model=${existing?.model.GetFullName() ?? "nil"}`,
		);
		if (existing) {
			if (!doubleO) {
				Globals.vehiclesTable[player.UserId]!.wasKilled = true;
			}

			VehicleSim.unregister(existing.model);

			for (const instance of Globals.vehiclesTable[player.UserId]!.model.GetDescendants()) {
				if (
					instance.IsA("WeldConstraint") ||
					instance.IsA("CylindricalConstraint") ||
					instance.IsA("SpringConstraint") ||
					instance.IsA("HingeConstraint") ||
					instance.IsA("Attachment")
				) {
					instance.Destroy();
				}
			}
			Globals.vehiclesTable[player.UserId]!.model.Destroy();

			Globals.vehiclesTable[player.UserId] = undefined;
			vehicleCharacter.delete(player.UserId);
		}

		const playerGarage = Globals.findPlayerGarage(player);
		if (playerGarage && playerGarage.FindFirstChild("VehicleFolder")) {
			for (const v of playerGarage.FindFirstChild("VehicleFolder")!.GetChildren()) {
				for (const instance of v.GetDescendants()) {
					if (
						instance.IsA("WeldConstraint") ||
						instance.IsA("CylindricalConstraint") ||
						instance.IsA("SpringConstraint") ||
						instance.IsA("HingeConstraint") ||
						instance.IsA("Attachment")
					) {
						instance.Destroy();
					}
				}
				v.Destroy();
			}
			//playerGarage:FindFirstChild("VehicleFolder"):ClearAllChildren()
		}

	},
};

// Phase 3: movement and abilities travel through the Input Action System —
// only the non-sim actions remain on this remote (Horn; FlipVehicle kept for
// parity, though nothing currently binds it client-side).
function KeyHandler(player: Player, actionName: unknown, inputState: unknown, inputObject: unknown) {
	const Vehicle = Globals.vehiclesTable[player.UserId];
	if (Vehicle) {
		if (actionName === "FlipVehicle" && inputState === Enum.UserInputState.Begin) {
			Vehicle.Flip();
		} else if (actionName === "HonkHorn") {
			Vehicle.Horn(inputState as Enum.UserInputState);
		}
	}
}

Players.PlayerAdded.Connect((player) => {
	player.CharacterRemoving.Connect((character) => {
		// Use the closure player: GetPlayerFromCharacter returns nil for a
		// character that already unparented mid-respawn, and KillVehicle
		// indexing nil.UserId errored on every menu-return loop.
		//
		// Deferred CharacterRemoving can run after SpawnInPlayer has already
		// LoadCharacter'd and spawned the next round's car; killing then would
		// destroy the NEW car mid-SeatPlayer. Only kill when the vehicle still
		// belongs to the character being removed (no recorded owner = old
		// behavior: kill).
		const owner = vehicleCharacter.get(player.UserId);
		if (owner !== undefined && owner !== character) {
			warn(
				`[KillVehicle] skipped for ${player.Name}: ${character.Name} removing but vehicle belongs to a newer character`,
			);
			return;
		}
		spawnVehicleModule.KillVehicle(player);
	});
});

Players.PlayerRemoving.Connect((player) => {
	spawnVehicleModule.KillVehicle(player);
	vehicleCharacter.delete(player.UserId);
	task.delay(5, () => {
		print(Globals.vehiclesTable);
	});
});
FunctionsAndEvents.KeyHandler.OnServerEvent.Connect(KeyHandler);

export = spawnVehicleModule;
