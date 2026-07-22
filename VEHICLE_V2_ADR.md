# Vehicle V2 — Architecture Decision Record

> Status: **implemented behind `VEHICLE_V2_ENABLED`** (src/shared/vehicleV2/FeatureFlags.ts).
> This document records the audited defects of the constraint-driven vehicle path, the
> platform behavior we verified, the selected architecture, and the rejected alternatives.
> Companion documents: `VEHICLE_V2_ACCEPTANCE.md` (numeric gates + test ladder),
> `SERVER_AUTHORITY_PLAN.md` (historic migration), `BALL_PHYSICS.md` (ball design).

## 1. Repository audit (verified against the working tree, 2026-07-22)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | Shared sim runs on both peers via one `BindToSimulation`; hooks ordered vehicle→ball | `src/shared/simScheduler.ts:121-125`, `VehicleSim.ts:2014`, `BallSim.ts:662` |
| 2 | Scheduler probed `Enum.SimulationFrequency` (does not exist); the documented parameter is `Enum.StepFrequency` (+ int priority, default 2000, lower first). The bare-bind fallback happened to run 30 Hz | `simScheduler.ts:83-101`; RunService.yaml (creator-docs): `BindToSimulation(function, frequency: StepFrequency = Hz30, priority: int = 2000)` |
| 3 | The match car is a multi-assembly: Base + 4–8 physical wheel systems, each `SpringConstraint`+`CylindricalConstraint`+`HingeConstraint`+`Wheel`+`DisplayWheel`, plus sim-created `LinearVelocity`, `VectorForce`×2, `AngularVelocity`×2, `AlignOrientation`×2, `AlignPosition`×2 | template dump (`rocketcars_instance_tree_no_maps.json` → ServerStorage/VehicleModels), `VehicleSim.ts:486-623` |
| 4 | Drift mutates wheel `CustomPhysicalProperties` per tick; steering writes hinge targets; ground checks raycast from wheel parts. Constraint/solver state does not roll back — the sim re-asserts friction from attributes every tick as a workaround | `VehicleSim.ts:1361-1382`, `1467-1511` |
| 5 | The client shell copies each physical wheel's chassis-relative CFrame into the visual clone every frame — a rollback or incoherent constraint solution is copied straight into the visuals (flying/detached wheel reports) | `vehicleShell.client.ts:565-571` |
| 6 | Local correction = **accumulating** first-divergent-step `Predicted − Authoritative` deltas into an offset decayed by 0.8 s SmoothDamp. Historical deltas are not the display error at the corrected present; stacking them over/under-corrects; 0.8 s leaves the visible car detached from collision truth for seconds | `vehicleShell.client.ts:57, 471-480` |
| 7 | Remote cars: unconditional SmoothDamp chase toward latest replicated pose (moving-target filter, permanent lag, no jitter buffer/extrapolation policy) | `vehicleShell.client.ts:539-557` |
| 8 | ~45 attributes on the predicted Base (state + `Tune*` mirrors), consciously riding near the 1024-byte predicted-attribute payload cap | `VehicleSim.ts:201-273, 717-731` |
| 9 | Input is IAS (`VehicleControls` context under Player, built server-side; client fires touch actions); this is the correct rollback-replayed input route and is **kept** | `vehicleInputActions.ts`, `VehicleKeyHandler.client.ts` |
| 10 | Character is seated + welded into the predicted assembly, then neutralized (massless/invisible). Still adds Humanoid/weld/occupancy surface to the predicted object; sit/exit edges gate the whole sim | `spawnVehicle.ts:85-270`, `VehicleSim.ts:1638-1709` |
| 11 | Cosmetics change real assembly mass (paint→Metal density; `SimMass` attribute re-measured on `refreshMass`) — physics and appearance not separated | `VehicleClass.ts:360-398`, `VehicleSim.ts:1784` |
| 12 | Ball: shared 30 Hz scripted sphere, strict include-list queries, one deepest car contact/tick (deterministic tie-break), no reciprocal car impulse, world spherecast sweep, car contact is current-frame overlap only | `BallSim.ts:395-587` |
| 13 | Goal blast: `ApplyImpulse` on Base **outside** the sim step, then placement loops zero velocity on every wheel assembly | `footballMatch.ts:958-972, 619-651` |
| 14 | netHealth's Misprediction parser scans positional args for "first Instance, first string, remaining values" — inconsistent with the documented `(time, entries[{Instance, Properties, Attributes}], stats)` shape | `netHealth.client.ts:357-388` |
| 15 | Template catalogue: 31 models; 29 with wheels FL/FR/BL/BR, MarketTruck +BR2/BL2 (6), TroopTransport +BL2/BR2 (6), MillitaryTransport +BR2/BR3/BL2/BL3 (8). Only the corner four are steered/measured today | template dump; `VehicleSim.ts:639-665` |

## 2. Verified platform behavior

- `RunService:BindToSimulation(fn, frequency, priority)` — `frequency: Enum.StepFrequency`
  (`Hz60=0, Hz30=1, Hz15, Hz10, Hz5, Hz1`; default **Hz30**), `priority: int` default 2000,
  lower first. Verified from Roblox/creator-docs `RunService.yaml` + `StepFrequency.yaml`.
- `RunService.Misprediction(time: double, instances: Array, stats: Dictionary)` — each entry is
  `{ Instance, Properties?: { [name]: {Predicted, Authoritative} }, Attributes?: same }`;
  `stats.ResimulationTime` (seconds). Values describe the **first divergent historical step**.
- `RunService.Rollback(time)` — fires **after** eligible state (properties, attributes, physics,
  animation) is restored, **before** resimulation.
- Server-authority "position smoothing" technique: invisible simulated object + massless,
  non-collidable visual clone; smoothing engaged by correction policy (docs recommend
  conditional smoothing above a threshold, not permanent follow lag).
- Instances created inside a simulation callback must be parented into the DataModel before the
  end of that frame; non-simulation-access property writes on simulated instances error inside
  the callback afterwards.
- `Workspace.AuthorityMode` is not script-readable in the current beta (`spawnVehicle.ts:54-71`);
  the game is committed to `Server`.
- Attribute writes on predicted instances are only legal inside `BindToSimulation` (established
  empirically in this repo; every server entry point queues pending ops consumed in-step).
- **Not verifiable in this environment** (no Roblox runtime): exact Rollback↔Misprediction↔render
  event interleaving, resim depth, actual cadence. `src/client/simTimeline.client.ts` (dev flag)
  captures an ordered timeline in Studio; `VEHICLE_V2_ACCEPTANCE.md` §5 lists the manual steps.
  The renderer deliberately does **not** depend on Misprediction timing (see §4.5).

## 3. Decision — single-assembly ray-contact vehicle

The match car becomes **one unanchored server-owned rigid box** (`VehicleRoot`) simulated by an
explicit fixed-step controller shared by server and predicting client. No physical wheels, no
springs/hinges, no seat weld, no Humanoid, no cosmetic mass. Cosmetics become a fully separate
anchored render rig animated client-side.

Key properties:

- **Physics preset, not model, defines physics.** `src/shared/vehicleV2/PhysicsPresets.ts`
  declares collision box size, center-of-mass height, four canonical contact hardpoints, wheel
  radius, suspension/tire/drive/boost/jump/dodge/aerial constants. Templates map to presets in
  `src/shared/vehicleV2/VehicleDefs.ts`. Cosmetics can never change mass (gate G-11).
- **Four canonical contacts** even for 6/8-wheel visual templates; extra visual axles derive
  compression/steer/spin from the nearest canonical contact (`CarRig` interpolates by Z).
- **Forces are per-tick impulses accumulated in code and committed as one
  `AssemblyLinearVelocity`/`AssemblyAngularVelocity` write** at the end of the vehicle step.
  Rationale: these are rollback-aware, replicated physics properties, and this exact pattern is
  already proven in-repo under server authority (`BallSim.ts:575`). Angular response uses the
  analytic box inertia of the preset (identical constants on both peers) instead of engine
  queries, so a resimulated tick reproduces the original bit-for-bit from restored state. The
  engine still owns integration and box-vs-world/box-vs-box contact resolution between our
  writes, so walls, cars and goal blasts remain real physics.
- **Suspension** = per-contact raycast down the root's −Y through rest+radius; spring-damper on
  compression and contact-point normal velocity (`GetVelocityAtPosition`), clamped: never pulls,
  per-tick Δv capped (anti-slam), applied at a configurable height toward COM for pitch/roll
  stability. **Tires** = point-velocity decomposition onto steered forward/lateral axes projected
  into the contact plane; longitudinal drive/brake from an explicit speed-force curve; lateral
  grip as bounded slip response; both share a **friction budget** (circle) per contact.
- **Modes** are an explicit state machine: Grounded / Braking-Reverse / Drift (hysteresis) /
  Coyote-Launch / Airborne (pitch-yaw-roll, boost) / JumpHold / Dodge / Recovery / External-
  impulse; goal blast writes velocity through the same external-event path **inside** the sim
  step and normal control yields to it for a defined window (no overspeed clamp for BlastGen
  events, gate G-9).
- **All cross-tick state is attributes on VehicleRoot** (schema in `CarState.ts`, byte-budget
  asserted). Everything else is recomputed from restored physics + replayed IAS input. No
  custom Rollback-hook history is required — that alternative is recorded below.
- **Input stays IAS** (same `VehicleControls` actions); the sim samples actions per tick into a
  fixed input record. No second input-replay system.
- **Render boundary**: `CarRig` builds an anchored, massless, non-colliding, non-predicted
  cosmetic rig from the template's visual parts (body + DisplayWheels + boost effect part), with
  per-wheel metadata (hardpoint, radius, steer flag, contact mapping) derived server-side at
  spawn and validated (`VehicleDefs`). Rendered wheels are mathematical children of the rendered
  chassis — body/wheel separation is impossible by construction (gate G-2/G-3).
- **Corrected-present reconciliation**: the renderer maintains a persistent local-space error
  offset `E` with the invariant *visible = S ⋅ E* (S = current sim pose). A correction is any
  discontinuity of S against its velocity-extrapolated continuation; on detection the offset is
  **recomputed** (`E ← S_new⁻¹ ⋅ V_prev`) so the visible pose stays C0-continuous, then decayed
  to identity with severity-banded, frame-rate-invariant half-lives (tens–low-hundreds of ms;
  the old 0.8 s constant is retired). It never targets the historical authoritative snapshot and
  never accumulates Misprediction deltas — Misprediction feeds telemetry/severity only, so the
  design is robust to event-timing details we cannot measure here. Teleports (TeleportGen) snap;
  goal blasts (BlastGen) correct fast; corrections that would visibly penetrate geometry snap
  the offending component.
- **Remote cars**: timestamped snapshot ring buffer, jitter-adaptive delay, velocity-aware
  (Hermite) position interpolation + slerp orientation, bounded extrapolation, hold+recover.
  Remote-input prediction remains an experiment behind `REMOTE_INPUT_PREDICTION` (off): inputs
  already replicate as attributes; the measured decision requires live latency testing (§2).
- **Camera** follows a dedicated anchor on the rendered pose (never the sim proxy), with
  separate position/rotation filtering and correction-aware smoothing.
- **Cadence**: explicit `Enum.StepFrequency.Hz30`, priority 1000, single shared bind + ordered
  hooks (vehicle 100 → ball 200). 30 Hz is the shipped baseline because the 60 Hz gate
  (server sim ≥59 FPS under full lobby + resim load) can only be measured live;
  `SIM_RATE_HZ`+`STEP_FREQUENCY` flip together for the A/B (see acceptance doc §4).

## 4. Rejected alternatives

1. **Keep constraint car, improve smoothing** — rejected: the rollback-mismatch surface (solver
   state, per-wheel assemblies, constraint properties that don't restore) is the root defect;
   smoothing over it violates the "don't hide systematic divergence" constraint.
2. **Anchored CFrame-driven car** — rejected: loses engine collision/impulse response and Server
   Authority integration; goal blasts and car-car contact would become fully scripted.
3. **Compound multi-part collision shells** — deferred: one box is sufficient for arena play and
   cheapest to reason about; the builder supports welded extra colliders if testing ever
   justifies them (they must stay massless-free rigid parts of the same assembly).
4. **Persistent constraint movers (LinearVelocity/AlignOrientation servos) for V2** — rejected:
   constraint properties are exactly the state class that does not roll back; impulse math from
   restored state removes the entire re-assert-every-tick workaround family.
5. **120 Hz (Rocket League parity)** — rejected: Roblox `StepFrequency` tops out at Hz60, and
   resimulation cost scales with rate; 30 Hz shipped, 60 Hz gated on live measurement.
6. **Custom rollback history via `RunService.Rollback`** — not needed: V2 keeps every cross-tick
   value in attributes; the hook remains available for future non-attribute state.
7. **Offline template geometry pipeline** — rejected: `RocketCars.rbxlx` is a git-LFS pointer
   here and would drift from live place edits; geometry is derived + validated at server startup
   from the actual `ServerStorage.VehicleModels` templates (report logged, overrides in
   `VehicleDefs.OVERRIDES`).

## 5. Ownership / security

Server remains authoritative for motion, boost meter, jump/dodge eligibility, damage, ball
contacts, score, respawns and external impulses. The client contributes **only** IAS input.
V2 validates: preset identity (server-selected), boost spend (server sim), event eligibility
(sim-time gates), spawn contracts (validator). No client transforms/velocities/hits are accepted.
Exploit-relevant disagreement (impossible input rates, out-of-range analog values) is clamped
and logged separately from benign divergence in `netHealth`.
