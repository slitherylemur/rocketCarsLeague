// Original: ServerStorage/Modules/DataStore2/TableUtil (ModuleScript)

const TableUtil = {
	clone(this: void, tbl: object): object {
		const clone = new Map<unknown, unknown>();

		for (const [key, value] of pairs(tbl as Map<unknown, defined>)) {
			if (typeOf(value) === "table") {
				clone.set(key, TableUtil.clone(value as object));
			} else {
				clone.set(key, value);
			}
		}

		return clone;
	},
};

export = TableUtil;
