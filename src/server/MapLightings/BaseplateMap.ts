// Original: ServerStorage/MapLightings/BaseplateMap (ModuleScript)
// The original one-line module returned Lighting property values read from its
// ValueObject children; roundHandler also cloned its non-Value children (sky,
// atmosphere, post effects, clouds) into Lighting/Terrain. Both the values and
// those child instances are reproduced here from the original place data.

import type { MapLightingEntry } from "./types";

const entry: MapLightingEntry = {
	values: {
		["Ambient"]: new Color3(0.274509817, 0.274509817, 0.274509817),
		["Brightness"]: 3,
		["ColorShift_Bottom"]: new Color3(0, 0, 0),
		["ColorShift_Top"]: new Color3(0, 0, 0),
		["EnvironmentDiffuseScale"]: 1,
		["EnvironmentSpecularScale"]: 1,
		["GlobalShadows"]: true,
		["OutdoorAmbient"]: new Color3(0.274509817, 0.274509817, 0.274509817),
		["ClockTime"]: 14.5,
		["ExposureCompensation"]: 0,
		["FogColor"]: new Color3(0.752941251, 0.752941251, 0.752941251),
		["FogEnd"]: 100000,
		["FogStart"]: 0,
		["GeographicLatitude"]: 0,
		["ShadowSoftness"]: 0.20000000298023223877,
	},

	createChildren: () => {
		const children: Array<{ instance: Instance; isClouds: boolean }> = [];
		{
			const inst = new Instance("Sky");
			inst.Name = "Sky";
			(inst as unknown as Record<string, unknown>)["CelestialBodiesShown"] = true;
			(inst as unknown as Record<string, unknown>)["MoonAngularSize"] = 11;
			(inst as unknown as Record<string, unknown>)["MoonTextureId"] = "rbxassetid://6444320592";
			(inst as unknown as Record<string, unknown>)["SkyboxBk"] = "rbxassetid://6444884337";
			(inst as unknown as Record<string, unknown>)["SkyboxDn"] = "rbxassetid://6444884785";
			(inst as unknown as Record<string, unknown>)["SkyboxFt"] = "rbxassetid://6444884337";
			(inst as unknown as Record<string, unknown>)["SkyboxLf"] = "rbxassetid://6444884337";
			(inst as unknown as Record<string, unknown>)["SkyboxOrientation"] = new Vector3(0, 0, 0);
			(inst as unknown as Record<string, unknown>)["SkyboxRt"] = "rbxassetid://6444884337";
			(inst as unknown as Record<string, unknown>)["SkyboxUp"] = "rbxassetid://6412503613";
			(inst as unknown as Record<string, unknown>)["StarCount"] = 3000;
			(inst as unknown as Record<string, unknown>)["SunAngularSize"] = 11;
			(inst as unknown as Record<string, unknown>)["SunTextureId"] = "rbxassetid://6196665106";
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("SunRaysEffect");
			inst.Name = "SunRays";
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			(inst as unknown as Record<string, unknown>)["Intensity"] = 0.00999999978;
			(inst as unknown as Record<string, unknown>)["Spread"] = 0.100000001;
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("Atmosphere");
			inst.Name = "Atmosphere";
			(inst as unknown as Record<string, unknown>)["Color"] = new Color3(0.78039217, 0.78039217, 0.78039217);
			(inst as unknown as Record<string, unknown>)["Decay"] = new Color3(0.41568628, 0.43921569, 0.490196079);
			(inst as unknown as Record<string, unknown>)["Density"] = 0.300000012;
			(inst as unknown as Record<string, unknown>)["Glare"] = 0;
			(inst as unknown as Record<string, unknown>)["Haze"] = 0;
			(inst as unknown as Record<string, unknown>)["Offset"] = 0.25;
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("BloomEffect");
			inst.Name = "Bloom";
			(inst as unknown as Record<string, unknown>)["Enabled"] = true;
			(inst as unknown as Record<string, unknown>)["Intensity"] = 1;
			(inst as unknown as Record<string, unknown>)["Size"] = 24;
			(inst as unknown as Record<string, unknown>)["Threshold"] = 2;
			children.push({ instance: inst, isClouds: false });
		}
		{
			const inst = new Instance("DepthOfFieldEffect");
			inst.Name = "DepthOfField";
			(inst as unknown as Record<string, unknown>)["Enabled"] = false;
			(inst as unknown as Record<string, unknown>)["FarIntensity"] = 0.100000001;
			(inst as unknown as Record<string, unknown>)["FocusDistance"] = 0.0500000007;
			(inst as unknown as Record<string, unknown>)["InFocusRadius"] = 30;
			(inst as unknown as Record<string, unknown>)["NearIntensity"] = 0.75;
			children.push({ instance: inst, isClouds: false });
		}
		return children;
	},
};

export = entry;
