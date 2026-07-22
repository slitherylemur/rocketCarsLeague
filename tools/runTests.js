#!/usr/bin/env node
// Off-platform test runner for the PURE Vehicle V2 modules. Transpiles the
// TypeScript sources (type stripping only — rbxtsc already type-checks) with
// the repo's own `typescript`, installs the Roblox datatype shims, and runs
// every tests/*.test.ts file. Exits non-zero on any failure.
//
// Usage: node tools/runTests.js

"use strict";
const fs = require("fs");
const path = require("path");
const ts = require(path.join(__dirname, "..", "node_modules", "typescript"));
const { installGlobals } = require(path.join(__dirname, "..", "tests", "robloxShim.js"));

installGlobals(globalThis);

const ROOT = path.join(__dirname, "..");
const moduleCache = new Map();

function resolveSource(spec, fromDir) {
	if (spec.startsWith("shared/")) {
		return path.join(ROOT, "src", spec + ".ts");
	}
	if (spec.startsWith("./") || spec.startsWith("../")) {
		const abs = path.join(fromDir, spec);
		for (const candidate of [abs + ".ts", abs + ".js", abs]) {
			if (fs.existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

function loadModule(file) {
	const key = path.resolve(file);
	if (moduleCache.has(key)) {
		return moduleCache.get(key).exports;
	}
	const source = fs.readFileSync(key, "utf8");
	let code = source;
	if (key.endsWith(".ts")) {
		code = ts.transpileModule(source, {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
			fileName: key,
		}).outputText;
	}
	const mod = { exports: {} };
	moduleCache.set(key, mod);
	const dir = path.dirname(key);
	const requireShim = (spec) => {
		const resolved = resolveSource(spec, dir);
		if (resolved === undefined) {
			throw new Error(`test runner cannot resolve import "${spec}" from ${key}`);
		}
		return loadModule(resolved);
	};
	const fn = new Function("require", "module", "exports", "__dirname", code);
	fn(requireShim, mod, mod.exports, dir);
	return mod.exports;
}

// ---- tiny assertion API exposed to tests ----------------------------------
let passed = 0;
let failed = 0;
let currentFile = "";

globalThis.check = (condition, label) => {
	if (condition) {
		passed += 1;
	} else {
		failed += 1;
		console.error(`  FAIL [${currentFile}] ${label}`);
	}
};
globalThis.checkNear = (actual, expected, tolerance, label) => {
	const ok = Math.abs(actual - expected) <= tolerance;
	if (!ok) {
		console.error(`  FAIL [${currentFile}] ${label}: got ${actual}, expected ${expected} ±${tolerance}`);
		failed += 1;
	} else {
		passed += 1;
	}
};

const testDir = path.join(ROOT, "tests");
const testFiles = fs
	.readdirSync(testDir)
	.filter((f) => f.endsWith(".test.ts"))
	.sort();

for (const file of testFiles) {
	currentFile = file;
	console.log(`== ${file}`);
	try {
		loadModule(path.join(testDir, file));
	} catch (err) {
		failed += 1;
		console.error(`  ERROR [${file}] ${err && err.stack ? err.stack : err}`);
	}
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
