// Original: ServerStorage/Modules/DataStore2/SavingMethods/Standard (ModuleScript)

// Standard saving of data stores
// The key you provide to DataStore2 is the name of the store with GetDataStore
// GetAsync/UpdateAsync are then called based on the user ID
import DataStoreServiceRetriever from "../DataStoreServiceRetriever";
import Promise from "../Promise";

// Minimal structural view of the main DataStore2 object (translated separately in ../init.ts)
interface DataStore2Like {
	Name: string;
	UserId: number;
}

class Standard {
	public dataStore: DataStore;
	public userId: number;

	public Get() {
		return Promise.async((resolve: (...values: Array<unknown>) => void) => {
			// Lua resolved with every value GetAsync returns (value, DataStoreKeyInfo);
			// destructure + re-pass to preserve both resolution values exactly.
			const [value, keyInfo] = this.dataStore.GetAsync(this.userId as unknown as string);
			resolve(value, keyInfo);
		});
	}

	public Set(value: unknown) {
		return Promise.async((resolve: (...values: Array<unknown>) => void) => {
			this.dataStore.UpdateAsync(
				this.userId as unknown as string,
				(() => {
					return value;
				}) as unknown as () => LuaTuple<[unknown]>,
			);

			resolve();
		});
	}

	constructor(dataStore2: DataStore2Like) {
		this.dataStore = DataStoreServiceRetriever.Get().GetDataStore(dataStore2.Name);
		this.userId = dataStore2.UserId;
	}
}

export = Standard;
