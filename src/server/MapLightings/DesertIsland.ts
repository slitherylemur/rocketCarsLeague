// Original: ServerStorage/MapLightings/DesertIsland (ModuleScript)
// The original one-line module returned Lighting property values read from its
// ValueObject children; roundHandler also cloned its non-Value children (sky,
// atmosphere, post effects, clouds) into Lighting/Terrain. Both the values and
// those child instances are reproduced here from the original place data.

import type { MapLightingEntry } from "./types";

const entry: MapLightingEntry = {
	values: {
		["Ambient"]: new Color3(0, 0, 0),
		["Brightness"]: 2,
		["ColorShift_Bottom"]: new Color3(0, 0, 0),
		["ColorShift_Top"]: new Color3(0.847058833, 0.70588237, 0.454901963),
		["EnvironmentDiffuseScale"]: 1,
		["EnvironmentSpecularScale"]: 1,
		["GlobalShadows"]: true,
		["OutdoorAmbient"]: new Color3(0.466666698, 0.552941203, 0.690196097),
		["ClockTime"]: 14,
		["ExposureCompensation"]: 0.40000000596046447754,
		["FogColor"]: new Color3(0.549019635, 0.423529416, 0.34117648),
		["FogEnd"]: 2000,
		["FogStart"]: 0,
		["GeographicLatitude"]: 41.733001708984375,
		["ShadowSoftness"]: 0.15000000596046447754,
	},

	createChildren: () => {
		const children: Array<{ instance: Instance; isClouds: boolean }> = [];
		{
			const inst = new Instance("Sky");
			inst.Name = "Clear Afternoon Sky";
			(inst as unknown as Record<string, unknown>)["CelestialBodiesShown"] = true;
			(inst as unknown as Record<string, unknown>)["MoonAngularSize"] = 11;
			(inst as unknown as Record<string, unknown>)["MoonTextureId"] = "rbxassetid://1345054856";
			(inst as unknown as Record<string, unknown>)["SkyboxBk"] = "http://www.roblox.com/asset/?id=6100050478";
			(inst as unknown as Record<string, unknown>)["SkyboxDn"] = "http://www.roblox.com/asset/?id=6100049801";
			(inst as unknown as Record<string, unknown>)["SkyboxFt"] = "http://www.roblox.com/asset/?id=6100049327";
			(inst as unknown as Record<string, unknown>)["SkyboxLf"] = "http://www.roblox.com/asset/?id=6100051088";
			(inst as unknown as Record<string, unknown>)["SkyboxOrientation"] = new Vector3(0, 0, 0);
			(inst as unknown as Record<string, unknown>)["SkyboxRt"] = "http://www.roblox.com/asset/?id=6100051670";
			(inst as unknown as Record<string, unknown>)["SkyboxUp"] = "http://www.roblox.com/asset/?id=6100052590";
			(inst as unknown as Record<string, unknown>)["StarCount"] = 3000;
			(inst as unknown as Record<string, unknown>)["SunAngularSize"] = 11;
			(inst as unknown as Record<string, unknown>)["SunTextureId"] = "rbxassetid://1345009717";
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("Clouds");
			inst.Name = "Clouds";
			(inst as unknown as Record<string, unknown>)["Color"] = new Color3(1, 1, 1);
			(inst as unknown as Record<string, unknown>)["Cover"] = 0.5;
			(inst as unknown as Record<string, unknown>)["Density"] = 0.203999996;
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			children.push({ instance: inst, isClouds: true });
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
