// Legacy `wait` / `delay` / `spawn` equivalents.
//
// A handful of original scripts used the deprecated globals (`wait(0.01)` /
// `wait()` in vehicle.client, killNotowned's `while wait(10)`,
// `delay(3, ...)` in vehicle.client boost, VehicleKeyHandler's
// `wait(.2)`, gameUi's commented `wait(1)`).
//
// Legacy semantics differ from task.wait: resumption is throttled (~30 Hz) and
// happens in the legacy waker rather than immediately on the next Heartbeat.
// We reproduce the documented behaviour: minimum resume time of 1/30s and
// resumption outside the signal firing. Return value matches (elapsed time).

const RunService = game.GetService("RunService");

const MIN_WAIT = 1 / 30;

export function legacyWait(seconds?: number): number {
	const target = math.max(seconds ?? 0, MIN_WAIT);
	const start = os.clock();
	while (os.clock() - start < target) {
		RunService.Heartbeat.Wait();
	}
	return os.clock() - start;
}

export function legacyDelay(seconds: number, callback: () => void): void {
	task.spawn(() => {
		legacyWait(seconds);
		callback();
	});
}

export function legacySpawn(callback: () => void): void {
	task.spawn(() => {
		legacyWait();
		callback();
	});
}
