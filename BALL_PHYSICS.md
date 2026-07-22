> **UPDATE (2026-07-22, Vehicle V2):** car contact detection now samples the
> relative ball-vs-hitbox motion at t=0.5/1.0 within each tick (continuous
> detection — no tunneling through the thin hitbox dimension), with
> deterministic earliest-time/deepest/name contact ordering; a preset-gated
> reciprocal car recoil exists (`PhysicsPresets.ballRecoil`, default 0 = RL
> rules); V2 cars expose the same `Hitboxes.HitboxMain` contract from a box
> welded to the single VehicleRoot assembly (spawn-validated); and the ball
> renderer now uses magnitude-scaled error decay with a fast-truth window
> after car contacts instead of the binary SmoothDamp engage. Details:
> `VEHICLE_V2_ADR.md`.

# Custom Ball Physics (Rocket-League style)

Why: engine physics (density/friction/elasticity) gave almost no usable
tuning range — the ball was either too heavy for a car to move or flew
forever after one touch. This design replaces engine collision response with
a scripted model that has an explicit dial for every part of the feel, built
to run under server authority with prediction/rollback.

## Rocket League reference (what we're imitating)

From the RLBot wiki and smish.dev's reverse engineering of RL's ball:

- Ball bounce (restitution) vs the arena: **0.6** — it keeps 60% of the
  into-surface speed.
- Ball speed is hard-capped at 6000 uu/s ≈ **2.6× car top speed** (2300).
- Gravity relative to ball size is LOW (650 uu/s² on a 91.25 uu radius ≈
  7.1 g/r) — the floaty arc. Roblox default (196.2 on our 13-stud radius =
  15 g/r) is about twice as "heavy", hence `gravityScale ≈ 0.5`.
- Slight air drag (~3%/s) so the ball dies down over time.
- The core trick — the **"Psyonix impulse"**: on every car→ball hit, on top
  of the physical collision, an extra impulse `J = m·|Δv|·s(|Δv|)` is applied
  to the ball ONLY (momentum deliberately not conserved), along the direction
  `ball center − car center` with the **vertical component scaled by 0.35**
  (keeps shots flat and drivable). This is what makes RL touches feel
  powerful and predictable.

## Architecture (Roblox server authority)

`src/shared/ballSim/BallSim.ts`, initialized on the server AND every client
(`initBallSim.server.ts` / `initBallSim.client.ts`), ticking in
`RunService:BindToSimulation()` — the same "simulation sync" pattern as
VehicleSim. The ball part is `PredictionMode.On`, so:

- every client predicts the ball with the same code → touches from the
  local (predicted) car respond **instantly**;
- the server's run is authoritative; the engine rolls back and resimulates
  clients that mispredicted.

The engine's own physics is neutralized: `CanCollide = false` (no engine
contacts at all) and an `AntiGravity` VectorForce cancels engine gravity.
The engine's only job is integrating position from the velocity BallSim
writes. The ball is also `CanQuery = false` so no other system's raycasts
(wheel ground rays, damage overlaps) ever see it.

Rollback rules (same discipline as VehicleSim):

- All cross-tick state is in attributes on the ball (`BallSimTime`,
  `BallLastHitCar`, `BallLastHitTime`).
- All tunables are attributes on the ball (`BT_*`), written by the server
  from inside the sim step and replicated — both peers always simulate with
  identical numbers, and tuning changes need no respawn (only `size` does).
- Timers compare sim time, never wall clock.

## The per-tick model

1. **Gravity + drag**: `v += (0, -g·gravityScale·dt, 0)`, then
   `v *= (1 − drag·dt)` (the air die-down).
2. **Ground probe**: a downward raycast de-penetrates the ball from the
   floor and sets `grounded`.
3. **World sweep**: a spherecast along `v·dt` (never tunnels at any speed)
   against a **strict include list** — the ball's own pitch's
   `STADIUM.collisionBottom`, `STADIUM.outer` and `groundPart`, nothing
   else (no goal parts, no decor, no terrain). On approach faster than a
   small threshold the velocity reflects instantly: into-surface speed ×
   `worldBounce`, along-surface speed × `(1 − worldFriction)`. Slower
   contact just slides. The ground probe uses the same include list.
4. **Car hits**: `GetPartBoundsInRadius` over an include list holding
   exactly every car's **Hitboxes.HitboxMain** box (never body/wheels).
   Contact normal = ball center minus closest point on the box. Then:
   - the ball-vs-car **relative** velocity reflects with `carBounce` — so
     both the ball's incoming speed and the car's speed feed the response;
   - a Psyonix-style punch of `hitPower × closing speed` is added along
     `ball center − hitbox center` with Y scaled by `hitVerticalScale`,
     applied to the ball only, gated by `hitCooldown` per car;
   - the ball is pushed out of penetration.
5. **Die-down + cap**: extra `rollFriction` on the ground, full stop below
   `restSpeed`, hard `maxSpeed` cap. Rolling spin is set for looks.

## Tuning guide (the HUD maps 1:1 to these)

| Dial | Feel | RL-ish default |
|---|---|---|
| `gravityScale` | floatiness of the arc | 0.55 |
| `drag` | how fast flight dies down | 0.1 |
| `rollFriction` | how fast ground rolling dies down | 0.6 |
| `restSpeed` | when the ball fully stops | 4 |
| `maxSpeed` | ceiling (≈2.6× car top speed in RL) | 300 |
| `worldBounce` | bounciness off map | 0.6 |
| `worldFriction` | grip of map surfaces on bounces | 0.2 |
| `carBounce` | passive bounce off cars | 0.5 |
| `hitPower` | THE punch dial | 1.2 |
| `hitVerticalScale` | 0 = flat shots, 1 = full lift | 0.35 |
| `hitCooldown` | anti machine-gun on sustained pushes | 0.15 |

Tuning recipe: set `maxSpeed` ≈ 2.5× car boost speed first, then raise
`hitPower` until a full-speed touch feels punchy, then balance `drag` /
`rollFriction` until the ball settles in ~4–6 s, then `gravityScale` for arc.

## Known tradeoffs

- The ball does not push cars (RL also barely does — the extra impulse is
  one-way by design). Cars drive through the ball's sphere if they clip past
  the hitbox contact in one tick; at our speeds the sweep + de-penetration
  make this rare.
- Only box hitboxes get exact closest-point contact; world contact is
  sphere-vs-include-list via spherecast (`STADIUM.collisionBottom`,
  `STADIUM.outer`, `groundPart` — the ball passes through everything else,
  including terrain and goal parts).
- Characters on foot are ignored by the ball entirely (not on the include
  list — nothing outside it can ever touch the ball).
