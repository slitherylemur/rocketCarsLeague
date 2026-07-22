// Dev-only ordered event timeline (VEHICLE_V2_ACCEPTANCE.md §6.1): captures
// the actual local interleaving of BindToSimulation ticks, RunService.Rollback,
// RunService.Misprediction and PreRender, with the local car's sim clock and
// root pose, so the correction pipeline can be verified against the real
// engine ordering instead of assumptions. Enabled via
// FeatureFlags.SIM_TIMELINE_ENABLED; prints a rolling window every 10 s.

import { SIM_TIMELINE_ENABLED } from "shared/vehicleV2/FeatureFlags";
import { registerSimHook } from "shared/simScheduler";
import { CarAttr, CarModelAttr } from "shared/vehicleV2/CarState";

const RunService = game.GetService("RunService");
const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;

if (SIM_TIMELINE_ENABLED) {
	const events: string[] = [];
	const MAX_EVENTS = 400;

	let ownRoot: BasePart | undefined;
	const findOwnRoot = () => {
		const vehicles = game.Workspace.FindFirstChild("Vehicles");
		if (!vehicles) {
			return undefined;
		}
		for (const model of vehicles.GetChildren()) {
			if (model.IsA("Model") && model.GetAttribute(CarModelAttr.OwnerUserId) === LocalPlayer.UserId) {
				const root = model.FindFirstChild("VehicleRoot") ?? model.FindFirstChild("Base");
				if (root && root.IsA("BasePart")) {
					return root;
				}
			}
		}
		return undefined;
	};

	const record = (tag: string, detail?: string) => {
		if (ownRoot === undefined || ownRoot.Parent === undefined) {
			ownRoot = findOwnRoot();
		}
		let state = "";
		if (ownRoot) {
			const simTime = ownRoot.GetAttribute(CarAttr.SimTime);
			const p = ownRoot.Position;
			state = ` sim=${typeIs(simTime, "number") ? string.format("%.3f", simTime) : "?"} pos=(${string.format(
				"%.1f,%.1f,%.1f",
				p.X,
				p.Y,
				p.Z,
			)})`;
		}
		events.push(`${string.format("%.4f", os.clock())} ${tag}${detail !== undefined ? " " + detail : ""}${state}`);
		if (events.size() > MAX_EVENTS) {
			events.remove(0);
		}
	};

	registerSimHook("SimTimeline", 10, (dt) => record("SIM", string.format("dt=%.4f", dt)));

	pcall(() => {
		(RunService as unknown as { Rollback: RBXScriptSignal<(time: number) => void> }).Rollback.Connect((time) =>
			record("ROLLBACK", string.format("to=%.3f", time)),
		);
	});
	pcall(() => {
		(
			RunService as unknown as {
				Misprediction: RBXScriptSignal<(time: number, entries: unknown, stats: unknown) => void>;
			}
		).Misprediction.Connect((time, _entries, stats) => {
			let resim = "?";
			if (typeIs(stats, "table")) {
				const value = (stats as Record<string, unknown>)["ResimulationTime"];
				if (typeIs(value, "number")) {
					resim = string.format("%.2fms", value * 1000);
				}
			}
			record("MISPREDICT", string.format("t=%.3f resim=%s", time, resim));
		});
	});
	RunService.PreRender.Connect(() => record("PRERENDER"));

	task.spawn(() => {
		while (task.wait(10)) {
			if (events.size() > 0) {
				print(`[SimTimeline] last ${events.size()} events:\n${events.join("\n")}`);
				events.clear();
			}
		}
	});
}

export {};
