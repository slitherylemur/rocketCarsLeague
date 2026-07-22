// Schema-budget + uniqueness tests for shared/vehicleV2/CarState.ts.

/* eslint-disable */
declare const check: (condition: boolean, label: string) => void;

import { CarAttr, CarModelAttr, estimateSchemaBytes } from "shared/vehicleV2/CarState";

// Predicted-attribute payload estimate stays well under the ~1024 B cap.
const bytes = estimateSchemaBytes();
check(bytes > 0, "schema estimate computed");
check(bytes <= 700, `schema estimate ${bytes}B within the 700B budget (cap ~1024B)`);

// Attribute names unique (a duplicate silently aliases two states).
{
	const seen = new Set<string>();
	let unique = true;
	for (const [, name] of pairs(CarAttr as unknown as Record<string, string>)) {
		if (seen.has(name)) unique = false;
		seen.add(name);
	}
	check(unique, "CarAttr names unique");
}

// Model attrs never collide with root state attrs that share the instance.
{
	let collision = false;
	for (const [, modelName] of pairs(CarModelAttr as unknown as Record<string, string>)) {
		for (const [, rootName] of pairs(CarAttr as unknown as Record<string, string>)) {
			if (modelName === rootName) collision = true;
		}
	}
	check(!collision, "model attrs distinct from root state attrs");
}
