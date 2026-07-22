/*
	DataStore2: A wrapper for data stores that caches and saves player's data.

	DataStore2(dataStoreName, player) - Returns a DataStore2 DataStore

	DataStore2 DataStore:
	- Get([defaultValue])
	- Set(value)
	- Update(updateFunc)
	- Increment(value, defaultValue)
	- BeforeInitialGet(modifier)
	- BeforeSave(modifier)
	- Save()
	- SaveAsync()
	- OnUpdate(callback)
	- BindToClose(callback)

	local coinStore = DataStore2("Coins", player)

	To give a player coins:

	coinStore:Increment(50)

	To get the current player's coins:

	coinStore:Get()

	NOTE (migration): this is the game's locally-modified fork of DataStore2
	(NOT stock 1.4). Local modifications preserved:
	  1. SaveAsync does NOT early-return when the value was not updated — it
	     warns (with UserId + time-in-game debug info) and saves anyway.
	  2. Routine save-success logs are suppressed; failures still surface.
	  3. Get() waits 1s between failed load attempts. Stock behaviour re-issues
	     the next DataStore request the moment the previous one rejects — a
	     production outage/throttle turned the retry-forever loop into a
	     request-budget hammer that starved its own recovery.
*/

import Constants from "./Constants";
import IsPlayer from "./IsPlayer";
import Promise2 from "./Promise";
import SavingMethods from "./SavingMethods";
import Settings from "./Settings";
import TableUtil from "./TableUtil";
import Verifier from "./Verifier";
import { Globals } from "../../Globals";

const RunService = game.GetService("RunService");
const ServerStorage = game.GetService("ServerStorage");

const SaveInStudioObject = ServerStorage.FindFirstChild("SaveInStudio") as BoolValue | undefined;
const SaveInStudio = SaveInStudioObject !== undefined && SaveInStudioObject.Value;

// Loosely-typed views of the self-contained Promise fork (Promise.ts).
// The real implementation preserves the original library's exact behaviour;
// these types only describe the calls this file makes.
interface Promise2Instance {
	andThen(onResolve?: (...args: never[]) => unknown, onReject?: (...args: never[]) => unknown): Promise2Instance;
	catch(onReject: (...args: never[]) => unknown): Promise2Instance;
	finally(callback: (...args: never[]) => unknown): Promise2Instance;
	await(): LuaTuple<[boolean, ...unknown[]]>;
}

interface Promise2Static {
	// Declared as arrow-typed PROPERTIES (not methods) so calls emit dot-style
	// (`Promise.async(...)`) exactly like the original library's static calls.
	async: (
		executor: (resolve: (...args: unknown[]) => void, reject: (...args: unknown[]) => void) => void,
	) => Promise2Instance;
	defer: (executor: (...args: unknown[]) => void) => Promise2Instance;
	delay: (seconds: number) => Promise2Instance;
	promisify: <A extends unknown[]>(callback: (...args: A) => unknown) => (...args: A) => Promise2Instance;
	race: (promises: Promise2Instance[]) => Promise2Instance;
	fromEvent: (event: RBXScriptSignal, predicate?: (...args: unknown[]) => boolean) => Promise2Instance;
	reject: (...args: unknown[]) => Promise2Instance;
}

const PromiseLib = Promise2 as unknown as Promise2Static;

function clone<T>(value: T): T {
	if (typeOf(value) === "table") {
		return TableUtil.clone(value as unknown as object) as unknown as T;
	} else {
		return value;
	}
}

type Callback2 = (value: unknown, dataStore: unknown) => void;
type Modifier = (value: unknown, dataStore: unknown) => unknown;

interface SavingMethod {
	Get(): Promise2Instance;
	Set(value: unknown): Promise2Instance;
}

//DataStore object
class DataStore {
	Name: string;
	UserId: number;
	callbacks: Callback2[];
	beforeInitialGet: Modifier[];
	afterSave: Callback2[];
	bindToClose: ((player: Player, value: unknown) => void)[];
	savingMethod!: SavingMethod;

	debug?: boolean;
	value: unknown;
	haveValue?: boolean;
	valueUpdated?: boolean;
	getting?: boolean;
	getRawPromise?: Promise2Instance;
	backup?: boolean;
	backupRetries?: number;
	backupValue?: unknown;
	beforeSave?: Modifier;
	combinedStore?: unknown; // only present on combined proxies (checked by SaveAll)

	constructor(dataStoreName: string, userId: number) {
		this.Name = dataStoreName;
		this.UserId = userId;
		this.callbacks = [];
		this.beforeInitialGet = [];
		this.afterSave = [];
		this.bindToClose = [];
	}

	//Internal functions
	Debug(...args: unknown[]) {
		if (this.debug) {
			print("[DataStore2.Debug]", ...args);
		}
	}

	_GetRaw(): Promise2Instance {
		if (this.getRawPromise) {
			return this.getRawPromise;
		}

		this.getRawPromise = this.savingMethod
			.Get()
			.andThen((value: unknown) => {
				this.value = value;
				this.Debug("value received");
				this.haveValue = true;
				this.getting = false;
			})
			.catch((reason: unknown) => {
				this.getting = false;
				this.getRawPromise = undefined;
				return PromiseLib.reject(reason);
			});

		return this.getRawPromise;
	}

	_Update(dontCallOnUpdate?: boolean) {
		if (!dontCallOnUpdate) {
			for (const callback of this.callbacks) {
				callback(this.value, this);
			}
		}

		this.haveValue = true;
		this.valueUpdated = true;
	}

	//Public functions

	Get(defaultValue?: unknown, dontAttemptGet?: boolean): unknown {
		if (dontAttemptGet) {
			return this.value;
		}

		let backupCount = 0;

		if (!this.haveValue) {
			while (!this.haveValue) {
				const [success, err] = this._GetRaw().await();

				if (!success) {
					if (this.backupRetries !== undefined) {
						backupCount = backupCount + 1;

						if (backupCount >= this.backupRetries) {
							this.backup = true;
							this.haveValue = true;
							this.value = this.backupValue;
							break;
						}
					}

					this.Debug("Get returned error:", err);
					// Local modification 4 (see header): pace the retry loop so a
					// DataStore outage doesn't burn the request budget.
					task.wait(1);
				}
			}

			if (this.value !== undefined) {
				for (const modifier of this.beforeInitialGet) {
					this.value = modifier(this.value, this);
				}
			}
		}

		let value: unknown;

		if (this.value === undefined && defaultValue !== undefined) {
			//not using "not" because false is a possible value
			value = defaultValue;
		} else {
			value = this.value;
		}

		value = clone(value);

		this.value = value;

		return value;
	}

	GetAsync(...args: unknown[]): Promise2Instance {
		return PromiseLib.promisify((...innerArgs: unknown[]) => {
			return this.Get(...innerArgs);
		})(...args);
	}

	GetTable(default_: unknown, ...args: unknown[]): unknown {
		const [success, result] = this.GetTableAsync(default_, ...args).await();
		if (!success) {
			error(result);
		}
		return result;
	}

	GetTableAsync(default_: unknown, ...args: unknown[]): Promise2Instance {
		assert(default_ !== undefined, "You must provide a default value.");

		return this.GetAsync(default_, ...args).andThen((result: unknown) => {
			let changed = false;
			assert(
				typeOf(result) === "table",
				":GetTable/:GetTableAsync was used when the value in the data store isn't a table.",
			);

			const resultTable = result as Record<string | number, unknown>;
			for (const [defaultKey, defaultValue] of pairs(default_ as Record<string | number, unknown>)) {
				if (resultTable[defaultKey] === undefined) {
					resultTable[defaultKey] = defaultValue;
					changed = true;
				}
			}

			if (changed) {
				this.Set(result);
			}

			return result;
		});
	}

	Set(value: unknown, _dontCallOnUpdate?: boolean) {
		this.value = clone(value);
		this._Update(_dontCallOnUpdate);
	}

	Update(updateFunc: (value: unknown) => unknown) {
		this.value = updateFunc(this.value);
		this._Update();
	}

	Increment(value: number, defaultValue?: number) {
		this.Set((this.Get(defaultValue) as number) + value);
	}

	IncrementAsync(add: number, defaultValue?: number): Promise2Instance {
		return this.GetAsync(defaultValue).andThen((value: unknown) => {
			return PromiseLib.promisify(() => {
				this.Set((value as number) + add);
			})();
		});
	}

	OnUpdate(callback: Callback2) {
		this.callbacks.push(callback);
	}

	BeforeInitialGet(modifier: Modifier) {
		this.beforeInitialGet.push(modifier);
	}

	BeforeSave(modifier: Modifier) {
		this.beforeSave = modifier;
	}

	AfterSave(callback: Callback2) {
		this.afterSave.push(callback);
	}

	/*
		<description>
		Adds a backup to the data store if :Get() fails a specified amount of times.
		Will return the value provided (if the value is nil, then the default value of :Get() will be returned)
		and mark the data store as a backup store, and attempts to :Save() will not truly save.
		</description>

		<parameter name = "retries">
		Number of retries before the backup will be used.
		</parameter>

		<parameter name = "value">
		The value to return to :Get() in the case of a failure.
		You can keep this blank and the default value you provided with :Get() will be used instead.
		</parameter>
	*/
	SetBackup(retries: number, value?: unknown) {
		this.backupRetries = retries;
		this.backupValue = value;
	}

	/*
		<description>
		Unmark the data store as a backup data store and tell :Get() and reset values to nil.
		</description>
	*/
	ClearBackup() {
		this.backup = undefined;
		this.haveValue = false;
		this.value = undefined;
		this.getRawPromise = undefined;
	}

	/*
		<returns>
		Whether or not the data store is a backup data store and thus won't save during :Save() or call :AfterSave().
		</returns>
	*/
	IsBackup(): boolean {
		return this.backup !== undefined; //some people haven't learned if x then yet, and will do if x == false then.
	}

	/*
		<description>
		Saves the data to the data store. Called when a player leaves.
		</description>
	*/
	Save() {
		const [success, result] = this.SaveAsync().await();

		if (!success) {
			error(result);
		}
	}

	/*
		<description>
		Asynchronously saves the data to the data store.
		</description>
	*/
	SaveAsync(): Promise2Instance {
		return PromiseLib.async((resolve, reject) => {
			if (!this.valueUpdated) {
				warn(
					string.format("Data store %s was not saved as it was not updated.", this.Name) +
						" PlayerID: " +
						this.UserId +
						" TimeInGame: " +
						(os.time() - Globals.PlayerJoinedTimes[this.UserId]!),
				);
				//resolve(false)
				//return
			}

			if (RunService.IsStudio() && !SaveInStudio) {
				warn(
					string.format("Data store %s attempted to save in studio while SaveInStudio is false.", this.Name),
				);
				if (!SaveInStudioObject) {
					warn("You can set the value of this by creating a BoolValue named SaveInStudio in ServerStorage.");
				}
				resolve(false);
				return;
			}

			if (this.backup) {
				warn("This data store is a backup store, and thus will not be saved.");
				resolve(false);
				return;
			}

			if (this.value !== undefined) {
				let save: unknown = clone(this.value);

				if (this.beforeSave) {
					const [success, result] = pcall(this.beforeSave, save, this);

					if (success) {
						save = result;
					} else {
						reject(result, Constants.SaveFailure.BeforeSaveError);
						return;
					}
				}

				const problem = Verifier.testValidity(save);
				if (problem !== undefined) {
					reject(problem, Constants.SaveFailure.InvalidData);
					return;
				}

				return this.savingMethod.Set(save).andThen(() => {
					resolve(true, save);
				});
			}
		}).andThen((saved: unknown, save: unknown) => {
			if (saved) {
				for (const afterSave of this.afterSave) {
					const [success, err] = pcall(afterSave, save, this);

					if (!success) {
						warn("Error on AfterSave:", err);
					}
				}

				this.valueUpdated = false;
			}
		});
	}

	BindToClose(callback: (player: Player, value: unknown) => void) {
		this.bindToClose.push(callback);
	}

	GetKeyValue(key: string): unknown {
		return ((this.value ?? {}) as Record<string, unknown>)[key];
	}

	SetKeyValue(key: string, newValue: unknown) {
		if (!this.value) {
			this.value = this.Get({});
		}

		(this.value as Record<string, unknown>)[key] = newValue;
	}
}

// CombinedDataStore method table. `self` is the combined proxy created in the
// DataStore2 call below; its __index falls back to the underlying DataStore.
interface CombinedProxy {
	combinedName: string;
	combinedStore: DataStore;
	combinedBeforeInitialGet?: (value: unknown) => unknown;
	combinedBeforeSave?: (value: unknown) => unknown;
	combinedInitialGot?: boolean;
	onUpdateCallbacks?: Callback2[];
	_Update(this: CombinedProxy, dontCallOnUpdate?: boolean): void;
	Get(this: CombinedProxy, defaultValue?: unknown, dontAttemptGet?: boolean): unknown;
	Set(this: CombinedProxy, value: unknown, dontCallOnUpdate?: boolean): unknown;
}

const CombinedDataStore = {
	BeforeInitialGet(this: void, combinedSelf: CombinedProxy, modifier: (value: unknown) => unknown) {
		combinedSelf.combinedBeforeInitialGet = modifier;
	},

	BeforeSave(this: void, combinedSelf: CombinedProxy, modifier: (value: unknown) => unknown) {
		combinedSelf.combinedBeforeSave = modifier;
	},

	Get(this: void, combinedSelf: CombinedProxy, defaultValue?: unknown, dontAttemptGet?: boolean): unknown {
		const tableResult = combinedSelf.combinedStore.Get({}) as Record<string, unknown>;
		let tableValue = tableResult[combinedSelf.combinedName];

		if (!dontAttemptGet) {
			if (tableValue === undefined) {
				tableValue = defaultValue;
			} else {
				if (combinedSelf.combinedBeforeInitialGet && !combinedSelf.combinedInitialGot) {
					tableValue = combinedSelf.combinedBeforeInitialGet(tableValue);
				}
			}
		}

		combinedSelf.combinedInitialGot = true;
		tableResult[combinedSelf.combinedName] = clone(tableValue);
		combinedSelf.combinedStore.Set(tableResult, true);
		return clone(tableValue);
	},

	Set(this: void, combinedSelf: CombinedProxy, value: unknown, dontCallOnUpdate?: boolean): unknown {
		return combinedSelf.combinedStore.GetAsync({}).andThen((tableResult: unknown) => {
			(tableResult as Record<string, unknown>)[combinedSelf.combinedName] = value;
			combinedSelf.combinedStore.Set(tableResult, dontCallOnUpdate);
			combinedSelf._Update(dontCallOnUpdate);
		});
	},

	Update(this: void, combinedSelf: CombinedProxy, updateFunc: (value: unknown) => unknown) {
		combinedSelf.Set(updateFunc(combinedSelf.Get()));
	},

	Save(this: void, combinedSelf: CombinedProxy) {
		combinedSelf.combinedStore.Save();
	},

	OnUpdate(this: void, combinedSelf: CombinedProxy, callback: Callback2) {
		if (!combinedSelf.onUpdateCallbacks) {
			combinedSelf.onUpdateCallbacks = [callback];
		} else {
			combinedSelf.onUpdateCallbacks.push(callback);
		}
	},

	_Update(this: void, combinedSelf: CombinedProxy, dontCallOnUpdate?: boolean) {
		if (!dontCallOnUpdate) {
			for (const callback of combinedSelf.onUpdateCallbacks ?? []) {
				callback(combinedSelf.Get(), combinedSelf);
			}
		}

		combinedSelf.combinedStore._Update(true);
	},

	SetBackup(this: void, combinedSelf: CombinedProxy, retries: number) {
		combinedSelf.combinedStore.SetBackup(retries);
	},
};

//Library
let DataStoreCache = new Map<Player, Map<string, DataStore>>();

const combinedDataStoreInfo = new Map<string, string>();

/*
	<description>
	Run this once to combine all keys provided into one "main key".
	Internally, this means that data will be stored in a table with the key mainKey.
	This is used to get around the 2-DataStore2 reliability caveat.
	</description>

	<parameter name = "mainKey">
	The key that will be used to house the table.
	</parameter>

	<parameter name = "...">
	All the keys to combine under one table.
	</parameter>
*/
function Combine(mainKey: string, ...names: string[]) {
	for (const name of names) {
		combinedDataStoreInfo.set(name, mainKey);
	}
}

function ClearCache() {
	DataStoreCache = new Map();
}

function SaveAll(player: Player) {
	const playerCache = DataStoreCache.get(player);
	if (playerCache) {
		for (const [_, dataStore] of pairs(playerCache)) {
			if (dataStore.combinedStore === undefined) {
				dataStore.Save();
			}
		}
	}
}

function PatchGlobalSettings(patch: Record<string, unknown>) {
	const settings = Settings as unknown as Record<string, unknown>;
	for (const [key, value] of pairs(patch)) {
		assert(settings[key as string] !== undefined, "No such key exists: " + (key as string));
		// TODO: Implement type checking with this when osyris' t is in
		settings[key as string] = value;
	}
}

function DataStore2Call(dataStoreName: string, player: Player): DataStore {
	assert(
		typeOf(dataStoreName) === "string" && IsPlayer.Check(player),
		string.format(
			"DataStore2() API call expected {string dataStoreName, Player player}, got {%s, %s}",
			typeOf(dataStoreName),
			typeOf(player),
		),
	);

	const existingCache = DataStoreCache.get(player);
	if (existingCache && existingCache.get(dataStoreName) !== undefined) {
		return existingCache.get(dataStoreName)!;
	} else if (combinedDataStoreInfo.get(dataStoreName) !== undefined) {
		const dataStore = DataStore2Call(combinedDataStoreInfo.get(dataStoreName)!, player);

		dataStore.BeforeSave(((combinedData: Record<string, unknown>) => {
			for (const [key] of pairs(combinedData)) {
				if (combinedDataStoreInfo.get(key as string) !== undefined) {
					const combinedStore = DataStore2Call(key as string, player) as unknown as CombinedProxy;
					const value = combinedStore.Get(undefined, true);
					if (value !== undefined) {
						if (combinedStore.combinedBeforeSave) {
							combinedData[key as string] = combinedStore.combinedBeforeSave(clone(value));
						} else {
							combinedData[key as string] = value;
						}
					}
				}
			}

			return combinedData;
		}) as Modifier);

		const combinedStore = setmetatable(
			{
				combinedName: dataStoreName,
				combinedStore: dataStore,
			},
			{
				__index: (_: unknown, key: unknown) => {
					return (
						(CombinedDataStore as unknown as Record<string, unknown>)[key as string] ??
						(dataStore as unknown as Record<string, unknown>)[key as string]
					);
				},
			},
		);

		if (!DataStoreCache.get(player)) {
			DataStoreCache.set(player, new Map());
		}

		DataStoreCache.get(player)!.set(dataStoreName, combinedStore as unknown as DataStore);
		return combinedStore as unknown as DataStore;
	}

	const dataStore = new DataStore(dataStoreName, player.UserId);

	dataStore.savingMethod = new (
		SavingMethods as unknown as Record<string, { new (dataStore: DataStore): SavingMethod }>
	)[Settings.SavingMethod](dataStore);

	const saveFinishedEvent = new Instance("BindableEvent");
	let isSaveFinished = false;
	const bindToCloseEvent = new Instance("BindableEvent");

	let bindToCloseCallback: (() => void) | undefined = () => {
		if (!isSaveFinished) {
			// Defer to avoid a race between connecting and firing "saveFinishedEvent"
			PromiseLib.defer(() => {
				bindToCloseEvent.Fire(); // Resolves the Promise.race to save the data
			});

			saveFinishedEvent.Event.Wait();
		}

		const value = dataStore.Get(undefined, true);

		for (const bindToClose of dataStore.bindToClose) {
			bindToClose(player, value);
		}
	};

	const [success, errorMessage] = pcall(() => {
		game.BindToClose(() => {
			if (bindToCloseCallback === undefined) {
				return;
			}

			bindToCloseCallback();
		});
	});
	if (!success) {
		warn("DataStore2 could not BindToClose", errorMessage);
	}

	PromiseLib.race([
		PromiseLib.fromEvent(bindToCloseEvent.Event),
		PromiseLib.fromEvent(player.AncestryChanged, () => {
			return !player.IsDescendantOf(game);
		}),
	]).andThen(() => {
		dataStore
			.SaveAsync()
			.catch((err: unknown) => {
				// TODO: Something more elegant
				warn("error when player left!", err);
			})
			.finally(() => {
				isSaveFinished = true;
				saveFinishedEvent.Fire();
			});

		//Give a long delay for people who haven't figured out the cache :^(
		return PromiseLib.delay(40).andThen(() => {
			DataStoreCache.delete(player);
			bindToCloseCallback = undefined;
		});
	});

	if (!DataStoreCache.get(player)) {
		DataStoreCache.set(player, new Map());
	}

	DataStoreCache.get(player)!.set(dataStoreName, dataStore);

	return dataStore;
}

// The original module returns `setmetatable(DataStore2, DataStore2)` with a
// __call metamethod — i.e. the module is callable AND carries the statics.
type DataStore2Module = typeof DataStore2Call & {
	Combine: typeof Combine;
	ClearCache: typeof ClearCache;
	SaveAll: typeof SaveAll;
	SaveAllAsync: (player: Player) => unknown;
	PatchGlobalSettings: typeof PatchGlobalSettings;
	Constants: typeof Constants;
};

const DataStore2Table = {
	Combine: Combine,
	ClearCache: ClearCache,
	SaveAll: SaveAll,
	SaveAllAsync: PromiseLib.promisify(SaveAll),
	PatchGlobalSettings: PatchGlobalSettings,
	Constants: Constants,
	__call: (_: unknown, dataStoreName: string, player: Player) => DataStore2Call(dataStoreName, player),
};

const DataStore2 = setmetatable(DataStore2Table, DataStore2Table as never) as unknown as DataStore2Module;

export = DataStore2;
