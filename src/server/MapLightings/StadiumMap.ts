// Original: ServerStorage/MapLightings/StadiumMap (ModuleScript)
// The original one-line module returned Lighting property values read from its
// ValueObject children; roundHandler also cloned its non-Value children (sky,
// atmosphere, post effects, clouds) into Lighting/Terrain. Both the values and
// those child instances are reproduced here from the original place data.

import type { MapLightingEntry } from "./types";

const entry: MapLightingEntry = {
	values: {
		["Ambient"]: new Color3(0, 0, 0),
		["Brightness"]: 4,
		["ColorShift_Bottom"]: new Color3(0, 0, 0),
		["ColorShift_Top"]: new Color3(1, 0.980392158, 0.941176474),
		["EnvironmentDiffuseScale"]: 1,
		["EnvironmentSpecularScale"]: 1,
		["GlobalShadows"]: false,
		["OutdoorAmbient"]: new Color3(0.470588237, 0.53725493, 0.615686297),
		["ClockTime"]: 12.5,
		["ExposureCompensation"]: 0.40000000596046447754,
		["FogColor"]: new Color3(0.549019635, 0.423529416, 0.34117648),
		["FogEnd"]: 10000000,
		["FogStart"]: 1000,
		["GeographicLatitude"]: 340,
		["ShadowSoftness"]: 0,
	},

	createChildren: () => {
		const children: Array<{ instance: Instance; isClouds: boolean }> = [];
		{
			const inst = new Instance("Atmosphere");
			inst.Name = "Atmosphere";
			(inst as unknown as Record<string, unknown>)["Color"] = new Color3(1, 0.82745105, 0.419607878);
			(inst as unknown as Record<string, unknown>)["Decay"] = new Color3(0.360799998, 0.235300004, 0.0549000017);
			(inst as unknown as Record<string, unknown>)["Density"] = 0.291000009;
			(inst as unknown as Record<string, unknown>)["Glare"] = 1.80999994;
			(inst as unknown as Record<string, unknown>)["Haze"] = 0.389999986;
			(inst as unknown as Record<string, unknown>)["Offset"] = 1;
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("Sky");
			inst.Name = "Sky";
			(inst as unknown as Record<string, unknown>)["CelestialBodiesShown"] = true;
			(inst as unknown as Record<string, unknown>)["MoonAngularSize"] = 11;
			(inst as unknown as Record<string, unknown>)["MoonTextureId"] = "rbxasset://sky/moon.jpg";
			(inst as unknown as Record<string, unknown>)["SkyboxBk"] = "http://www.roblox.com/asset/?id=144933338";
			(inst as unknown as Record<string, unknown>)["SkyboxDn"] = "http://www.roblox.com/asset/?id=144931530";
			(inst as unknown as Record<string, unknown>)["SkyboxFt"] = "http://www.roblox.com/asset/?id=144933262";
			(inst as unknown as Record<string, unknown>)["SkyboxLf"] = "http://www.roblox.com/asset/?id=144933244";
			(inst as unknown as Record<string, unknown>)["SkyboxOrientation"] = new Vector3(0, 0, 0);
			(inst as unknown as Record<string, unknown>)["SkyboxRt"] = "http://www.roblox.com/asset/?id=144933299";
			(inst as unknown as Record<string, unknown>)["SkyboxUp"] = "http://www.roblox.com/asset/?id=144931564";
			(inst as unknown as Record<string, unknown>)["StarCount"] = 1500;
			(inst as unknown as Record<string, unknown>)["SunAngularSize"] = 5;
			(inst as unknown as Record<string, unknown>)["SunTextureId"] = "rbxasset://sky/sun.jpg";
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("SunRaysEffect");
			inst.Name = "SunRays";
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			(inst as unknown as Record<string, unknown>)["Intensity"] = 0.0960000008;
			(inst as unknown as Record<string, unknown>)["Spread"] = 0.25;
			children.push({ instance: inst, isClouds: false });
		}
		return children;
	},
};

export = entry;
