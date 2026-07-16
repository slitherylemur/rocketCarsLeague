// Original: ServerStorage/Modules/DataStore2/Constants (ModuleScript)

// Upstream uses `newproxy(true)` with a __tostring metamethod for these symbols.
// roblox-ts does not declare `newproxy`, so we use a frozen empty table with a
// __tostring metamethod instead — closest behavior: unique identity + same
// tostring() text, and no fields can be added (like a userdata).
function symbol(text: string): object {
	const symbol = setmetatable({}, {
		__tostring: () => text,
	});
	table.freeze(symbol);
	return symbol;
}

export = {
	SaveFailure: {
		BeforeSaveError: symbol("BeforeSaveError"),
		DataStoreFailure: symbol("DataStoreFailure"),
		InvalidData: symbol("InvalidData"),
	},
};
