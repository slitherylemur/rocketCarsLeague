/* eslint-disable */
/*
	An implementation of Promises similar to Promise/A+.
*/

// (roblox-ts) `unpack` is the Luau global; it is not declared by @rbxts/types, so declare it here.
declare function unpack<T>(list: ReadonlyArray<T>, i?: number, j?: number): LuaTuple<Array<T>>;

const ERROR_NON_PROMISE_IN_LIST = "Non-promise value passed into %s at index %s";
const ERROR_NON_LIST = "Please pass a list of promises to %s";
const ERROR_NON_FUNCTION = "Please pass a handler function to %s!";
const MODE_KEY_METATABLE = { __mode: "k" as const };

// (roblox-ts) Type declarations for the metatable-based structures below. These emit nothing.
type Status = "Started" | "Resolved" | "Rejected" | "Cancelled";

interface PromiseErrorOptions {
	error?: unknown;
	trace?: string;
	context?: string;
	kind?: string;
}

interface PromiseError {
	error: string;
	trace: string | undefined;
	context: string | undefined;
	kind: string | undefined;
	parent: PromiseError | undefined;
	createdTick: number;
	createdTrace: string;
	extend(options?: PromiseErrorOptions): PromiseError;
	getErrorChain(): Array<PromiseError>;
}

interface PromiseErrorConstructor {
	Kind: {
		ExecutionError: "ExecutionError";
		AlreadyCancelled: "AlreadyCancelled";
		NotResolvedInTime: "NotResolvedInTime";
		TimedOut: "TimedOut";
	};
	__index: PromiseErrorConstructor;
	new: (options?: PromiseErrorOptions, parent?: PromiseError) => PromiseError;
	is: (anything: unknown) => boolean;
	isKind: (anything: unknown, kind: string) => boolean;
	extend: PromiseError["extend"];
	getErrorChain: PromiseError["getErrorChain"];
	__tostring: (errorObject: PromiseError) => string;
}

type PromiseExecutor = (
	resolve: (...values: Array<unknown>) => void,
	reject: (...values: Array<unknown>) => void,
	onCancel: (cancellationHook?: Callback) => boolean,
) => void;

interface Promise2 {
	_source: string;
	_status: Status;
	_values: Array<unknown> | undefined;
	_valuesLength: number;
	_unhandledRejection: boolean;
	_queuedResolve: Array<Callback> | undefined;
	_queuedReject: Array<Callback> | undefined;
	_queuedFinally: Array<Callback> | undefined;
	_cancellationHook: Callback | undefined;
	_parent: Promise2 | undefined;
	_consumers: Map<Promise2, boolean> | undefined;
	/** Backwards compatibility < v2 (set by promises from older versions of the Promise library) */
	_error?: unknown;

	timeout(seconds: number, rejectionValue?: unknown): Promise2;
	getStatus(): Status;
	_andThen(traceback: string, successHandler?: Callback, failureHandler?: Callback): Promise2;
	andThen(successHandler?: Callback, failureHandler?: Callback): Promise2;
	catch(failureCallback?: Callback): Promise2;
	tap(tapCallback: Callback): Promise2;
	andThenCall(callback: Callback, ...args: Array<unknown>): Promise2;
	andThenReturn(...args: Array<unknown>): Promise2;
	cancel(): void;
	_consumerCancelled(consumer: Promise2): void;
	_finally(traceback: string, finallyHandler?: Callback, onlyOk?: boolean): Promise2;
	finally(finallyHandler?: Callback): Promise2;
	finallyCall(callback: Callback, ...args: Array<unknown>): Promise2;
	finallyReturn(...args: Array<unknown>): Promise2;
	done(finallyHandler?: Callback): Promise2;
	doneCall(callback: Callback, ...args: Array<unknown>): Promise2;
	doneReturn(...args: Array<unknown>): Promise2;
	awaitStatus(): LuaTuple<[Status, ...Array<unknown>]>;
	await(): LuaTuple<[boolean, ...Array<unknown>]>;
	expect(): LuaTuple<Array<unknown>>;
	awaitValue(): LuaTuple<Array<unknown>>;
	_unwrap(): LuaTuple<[boolean, ...Array<unknown>]>;
	_resolve(...values: Array<unknown>): void;
	_reject(...values: Array<unknown>): void;
	_finalize(): void;
	now(rejectionValue?: unknown): Promise2;
}

interface PromisePrototype {
	timeout: Promise2["timeout"];
	getStatus: Promise2["getStatus"];
	_andThen: Promise2["_andThen"];
	andThen: Promise2["andThen"];
	catch: Promise2["catch"];
	tap: Promise2["tap"];
	andThenCall: Promise2["andThenCall"];
	andThenReturn: Promise2["andThenReturn"];
	cancel: Promise2["cancel"];
	_consumerCancelled: Promise2["_consumerCancelled"];
	_finally: Promise2["_finally"];
	finally: Promise2["finally"];
	finallyCall: Promise2["finallyCall"];
	finallyReturn: Promise2["finallyReturn"];
	done: Promise2["done"];
	doneCall: Promise2["doneCall"];
	doneReturn: Promise2["doneReturn"];
	awaitStatus: Promise2["awaitStatus"];
	await: Promise2["await"];
	expect: Promise2["expect"];
	awaitValue: Promise2["awaitValue"];
	_unwrap: Promise2["_unwrap"];
	_resolve: Promise2["_resolve"];
	_reject: Promise2["_reject"];
	_finalize: Promise2["_finalize"];
	now: Promise2["now"];
}

interface PromiseStatic {
	Error: PromiseErrorConstructor;
	Status: { Started: "Started"; Resolved: "Resolved"; Rejected: "Rejected"; Cancelled: "Cancelled" };
	_getTime: () => number;
	_timeEvent: RBXScriptSignal;
	TEST?: boolean;
	prototype: PromisePrototype;
	__index: PromisePrototype;
	__tostring: (promise: Promise2) => string;
	_new: (traceback: string, callback: PromiseExecutor, parent?: Promise2) => Promise2;
	new: (executor: PromiseExecutor) => Promise2;
	defer: (callback: PromiseExecutor) => Promise2;
	async: (callback: PromiseExecutor) => Promise2;
	resolve: (...values: Array<unknown>) => Promise2;
	reject: (...values: Array<unknown>) => Promise2;
	_try: (traceback: string, callback: Callback, ...args: Array<unknown>) => Promise2;
	try: (...args: Array<unknown>) => Promise2;
	_all: (traceback: string, promises: Array<Promise2>, amount?: number) => Promise2;
	all: (promises: Array<Promise2>) => Promise2;
	some: (promises: Array<Promise2>, amount: number) => Promise2;
	any: (promises: Array<Promise2>) => Promise2;
	allSettled: (promises: Array<Promise2>) => Promise2;
	race: (promises: Array<Promise2>) => Promise2;
	each: (list: Array<unknown>, predicate: Callback) => Promise2;
	is: (object: unknown) => boolean;
	promisify: (callback: Callback) => (...args: Array<unknown>) => Promise2;
	delay: (seconds: number) => Promise2;
	retry: (callback: Callback, times: number, ...args: Array<unknown>) => Promise2;
	fromEvent: (event: RBXScriptSignal, predicate?: Callback) => Promise2;
}

/*
	Creates an enum dictionary with some metamethods to prevent common mistakes.
*/
function makeEnum<T extends string>(enumName: string, members: ReadonlyArray<T>): { [K in T]: K } {
	const enum_: Record<string, string> = {};

	for (const [, memberName] of ipairs(members)) {
		enum_[memberName] = memberName;
	}

	return setmetatable(enum_, {
		__index: (_, k) => {
			error(string.format("%s is not in %s!", k as string, enumName), 2);
		},
		__newindex: () => {
			error(string.format("Creating new members in %s is not allowed!", enumName), 2);
		},
	}) as { [K in T]: K };
}

/*
	An object to represent runtime errors that occur during execution.
	Promises that experience an error like this will be rejected with
	an instance of this object.
*/
const Error = {} as PromiseErrorConstructor;
Error.Kind = makeEnum("Promise.Error.Kind", ["ExecutionError", "AlreadyCancelled", "NotResolvedInTime", "TimedOut"]);
Error.__index = Error;

Error.new = (options?: PromiseErrorOptions, parent?: PromiseError): PromiseError => {
	options = options ?? {};
	return setmetatable(
		{
			error: (tostring(options.error) as string | undefined) ?? "[This error has no error text.]",
			trace: options.trace,
			context: options.context,
			kind: options.kind,
			parent: parent,
			createdTick: os.clock(),
			createdTrace: debug.traceback(),
		},
		Error as never,
	) as unknown as PromiseError;
};

Error.is = (anything: unknown): boolean => {
	if (type(anything) === "table") {
		const metatable = getmetatable(anything as object);

		if (type(metatable) === "table") {
			return rawget(anything, "error") !== undefined && type(rawget(metatable, "extend")) === "function";
		}
	}

	return false;
};

Error.isKind = (anything: unknown, kind: string): boolean => {
	assert(kind !== undefined, "Argument #2 to Promise.Error.isKind must not be nil");

	return Error.is(anything) && (anything as PromiseError).kind === kind;
};

Error.extend = function (this: PromiseError, options?: PromiseErrorOptions) {
	options = options ?? {};

	options.kind = options.kind ?? this.kind;

	return Error.new(options, this);
};

Error.getErrorChain = function (this: PromiseError) {
	const runtimeErrors = [this as PromiseError];

	while (runtimeErrors[runtimeErrors.size() - 1].parent) {
		runtimeErrors.push(runtimeErrors[runtimeErrors.size() - 1].parent!);
	}

	return runtimeErrors;
};

Error.__tostring = (errorObject: PromiseError) => {
	const errorStrings = [string.format("-- Promise.Error(%s) --", errorObject.kind ?? "?")];

	for (const [, runtimeError] of ipairs(errorObject.getErrorChain())) {
		errorStrings.push(
			([runtimeError.trace ?? runtimeError.error, runtimeError.context] as Array<string>).join("\n"),
		);
	}

	return errorStrings.join("\n");
};

/*
	Packs a number of arguments into a table and returns its length.

	Used to cajole varargs without dropping sparse values.
*/
function pack(...args: Array<unknown>): LuaTuple<[number, Array<unknown>]> {
	// (roblox-ts) `args` is the `{ ... }` table; select("#", ...args) mirrors the original count.
	return $tuple(select("#", ...args), args);
}

/*
	Returns first value (success), and packs all following values.
*/
function packResult(success: boolean, ...args: Array<unknown>): LuaTuple<[boolean, number, Array<unknown>]> {
	return $tuple(success, select("#", ...args), args);
}

function makeErrorHandler(traceback: string) {
	assert(traceback !== undefined);

	return (err: unknown) => {
		// If the error object is already a table, forward it directly.
		// Should we extend the error here and add our own trace?

		if (type(err) === "table") {
			return err;
		}

		return Error.new({
			error: err,
			kind: Error.Kind.ExecutionError,
			trace: debug.traceback(tostring(err), 2),
			context: `Promise created at:\n\n${traceback}`,
		});
	};
}

/*
	Calls a Promise executor with error handling.
*/
function runExecutor(traceback: string, callback: Callback, ...args: Array<unknown>) {
	// return packResult(xpcall(callback, makeErrorHandler(traceback), ...))
	const results = xpcall(callback, makeErrorHandler(traceback), ...args);
	return packResult(...(results as unknown as [boolean, ...Array<unknown>]));
}

/*
	Creates a function that invokes a callback with correct error handling and
	resolution mechanisms.
*/
function createAdvancer(
	traceback: string,
	callback: Callback,
	resolve: (...values: Array<unknown>) => void,
	reject: (...values: Array<unknown>) => void,
) {
	return (...args: Array<unknown>) => {
		const [ok, resultLength, result] = runExecutor(traceback, callback, ...args);

		if (ok) {
			resolve(...unpack(result, 1, resultLength));
		} else {
			reject(result[0]);
		}
	};
}

function isEmpty(t: object) {
	const [firstKey] = next(t as unknown as ReadonlyMap<unknown, unknown>);
	return firstKey === undefined;
}

const Promise = {
	Error: Error,
	Status: makeEnum("Promise.Status", ["Started", "Resolved", "Rejected", "Cancelled"]),
	_getTime: os.clock,
	_timeEvent: game.GetService("RunService").Heartbeat,
} as PromiseStatic;
// (roblox-ts) `X.prototype` property access is banned by the compiler, so the prototype table is
// built in a local and attached with rawset. The runtime field name is still "prototype".
const promisePrototype = {} as PromisePrototype;
rawset(Promise, "prototype", promisePrototype);
Promise.__index = promisePrototype;

/*
	Constructs a new Promise with the given initializing callback.

	This is generally only called when directly wrapping a non-promise API into
	a promise-based version.

	The callback will receive 'resolve' and 'reject' methods, used to start
	invoking the promise chain.

	Second parameter, parent, is used internally for tracking the "parent" in a
	promise chain. External code shouldn't need to worry about this.
*/
Promise._new = (traceback: string, callback: PromiseExecutor, parent?: Promise2): Promise2 => {
	if (parent !== undefined && !Promise.is(parent)) {
		error("Argument #2 to Promise.new must be a promise or nil", 2);
	}

	// (roblox-ts) `self` is reserved by the compiler; the original's `self` local is named `promise` here.
	const promise = {
		// Used to locate where a promise was created
		_source: traceback,

		_status: Promise.Status.Started,

		// A table containing a list of all results, whether success or failure.
		// Only valid if _status is set to something besides Started
		_values: undefined,

		// Lua doesn't like sparse arrays very much, so we explicitly store the
		// length of _values to handle middle nils.
		_valuesLength: -1,

		// Tracks if this Promise has no error observers..
		_unhandledRejection: true,

		// Queues representing functions we should invoke when we update!
		_queuedResolve: [] as Array<Callback>,
		_queuedReject: [] as Array<Callback>,
		_queuedFinally: [] as Array<Callback>,

		// The function to run when/if this promise is cancelled.
		_cancellationHook: undefined,

		// The "parent" of this promise in a promise chain. Required for
		// cancellation propagation upstream.
		_parent: parent,

		// Consumers are Promises that have chained onto this one.
		// We track them for cancellation propagation downstream.
		_consumers: setmetatable(
			new Map<Promise2, boolean>(),
			MODE_KEY_METATABLE as LuaMetatable<Map<Promise2, boolean>>,
		),
	} as unknown as Promise2;

	if (parent && parent._status === Promise.Status.Started) {
		parent._consumers!.set(promise, true);
	}

	setmetatable(promise, Promise as unknown as LuaMetatable<Promise2>);

	const resolve = (...values: Array<unknown>) => {
		promise._resolve(...values);
	};

	const reject = (...values: Array<unknown>) => {
		promise._reject(...values);
	};

	const onCancel = (cancellationHook?: Callback): boolean => {
		if (cancellationHook) {
			if (promise._status === Promise.Status.Cancelled) {
				cancellationHook();
			} else {
				promise._cancellationHook = cancellationHook;
			}
		}

		return promise._status === Promise.Status.Cancelled;
	};

	coroutine.wrap(() => {
		const [ok, _resultLength, result] = runExecutor(promise._source, callback, resolve, reject, onCancel);

		if (!ok) {
			reject(result[0]);
		}
	})();

	return promise;
};

Promise.new = (executor: PromiseExecutor) => {
	return Promise._new(debug.traceback(undefined, 2), executor);
};

Promise.__tostring = (promise: Promise2) => {
	return string.format("Promise(%s)", promise.getStatus());
};

/*
	Promise.new, except pcall on a new thread is automatic.
*/
Promise.defer = (callback: PromiseExecutor) => {
	const traceback = debug.traceback(undefined, 2);
	let promise: Promise2;
	promise = Promise._new(traceback, (resolve, reject, onCancel) => {
		let connection: RBXScriptConnection | undefined;
		connection = Promise._timeEvent.Connect(() => {
			connection!.Disconnect();
			const [ok, _resultLength, result] = runExecutor(traceback, callback, resolve, reject, onCancel);

			if (!ok) {
				reject(result[0]);
			}
		});
	});

	return promise;
};

// Backwards compatibility
Promise.async = Promise.defer;

/*
	Create a promise that represents the immediately resolved value.
*/
Promise.resolve = (...args: Array<unknown>) => {
	const [length, values] = pack(...args);
	return Promise._new(debug.traceback(undefined, 2), (resolve) => {
		resolve(...unpack(values, 1, length));
	});
};

/*
	Create a promise that represents the immediately rejected value.
*/
Promise.reject = (...args: Array<unknown>) => {
	const [length, values] = pack(...args);
	return Promise._new(debug.traceback(undefined, 2), (_, reject) => {
		reject(...unpack(values, 1, length));
	});
};

/*
	Runs a non-promise-returning function as a Promise with the
  given arguments.
*/
Promise._try = (traceback: string, callback: Callback, ...args: Array<unknown>) => {
	const [valuesLength, values] = pack(...args);

	return Promise._new(traceback, (resolve) => {
		resolve(callback(...unpack(values, 1, valuesLength)));
	});
};

/*
	Begins a Promise chain, turning synchronous errors into rejections.
*/
Promise.try = (...args: Array<unknown>) => {
	// return Promise._try(debug.traceback(nil, 2), ...)
	return Promise._try(debug.traceback(undefined, 2), ...(args as [Callback, ...Array<unknown>]));
};

/*
	Returns a new promise that:
		* is resolved when all input promises resolve
		* is rejected if ANY input promises reject
*/
Promise._all = (traceback: string, promises: Array<Promise2>, amount?: number): Promise2 => {
	if (type(promises) !== "table") {
		error(string.format(ERROR_NON_LIST, "Promise.all"), 3);
	}

	// We need to check that each value is a promise here so that we can produce
	// a proper error rather than a rejected promise with our error.
	for (const [i, promise] of pairs(promises)) {
		if (!Promise.is(promise)) {
			error(string.format(ERROR_NON_PROMISE_IN_LIST, "Promise.all", tostring(i)), 3);
		}
	}

	// If there are no values then return an already resolved promise.
	if (promises.size() === 0 || amount === 0) {
		return Promise.resolve([]);
	}

	return Promise._new(traceback, (resolve, reject, onCancel) => {
		// An array to contain our resolved values from the given promises.
		const resolvedValues: Array<unknown> = [];
		const newPromises: Array<Promise2> = [];

		// Keep a count of resolved promises because just checking the resolved
		// values length wouldn't account for promises that resolve with nil.
		let resolvedCount = 0;
		let rejectedCount = 0;
		let done = false;

		const cancel = () => {
			for (const [, promise] of ipairs(newPromises)) {
				promise.cancel();
			}
		};

		// Called when a single value is resolved and resolves if all are done.
		const resolveOne = (i: number, ...args: Array<unknown>) => {
			if (done) {
				return;
			}

			resolvedCount += 1;

			if (amount === undefined) {
				resolvedValues[i - 1] = args[0];
			} else {
				resolvedValues[resolvedCount - 1] = args[0];
			}

			if (resolvedCount >= (amount ?? promises.size())) {
				done = true;
				resolve(resolvedValues);
				cancel();
			}
		};

		onCancel(cancel);

		// We can assume the values inside `promises` are all promises since we
		// checked above.
		for (const [i, promise] of ipairs(promises)) {
			newPromises[i - 1] = promise.andThen(
				(...args: Array<unknown>) => {
					resolveOne(i, ...args);
				},
				(...args: Array<unknown>) => {
					rejectedCount += 1;

					if (amount === undefined || promises.size() - rejectedCount < amount) {
						cancel();
						done = true;

						reject(...args);
					}
				},
			);
		}

		if (done) {
			cancel();
		}
	});
};

Promise.all = (promises: Array<Promise2>) => {
	return Promise._all(debug.traceback(undefined, 2), promises);
};

Promise.some = (promises: Array<Promise2>, amount: number) => {
	assert(type(amount) === "number", "Bad argument #2 to Promise.some: must be a number");

	return Promise._all(debug.traceback(undefined, 2), promises, amount);
};

Promise.any = (promises: Array<Promise2>) => {
	return Promise._all(debug.traceback(undefined, 2), promises, 1).andThen((values: Array<unknown>) => {
		return values[0];
	});
};

Promise.allSettled = (promises: Array<Promise2>) => {
	if (type(promises) !== "table") {
		error(string.format(ERROR_NON_LIST, "Promise.allSettled"), 2);
	}

	// We need to check that each value is a promise here so that we can produce
	// a proper error rather than a rejected promise with our error.
	for (const [i, promise] of pairs(promises)) {
		if (!Promise.is(promise)) {
			error(string.format(ERROR_NON_PROMISE_IN_LIST, "Promise.allSettled", tostring(i)), 2);
		}
	}

	// If there are no values then return an already resolved promise.
	if (promises.size() === 0) {
		return Promise.resolve([]);
	}

	return Promise._new(debug.traceback(undefined, 2), (resolve, _, onCancel) => {
		// An array to contain our resolved values from the given promises.
		const fates: Array<unknown> = [];
		const newPromises: Array<Promise2> = [];

		// Keep a count of resolved promises because just checking the resolved
		// values length wouldn't account for promises that resolve with nil.
		let finishedCount = 0;

		// Called when a single value is resolved and resolves if all are done.
		const resolveOne = (i: number, ...args: Array<unknown>) => {
			finishedCount += 1;

			fates[i - 1] = args[0];

			if (finishedCount >= promises.size()) {
				resolve(fates);
			}
		};

		onCancel(() => {
			for (const [, promise] of ipairs(newPromises)) {
				promise.cancel();
			}
		});

		// We can assume the values inside `promises` are all promises since we
		// checked above.
		for (const [i, promise] of ipairs(promises)) {
			newPromises[i - 1] = promise.finally((...args: Array<unknown>) => {
				resolveOne(i, ...args);
			});
		}
	});
};

/*
	Races a set of Promises and returns the first one that resolves,
	cancelling the others.
*/
Promise.race = (promises: Array<Promise2>) => {
	assert(type(promises) === "table", string.format(ERROR_NON_LIST, "Promise.race"));

	for (const [i, promise] of pairs(promises)) {
		assert(Promise.is(promise), string.format(ERROR_NON_PROMISE_IN_LIST, "Promise.race", tostring(i)));
	}

	return Promise._new(debug.traceback(undefined, 2), (resolve, reject, onCancel) => {
		const newPromises: Array<Promise2> = [];
		let finished = false;

		const cancel = () => {
			for (const [, promise] of ipairs(newPromises)) {
				promise.cancel();
			}
		};

		const finalize = (callback: (...args: Array<unknown>) => unknown) => {
			return (...args: Array<unknown>) => {
				cancel();
				finished = true;
				return callback(...args);
			};
		};

		if (onCancel(finalize(reject))) {
			return;
		}

		for (const [i, promise] of ipairs(promises)) {
			newPromises[i - 1] = promise.andThen(finalize(resolve), finalize(reject));
		}

		if (finished) {
			cancel();
		}
	});
};

/*
	Iterates serially over the given an array of values, calling the predicate callback on each before continuing.
	If the predicate returns a Promise, we wait for that Promise to resolve before continuing to the next item
	in the array. If the Promise the predicate returns rejects, the Promise from Promise.each is also rejected with
	the same value.

	Returns a Promise containing an array of the return values from the predicate for each item in the original list.
*/
Promise.each = (list: Array<unknown>, predicate: Callback) => {
	assert(type(list) === "table", string.format(ERROR_NON_LIST, "Promise.each"));
	assert(type(predicate) === "function", string.format(ERROR_NON_FUNCTION, "Promise.each"));

	return Promise._new(debug.traceback(undefined, 2), (resolve, reject, onCancel) => {
		const results: Array<unknown> = [];
		const promisesToCancel: Array<Promise2> = [];

		let cancelled = false;

		const cancel = () => {
			for (const [, promiseToCancel] of ipairs(promisesToCancel)) {
				promiseToCancel.cancel();
			}
		};

		onCancel(() => {
			cancelled = true;

			cancel();
		});

		// We need to preprocess the list of values and look for Promises.
		// If we find some, we must register our andThen calls now, so that those Promises have a consumer
		// from us registered. If we don't do this, those Promises might get cancelled by something else
		// before we get to them in the series because it's not possible to tell that we plan to use it
		// unless we indicate it here.

		const preprocessedList: Array<unknown> = [];

		for (const [index, value] of ipairs(list)) {
			if (Promise.is(value)) {
				const valuePromise = value as Promise2;
				if (valuePromise.getStatus() === Promise.Status.Cancelled) {
					cancel();
					return reject(
						Error.new({
							error: "Promise is cancelled",
							kind: Error.Kind.AlreadyCancelled,
							context: string.format(
								"The Promise that was part of the array at index %d passed into Promise.each was already cancelled when Promise.each began.\n\nThat Promise was created at:\n\n%s",
								index,
								valuePromise._source,
							),
						}),
					);
				} else if (valuePromise.getStatus() === Promise.Status.Rejected) {
					cancel();
					// return reject(select(2, value:await()))
					const awaitResult = valuePromise.await();
					return reject(...select(2, ...(awaitResult as unknown as Array<unknown>)));
				}

				// Chain a new Promise from this one so we only cancel ours
				const ourPromise = valuePromise.andThen((...args: Array<unknown>): LuaTuple<Array<unknown>> => {
					return $tuple(...args);
				});

				promisesToCancel.push(ourPromise);
				preprocessedList[index - 1] = ourPromise;
			} else {
				preprocessedList[index - 1] = value;
			}
		}

		for (const [index, valueIn] of ipairs(preprocessedList)) {
			let value = valueIn;
			if (Promise.is(value)) {
				// success, value = value:await()
				const [success, awaitValue] = (value as Promise2).await();
				value = awaitValue;

				if (!success) {
					cancel();
					return reject(value);
				}
			}

			if (cancelled) {
				return;
			}

			const predicatePromise = Promise.resolve(predicate(value, index));

			promisesToCancel.push(predicatePromise);

			const [success, result] = predicatePromise.await();

			if (!success) {
				cancel();
				return reject(result);
			}

			results[index - 1] = result;
		}

		resolve(results);
	});
};

/*
	Is the given object a Promise instance?
*/
Promise.is = (object: unknown): boolean => {
	if (type(object) !== "table") {
		return false;
	}

	const objectMetatable = getmetatable(object as object);

	if (objectMetatable === Promise) {
		// The Promise came from this library.
		return true;
	} else if (objectMetatable === undefined) {
		// No metatable, but we should still chain onto tables with andThen methods
		return type((object as { andThen: unknown }).andThen) === "function";
	} else if (
		type(objectMetatable) === "table" &&
		type(rawget(objectMetatable, "__index")) === "table" &&
		type(rawget(rawget(objectMetatable, "__index"), "andThen")) === "function"
	) {
		// Maybe this came from a different or older Promise library.
		return true;
	}

	return false;
};

/*
	Converts a yielding function into a Promise-returning one.
*/
Promise.promisify = (callback: Callback) => {
	return (...args: Array<unknown>) => {
		return Promise._try(debug.traceback(undefined, 2), callback, ...args);
	};
};

/*
	Creates a Promise that resolves after given number of seconds.
*/
interface DelayNode {
	resolve: (...values: Array<unknown>) => void;
	startTime: number;
	endTime: number;
	next?: DelayNode;
	previous?: DelayNode;
}
{
	// uses a sorted doubly linked list (queue) to achieve O(1) remove operations and O(n) for insert

	// the initial node in the linked list
	let first: DelayNode | undefined;
	let connection: RBXScriptConnection | undefined;

	Promise.delay = (seconds: number) => {
		assert(type(seconds) === "number", "Bad argument #1 to Promise.delay, must be a number.");
		// If seconds is -INF, INF, NaN, or less than 1 / 60, assume seconds is 1 / 60.
		// This mirrors the behavior of wait()
		if (!(seconds >= 1 / 60) || seconds === math.huge) {
			seconds = 1 / 60;
		}

		return Promise._new(debug.traceback(undefined, 2), (resolve, _, onCancel) => {
			const startTime = Promise._getTime();
			const endTime = startTime + seconds;

			const node: DelayNode = {
				resolve: resolve,
				startTime: startTime,
				endTime: endTime,
			};

			if (connection === undefined) {
				// first is nil when connection is nil
				first = node;
				connection = Promise._timeEvent.Connect(() => {
					const threadStart = Promise._getTime();

					while (first !== undefined && first.endTime < threadStart) {
						const current = first;
						first = current.next;

						if (first === undefined) {
							connection!.Disconnect();
							connection = undefined;
						} else {
							first.previous = undefined;
						}

						current.resolve(Promise._getTime() - current.startTime);
					}
				});
			} else {
				// first is non-nil
				if (first!.endTime < endTime) {
					// if `node` should be placed after `first`
					// we will insert `node` between `current` and `next`
					// (i.e. after `current` if `next` is nil)
					let current = first!;
					let nextNode = current.next;

					while (nextNode !== undefined && nextNode.endTime < endTime) {
						current = nextNode;
						nextNode = current.next;
					}

					// `current` must be non-nil, but `next` could be `nil` (i.e. last item in list)
					current.next = node;
					node.previous = current;

					if (nextNode !== undefined) {
						node.next = nextNode;
						nextNode.previous = node;
					}
				} else {
					// set `node` to `first`
					node.next = first;
					first!.previous = node;
					first = node;
				}
			}

			onCancel(() => {
				// remove node from queue
				const nextNode = node.next;

				if (first === node) {
					if (nextNode === undefined) {
						// if `node` is the first and last
						connection!.Disconnect();
						connection = undefined;
					} else {
						// if `node` is `first` and not the last
						nextNode.previous = undefined;
					}
					first = nextNode;
				} else {
					const previous = node.previous!;
					// since `node` is not `first`, then we know `previous` is non-nil
					previous.next = nextNode;

					if (nextNode !== undefined) {
						nextNode.previous = previous;
					}
				}
			});
		});
	};
}

/*
	Rejects the promise after `seconds` seconds.
*/
promisePrototype.timeout = function (this: Promise2, seconds: number, rejectionValue?: unknown) {
	const traceback = debug.traceback(undefined, 2);

	return Promise.race([
		Promise.delay(seconds).andThen(() => {
			return Promise.reject(
				rejectionValue === undefined
					? Error.new({
							kind: Error.Kind.TimedOut,
							error: "Timed out",
							context: string.format(
								"Timeout of %d seconds exceeded.\n:timeout() called at:\n\n%s",
								seconds,
								traceback,
							),
						})
					: rejectionValue,
			);
		}),
		this,
	]);
};

promisePrototype.getStatus = function (this: Promise2) {
	return this._status;
};

/*
	Creates a new promise that receives the result of this promise.

	The given callbacks are invoked depending on that result.
*/
promisePrototype._andThen = function (
	this: Promise2,
	traceback: string,
	successHandler?: Callback,
	failureHandler?: Callback,
) {
	this._unhandledRejection = false;

	// Create a new promise to follow this part of the chain
	return Promise._new(
		traceback,
		(resolve, reject) => {
			// Our default callbacks just pass values onto the next promise.
			// This lets success and failure cascade correctly!

			let successCallback: (...args: Array<unknown>) => void = resolve;
			if (successHandler) {
				successCallback = createAdvancer(traceback, successHandler, resolve, reject);
			}

			let failureCallback: (...args: Array<unknown>) => void = reject;
			if (failureHandler) {
				failureCallback = createAdvancer(traceback, failureHandler, resolve, reject);
			}

			if (this._status === Promise.Status.Started) {
				// If we haven't resolved yet, put ourselves into the queue
				this._queuedResolve!.push(successCallback);
				this._queuedReject!.push(failureCallback);
			} else if (this._status === Promise.Status.Resolved) {
				// This promise has already resolved! Trigger success immediately.
				successCallback(...unpack(this._values!, 1, this._valuesLength));
			} else if (this._status === Promise.Status.Rejected) {
				// This promise died a terrible death! Trigger failure immediately.
				failureCallback(...unpack(this._values!, 1, this._valuesLength));
			} else if (this._status === Promise.Status.Cancelled) {
				// We don't want to call the success handler or the failure handler,
				// we just reject this promise outright.
				reject(
					Error.new({
						error: "Promise is cancelled",
						kind: Error.Kind.AlreadyCancelled,
						context: `Promise created at\n\n${traceback}`,
					}),
				);
			}
		},
		this,
	);
};

promisePrototype.andThen = function (this: Promise2, successHandler?: Callback, failureHandler?: Callback) {
	assert(
		successHandler === undefined || type(successHandler) === "function",
		string.format(ERROR_NON_FUNCTION, "Promise:andThen"),
	);
	assert(
		failureHandler === undefined || type(failureHandler) === "function",
		string.format(ERROR_NON_FUNCTION, "Promise:andThen"),
	);

	return this._andThen(debug.traceback(undefined, 2), successHandler, failureHandler);
};

/*
	Used to catch any errors that may have occurred in the promise.
*/
promisePrototype.catch = function (this: Promise2, failureCallback?: Callback) {
	assert(
		failureCallback === undefined || type(failureCallback) === "function",
		string.format(ERROR_NON_FUNCTION, "Promise:catch"),
	);
	return this._andThen(debug.traceback(undefined, 2), undefined, failureCallback);
};

/*
	Like andThen, but the value passed into the handler is also the
	value returned from the handler.
*/
promisePrototype.tap = function (this: Promise2, tapCallback: Callback) {
	assert(type(tapCallback) === "function", string.format(ERROR_NON_FUNCTION, "Promise:tap"));
	return this._andThen(debug.traceback(undefined, 2), (...args: Array<unknown>): Promise2 | LuaTuple<
		Array<unknown>
	> => {
		const callbackReturn = tapCallback(...args) as unknown;

		if (Promise.is(callbackReturn)) {
			const [length, values] = pack(...args);
			return (callbackReturn as Promise2).andThen(() => {
				return unpack(values, 1, length);
			});
		}

		return $tuple(...args);
	});
};

/*
	Calls a callback on `andThen` with specific arguments.
*/
promisePrototype.andThenCall = function (this: Promise2, callback: Callback, ...args: Array<unknown>) {
	assert(type(callback) === "function", string.format(ERROR_NON_FUNCTION, "Promise:andThenCall"));
	const [length, values] = pack(...args);
	return this._andThen(debug.traceback(undefined, 2), () => {
		return callback(...unpack(values, 1, length)) as unknown;
	});
};

/*
	Shorthand for an andThen handler that returns the given value.
*/
promisePrototype.andThenReturn = function (this: Promise2, ...args: Array<unknown>) {
	const [length, values] = pack(...args);
	return this._andThen(debug.traceback(undefined, 2), () => {
		return unpack(values, 1, length);
	});
};

/*
	Cancels the promise, disallowing it from rejecting or resolving, and calls
	the cancellation hook if provided.
*/
promisePrototype.cancel = function (this: Promise2) {
	if (this._status !== Promise.Status.Started) {
		return;
	}

	this._status = Promise.Status.Cancelled;

	if (this._cancellationHook) {
		this._cancellationHook();
	}

	if (this._parent) {
		this._parent._consumerCancelled(this);
	}

	for (const [child] of pairs(this._consumers!)) {
		child.cancel();
	}

	this._finalize();
};

/*
	Used to decrease the number of consumers by 1, and if there are no more,
	cancel this promise.
*/
promisePrototype._consumerCancelled = function (this: Promise2, consumer: Promise2) {
	if (this._status !== Promise.Status.Started) {
		return;
	}

	this._consumers!.delete(consumer);

	const [firstConsumer] = next(this._consumers!);
	if (firstConsumer === undefined) {
		this.cancel();
	}
};

/*
	Used to set a handler for when the promise resolves, rejects, or is
	cancelled. Returns a new promise chained from this promise.
*/
promisePrototype._finally = function (this: Promise2, traceback: string, finallyHandler?: Callback, onlyOk?: boolean) {
	if (!onlyOk) {
		this._unhandledRejection = false;
	}

	// Return a promise chained off of this promise
	return Promise._new(
		traceback,
		(resolve, reject) => {
			let finallyCallback: (...args: Array<unknown>) => unknown = resolve;
			if (finallyHandler) {
				finallyCallback = createAdvancer(traceback, finallyHandler, resolve, reject);
			}

			if (onlyOk) {
				const callback = finallyCallback;
				finallyCallback = (...args: Array<unknown>) => {
					if (this._status === Promise.Status.Rejected) {
						return resolve(this);
					}

					return callback(...args);
				};
			}

			if (this._status === Promise.Status.Started) {
				// The promise is not settled, so queue this.
				this._queuedFinally!.push(finallyCallback);
			} else {
				// The promise already settled or was cancelled, run the callback now.
				finallyCallback(this._status);
			}
		},
		this,
	);
};

promisePrototype.finally = function (this: Promise2, finallyHandler?: Callback) {
	assert(
		finallyHandler === undefined || type(finallyHandler) === "function",
		string.format(ERROR_NON_FUNCTION, "Promise:finally"),
	);
	return this._finally(debug.traceback(undefined, 2), finallyHandler);
};

/*
	Calls a callback on `finally` with specific arguments.
*/
promisePrototype.finallyCall = function (this: Promise2, callback: Callback, ...args: Array<unknown>) {
	assert(type(callback) === "function", string.format(ERROR_NON_FUNCTION, "Promise:finallyCall"));
	const [length, values] = pack(...args);
	return this._finally(debug.traceback(undefined, 2), () => {
		return callback(...unpack(values, 1, length)) as unknown;
	});
};

/*
	Shorthand for a finally handler that returns the given value.
*/
promisePrototype.finallyReturn = function (this: Promise2, ...args: Array<unknown>) {
	const [length, values] = pack(...args);
	return this._finally(debug.traceback(undefined, 2), () => {
		return unpack(values, 1, length);
	});
};

/*
	Similar to finally, except rejections are propagated through it.
*/
promisePrototype.done = function (this: Promise2, finallyHandler?: Callback) {
	assert(
		finallyHandler === undefined || type(finallyHandler) === "function",
		string.format(ERROR_NON_FUNCTION, "Promise:done"),
	);
	return this._finally(debug.traceback(undefined, 2), finallyHandler, true);
};

/*
	Calls a callback on `done` with specific arguments.
*/
promisePrototype.doneCall = function (this: Promise2, callback: Callback, ...args: Array<unknown>) {
	assert(type(callback) === "function", string.format(ERROR_NON_FUNCTION, "Promise:doneCall"));
	const [length, values] = pack(...args);
	return this._finally(
		debug.traceback(undefined, 2),
		() => {
			return callback(...unpack(values, 1, length)) as unknown;
		},
		true,
	);
};

/*
	Shorthand for a done handler that returns the given value.
*/
promisePrototype.doneReturn = function (this: Promise2, ...args: Array<unknown>) {
	const [length, values] = pack(...args);
	return this._finally(
		debug.traceback(undefined, 2),
		() => {
			return unpack(values, 1, length);
		},
		true,
	);
};

/*
	Yield until the promise is completed.

	This matches the execution model of normal Roblox functions.
*/
promisePrototype.awaitStatus = function (this: Promise2): LuaTuple<[Status, ...Array<unknown>]> {
	this._unhandledRejection = false;

	if (this._status === Promise.Status.Started) {
		const bindable = new Instance("BindableEvent");

		this.finally(() => {
			bindable.Fire();
		});

		bindable.Event.Wait();
		bindable.Destroy();
	}

	if (this._status === Promise.Status.Resolved) {
		return $tuple(this._status as Status, ...unpack(this._values!, 1, this._valuesLength));
	} else if (this._status === Promise.Status.Rejected) {
		return $tuple(this._status as Status, ...unpack(this._values!, 1, this._valuesLength));
	}

	return $tuple(this._status);
};

function awaitHelper(status: Status, ...args: Array<unknown>): LuaTuple<[boolean, ...Array<unknown>]> {
	return $tuple(status === Promise.Status.Resolved, ...args);
}

/*
	Calls awaitStatus internally, returns (isResolved, values...)
*/
promisePrototype.await = function (this: Promise2) {
	// return awaitHelper(self:awaitStatus())
	const statusAndValues = this.awaitStatus();
	return awaitHelper(...(statusAndValues as unknown as [Status, ...Array<unknown>]));
};

function expectHelper(status: Status, ...args: Array<unknown>): LuaTuple<Array<unknown>> {
	if (status !== Promise.Status.Resolved) {
		error(args[0] === undefined ? "Expected Promise rejected with no value." : args[0], 3);
	}

	return $tuple(...args);
}

/*
	Calls await and only returns if the Promise resolves.
	Throws if the Promise rejects or gets cancelled.
*/
promisePrototype.expect = function (this: Promise2) {
	// return expectHelper(self:awaitStatus())
	const statusAndValues = this.awaitStatus();
	return expectHelper(...(statusAndValues as unknown as [Status, ...Array<unknown>]));
};

// Backwards compatibility
promisePrototype.awaitValue = promisePrototype.expect;

/*
	Intended for use in tests.

	Similar to await(), but instead of yielding if the promise is unresolved,
	_unwrap will throw. This indicates an assumption that a promise has
	resolved.
*/
promisePrototype._unwrap = function (this: Promise2) {
	if (this._status === Promise.Status.Started) {
		error("Promise has not resolved or rejected.", 2);
	}

	const success = this._status === Promise.Status.Resolved;

	return $tuple(success, ...unpack(this._values!, 1, this._valuesLength));
};

promisePrototype._resolve = function (this: Promise2, ...args: Array<unknown>) {
	if (this._status !== Promise.Status.Started) {
		if (Promise.is(args[0])) {
			(args[0] as Promise2)._consumerCancelled(this);
		}
		return;
	}

	// If the resolved value was a Promise, we chain onto it!
	if (Promise.is(args[0])) {
		// Without this warning, arguments sometimes mysteriously disappear
		if (select("#", ...args) > 1) {
			const message = string.format(
				"When returning a Promise from andThen, extra arguments are " + "discarded! See:\n\n%s",
				this._source,
			);
			warn(message);
		}

		const chainedPromise = args[0] as Promise2;

		const promise = chainedPromise.andThen(
			(...values: Array<unknown>) => {
				this._resolve(...values);
			},
			(...values: Array<unknown>) => {
				let maybeRuntimeError: unknown = chainedPromise._values![0];

				// Backwards compatibility < v2
				if (chainedPromise._error !== undefined && chainedPromise._error !== false) {
					maybeRuntimeError = Error.new({
						error: chainedPromise._error,
						kind: Error.Kind.ExecutionError,
						context:
							"[No stack trace available as this Promise originated from an older version of the Promise library (< v2)]",
					});
				}

				if (Error.isKind(maybeRuntimeError, Error.Kind.ExecutionError)) {
					return this._reject(
						(maybeRuntimeError as PromiseError).extend({
							error: "This Promise was chained to a Promise that errored.",
							trace: "",
							context: string.format(
								"The Promise at:\n\n%s\n...Rejected because it was chained to the following Promise, which encountered an error:\n",
								this._source,
							),
						}),
					);
				}

				this._reject(...values);
			},
		);

		if (promise._status === Promise.Status.Cancelled) {
			this.cancel();
		} else if (promise._status === Promise.Status.Started) {
			// Adopt ourselves into promise for cancellation propagation.
			this._parent = promise;
			promise._consumers!.set(this, true);
		}

		return;
	}

	this._status = Promise.Status.Resolved;
	// self._valuesLength, self._values = pack(...)
	const [valuesLength, values] = pack(...args);
	this._valuesLength = valuesLength;
	this._values = values;

	// We assume that these callbacks will not throw errors.
	for (const [, callback] of ipairs(this._queuedResolve!)) {
		coroutine.wrap(callback)(...args);
	}

	this._finalize();
};

promisePrototype._reject = function (this: Promise2, ...args: Array<unknown>) {
	if (this._status !== Promise.Status.Started) {
		return;
	}

	this._status = Promise.Status.Rejected;
	// self._valuesLength, self._values = pack(...)
	const [valuesLength, values] = pack(...args);
	this._valuesLength = valuesLength;
	this._values = values;

	// If there are any rejection handlers, call those!
	if (!isEmpty(this._queuedReject!)) {
		// We assume that these callbacks will not throw errors.
		for (const [, callback] of ipairs(this._queuedReject!)) {
			coroutine.wrap(callback)(...args);
		}
	} else {
		// At this point, no one was able to observe the error.
		// An error handler might still be attached if the error occurred
		// synchronously. We'll wait one tick, and if there are still no
		// observers, then we should put a message in the console.

		const err = tostring(args[0]);

		coroutine.wrap(() => {
			Promise._timeEvent.Wait();

			// Someone observed the error, hooray!
			if (!this._unhandledRejection) {
				return;
			}

			// Build a reasonable message
			const message = string.format("Unhandled Promise rejection:\n\n%s\n\n%s", err, this._source);

			if (Promise.TEST) {
				// Don't spam output when we're running tests.
				return;
			}

			warn(message);
		})();
	}

	this._finalize();
};

/*
	Calls any :finally handlers. We need this to be a separate method and
	queue because we must call all of the finally callbacks upon a success,
	failure, *and* cancellation.
*/
promisePrototype._finalize = function (this: Promise2) {
	for (const [, callback] of ipairs(this._queuedFinally!)) {
		// Purposefully not passing values to callbacks here, as it could be the
		// resolved values, or rejected errors. If the developer needs the values,
		// they should use :andThen or :catch explicitly.
		coroutine.wrap(callback)(this._status);
	}

	this._queuedFinally = undefined;
	this._queuedReject = undefined;
	this._queuedResolve = undefined;

	// Clear references to other Promises to allow gc
	if (!Promise.TEST) {
		this._parent = undefined;
		this._consumers = undefined;
	}
};

/*
	Chains a Promise from this one that is resolved if this Promise is
	resolved, and rejected if it is not resolved.
*/
promisePrototype.now = function (this: Promise2, rejectionValue?: unknown) {
	const traceback = debug.traceback(undefined, 2);
	if (this.getStatus() === Promise.Status.Resolved) {
		return this._andThen(traceback, (...args: Array<unknown>): LuaTuple<Array<unknown>> => {
			return $tuple(...args);
		});
	} else {
		return Promise.reject(
			rejectionValue === undefined
				? Error.new({
						kind: Error.Kind.NotResolvedInTime,
						error: "This Promise was not resolved in time for :now()",
						context: `:now() was called at:\n\n${traceback}`,
					})
				: rejectionValue,
		);
	}
};

/*
	Retries a Promise-returning callback N times until it succeeds.
*/
Promise.retry = (callback: Callback, times: number, ...args: Array<unknown>): Promise2 => {
	assert(type(callback) === "function", "Parameter #1 to Promise.retry must be a function");
	assert(type(times) === "number", "Parameter #2 to Promise.retry must be a number");

	// local args, length = {...}, select("#", ...)
	const length = select("#", ...args);

	return Promise.resolve(callback(...args)).catch((...errors: Array<unknown>) => {
		if (times > 0) {
			return Promise.retry(callback, times - 1, ...unpack(args, 1, length));
		} else {
			return Promise.reject(...errors);
		}
	});
};

/*
	Converts an event into a Promise with an optional predicate
*/
Promise.fromEvent = (event: RBXScriptSignal, predicate?: Callback) => {
	predicate =
		predicate ??
		(() => {
			return true;
		});

	return Promise._new(debug.traceback(undefined, 2), (resolve, reject, onCancel) => {
		let connection: RBXScriptConnection | undefined;
		let shouldDisconnect = false;

		const disconnect = () => {
			connection!.Disconnect();
			connection = undefined;
		};

		// We use shouldDisconnect because if the callback given to Connect is called before
		// Connect returns, connection will still be nil. This happens with events that queue up
		// events when there's nothing connected, such as RemoteEvents

		connection = event.Connect((...args: Array<unknown>) => {
			const callbackValue = predicate!(...args) as unknown;

			if (callbackValue === true) {
				resolve(...args);

				if (connection) {
					disconnect();
				} else {
					shouldDisconnect = true;
				}
			} else if (type(callbackValue) !== "boolean") {
				error("Promise.fromEvent predicate should always return a boolean");
			}
		});

		if (shouldDisconnect && connection) {
			return disconnect();
		}

		onCancel(() => {
			disconnect();
		});
	});
};

export = Promise;
