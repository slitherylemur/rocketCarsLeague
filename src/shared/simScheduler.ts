// Shared fixed-step scheduler for the server-authority simulations.
//
// Both VehicleSim and BallSim used to call RunService:BindToSimulation()
// independently with no frequency/priority arguments. That left two things
// implicit that must be explicit:
//
//   1. FREQUENCY. The engine default is Hz30 (the docs list "Default Value:
//      Hz30"), while several diagnostics assumed 60 Hz. SIM_RATE_HZ below is
//      the single source of truth; every "per tick" calculation must derive
//      from it. 30 Hz is the deliberate stability baseline — 60 Hz roughly
//      doubles scripted simulation AND rollback-resimulation work, so it is
//      only worth adopting after an A/B shows a real control improvement with
//      RCC heartbeat still ≥ 59 (flip SIM_RATE_HZ to 60 to run that A/B).
//
//   2. ORDER. Vehicle and ball callbacks had no defined relative order (it
//      fell out of script load order, which differs between server and
//      client). Both sims now register HOOKS here and ONE BindToSimulation
//      callback runs them in ascending `order` — vehicles strictly before
//      balls on every peer, so a resimulated tick replays identically.
//
// The Hz30 enum/argument is passed defensively: the server-authority API is
// still a beta and its signature has shifted before. If the engine rejects
// the frequency argument the bare bind is used (which today defaults to
// 30 Hz anyway), and the first-ticks rate check below warns loudly if the
// real cadence disagrees with SIM_RATE_HZ so a silent default change can
// never skew the sim math unnoticed.

const RunService = game.GetService("RunService");

export const SIM_RATE_HZ = 30;
export const SIM_DT = 1 / SIM_RATE_HZ;

// Hook orders (ascending = earlier). Gaps left for future systems.
export const SIM_ORDER_VEHICLE = 100;
export const SIM_ORDER_BALL = 200;

interface SimHook {
	name: string;
	order: number;
	fn: (dt: number) => void;
}

const hooks: SimHook[] = [];
let bound = false;
let boundVia = "unbound";

// Rate sanity check over the first ticks — catches an engine whose actual
// simulation cadence disagrees with SIM_RATE_HZ (per-tick constants like the
// boost drain and resim-depth estimates would silently be wrong).
let rateCheckTicks = 0;
let rateCheckAccum = 0;

function runHooks(dt: number) {
	if (rateCheckTicks < 90) {
		rateCheckTicks += 1;
		rateCheckAccum += dt;
		if (rateCheckTicks === 90) {
			const avgHz = 90 / rateCheckAccum;
			if (math.abs(avgHz - SIM_RATE_HZ) > SIM_RATE_HZ * 0.2) {
				warn(
					`[SimScheduler] measured simulation rate ${string.format("%.1f", avgHz)}Hz != configured ${SIM_RATE_HZ}Hz (bound via ${boundVia}) — per-tick math is running off-rate`,
				);
			} else {
				print(
					`[SimScheduler] ${RunService.IsServer() ? "server" : "client"} simulation rate confirmed ~${string.format("%.1f", avgHz)}Hz via ${boundVia}`,
				);
			}
		}
	}
	for (const hook of hooks) {
		hook.fn(dt);
	}
}

// Priority of the single bound callback (documented default 2000, LOWER runs
// first within a step). 1000 keeps the gameplay sims ahead of any
// default-priority binds other systems might add later.
export const SIM_BIND_PRIORITY = 1000;

function bindOnce() {
	if (bound) {
		return;
	}
	bound = true;

	// The documented signature is BindToSimulation(fn, Enum.StepFrequency,
	// priority) — the old code probed Enum.SimulationFrequency, which does not
	// exist, so it always fell through to the bare bind and ran on the engine
	// DEFAULT (Hz30 today, but implicit). Probe the real enum under pcall
	// (server-authority beta builds have shifted signatures before).
	let stepFrequency: unknown;
	pcall(() => {
		stepFrequency = (Enum as unknown as Record<string, Record<string, unknown>>)["StepFrequency"][
			`Hz${SIM_RATE_HZ}`
		];
	});

	const rs = RunService as unknown as {
		BindToSimulation(callback: (dt: number) => void, frequency?: unknown, priority?: number): void;
	};

	if (stepFrequency !== undefined) {
		const [ok] = pcall(() => rs.BindToSimulation(runHooks, stepFrequency, SIM_BIND_PRIORITY));
		if (ok) {
			boundVia = `BindToSimulation(Hz${SIM_RATE_HZ},prio${SIM_BIND_PRIORITY})`;
			print(`[SimScheduler] ${RunService.IsServer() ? "server" : "client"} bound via ${boundVia}`);
			return;
		}
	}

	const [ok, err] = pcall(() => rs.BindToSimulation(runHooks));
	if (ok) {
		boundVia = "BindToSimulation(default frequency)";
		print(`[SimScheduler] ${RunService.IsServer() ? "server" : "client"} bound via ${boundVia}`);
		return;
	}

	// Fallback ONLY for engines without the server-authority beta — Heartbeat
	// code is invisible to rollback-resimulation, so under AuthorityMode=Server
	// this branch must never run.
	boundVia = "Heartbeat fallback";
	warn(`[SimScheduler] BindToSimulation unavailable (${err}); falling back to Heartbeat`);
	RunService.Heartbeat.Connect(runHooks);
}

/** Register a fixed-step simulation hook. The first registration performs the
 * single BindToSimulation; hooks run in ascending `order` (ties by name) so
 * cross-system ordering is deterministic on both peers. */
export function registerSimHook(name: string, order: number, fn: (dt: number) => void) {
	hooks.push({ name, order, fn });
	table.sort(hooks, (a, b) => (a.order === b.order ? a.name < b.name : a.order < b.order));
	bindOnce();
}
