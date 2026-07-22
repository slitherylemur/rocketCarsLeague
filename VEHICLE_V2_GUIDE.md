# Vehicle V2 — developer guide

How to work with the single-assembly ray-contact vehicle system. Architecture
rationale: `VEHICLE_V2_ADR.md`. Numeric gates: `VEHICLE_V2_ACCEPTANCE.md`.

## Module map

| Module | Role |
|---|---|
| `src/shared/vehicleV2/FeatureFlags.ts` | rollout switches (`VEHICLE_V2_ENABLED`, dev overlays) |
| `src/shared/vehicleV2/PhysicsPresets.ts` | ALL physics constants, per preset family |
| `src/shared/vehicleV2/VehicleDefs.ts` | template→preset map, visual-wheel derivation, startup validator |
| `src/shared/vehicleV2/CarMath.ts` | pure math (unit-tested off-platform: `npm test`) |
| `src/shared/vehicleV2/CarState.ts` | attribute schema + payload budget assertion |
| `src/shared/vehicleV2/CarSim.ts` | the shared fixed-step simulation (server + predicting client) |
| `src/shared/vehicleV2/CorrectionPolicy.ts` | render-correction severity bands (pure) |
| `src/shared/vehicleV2/VehicleApi.ts` | façade routing gameplay calls to legacy VehicleSim or CarSim |
| `src/server/Modules/vehicleV2Spawn.ts` | template→proxy restructuring, driver association |
| `src/client/carRig.client.ts` | render rig, corrected-present reconciliation, remote snapshots, camera anchor |
| `src/client/simTimeline.client.ts` | dev event-order instrumentation |

## Add a visual car

1. Author the template in `ServerStorage.VehicleModels` with the usual shape
   (`Base`, `Hitboxes/HitboxMain`, `Wheels/<name>/{DisplayWheel|Wheel}`, `Model`, `BoostEffectPart`,
   sounds on `Base`). Wheels named `FL/FR/BL/BR` (+`BR2`… for extra axles).
2. Add a `VehicleSubClass` module as before (economy/health params).
3. Map the template to a preset family in `VehicleDefs.TEMPLATE_PRESETS`
   (unlisted templates get `Standard`). If a wheel needs a non-default steer
   flag, add it to `VehicleDefs.OVERRIDES` — never rely on silent guessing.
4. Start the server and read the `[VehicleDefs]` startup report: the template
   must be listed as clean. `vehicleV2Spawn.validateProxy` also hard-fails a
   bad spawn (forbidden constraint classes, assembly leaks, missing hitbox).

`Hitboxes/HitboxMain` remains the per-car gameplay envelope. Its authored pose
and size become `VehicleRoot` and the BallSim query box; both peers scale
contact rays and inertia from that replicated size. The preset supplies mass
and handling, while render cosmetics never feed simulation (gate G-10).

## Add or tune a physics preset

- Edit `PhysicsPresets.ts`. Every field is documented inline with units; the
  `BASE` table is the tuned legacy envelope (top speed 120, boost ceiling
  240, jump ≈ legacy 3.37 g window, aerial 378 rad/s² per-mass equivalent).
- Handling levers, in the order that usually matters:
  - `turnRadius` + `gripYawAccel` — cornering arc and how hard it's enforced
  - `lateralGripAccel` / `frictionBudgetAccel` — slide threshold
  - `driftMaxSlipAngle` / `driftSlipGain` / `driftSideAccel` — slide angle,
    how eagerly the nose chases it, and how tight the drift arc pulls
  - `driftGripMult` / `driftSpeedScrub` — how icy the slide is / speed cost
  - `suspensionOmega` / `suspensionZeta` — ride stiffness (keep ζ ≥ 0.8)
  - `suspensionTorqueArmScale` — body pitch/roll response (0 = flat)
- Never read model geometry into the sim. Never store cross-tick state
  outside `CarState` attributes (rollback contract — CarSim header comment).
- Run `npm test` (pure-math bounds) and the `/feel` harness envelope compare.

## Diagnose a correction ("the car warped/glided")

1. `netHealth` (top-right badge + 5 s console summaries while driving) now
   parses the documented `Misprediction(time, entries, stats)` shape: it
   names the exact property/attribute that diverged, the pos/rot deltas, the
   resimulation cost, and whether the event correlates with a teleport or
   control-lock transition. An attribute name in the top-offenders list =
   a determinism bug in the sim (something wall-clock, unordered, or written
   outside the sim step). `BasePart:…CFrame` alone under contested play =
   normal shared-event corrections.
2. Set `RENDER_DEBUG_OVERLAY = true` (FeatureFlags) for the live error-offset
   readout (magnitude, severity band, snap count) of the local rig.
3. Set `SIM_TIMELINE_ENABLED = true` to capture the engine's actual
   Rollback → resim → Misprediction → PreRender ordering with sim-clock and
   pose per event (acceptance §6.1).
4. Render policy thresholds live in `CorrectionPolicy.ts` and MUST stay in
   sync with `VEHICLE_V2_ACCEPTANCE.md` §3. Do not "fix" a persistent
   divergence by lengthening half-lives — find the mismatch (engineering
   constraint: smoothing never hides a systematic prediction error).

## Latency testing

Studio → Studio Settings → Network → Incoming Replication Lag (one-way
seconds), plus two-player local server for remote/contested scenarios. Run
the ladder + profiles from `VEHICLE_V2_ACCEPTANCE.md` §2/§5. `netHealth`
prints input→attribute latency (should stay ≤ 1 sim tick at any RTT — gate
G-1) and rollback/resim rates.

## Rollback contract (the short version)

- Cross-tick sim state ⇒ attribute on VehicleRoot, listed in `CarState`.
- Attribute writes on predicted instances ⇒ only inside the sim step
  (external events queue pending ops on the registry entry).
- Timers compare `SimTime`, never wall clock.
- Forces ⇒ accumulated impulses committed as one assembly-velocity write.
- Cosmetics/effects ⇒ derived from attributes (renderer), never imperative.

## Legacy path

`VEHICLE_V2_ENABLED = false` restores the constraint-driven path wholesale
(legacy modules untouched; registration interlocked both ways). Once V2
passes the acceptance ladder in production, delete the legacy path:
`vehicleShell.client.ts`, the mover/wheel code in `VehicleSim.ts`, the
seat choreography in `spawnVehicle.ts`, and the legacy branches in
`VehicleClass`/`VehicleApi`.
