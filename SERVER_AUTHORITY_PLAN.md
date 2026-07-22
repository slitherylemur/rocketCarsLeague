> **SUPERSEDED FOR MATCH VEHICLES (2026-07-22):** the constraint-driven car this
> plan migrated has been replaced by the **Vehicle V2 single-assembly
> ray-contact architecture** behind `VEHICLE_V2_ENABLED`
> (src/shared/vehicleV2/). See `VEHICLE_V2_ADR.md` (decisions + audit),
> `VEHICLE_V2_ACCEPTANCE.md` (gates + latency ladder) and `VEHICLE_V2_GUIDE.md`
> (how to add cars/presets and diagnose corrections). This document remains as
> the historical record of the server-authority migration and still describes
> the legacy path that runs when the flag is off.

# Server Authority + Client Prediction Migration Plan

> **Status (2026-07-16):**
> - Studio flags all flipped (beta + Workspace properties incl. `AuthorityMode = Server`); PlayerGarages etc. set Persistent for streaming.
> - Phase 0 ✅ — `/feel` harness in `src/server/FeelHarness.server.ts` (chat `/feel` while seated, Studio only).
> - Phase 1 ✅ — legacy BodyMovers replaced by code-created modern constraints; verified in-game.
> - Phase 2 ✅ code-complete — sim extracted to `src/shared/vehicleSim/VehicleSim.ts` (server-ticked), timers are sim-time state machines, sim state in attributes, rendering in `src/client/vehicleRenderer.client.ts`. Pending playtest + `/feel` parity.
> - Phase 3 ✅ — per-player `VehicleControls` InputContext built in code (`vehicleInputActions.ts`), sim reads InputActions each tick (one Bool action per movement key — IAS multi-binding axes drop keys), remotes deleted (Horn stays), keybind menu rebinds live, mobile buttons/joystick fire actions programmatically. Verified on PC + mobile.
> - Phase 4 ✅ code-complete — tick bound via `BindToSimulation` on both peers; client registers its own car (`initVehicleSim.client.ts`, adopts movers + tuning attrs from the replica); local car + character forced `PredictionMode.On` (deep) while seated; remote cars explicitly unpredicted (server-rendered). Pending multi-client + latency test.
> - Phase 4b (2026-07-16, rollback-safety rewrite) — root cause of the drive-time glitching: the sim stamped **wall-clock `time()`** into synchronized attributes (`JumpForceUntil`, `BoostBlockedUntil`, …). Client and server wall clocks never agree, and *any* attribute mismatch on a predicted instance triggers a full rollback+resim → permanent rollback storm while driving. Fix: per-car `SimTime` attribute advanced by the `BindToSimulation` deltaTime (fixed-step, rolls back with the snapshot); ALL cross-tick sim state moved into attributes (`LastThrottle`, `ReleasedThrottle`, `JumpStabilizing/Start`, `BoostLastInc`, `FlipActive/Until/ReadyAt/Target/LiftPos`, `Prev*` input edges, `Driving` as the occupancy edge source); wheel drift friction re-asserted from the `DriftEngaged` attribute every tick (rollback restores attrs, not physical properties); server-initiated ops (FeelHarness `setBoostHeld`/`requestJump`/`setRoll`, FlipVehicle remote) queued on the entry and consumed *inside* the sim step, since attributes on predicted instances may only be written from within `BindToSimulation`. Pending playtest.
> - Phase 5 (optional/polish): correction smoothing for remote cars, opponent input-echo extrapolation (attrs already replicate), spawn-choreography cleanup, live-publish check of the beta.
> - Note: Flip has no client-side trigger (pre-existing); give it an IAS binding if wanted.

Goal: move the game onto Roblox's server authority model (`Workspace.AuthorityMode = Server`)
with client-side prediction of the local player's car, so that:

- input feels instant (prediction hides the round trip),
- car-vs-car hits are computed from one authoritative simulation (accurate, fair),
- the game plays well across devices and ping levels,
- **the tuned car feel is preserved exactly** — the physics *math* does not change,
  only *where and when* it runs.

Non-negotiable: at every phase gate the car must drive identically to the current
build (verified by the parity harness in Phase 0). We change architecture in layers,
never physics behavior and architecture in the same step.

---

## 1. Current architecture (as-built audit)

What actually runs today (this differs from what the comments imply):

| Concern | Where it lives today |
| --- | --- |
| Input read | `src/client/VehicleKeyHandler.client.ts` — CAS-bound keys → held-state |
| Input transport | `inputChangedEvent` RemoteEvent (throttle/steer floats), `KeyHandler` RemoteEvent (Drift/Boost/Jump/Horn/Rolls/Flip) |
| Force computation | `VehicleClass.drive()` — a per-vehicle **server** `while` loop on `Heartbeat` (`VehicleClass.ts:632`) |
| Physics simulation | **The owning client.** `spawnVehicle.ts:265` calls `Base.SetNetworkOwner(player)` — the car assembly is client-simulated |
| Hit detection | Server `Touched` on `Hitboxes.damageBlock` + velocity buckets (`VehicleClass.ts:644`) |
| Effects/sounds/GUI | Mutated **inside** the server drive loop (idle sound pitch, drift sound/trails, boost meter tween, health bar) |

So the input path is: key press → RemoteEvent → server loop tick → constraint
property write → replication → owning client's physics applies it. **Steering and
throttle lag by a full RTT plus a Heartbeat**, which is exactly the unresponsiveness
being felt. Meanwhile hits are judged on the server against positions the *clients*
simulated — the worst of both worlds for accuracy. Server authority fixes both:
one authoritative simulation on the server, and the input latency is hidden by
running the *same* simulation code predictively on the client.

Physics actuators currently on the car (`VehicleClass.ts` / the place-file models):

| Actuator | Class | Used for | Status under server authority |
| --- | --- | --- | --- |
| `Base.LinearVelocity` | LinearVelocity | main propulsion | ✅ modern constraint, keep |
| `Base.slopeCounterVelocity` | LinearVelocity | anti-slide on side slopes | ✅ keep |
| `Base.DriftThrust` | VectorForce | drift centripetal assist | ✅ keep |
| `JumpThrust` (created in code) | VectorForce | jump impulse | ✅ keep |
| `DriftYaw` (created in code) | **BodyAngularVelocity** | commanded drift rotation | ⚠️ legacy mover — migrate |
| `Base.Aerial` | **BodyAngularVelocity** | aerial yaw/pitch/roll | ⚠️ legacy mover — migrate |
| `Base.BodyGyro` | **BodyGyro** | slope alignment, jump upright hold, flip | ⚠️ legacy mover — migrate |
| `Base.FlipMover` | **BodyPosition** | flip lift | ⚠️ legacy mover — migrate |
| Wheel `HingeConstraint`s | HingeConstraint (Servo) | Ackermann steering | ✅ keep |
| Wheel `SpringConstraint`s | SpringConstraint | suspension | ✅ keep |
| `CustomPhysicalProperties` swaps | — | drift grip change | ✅ property write, keep |

The deprecated `Body*` movers are a migration risk twice over: they're legacy
(no guarantee of simulation-access support inside `BindToSimulation`, no guarantee
of correct behavior under fixed-step rollback), and they must be replaced with
`AngularVelocity` / `AlignOrientation` / `AlignPosition` **before** the authority
flip so that feel-parity is verified independently of the netcode change.

Wall-clock / event-driven logic that cannot survive rollback-resimulation as written:

- `Jump()` — `task.wait(JUMP_FORCE_TIME)`, `task.wait(2)` debounce (`VehicleClass.ts:1137`)
- `Boost()` — `task.delay(3)` boost-regen delay (`VehicleClass.ts:1064`)
- `boostIncrement()` — `time()` deltas at 0.2 s cadence (`VehicleClass.ts:1114`)
- `Flip()` — `task.wait(1)` / `task.wait(2)` sequence (`VehicleClass.ts:1160`)
- `drive()` itself — `while … Heartbeat.Wait()` loop keyed off `Humanoid.Seated`
- `lastCarHit` 1 s `task.delay` debounce in the Touched handler

All of these become **explicit state machines advanced by the simulation tick's
`deltaTime`**, with their state stored where the rollback system can snapshot it
(attributes). This is a mechanical transformation that does not change timing
behavior — a `task.wait(0.18)` becomes "force stays on until `simTime >= t0 + 0.18`".

---

## 2. Target architecture

```
ReplicatedStorage.TS.vehicleSim (shared ModuleScript, compiled from src/shared/vehicleSim/)
│   VehicleSim.register(model, tuningParams)   ← pure simulation core
│   VehicleSim.initialize()                    ← RunService:BindToSimulation(tick)
│
├── runs on SERVER  (initialized from a Script)      → authoritative state
└── runs on CLIENT  (initialized from a LocalScript) → prediction of nearby cars
        └── separate RenderStepped renderer: sounds, trails, particles,
            boost meter GUI, idle-sound pitch, smoothing

Player.Inputs.VehicleControls (InputContext, cloned per player by the server)
    Throttle  (Direction1D: W/S, R2/L2, mobile joystick Y)
    Steer     (Direction1D: A/D, thumbstick X, mobile joystick X)
    Drift / Boost / Jump / RollLeft / RollRight / Flip  (Bool)
    — read inside the sim tick on BOTH sides; the engine replays them on rollback

Server-only (src/server): spawning, seating, damage, health, economy, cosmetics,
    round logic — unchanged, still RemoteEvents/BindableEvents where appropriate
```

Key division of labor:

- **Shared sim core** (`src/shared/vehicleSim/`): everything that determines the
  car's *motion* — the drive tick (gears, slope compensation, boost force),
  drift engage/disengage + friction swap, jump state machine, aerial controls,
  flip state machine, wheel steering (Ackermann), ground/closeGround raycasts.
  This is a near-verbatim port of the math in `VehicleClass.ts:632-1251`,
  with the tuning constants moved with it. **No server-only imports** (no
  DataStore, no Globals, no economy).
- **Server wrapper** (`VehicleClass` slims down): ownership, spawn/kill, damage
  and health, paint/trails/horn cosmetics, money popups, team logic. It *reads*
  sim state (velocity for damage buckets) but never writes motion.
- **Client renderer** (new `src/client/vehicleRenderer.client.ts`): everything
  audiovisual, driven off attributes + instance state on `RenderStepped`, per the
  techniques doc — so a rolled-back boost never leaves a stuck sound playing.

### 2.1 Input mapping (Input Action System)

IAS is mandatory: InputActions are the only client-authoritative data in the
rollback system and are replayed during resimulation. Mapping from today's code:

| Today | IAS action | Notes |
| --- | --- | --- |
| `held.forward/backward` → throttle float | `Throttle` Direction1D | keyboard W/S, gamepad R2/L2 |
| `held.left/right` + thumbstick → steer float | `Steer` Direction1D | A/D + Thumbstick1 X |
| mobile `Humanoid.MoveDirection` sampling | joystick bound to `Throttle`/`Steer` | replaces the `MobileSteer` RenderStep hack |
| `KeyHandler("Drift"/"Boost"/"Jump1"...)` | Bool actions | mobile buttons fire the same actions |
| `KeyHandler("FlipVehicle")` | `Flip` Bool | affects motion → must be IAS |
| `KeyHandler("HonkHorn")` | stays a RemoteEvent | cosmetic; doesn't touch the sim |
| custom keybinding menu (`GetKeyBinding`/`SetKeyBinding`) | rebind `InputBinding.KeyCode` at runtime | the menu UI is unchanged; it now edits bindings on the player's InputContext clone |

Server-side sanity checks stay: clamp throttle/steer to [-1, 1], NaN-guard —
same checks as `initialiseVehicleModel`'s current remote handler, applied where
the sim reads the actions.

`InputContext`s must live under the `Player`; a small server script clones a
template folder from ReplicatedStorage on `PlayerAdded` (pattern straight from
the docs). Actions are enabled only while seated (same enable/disable moments as
today's `BindAction`/`UnbindAction` in `onSeated`).

### 2.2 Synchronized state (attribute schema)

Rule: **any state the motion math reads must be snapshotted by the rollback
system** — i.e. live in attributes on a predicted instance (`Base`) — and the set
should stay minimal, because *any* attribute mismatch triggers a full rollback.
Derivable values (velocity, propVelocity) are recomputed each tick, never stored.

On `Base` (predicted, sim-critical):

| Attribute | Type | Replaces |
| --- | --- | --- |
| `BoostAmount` | number (integer 0-100) | `this.boostAmount` |
| `BoostHeld` | boolean | `this.boost` |
| `BoostRegenAt` | number (sim time) | `boostDelay` + `task.delay(3)` |
| `BoostTickAt` | number (sim time) | `lastIncrementTime` 0.2 s cadence |
| `DriftHeld` | boolean | `this.drifting` |
| `DriftEngaged` | boolean | `this.driftEngaged` |
| `JumpForceUntil` | number (sim time) | `task.wait(JUMP_FORCE_TIME)` |
| `JumpReadyAt` | number (sim time) | `jumpDebounce` + `task.wait(2)` |
| `StabilizeUntil` | number (sim time) | `jumpStabilizing`/`jumpStabilizeStart` |
| `FlipState` / `FlipUntil` | number | `Flip()`'s wait sequence |
| `Throttle` / `Steer` | number | server-echoed inputs (enables remote-car prediction, §2.5) |

On the vehicle `Model` (game state, not motion — non-BasePart instances are not
rolled back under Automatic prediction, which is what we want):

| Attribute | Type | Replaces |
| --- | --- | --- |
| `Health` | number | `this.health` (server-only writes; drives health bar renderer) |
| `OwnerUserId` | number | renderer + sim lookup key |

Tuning params (mass, acceleration, targetVelocity, turn radii, drifting mult,
suspension numbers) are static per vehicle type — written once as attributes at
spawn so the client sim can read them without importing the server subclass files.

### 2.3 The simulation tick

One `BindToSimulation` callback iterates a registry of active vehicles (replacing
N per-vehicle `while` loops). Per vehicle, in order — this is the *same math,
same order* as today's `drive()` body:

```
tick(dt):
  for each registered vehicle v:
    if not shouldSimulate(v): continue        -- seat.Occupant check (replaces the while-condition)
    input  = readInputs(v)                    -- IAS actions (own car) or Base attributes (remote cars, server-echoed)
    advanceTimers(v, simTime)                 -- boost regen/drain, jump debounce, flip, stabilize (attribute state machines)
    velocity, propVelocity = fromBase(v)      -- recomputed, not stored
    onGround, closeGround = raycasts(v)       -- unchanged from onGround()/closeGround()
    aerialAndUprightLogic(v)                  -- BodyGyro→AlignOrientation targets, unchanged math
    turnWheels + drift/undrift(v)             -- hinge targets, friction swap, DriftYaw→AngularVelocity
    forceComputation(v)                       -- gears, slope terms, boost multipliers — verbatim
    write LinearVelocity / slopeCounter / DriftThrust / JumpThrust
```

Rules inside the tick (from the docs): only simulation-access properties; no
`task.wait`/`task.delay`/`task.spawn`; no `os.clock`, use `time()` (sim-synced);
no `math.random`; no event connections; no GUI, no sounds. The current
`pcall`-wrapped loop body gets un-pcall'ed — under resimulation an erroring tick
means divergence, so errors must surface in testing, not be swallowed.

Perf notes (the server now simulates *all* cars at a fixed 60 Hz, and clients
additionally resimulate several frames on every misprediction):

- `GetTotalMass()` currently walks every descendant every frame — cache at spawn
  and on occupant change (`Seats.VehicleSeat:GetPropertyChangedSignal("Occupant")`).
- Cache wheel/hinge/constraint references at registration; no `FindFirstChild`
  in the tick.
- 4 raycasts/car/tick (+1 closeGround) is fine, but keep the RaycastParams reuse.
- Watch `RCC heartbeat FPS ≥ 59` in the visualizer with a full lobby.

### 2.4 Rendering split (client, RenderStepped)

Moved out of the drive loop / server methods into a client renderer that reads
attributes and instance state:

| Effect | Today | Target |
| --- | --- | --- |
| Idle sound pitch (gear curve) | server loop writes `PlaybackSpeed` | client computes from live velocity — same curve, zero net change |
| Drift sound + wheel trails | server `drift()`/`undrift()` | client: `DriftEngaged` attribute edge |
| Boost particles/trail/sound | server `UpdateBoostEffect()` | client: `BoostHeld` && `BoostAmount > 0` |
| Boost meter GUI | server tweens the player's PlayerGui (!) | client reads `BoostAmount` — deletes `setBoostMeter()` entirely |
| Jump sound | server `Jump()` | client: `JumpForceUntil` edge |
| Health bar | server writes `Green.Size` | client reads `Health` attribute |
| Crash/explosion/money popups | server, event-driven | unchanged — server game-state effects are fine outside the sim |

The state-machine + edge-detection pattern ("play explosion only when state
changed to Exploded and timer < 0.2 s") from the techniques doc is the template:
a mispredicted boost that rolls back just flips the attribute back and the
renderer stops the sound — nothing sticks.

### 2.5 Hits, damage, and other players' cars

- **Damage stays server-only.** The `Touched` handler moves to a server-side
  spatial query (`GetPartsInPart` on `damageBlock`) run outside `BindToSimulation`
  (or in a server-only branch of the tick), keeping the velocity buckets and the
  1 s per-target debounce as sim-time state. Rationale: predicted damage would
  mean mispredicted kills/explosions/money — high-cost artifacts for zero feel
  benefit. The physical shove of a collision *is* predicted (it's physics); only
  the health consequence arrives at server truth.
- **Remote cars, phase one: default behavior.** Other players' inputs are not
  forwarded, so their cars render slightly in the past but never mispredict.
  For a combat bumper game this is the stable starting point.
- **Remote cars, phase two (optional): input echo.** The server writes each
  player's throttle/steer into `Base` attributes (§2.2) every tick; client sims
  read those for cars it predicts (the Racing-template pattern). This makes
  nearby opponents extrapolate correctly (better rams, less "he was behind me")
  at the cost of more rollbacks when they change input. Ship it behind a toggle
  and A/B it with real ping.
- **Misprediction smoothing:** adopt the Soccer-template conditional smoother —
  an invisible simulated chassis with a visual-only rendered clone is the heavy
  version; start lighter: smooth only when the correction jump exceeds a
  threshold (`TweenService:SmoothDamp`, ~0.07 s), otherwise render raw. Apply to
  remote cars first; the local car should rarely need it if the sim is faithful.

### 2.6 Spawning and seating

- `SetNetworkOwner` is deleted — there is no network ownership under server
  authority. The elaborate anchor-during-seating choreography in
  `spawnVehicle.ts` (lines 199-269) exists to fight ownership-transfer races
  that no longer exist. **Keep it during migration** (it's harmless), simplify
  in the final cleanup phase once stable.
- `drive()` is no longer started from `Humanoid.Seated` — vehicles register with
  the sim at spawn and the tick itself gates on `VehicleSeat.Occupant`
  (the same ground-truth check the while-loop uses today at `VehicleClass.ts:711`).
- Vehicle model templates stay in ServerStorage; the spawned clone in
  `workspace.Vehicles` replicates to clients normally, and that live model is
  what the client sim operates on. (Instance stitching for spawn prediction is
  available later if spawn latency ever matters — it doesn't for this game.)
- Garage display cars (`clientSided` path) never register with the sim.

### 2.7 StreamingEnabled audit

`StreamingEnabled = true` is a hard prerequisite and is a game-wide behavior
change: workspace content now streams in/out per client. Required audit:

- Client scripts using dot-access on workspace (`workspace.MenuVehicles`,
  `workspace.spawnPartTemp`, garages, map models) → `WaitForChild`/streaming-safe
  access, or mark containers persistent.
- Set `Model.ModelStreamingMode = Persistent` on: player garages, menu cameras'
  rigs, spawn plates, round-critical map furniture. Arenas are small — if the
  whole map fits memory, a generous `StreamingMinRadius`/`TargetRadius` makes
  streaming near-invisible.
- Maps are swapped at runtime by `roundHandler`/`MapLightings` — verify map
  load/teardown behaves when clients haven't streamed the old map fully.
- `TerrainReset.client.ts` and lighting scripts — verify they don't assume
  full replication.

This audit is its own phase gate *before* the authority flip, so streaming bugs
aren't conflated with prediction bugs.

---

## 3. Phased migration

Each phase lands on `master` only after its gate passes. Physics math and
architecture never change in the same phase.

### Phase 0 — Baseline capture & parity harness (no behavior change)
1. Build a server-side test harness (Studio-only script) that injects scripted
   input sequences directly into the input floats and records metrics per car:
   - 0→max time, top speed, boost top speed, boost drain/regen timeline
   - steady-state turn radius at 25/50/75/100% speed
   - drift: lateral speed cap, yaw rate, exit heading after a scripted slide
   - jump apex height + airtime; flip recovery time
2. Record baseline JSON per vehicle type (at least BumperCar + 2-3 popular cars)
   and capture reference video of feel-critical maneuvers.
3. **Gate:** harness runs green against current build; numbers stored in repo.

### Phase 1 — Modernize legacy movers (current netcode, no restructure)
1. `Aerial` (BodyAngularVelocity) → `AngularVelocity` constraint; `DriftYaw` →
   `AngularVelocity`; `BodyGyro` → `AlignOrientation`; `FlipMover` (BodyPosition)
   → `AlignPosition` (or a vertical VectorForce ramp). Match torque/force/
   responsiveness params to reproduce current behavior — these have different
   parameterizations (`MaxTorque` vs `MaxAngularAcceleration`/`Responsiveness`),
   so this is a tuning task guarded by the harness, not a find-replace.
2. Update the place-file models (Base contains `Aerial`, `BodyGyro`, `FlipMover`,
   `LinearVelocity`, etc.) and the code that drives them.
3. **Gate:** Phase 0 harness parity + hands-on feel check. This is the highest
   feel-risk phase — do it while everything else is still familiar.

### Phase 2 — Restructure into the shared sim (still client-owned physics)
1. Extract `src/shared/vehicleSim/` from `VehicleClass.drive()` + movement
   methods; VehicleClass becomes the server wrapper (§2). Sim still runs
   **server-only** for now (bound to Heartbeat), inputs still arrive via the
   existing remotes → *zero* network behavior change.
2. Convert all timers to sim-time state machines and move sim state into the
   attribute schema (§2.2).
3. Move rendering to the client renderer (§2.4) driven by attributes.
4. Replace per-vehicle while-loops with the registry + single tick.
5. **Gate:** harness parity; a full playtest (damage, kills, boost meter,
   drift trails, mobile buttons, keybind menu) behaves identically.

### Phase 3 — IAS input path
1. Create the InputContext template + per-player cloning; port the keybinding
   menu to rebind InputBindings; port mobile joystick/buttons.
2. Server sim reads IAS actions instead of the remotes; delete
   `inputChangedEvent` and the movement half of `KeyHandler` (Horn stays).
3. Requires `Workspace.PlayerScriptsUseInputActionSystem = true` — test default
   character controls (lobby walking!) still work on all input types.
4. **Gate:** all inputs work on keyboard, gamepad, touch; input floats observed
   server-side match Phase 2 values.

### Phase 4 — The authority flip
1. Studio checklist (§4 below): beta feature + workspace properties, ending with
   `AuthorityMode = Server`. Complete the streaming audit (§2.7) first.
2. Initialize `vehicleSim` on the client too; local car becomes predicted
   (force `RunService:SetPredictionMode(model, Enum.PredictionMode.On)` for the
   local player's car; leave others Automatic).
3. Remove `SetNetworkOwner`; verify seating flow.
4. Test protocol: Studio "Server & Clients" mode with ≥1 client windows (never
   single-window — known false-jitter gotcha), then real multi-device tests with
   the visualizer (Ctrl+Shift+F6): prediction success rate, input accept rate,
   step delta stability, RCC FPS ≥ 59 with a full server.
5. **Gate:** harness parity **on the server sim**; local car feels ≤1-frame
   responsive; no visible artifacts at 0 ms; playable and stable at 100-150 ms
   simulated latency (Studio's network simulator / IncomingReplicationLag).

### Phase 5 — Smoothing, remote-car prediction, polish
1. Conditional smoothing renderer for correction jumps (§2.5).
2. Evaluate opponent input echo (attributes) for nearby cars; A/B at real ping.
3. Latency-tolerant design tweaks *only if needed* and only as explicit,
   user-approved feel changes (e.g. the docs note high-acceleration mechanics
   produce bigger artifacts — our boost punch is exactly that; if boost rollback
   pops are visible at high ping, consider smoothing, not detuning).
4. Cleanup: strip the now-dead anchor choreography in `spawnVehicle`, dead
   remotes (`Throttle`, `SteerFloat`, `UpdateBoostEffect`, `UpdateDriftEffect`),
   `physFixPlease` review.
5. **Gate:** multi-device playtest matrix (PC/mobile/console × low/high ping);
   hit-registration sanity (two cars ramming at speed produce symmetric,
   believable damage on both screens).

---

## 4. Studio checklist (manual steps in the place file)

Do these in order, in the place file (rojo doesn't manage these settings; we can
*also* pin the Workspace properties in `default.project.json` `$properties` so
fresh builds match, but the live place must be set by hand):

1. **File → Beta Features → "Server Authority Core API"** → enable → restart.
2. Workspace properties, in this order (the first five unlock the sixth):
   - `StreamingEnabled = true` *(only after the Phase 4 streaming audit)*
   - `UseFixedSimulation = true`
   - `PlayerScriptsUseInputActionSystem = true` *(Phase 3)*
   - `NextGenerationReplication = true`
   - `SignalBehavior = Deferred` *(audit: deferred events reorder same-frame
     signal handling — smoke-test UI + round flow after flipping this)*
   - `Workspace → Server Authority → AuthorityMode = Server` *(Phase 4)*
3. Model edits (Phase 1): in every `ServerStorage.VehicleModels.*.Base`, replace
   `Aerial`/`BodyGyro`/`FlipMover` with `AngularVelocity`/`AlignOrientation`/
   `AlignPosition` (+ needed Attachments). Script-created movers (`DriftYaw`,
   `JumpThrust`) are code-only changes.
4. Create `ReplicatedStorage.Inputs.VehicleControls` (InputContext) with the
   actions/bindings from §2.1 (Phase 3).
5. Test settings: **Test tab → Clients and Servers → 1+ clients** for all
   server-authority testing; use the network simulator for latency; visualizer
   via Ctrl+Shift+F6; prediction radius view via Alt+S "Are Regions Enabled".

---

## 5. Risks & mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Server authority is **beta** — publishability/stability may change under us (the API already renamed `FixedHeartbeat`→`BindToSimulation` once) | High | Verify current publish policy before Phase 4; keep Phases 0-3 valuable on their own (they are — cleaner arch, modern constraints, IAS); keep the flip isolated to one small commit that's trivially revertible |
| Feel drift from legacy-mover replacement (different parameterization) | High | Phase 1 is isolated + harness-gated; per-vehicle tuning table; reference videos |
| Feel drift from fixed 60 Hz sim (current loop is variable-rate Heartbeat) | Medium | Force math is constraint-target-based (rate-independent) except the 0.2 s boost cadence, which is already time-gated; harness will catch any residual |
| `@rbxts/types` may lag the beta APIs (`BindToSimulation`, `SetPredictionMode`, `InputAction`) | Low | Ship ambient declarations in `src/shared/robloxBeta.d.ts` until upstream catches up |
| StreamingEnabled breaks menu/garage/round flow | Medium | Dedicated audit + persistent models, gated before the flip |
| Server perf: all cars simulated on server at 60 Hz + client resim cost | Medium | §2.3 caching; visualizer RCC FPS budget; prediction limited to local car + Automatic radius |
| Rollback artifacts on high-punch mechanics (boost, jump, rams) | Medium | Conditional smoothing (§2.5); artifacts land on remote cars first, local car only mispredicts on server-side surprises (being hit) — which is exactly when a correction is *correct* |
| Character/seat edge cases under new replication (seat welds, exit, death) | Medium | Phase 4 test protocol includes seat/exit/death/respawn matrix; keep the defensive spawn code until Phase 5 |

## 6. Open questions (answer during Phase 0/1)

1. Does `VehicleSeat`'s occupant/weld flow behave cleanly under `AuthorityMode =
   Server`, or should the driver be welded manually? (Test in a scratch place
   with the Racing template as reference.)
2. Are `SpringConstraint`/`HingeConstraint` property writes (Servo targets,
   friction swaps via `CustomPhysicalProperties`) simulation-access — i.e.
   writable inside `BindToSimulation`? If not, wheel steering moves to a
   server-echoed attribute the physics reads via constraint config outside the
   tick. (Check API labels; test early.)
3. Exact IAS surface for programmatic firing (mobile buttons) and runtime
   rebinding — confirm against current `InputAction`/`InputBinding` API before
   porting the keybind menu.
4. Does the beta currently allow publishing `AuthorityMode = Server` to a live
   experience, and on what device/app versions do clients get prediction?
