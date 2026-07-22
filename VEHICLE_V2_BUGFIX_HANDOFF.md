# Vehicle V2 testing and bug-fixing handoff

Use this document as the starting context for a fresh engineering agent.

## Current state

PR #6, **Implement Vehicle V2: single-assembly ray-contact physics system**,
was merged into `master` on 2026-07-22.

- Merge commit: `6ea0e7058b599cbe46137d0ed290670665cf2ef2`
- Vehicle V2 is enabled: `VEHICLE_V2_ENABLED = true`.
- The requested simulation target is 60 Hz: `SIM_RATE_HZ = 60`.
- The last local verification passed 78/78 deterministic assertions.
- `npm run build` passed.
- GitHub had no automated CI checks configured.
- The important Roblox Studio/network/load acceptance tests have **not** yet
  been run. Do not describe the networking as proven or perfect until they are.

Before editing, preserve any local work, update from `master`, run `git status`,
then run:

```text
npm test
npm run build
```

## Product goal

The locally controlled car should respond on the next simulation tick and
remain visually continuous under Roblox Server Authority, including at up to
approximately 300 ms simulated RTT. Roblox may restore and resimulate the
hidden gameplay proxy, but the visible car and camera must not visibly rewind,
rubber-band, split into pieces, detach wheels, or follow an old server snapshot.

Shared events cannot erase latency. Remote car and ball contacts may correct,
but those corrections must be bounded, coherent and biased toward gameplay
truth when necessary.

## Architecture that must be preserved

### Simulation vehicle

- One unanchored `VehicleRoot` is the car's physical, authoritative and locally
  predicted assembly.
- There are no physical wheel assemblies, `VehicleSeat`, Humanoid weld,
  `SpringConstraint`, `CylindricalConstraint`, steering hinge or cosmetic mass
  in a V2 match car.
- Four canonical ray contacts calculate suspension, grip, braking, drive and
  steering through code.
- Existing 6/8-wheel cars still use four simulation contacts. Extra wheels are
  visual and map to a canonical contact.
- The original template's `Hitboxes/HitboxMain` pose and size are mandatory.
  They define `VehicleRoot`, the BallSim envelope, analytic inertia and scaled
  contact layout. Never replace these with one generic family-sized box.
- Movement tuning comes from the `Standard`, `Sport`, `Compact`, `Heavy` and
  `Truck` preset families. Authored render geometry must not change mass or
  handling.

### Prediction and rollback

- Server and predicting client run the same `CarSim` through the shared
  `BindToSimulation` scheduler.
- Roblox Input Action System is the replayed local input path. Do not add a
  second manual local input-history replay system.
- Server-side external changes are queued and consumed in the simulation step.
  Goal blasts, teleports and boost grants must not mutate predicted gameplay
  state from rendering code.
- Reconciliation targets the **resimulated present proxy**, never the received
  historical authoritative transform.

### Rendering

- The visible body is an anchored, massless, noncolliding presentation rig.
- Every visual wheel is posed mathematically from the same rendered chassis
  transform. It must never copy a physical wheel transform.
- With no active correction offset, the local visible pose must equal the
  predicted present pose without permanent smoothing delay.
- At rollback/correction, capture the last visible pose, recompute a persistent
  transform offset against the corrected present, then decay it toward
  identity. Never accumulate historical misprediction deltas or repeatedly
  restart a long tween.
- The camera follows the rendered pose, never `VehicleRoot` directly.

### Ball

- BallSim remains server authoritative and predicted on clients.
- Ball free flight uses the shared simulation schedule after vehicle stepping.
- Car contact uses the query-only `Hitboxes/HitboxMain` box.
- Current contact detection includes a continuous relative segment sweep and
  can resolve up to two distinct car contacts for pinches.
- Ball rendering uses corrected-present continuity and must not permanently
  trail normal free flight.

## Important files

- `CLAUDE_FABLE_VEHICLE_NETWORKING_REBUILD_PROMPT.md` — full original design
  and implementation specification.
- `VEHICLE_V2_ADR.md` — architecture decision and repository audit.
- `VEHICLE_V2_ACCEPTANCE.md` — numeric correction budgets, network profiles
  and scenario ladder.
- `VEHICLE_V2_GUIDE.md` — developer and correction-diagnosis guide.
- `src/shared/simScheduler.ts` — fixed-rate ordered simulation scheduler.
- `src/shared/vehicleV2/CarSim.ts` — shared vehicle controller.
- `src/shared/vehicleV2/CarMath.ts` — pure suspension/tire/offset helpers.
- `src/shared/vehicleV2/PhysicsPresets.ts` — movement tuning and resolved box
  geometry.
- `src/shared/vehicleV2/VehicleDefs.ts` — template/preset mapping and wheel/
  hitbox derivation.
- `src/shared/vehicleV2/CorrectionPolicy.ts` — local correction severity.
- `src/shared/vehicleV2/CarState.ts` — rollback-aware state attributes/schema.
- `src/shared/vehicleV2/VehicleApi.ts` — compatibility API for gameplay code.
- `src/server/Modules/vehicleV2Spawn.ts` — proxy/render-source construction,
  validation, driver association and replication focus.
- `src/client/carRig.client.ts` — local correction, remote interpolation,
  coherent visual wheels and camera target.
- `src/shared/ballSim/BallSim.ts` and `BallMath.ts` — ball simulation/contact.
- `src/client/ballRenderer.client.ts` — corrected-present ball rendering.
- `src/client/netHealth.client.ts` — Misprediction/network diagnostics.
- `src/client/simTimeline.client.ts` — rollback event-order diagnostic.
- `src/server/FeelHarness.server.ts` — `/feel` comparison harness.
- `src/shared/vehicleV2/FeatureFlags.ts` — V2 and diagnostic switches.

## Known limitations and likely bug areas

Treat these as investigation targets, not automatically as the cause of every
reported symptom.

1. **Runtime platform settings are unproven.** The checked-in place does not
   visibly opt into streaming, fixed simulation or next-generation replication.
   Confirm the live Studio place's actual `AuthorityMode`,
   `UseFixedSimulation`, `NextGenerationReplication` and streaming properties.

2. **60 Hz is requested but not load-proven.** The scheduler attempts
   `StepFrequency.Hz60` but can fall back to the engine default or Heartbeat.
   Confirm logs say `BindToSimulation(Hz60,prio1000)` and approximately 60 Hz
   on both server and client. Under a full lobby, server simulation must remain
   at least 59 FPS with rollback/resimulation load.

3. **No measured 300 ms result exists.** The architecture is promising, but
   butter-smooth behavior has not been demonstrated under latency, jitter and
   loss.

4. **Feel parity is unproven.** V2 uses broad movement preset families rather
   than every old `VehicleClass` movement value. Run `/feel` on legacy and V2,
   compare acceleration, speed, braking, turning, jump, boost and blast, then
   retune intentionally.

5. **Directional dodge may be missing.** Current `flip` behavior is primarily
   low-speed upside-down recovery. If the intended game requires a Rocket
   League-style directional airborne dodge, implement explicit direction,
   impulse, rotation phase, timer and consumed/cooldown state.

6. **Correction policy is incomplete.** It handles magnitude, rotation, speed,
   grounded/airborne, landing, nearby ball, blast and basic world penetration.
   It does not fully account for drift direction, flips, error direction
   relative to motion/camera, goal-plane urgency, car penetration, screen-space
   displacement or enforced maximum settle duration.

7. **Camera policy is basic.** It follows one corrected render anchor. Separate
   position/orientation stabilization, grounded horizon behavior, correction
   attribution and special flip/landing/goal/respawn policies are not complete.
   Avoid adding a second long smoothing layer that makes controls feel delayed.

8. **Remote input prediction is disabled.** Remote cars use a timestamped
   buffer, Hermite position interpolation, rotational interpolation and bounded
   extrapolation. `REMOTE_INPUT_PREDICTION` remains false pending measured
   testing. Document the collision-time-versus-render-time tradeoff before
   enabling it.

9. **Ball integration needs live stress testing.** Test high-speed hits, two-car
   pinches, same-frame contacts, saves, goal-line corrections, wall/curb
   penetration and remote contacts. Ball attribution currently uses the match
   model name; match cars are suffixed with `player.UserId`, so names are unique
   under the current spawn contract, but a stable owner identifier would be
   safer if that naming contract changes.

10. **Streaming dependencies need validation.** The driver's
    `ReplicationFocus` follows `VehicleRoot` and V2 models stream atomically,
    but verify ball, arena collision, nearby cars and cast dependencies remain
    available throughout a real match.

11. **Template validation has not been run over the live catalogue.** Missing
    `HitboxMain` aborts spawning, but other wheel-derivation problems may warn
    and continue. Test every 4/6/8-wheel template for correct body pivot,
    hitbox, wheel position, steering axle, suspension travel, paint and effects.

12. **Telemetry is incomplete.** `/nettest` reports correction count, snaps,
    maximum offset and settle time, while `netHealth` parses structured
    Mispredictions. It does not yet provide every requested screen-space,
    camera, streaming, context and server-load metric. There is also at least
    one stale 30 Hz comment in `netHealth.client.ts`; audit diagnostics for
    assumptions tied to the old rate.

13. **Automated coverage is mostly pure math.** Missing or weak areas include
    whole-trajectory dt invariance, movement state transitions, external blast
    survival, teleport correction clearing, live template validation, ball
    contact ordering/pinches and gameplay integration.

14. **V2 is currently enabled before acceptance testing.** This is intentional
    for the present testing request, but keep rollback simple: disabling
    `VEHICLE_V2_ENABLED` restores the isolated legacy match path.

## Test order

Do not start with a full chaotic match. At every stage, record reproduction
steps, expected behavior, actual behavior, ping profile, FPS, correction
telemetry and relevant logs.

1. One V2 car on flat static ground at 0 ms.
2. Acceleration, reverse, braking and turning at several speeds.
3. Drift initiation, sustain and regrip.
4. Boost on ground and in air; verify target-speed and resource behavior.
5. Jump hold/release, aerial pitch/yaw/roll and upside-down recovery.
6. Slopes, ramps, curbs, walls and repeated landings.
7. Forced corrections with no other moving objects.
8. One remote car without contact.
9. Car-to-car collision.
10. Ball free flight.
11. Local car-to-ball contact.
12. Remote car-to-ball contact.
13. Two-car pinch and simultaneous contacts.
14. Goal, blast, reset and kickoff.
15. Every vehicle template.
16. Full lobby and streaming boundaries.

Repeat the relevant ladder at:

- 0, 50, 100, 150, 200 and 300 ms RTT.
- Stable latency and approximately ±40 ms jitter.
- 150 ms with representative packet loss, initially 5%.
- 30, 60 and high-refresh rendering.
- A representative low-end/mobile device.
- Full expected server player and vehicle count.

## Diagnostic procedure

1. Enable `SIM_TIMELINE_ENABLED` for a development run when validating Roblox
   event order.
2. Enable `RENDER_DEBUG_OVERLAY` when diagnosing correction offsets.
3. Use `/nettest` after each reproducible correction sequence.
4. Use `/feel` for repeatable movement envelope measurements.
5. Capture `netHealth` summaries and Server Authority visualizer metrics.
6. Verify the scheduler logs the intended Hz60 binding and measured rate.
7. Record whether a defect is in:
   - authoritative/predicted simulation,
   - local render correction,
   - remote interpolation,
   - ball rendering,
   - camera presentation,
   - streaming/replication,
   - or non-network gameplay integration.

## Acceptance essentials

- Local input affects the predicted proxy by the next simulation tick.
- With no correction, rendered local pose equals predicted pose exactly.
- Corrections converge to corrected-present truth within the documented
  severity budget.
- The visual car never exposes physical rollback or detached wheels.
- Teleports snap intentionally and clear render error.
- Goal blasts visibly launch the proxy and are not immediately clamped away.
- Ball contact remains server authoritative and usable at every profile.
- Client render FPS does not materially change gameplay trajectory.
- Full-lobby server simulation sustains the selected 60 Hz rate.
- Every template preserves its authored `HitboxMain` dimensions and pose.
- Legacy and V2 controllers never drive the same vehicle simultaneously.

The complete numeric budgets are in `VEHICLE_V2_ACCEPTANCE.md`.

## Bug-report template

For each issue, record:

```text
Title:
Vehicle template/preset:
Scenario:
Client FPS / server FPS:
RTT / jitter / loss:
Local, remote, or ball:
Exact reproduction steps:
Expected behavior:
Observed behavior:
First bad frame/event:
/nettest output:
netHealth output:
Mispredicted property/attribute:
Simulation proxy pose:
Rendered pose/error offset:
Grounded/drift/jump/boost/flip/blast context:
Streaming readiness:
Video/screenshots/logs:
```

## Non-negotiable bug-fixing guardrails

- Do not reintroduce constraint wheels or a multi-assembly predicted car.
- Do not move the visible rig backward to an old authoritative snapshot.
- Do not smooth or tween `VehicleRoot`; corrections belong in presentation.
- Do not apply permanent smoothing during ordinary correctly predicted motion.
- Do not hide systematic prediction divergence with a longer half-life.
- Do not allow render wheels to follow independent physics objects.
- Do not let rendering, camera, sound or UI mutate gameplay state.
- Do not apply external gameplay impulses outside the deterministic simulation
  event path and then fight them with normal speed control.
- Do not accept client-supplied transforms, velocity, hits, damage or score.
- Do not replace per-template authored `HitboxMain` geometry with cosmetic
  bounds or one universal car size.
- Preserve unrelated fixes on `master`; the vehicle PR also incorporated UI
  flow/spawn race fixes from the latest base branch.

## Expected fresh-agent working method

Start by reproducing one concrete defect. Trace it through simulation proxy,
render offset and camera rather than immediately tuning smoothing. Make the
smallest deterministic fix, add a focused regression test where possible, run
the build and full test suite, then repeat the exact latency profile that
exposed it. Keep measurements in the bug report or acceptance document so
later work does not rely on “felt smoother” as evidence.
