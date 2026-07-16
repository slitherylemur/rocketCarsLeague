// Original: ServerStorage/Classes/VehicleSubClass/ArmouredTransport (ModuleScript)

import VehicleClass, { VehicleModel, VehicleParams } from "../VehicleClass";
import GeneralUtils from "../../GeneralUtils";
import { Globals } from "../../Globals";

const Params: VehicleParams = {
	cost: 50000,

	//DAMAGE
	health: 200,
	damageMultiplier: 1.3,

	//MOVEMENT
	mass: 400,
	acceleration: 50,
	targetVelocity: 120,

	//TURNING
	minTurnRadius: 30,
	maxTurnRadius: 60,
	maxAngularSpeed: math.pi,
	minAngularSpeed: 0.6,

	//SPECIALS
	boostAmount: 100,
	driftingMult: 1,

	category: Globals.CarCategorys[5 - 1],

	idleSoundId: 1724607017,

	//SUSPENSION (assigned below, exactly like the original)
	damping: 0,
	stiffness: 0,
	freeLength: 0,
};

//SUSPENSION
Params.damping = Params.mass * 2;
Params.stiffness = Params.mass * 100;
Params.freeLength = 2.6;

//VEHICLE NAME
const Vehicle = {
	displayName: GeneralUtils.StringAddSpacesBeforeCaps(script.Name),

	modelTemplate: (
		game.GetService("ServerStorage") as unknown as { VehicleModels: Folder }
	).VehicleModels.FindFirstChild(script.Name) as VehicleModel,

	new: (player?: Player): LuaTuple<[VehicleClass, VehicleModel]> => {
		Params.model = Vehicle.modelTemplate.Clone();
		Params.owner = player;

		const newVehicle = new VehicleClass(Params);

		// (original re-applied setmetatable(newVehicle, VehicleClass) here — redundant)

		return $tuple(newVehicle, Params.model);
	},
};

export = Vehicle;
