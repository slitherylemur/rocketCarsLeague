// Original: ServerStorage/Classes/VehicleSubClass/DogeChallenger (ModuleScript)

import VehicleClass, { VehicleModel, VehicleParams } from "../VehicleClass";
import GeneralUtils from "../../GeneralUtils";
import { Globals } from "../../Globals";

const Params: VehicleParams = {
	cost: 20000,

	//DAMAGE
	health: 100,
	damageMultiplier: 1,

	//MOVEMENT
	mass: 400,
	acceleration: 50,
	targetVelocity: 150,

	//TURNING
	minTurnRadius: 30,
	maxTurnRadius: 60,
	maxAngularSpeed: math.pi,
	minAngularSpeed: 0.6,

	//SPECIALS
	boostAmount: 100,
	driftingMult: 1,

	category: Globals.CarCategorys[1 - 1],

	idleSoundId: 484883392,

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

/* Original trailing commented-out copy of the module (older variant with
   mass = 200 and idleSoundId = 319804747) preserved for context — it was a
   fully commented-out duplicate of the file above with those two values
   changed, plus `Params.model` cloned via
   game.ServerStorage.VehicleModels:FindFirstChild(script.Name):Clone(). */
