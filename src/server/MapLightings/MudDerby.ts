// Original: ServerStorage/MapLightings/MudDerby (ModuleScript)
// The original one-line module returned Lighting property values read from its
// ValueObject children; roundHandler also cloned its non-Value children (sky,
// atmosphere, post effects, clouds) into Lighting/Terrain. Both the values and
// those child instances are reproduced here from the original place data.

import type { MapLightingEntry } from "./types";

const entry: MapLightingEntry = {
	values: {
		["Ambient"]: new Color3(0.494117677, 0.294117659, 0.294117659),
		["Brightness"]: 1.8500000238418579102,
		["ColorShift_Bottom"]: new Color3(0.200000018, 0.180392161, 0.419607878),
		["ColorShift_Top"]: new Color3(0.458823562, 0.270588249, 0.223529428),
		["EnvironmentDiffuseScale"]: 1,
		["EnvironmentSpecularScale"]: 1,
		["GlobalShadows"]: true,
		["OutdoorAmbient"]: new Color3(0.53725493, 0.470588267, 0.654901981),
		["ClockTime"]: 14.694444656372070312,
		["ExposureCompensation"]: 0.40000000596046447754,
		["FogColor"]: new Color3(0.752941251, 0.752941251, 0.752941251),
		["FogEnd"]: 100000,
		["FogStart"]: 0,
		["GeographicLatitude"]: -0.17301945388317108154,
		["ShadowSoftness"]: 1,
	},

	createChildren: () => {
		const children: Array<{ instance: Instance; isClouds: boolean }> = [];
		{
			const inst = new Instance("Sky");
			inst.Name = "DerbySky";
			(inst as unknown as Record<string, unknown>)["CelestialBodiesShown"] = false;
			(inst as unknown as Record<string, unknown>)["MoonAngularSize"] = 1.5;
			(inst as unknown as Record<string, unknown>)["MoonTextureId"] = "rbxassetid://1075087760";
			(inst as unknown as Record<string, unknown>)["SkyboxBk"] = "rbxassetid://2673551390";
			(inst as unknown as Record<string, unknown>)["SkyboxDn"] = "rbxassetid://2673550503";
			(inst as unknown as Record<string, unknown>)["SkyboxFt"] = "rbxassetid://2673551898";
			(inst as unknown as Record<string, unknown>)["SkyboxLf"] = "rbxassetid://2673550328";
			(inst as unknown as Record<string, unknown>)["SkyboxOrientation"] = new Vector3(0, 0, 0);
			(inst as unknown as Record<string, unknown>)["SkyboxRt"] = "rbxassetid://2673550747";
			(inst as unknown as Record<string, unknown>)["SkyboxUp"] = "rbxassetid://2673551054";
			(inst as unknown as Record<string, unknown>)["StarCount"] = 500;
			(inst as unknown as Record<string, unknown>)["SunAngularSize"] = 12;
			(inst as unknown as Record<string, unknown>)["SunTextureId"] = "rbxassetid://1084351190";
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("Clouds");
			inst.Name = "Clouds";
			(inst as unknown as Record<string, unknown>)["Color"] = new Color3(0.345098048, 0.278431386, 0.235294133);
			(inst as unknown as Record<string, unknown>)["Cover"] = 0.649999976;
			(inst as unknown as Record<string, unknown>)["Density"] = 0.305999994;
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			children.push({ instance: inst, isClouds: true });
		}
		{
			const inst = new Instance("Atmosphere");
			inst.Name = "Atmosphere";
			(inst as unknown as Record<string, unknown>)["Color"] = new Color3(0.784300029, 0.666700006, 0.423500001);
			(inst as unknown as Record<string, unknown>)["Decay"] = new Color3(0.360799998, 0.235300004, 0.0549000017);
			(inst as unknown as Record<string, unknown>)["Density"] = 0.352999985;
			(inst as unknown as Record<string, unknown>)["Glare"] = 1.66999996;
			(inst as unknown as Record<string, unknown>)["Haze"] = 0.670000017;
			(inst as unknown as Record<string, unknown>)["Offset"] = 0;
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("BloomEffect");
			inst.Name = "Bloom";
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			(inst as unknown as Record<string, unknown>)["Intensity"] = 1;
			(inst as unknown as Record<string, unknown>)["Size"] = 24;
			(inst as unknown as Record<string, unknown>)["Threshold"] = 1.89999998;
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("SunRaysEffect");
			inst.Name = "SunRays";
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			(inst as unknown as Record<string, unknown>)["Intensity"] = 0.0199999996;
			(inst as unknown as Record<string, unknown>)["Spread"] = 0.100000001;
			children.push({ instance: inst, isClouds: false });
		}
		return children;
	},
};

export = entry;
