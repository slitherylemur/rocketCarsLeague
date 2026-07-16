// Original: ServerStorage/Modules/DataStore2/Verifier (ModuleScript)

// Written by Coercii

const Verifier = {
	typeValid(this: void, data: unknown): LuaTuple<[boolean, keyof CheckableTypes]> {
		return $tuple(type(data) !== "userdata", typeOf(data));
	},

	scanValidity(
		this: void,
		tbl: unknown,
		passed?: Map<unknown, boolean>,
		path?: Array<string>,
	): LuaTuple<[boolean, Array<string>?, string?, unknown?]> {
		if (type(tbl) !== "table") {
			return Verifier.scanValidity({ input: tbl }, new Map(), []);
		}
		passed = passed || new Map();
		path = path || ["input"];
		passed.set(tbl as object, true);
		let tblType: string;
		{
			const [key] = next(tbl as Map<unknown, unknown>);
			if (type(key) === "number") {
				tblType = "Array";
			} else {
				tblType = "Dictionary";
			}
		}
		let last = 0;
		for (const [key, value] of pairs(tbl as Map<unknown, defined>)) {
			path.push(tostring(key));
			if (type(key) === "number") {
				if (tblType === "Dictionary") {
					return $tuple(false, path, "Mixed Array/Dictionary");
				} else if ((key as number) % 1 !== 0) {
					// if not an integer
					return $tuple(false, path, "Non-integer index");
				} else if (key === math.huge || key === -math.huge) {
					return $tuple(false, path, "(-)Infinity index");
				}
			} else if (type(key) !== "string") {
				return $tuple(false, path, "Non-string key", typeOf(key));
			} else if (tblType === "Array") {
				return $tuple(false, path, "Mixed Array/Dictionary");
			}
			if (tblType === "Array") {
				if (last !== (key as number) - 1) {
					return $tuple(false, path, "Array with non-sequential indexes");
				}
				last = key as number;
			}
			const [isTypeValid, valueType] = Verifier.typeValid(value);
			if (!isTypeValid) {
				return $tuple(false, path, "Invalid type", valueType);
			}
			if (type(value) === "table") {
				if (passed.get(value)) {
					return $tuple(false, path, "Cyclic");
				}
				const [isValid, keyPath, reason, extra] = Verifier.scanValidity(value, passed, path);
				if (!isValid) {
					return $tuple(isValid, keyPath, reason, extra);
				}
			}
			path.pop();
		}
		passed.delete(tbl as object);
		return $tuple(true);
	},

	getStringPath(this: void, path: Array<string>): string {
		return path.join(".");
	},

	testValidity(this: void, input: unknown): string | undefined {
		const [isValid, keyPath, reason, extra] = Verifier.scanValidity(input);
		if (!isValid) {
			// Lua `if extra then`: extra is only ever a string or nil here, so a nil
			// check is exact (avoids TS 0/""/NaN truthiness emit on `unknown`)
			if (extra !== undefined) {
				return `Invalid at ${Verifier.getStringPath(keyPath!)} because: ${reason!} (${tostring(extra)})`;
			} else {
				return `Invalid at ${Verifier.getStringPath(keyPath!)} because: ${reason!}`;
			}
		}
	},
};

export = Verifier;
