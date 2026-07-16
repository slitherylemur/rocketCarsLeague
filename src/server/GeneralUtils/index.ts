// Original: ServerScriptService/GeneralUtils (ModuleScript)

//Services
const PhysicsService = game.GetService("PhysicsService");
const Players = game.GetService("Players");

type IterAction = (object: Instance, ...args: unknown[]) => void;

const GeneralUtils = {
	IterateOverArrayValuesOfType(Table: Instance[], Type: keyof Instances, action: IterAction, ...args: unknown[]) {
		for (const object of Table) {
			if (object.IsA(Type)) {
				action(object, ...args);
			}
		}
	},

	GetArrayValuesOfType(Table: Instance[], Type: keyof Instances): Instance[] {
		const newTable: Instance[] = [];
		for (const object of Table) {
			if (object.IsA(Type)) {
				newTable.push(object);
			}
		}
		return newTable;
	},

	RemoveArrayValuesOfType(Table: Instance[], Type: keyof Instances) {
		for (let i = Table.size() - 1; i >= 1 - 1; i--) {
			const object = Table[i];

			if (object.IsA(Type)) {
				object.Destroy();
				Table.remove(i);
			}
		}
	},

	//Children
	GetChildrenOfType(parent: Instance, Type: keyof Instances) {
		return GeneralUtils.GetArrayValuesOfType(parent.GetChildren(), Type);
	},

	RemoveChildrenOfType(parent: Instance, Type: keyof Instances) {
		return GeneralUtils.RemoveArrayValuesOfType(parent.GetChildren(), Type);
	},

	IterateOverChildrenOfType(parent: Instance, Type: keyof Instances, action: IterAction, ...args: unknown[]) {
		return GeneralUtils.IterateOverArrayValuesOfType(parent.GetChildren(), Type, action, ...args);
	},

	//Descendants
	GetDescendantsOfType(parent: Instance, Type: keyof Instances) {
		return GeneralUtils.GetArrayValuesOfType(parent.GetDescendants(), Type);
	},

	RemoveDescendantsOfType(parent: Instance, Type: keyof Instances) {
		return GeneralUtils.RemoveArrayValuesOfType(parent.GetDescendants(), Type);
	},

	IterateOverDescendantsOfType(parent: Instance, Type: keyof Instances, action: IterAction, ...args: unknown[]) {
		return GeneralUtils.IterateOverArrayValuesOfType(parent.GetDescendants(), Type, action, ...args);
	},

	//Collision groups
	setCollisionGroup(object: Instance, GroupName: string) {
		if (object.IsA("BasePart")) {
			setCollisionGroup(object, GroupName);
		}

		GeneralUtils.IterateOverDescendantsOfType(object, "BasePart", setCollisionGroupAction, GroupName);
	},

	//String
	StringAddSpacesBeforeCaps(String: string): string {
		const SplitLocation = string.find(String, "%l%u")[0];

		if (SplitLocation !== undefined) {
			const FirstString = string.sub(String, 0, SplitLocation);
			const SecondString = string.sub(String, SplitLocation + 1);

			if (SecondString !== undefined) {
				return FirstString + " " + GeneralUtils.StringAddSpacesBeforeCaps(SecondString);
			} else {
				return String;
			}
		} else {
			return String;
		}
	},

	StringNumberFormat(Number: number): string {
		const Abbreviations = ["K", "M", "b", "t", "qa", "qi", "sx", "sp", "o", "n", "d"];

		assert(Number !== undefined && typeOf(Number) === "number", "Supplied value must be a number");

		const AbsNumber = math.abs(Number);

		if (AbsNumber < 1000) {
			return tostring(Number);
		}

		for (let Key = 1; Key <= Abbreviations.size(); Key++) {
			const Abbreviation = Abbreviations[Key - 1];
			if (AbsNumber >= 10 ** (3 * Key) && AbsNumber < 10 ** (3 * (Key + 1))) {
				return (
					(Number < 0 ? "-" : "") +
					tostring(math.floor((AbsNumber / 10 ** (3 * Key)) * 10) / 10) +
					Abbreviation
				);
			}
		}

		assert(Number !== undefined && typeOf(Number) === "number", "Supplied value must be a number");

		if (math.abs(Number) < 1000) {
			return tostring(Number);
		}

		let String =
			(Number < 0 ? "-" : "") +
			string.reverse(
				string.gsub(
					string.gsub(string.reverse(tostring(math.abs(math.floor(Number)))), "%d%d%d", "%1 ")[0],
					",$",
					"",
				)[0],
			);

		if (!(Number === math.floor(Number))) {
			String = String + "." + (string.match(tostring(Number), "%d+.$")[0] as string);
		}

		return String;
	},

	StringCreatePrice(Number: number, Sign: string, atFront?: boolean): string {
		const NumberString = GeneralUtils.StringNumberFormat(Number);
		if (atFront) {
			return Sign + NumberString;
		} else {
			return NumberString + Sign;
		}
	},

	CommaNumber(Number: number): string {
		//	print(Number)
		assert(Number !== undefined && typeOf(Number) === "number", "Supplied value must be a number");

		if (math.abs(Number) < 1000) {
			return tostring(Number);
		}

		let String =
			(Number < 0 ? "-" : "") +
			string.reverse(
				string.gsub(
					string.gsub(string.reverse(tostring(math.abs(math.floor(Number)))), "%d%d%d", "%1,")[0],
					",$",
					"",
				)[0],
			);

		if (!(Number === math.floor(Number))) {
			String = String + "." + (string.match(tostring(Number), "%d+.$")[0] as string);
		}

		return String;
	},
};

function setCollisionGroup(object: BasePart, GroupName: string) {
	//PhysicsService:SetPartCollisionGroup(object, GroupName)
	object.CollisionGroup = GroupName;
}

const setCollisionGroupAction = ((object: BasePart, GroupName: string) =>
	setCollisionGroup(object, GroupName)) as unknown as IterAction;

//Test

export = GeneralUtils;
