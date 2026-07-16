// Original: ServerStorage/MapLightings/ApocalypticCity (ModuleScript)
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
		["ExposureCompensation"]: 0.14000000059604644775,
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
			(inst as unknown as Record<string, unknown>)["Color"] = new Color3(0.847058833, 1, 0.980392158);
			(inst as unknown as Record<string, unknown>)["Decay"] = new Color3(0.360799998, 0.235300004, 0.0549000017);
			(inst as unknown as Record<string, unknown>)["Density"] = 0.400000006;
			(inst as unknown as Record<string, unknown>)["Glare"] = 0.600000024;
			(inst as unknown as Record<string, unknown>)["Haze"] = 1.5;
			(inst as unknown as Record<string, unknown>)["Offset"] = 1;
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("BlurEffect");
			inst.Name = "Blur";
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			(inst as unknown as Record<string, unknown>)["Size"] = 2;
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("ColorCorrectionEffect");
			inst.Name = "ColorCorrection";
			(inst as unknown as Record<string, unknown>)["Brightness"] = 0;
			(inst as unknown as Record<string, unknown>)["Contrast"] = -0.100000001;
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			(inst as unknown as Record<string, unknown>)["Saturation"] = 0;
			(inst as unknown as Record<string, unknown>)["TintColor"] = new Color3(1, 0.996078491, 0.886274576);
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("SunRaysEffect");
			inst.Name = "SunRays";
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			(inst as unknown as Record<string, unknown>)["Intensity"] = 0.100000001;
			(inst as unknown as Record<string, unknown>)["Spread"] = 0.629999995;
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("Sky");
			inst.Name = "Sky";
			(inst as unknown as Record<string, unknown>)["CelestialBodiesShown"] = false;
			(inst as unknown as Record<string, unknown>)["MoonAngularSize"] = 11;
			(inst as unknown as Record<string, unknown>)["MoonTextureId"] = "rbxasset://sky/moon.jpg";
			(inst as unknown as Record<string, unknown>)["SkyboxBk"] = "http://www.roblox.com/asset/?id=271042516";
			(inst as unknown as Record<string, unknown>)["SkyboxDn"] = "http://www.roblox.com/asset/?id=271077243";
			(inst as unknown as Record<string, unknown>)["SkyboxFt"] = "http://www.roblox.com/asset/?id=271042556";
			(inst as unknown as Record<string, unknown>)["SkyboxLf"] = "http://www.roblox.com/asset/?id=271042310";
			(inst as unknown as Record<string, unknown>)["SkyboxOrientation"] = new Vector3(0, 0, 0);
			(inst as unknown as Record<string, unknown>)["SkyboxRt"] = "http://www.roblox.com/asset/?id=271042467";
			(inst as unknown as Record<string, unknown>)["SkyboxUp"] = "http://www.roblox.com/asset/?id=271077958";
			(inst as unknown as Record<string, unknown>)["StarCount"] = 1334;
			(inst as unknown as Record<string, unknown>)["SunAngularSize"] = 21;
			(inst as unknown as Record<string, unknown>)["SunTextureId"] = "rbxasset://sky/sun.jpg";
			children.push({ instance: inst, isClouds: false });
		}
		return children;
	},
};

export = entry;
