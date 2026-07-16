// Original: ServerStorage/Modules/DataStore2/SavingMethods/OrderedBackups (ModuleScript)

/*
	berezaa's method of saving data (from the dev forum):

	What I do and this might seem a little over-the-top but it's fine as long as you're not using datastores
	excessively elsewhere is have a datastore and an ordereddatastore for each player. When you perform a save,
	add a key (can be anything) with the value of os.time() to the ordereddatastore and save a key with the os.time()
	and the value of the player's data to the regular datastore. Then, when loading data, get the highest number from
	the ordered data store (most recent save) and load the data with that as a key.

	Ever since I implemented this, pretty much no one has ever lost data. There's no caches to worry about either
	because you're never overriding any keys. Plus, it has the added benefit of allowing you to restore lost data,
	since every save doubles as a backup which can be easily found with the ordereddatastore

	edit: while there's no official comment on this, many developers including myself have noticed really bad cache
	times and issues with using the same datastore keys to save data across multiple places in the same game. With
	this method, data is almost always instantly accessible immediately after a player teleports, making it useful
	for multi-place games.
*/

import DataStoreServiceRetriever from "../DataStoreServiceRetriever";
import Promise from "../Promise";

// Minimal structural view of the main DataStore2 object (translated separately in ../init.ts)
interface DataStore2Like {
	Name: string;
	UserId: number;
	Debug(...args: Array<unknown>): void;
}

class OrderedBackups {
	public dataStore2: DataStore2Like;
	public dataStore: DataStore;
	public orderedDataStore: OrderedDataStore;
	public mostRecentKey?: number;

	public Get() {
		return Promise.async((resolve: (...values: Array<unknown>) => void) => {
			resolve(this.orderedDataStore.GetSortedAsync(false, 1).GetCurrentPage()[0]);
		}).andThen((mostRecentKeyPage: { key: string; value: unknown } | undefined) => {
			if (mostRecentKeyPage) {
				const recentKey = mostRecentKeyPage.value as number;
				this.dataStore2.Debug("most recent key", mostRecentKeyPage);
				this.mostRecentKey = recentKey;

				return Promise.async((resolve: (...values: Array<unknown>) => void) => {
					// Lua resolved with every value GetAsync returns (value, DataStoreKeyInfo);
					// destructure + re-pass to preserve both resolution values exactly.
					const [value, keyInfo] = this.dataStore.GetAsync(recentKey as unknown as string);
					resolve(value, keyInfo);
				});
			} else {
				this.dataStore2.Debug("no recent key");
				return undefined;
			}
		});
	}

	public Set(value: unknown) {
		// `mostRecentKey or 0`: mostRecentKey is only ever a number or nil, so ?? matches Lua's `or`
		const key = (this.mostRecentKey ?? 0) + 1;

		return Promise.async((resolve: (...values: Array<unknown>) => void) => {
			this.dataStore.SetAsync(key as unknown as string, value);
			resolve();
		})
			.andThen(() => {
				return Promise.promisify(() => {
					this.orderedDataStore.SetAsync(key as unknown as string, key);
				})();
			})
			.andThen(() => {
				this.mostRecentKey = key;
			});
	}

	constructor(dataStore2: DataStore2Like) {
		const dataStoreService = DataStoreServiceRetriever.Get();
		const dataStoreKey = `${dataStore2.Name}/${dataStore2.UserId}`;

		this.dataStore2 = dataStore2;
		this.dataStore = dataStoreService.GetDataStore(dataStoreKey);
		this.orderedDataStore = dataStoreService.GetOrderedDataStore(dataStoreKey);
	}
}

export = OrderedBackups;
