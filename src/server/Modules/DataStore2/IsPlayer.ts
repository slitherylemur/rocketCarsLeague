// Original: ServerStorage/Modules/DataStore2/IsPlayer (ModuleScript)

// This function is monkey patched to return MockDataStoreService during tests
const IsPlayer = {
	Check(this: void, object: unknown): boolean {
		return typeOf(object) === "Instance" && (object as Instance).ClassName === "Player";
	},
};

export = IsPlayer;
