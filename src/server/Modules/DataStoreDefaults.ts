// Original: ServerStorage/Modules/DataStoreDefaults (ModuleScript)

import type { DataStoreDefaultsType, SerializedEnum } from "./dataTypes";

function SerializeEnum(enumItem: EnumItem): SerializedEnum {
	return [tostring(enumItem.EnumType), tostring(enumItem.Name)];
}

function DeserializeEnum(SerialisedEnum: SerializedEnum): EnumItem {
	return (Enum as unknown as Record<string, Record<string, EnumItem>>)[SerialisedEnum[0]][SerialisedEnum[1]];
}

const JumpBind = SerializeEnum(Enum.KeyCode.R);
const BoostBind = SerializeEnum(Enum.KeyCode.LeftShift);
const DriftBind = SerializeEnum(Enum.KeyCode.Space);
const HornBind = SerializeEnum(Enum.KeyCode.H);
const RollLBind = SerializeEnum(Enum.KeyCode.Q);
const RollRBind = SerializeEnum(Enum.KeyCode.E);

const DefaultValues: DataStoreDefaultsType = {
	money: 0,

	wins: 0,

	kills: 0,

	deaths: 0,

	equippedVehicle: "ToyCorolla",

	colors: ["None"],

	hornSounds: ["Horn"],

	boostTrails: ["DefaultTrail"],

	vehicles: ["ToyCorolla"],

	//Indexed by vehicle name stores Vehicles equipped accessories and so on

	vehicleCustomization: {
		ToyCorolla: {
			color: "None",

			hornSound: "Horn",

			boostTrail: "DefaultTrail",
		},
	},

	crates: [2, 1, 0],

	multipliers: [[1, 0]],

	keyBinds: {
		Jump: JumpBind,
		Boost: BoostBind,
		Drift: DriftBind,
		Horn: HornBind,
		RollLeft: RollLBind,
		RollRight: RollRBind,
	},

	codes: [],

	crateTutorial: false,
};

export = DefaultValues;
