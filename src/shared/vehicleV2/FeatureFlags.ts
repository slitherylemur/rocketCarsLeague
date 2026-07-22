// Vehicle V2 rollout switches. See VEHICLE_V2_ADR.md.
//
// VEHICLE_V2_ENABLED selects which vehicle system a MATCH car spawns on. The
// two systems interlock (legacy VehicleSim.register refuses a V2 model and
// CarSim refuses a legacy model), so a single spawn can never be driven by
// both — acceptance gate G-14.

/** Master switch: match cars spawn as V2 single-assembly ray-contact proxies. */
export const VEHICLE_V2_ENABLED = true;

/** Attribute stamped on every V2 vehicle MODEL (value: schema version number).
 * All cross-system branching keys off this attribute. */
export const V2_MODEL_ATTR = "V2";

/** Remote-input prediction experiment (ADR §3): replicate + predict nearby
 * remote cars from their replicated input attributes. OFF until the measured
 * decision (needs live latency testing — see VEHICLE_V2_ACCEPTANCE.md §6). */
export const REMOTE_INPUT_PREDICTION = false;

/** Dev-only ordered event timeline capture (client): BindToSimulation ticks,
 * Rollback, Misprediction, PreRender — see simTimeline.client.ts. */
export const SIM_TIMELINE_ENABLED = false;

/** Dev-only render-correction debug overlay (sim proxy vs visible chassis,
 * error offset magnitude, severity band). */
export const RENDER_DEBUG_OVERLAY = false;
