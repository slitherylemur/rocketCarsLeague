// Original: ServerStorage/Modules/DataStore2/DataStoreServiceRetriever (ModuleScript)

// This function is monkey patched to return MockDataStoreService during tests
const DataStoreService = game.GetService("DataStoreService");

const DataStoreServiceRetriever = {
	Get(this: void): DataStoreService {
		return DataStoreService;
	},
};

export = DataStoreServiceRetriever;
