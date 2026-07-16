// Original: ServerStorage/Modules/spawnVehicle (ModuleScript)

import { Globals } from "../Globals";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import requireModule from "shared/requireModule";
import type { VehicleClass, VehicleModel } from "../Classes/VehicleClass";
import type { VehicleSubClassModule } from "../Classes/VehicleSubClass/subClassTypes";

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const physicsService = game.GetService("PhysicsService");
const RunService = game.GetService("RunService");

Globals.vehiclesTable = {};

function GetSpawnCFrame(humanoidRootPart: BasePart, vehicleModel: Model): CFrame {
	const spawnCFrame = (game.Workspace as unknown as { spawnPartTemp: BasePart }).spawnPartTemp.CFrame;
	return spawnCFrame;
}

function SeatPlayer(player: Player, newModel: Model) {
	const seat = newModel.FindFirstChildWhichIsA("VehicleSeat", true)!;
	player.Character!.WaitForChild("Humanoid");
	RunService.Stepped.Wait();

	seat.Sit((player.Character as unknown as { Humanoid: Humanoid }).Humanoid);
}

const HumanoidSeatedConnection = new Map<Player, RBXScriptConnection>();

function InitialiseControl(player: Player, newModel: VehicleModel) {
	if (HumanoidSeatedConnection.get(player) !== undefined) {
		HumanoidSeatedConnection.get(player)!.Disconnect();
		HumanoidSeatedConnection.delete(player);
	}

	HumanoidSeatedConnection.set(
		player,
		(player.Character as unknown as { Humanoid: Humanoid }).Humanoid.Seated.Connect(() => {
			// print("seated")

			// if not player.Character then
			// 	print("character DNE")
			// end

			// if not newModel.Seats:FindFirstChild("VehicleSeat") then
			// 	print("vehicle seat DNE")
			// end

			// if not player.Character.Humanoid == newModel.Seats.VehicleSeat.Occupant then
			// 	print("character is not seated in the vehicle")
			// end

			if (
				player.Character &&
				newModel.Seats.FindFirstChild("VehicleSeat") &&
				(player.Character as unknown as { Humanoid: Humanoid }).Humanoid ===
					(newModel.Seats.FindFirstChild("VehicleSeat") as VehicleSeat).Occupant
			) {
				// print(_G.vehiclesTable[player.UserId])
				// print(_G.vehiclesTable[player.UserId].model)
				// print(_G.vehiclesTable[player.UserId].model.Base)
				Globals.vehiclesTable[player.UserId]!.drive();
			}
		}),
	);
}

function makeWheelsUncollidable(vehicleModel: VehicleModel) {
	for (const part of vehicleModel.GetDescendants()) {
		if (part.IsA("BasePart")) {
			if (part.Parent!.Parent === vehicleModel.Wheels) {
				//physicsService:SetPartCollisionGroup(part, "VehicleWheels")
				part.CollisionGroup = "VehicleWheels";
			} else {
				//physicsService:SetPartCollisionGroup(part, "vehicle")
				part.CollisionGroup = "vehicle";
			}
		}
	}
}

const spawnVehicleModule = {
	SpawnVehicle(player: Player, drivable: boolean, vehicleName: string, spawnCFrame: CFrame, clientSided?: boolean) {
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
		let newModel: VehicleModel | undefined = model;

		if (!newModel) {
			return;
		}

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
		}

		const modelSize = newModel.GetExtentsSize();

		newModel.SetPrimaryPartCFrame(spawnCFrame.add(new Vector3(0, modelSize.Y / 2, 0)));

		makeWheelsUncollidable(newModel);

		if (drivable) {
			//task.wait(1)
			// pcall(function()
			// 	newModel:WaitForChild("Base")
			// end)

			(game.Workspace as unknown as { Vehicles: Folder }).Vehicles.WaitForChild(newModel.Name);

			InitialiseControl(player, newModel);

			SeatPlayer(player, newModel);

			(
				player as unknown as {
					PlayerGui: { Game: { BoostMeter: CanvasGroup } };
				}
			).PlayerGui.Game.BoostMeter.Visible = true;

			task.wait(2);
		}

		let loopTimer = 0;
		while (!newModel.IsDescendantOf(game.Workspace)) {
			task.wait(0.5);
			loopTimer += 1;
			if (loopTimer === 10) {
				return;
			}
		}

		newModel.Base.SetNetworkOwner(player);
	},

	KillVehicle(player: Player, doubleO?: boolean) {
		if (Globals.vehiclesTable[player.UserId]) {
			if (!doubleO) {
				Globals.vehiclesTable[player.UserId]!.wasKilled = true;
			}

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

		if (HumanoidSeatedConnection.get(player) !== undefined) {
			HumanoidSeatedConnection.get(player)!.Disconnect();
			HumanoidSeatedConnection.delete(player);
		}
	},
};

// Methods that only exist on the client Vehicle class (or are commented out on
// the server class) still get called here exactly like the original — calling
// them errors at runtime identically to the Lua (`attempt to call a nil value`),
// which the game swallows in the remote-event handler.
interface KeyHandlerVehicle {
	Flip(): void;
	Horn(inputState: Enum.UserInputState): void;
	DriftHandler(inputState: Enum.UserInputState): void;
	Boost(inputState: Enum.UserInputState): void;
	Jump(inputState: Enum.UserInputState): void;
	RollLeft(inputState: Enum.UserInputState): void;
	RollRight(inputState: Enum.UserInputState): void;
}

function KeyHandler(player: Player, actionName: unknown, inputState: unknown, inputObject: unknown) {
	const Vehicle = Globals.vehiclesTable[player.UserId] as unknown as KeyHandlerVehicle | undefined;
	if (Vehicle) {
		if (actionName === "FlipVehicle" && inputState === Enum.UserInputState.Begin) {
			Vehicle.Flip();
		} else if (actionName === "HonkHorn") {
			Vehicle.Horn(inputState as Enum.UserInputState);
		} else if (actionName === "Drift") {
			Vehicle.DriftHandler(inputState as Enum.UserInputState);
		} else if (actionName === "Boost") {
			Vehicle.Boost(inputState as Enum.UserInputState);
		} else if (actionName === "Jump1" || actionName === "Jump2") {
			Vehicle.Jump(inputState as Enum.UserInputState);
		} else if (actionName === "RollLeft") {
			Vehicle.RollLeft(inputState as Enum.UserInputState);
		} else if (actionName === "RollRight") {
			Vehicle.RollRight(inputState as Enum.UserInputState);
		}
	}
}

Players.PlayerAdded.Connect((player) => {
	player.CharacterRemoving.Connect((character) => {
		const characterPlayer = game.GetService("Players").GetPlayerFromCharacter(character)!;
		spawnVehicleModule.KillVehicle(characterPlayer);
	});
});

Players.PlayerRemoving.Connect((player) => {
	spawnVehicleModule.KillVehicle(player);
	task.delay(5, () => {
		print(Globals.vehiclesTable);
	});
});
FunctionsAndEvents.KeyHandler.OnServerEvent.Connect(KeyHandler);

export = spawnVehicleModule;
