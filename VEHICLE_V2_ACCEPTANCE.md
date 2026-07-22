# Vehicle V2 — Acceptance gates, budgets and test ladder

Single source of truth for the numeric budgets. Code reads none of these at runtime;
`src/shared/vehicleV2/CorrectionPolicy.ts` mirrors §3 and must be kept in sync when tuning.

## 1. Outcome gates

| Gate | Statement | How verified |
|------|-----------|--------------|
| G-1 | Local input affects the predicted proxy on the **next simulation tick**; never waits one RTT | simTimeline capture: input edge → force application ≤ 1 tick (16.7 ms @60 Hz) |
| G-2 | Rendered body/wheel separation impossible **by construction** | code inspection: rig wheels are CFramed children of the rendered chassis pose only (`carRig.client.ts`) |
| G-3 | No constraint/wheel assembly can fling — none participates in match physics | spawn validator asserts the V2 model contains no SpringConstraint/HingeConstraint/CylindricalConstraint/VehicleSeat and exactly one unanchored part |
| G-4 | Uncontested local driving @300 ms RTT: no visible rewind; render correction stays inside budgets (§3) | latency ladder profile P-6, telemetry `maxOffset`, `settleTime` |
| G-5 | Corrections converge to the corrected-present proxy within the severity band's settle budget | telemetry per-correction records |
| G-6 | Zero permanent render-follow delay without an active correction | with `E = identity`, visible pose == sim pose bit-for-bit (assert in debug overlay) |
| G-7 | Teleports/respawns snap atomically (TeleportGen), clearing E and camera smoothing | scenario L-10 |
| G-8 | Goal blast launches the single proxy, is visible locally, and is not cancelled by speed control | overspeed brake suppressed for `BLAST_CONTROL_HOLDOFF` after BlastGen bump; scenario L-10 |
| G-9 | Ball contact stays authoritative and usable at all profiles; corrections near goals favor truth | ladder L-7/L-8 at each profile |
| G-10 | Same preset ⇒ identical physics across cosmetics | presets contain all physics constants; no model-derived quantity feeds the sim (mass/dims from preset) |
| G-11 | Client FPS does not change trajectory beyond tolerance (fixed-step sim; render decoupled) | 30/60/144 FPS runs of L-1..L-3, trajectory divergence < 0.5 vehicle lengths over 30 s |
| G-12 | Server sustains the 60 Hz fixed rate under full load including resim (server heartbeat ≥59) | Server Authority visualizer + netHealth server-rate alert |
| G-13 | Misprediction telemetry names real properties/attributes and context (never "unknown entry") | netHealth v2 parser matches documented event shape |
| G-14 | Old and new movement systems cannot both drive one vehicle | `VEHICLE_V2_ENABLED` selects the registration path at spawn; legacy `VehicleSim.register` refuses V2 models; V2 refuses legacy models |

## 2. Latency/network profiles (run the full ladder at each)

P-1 0 ms · P-2 50 ms · P-3 100 ms · P-4 150 ms · P-5 200 ms · P-6 300 ms RTT —
each stable **and** with ±40 ms jitter; P-7 = 150 ms + 5% loss; client render at 30/60/high-refresh;
one representative low-end/mobile client; full expected lobby size.
Tooling: Studio → File → Studio Settings → Network → *Incoming Replication Lag* (adds one-way delay);
run two-player local server for remote-car scenarios. Record: netHealth 5 s summaries + correction
telemetry dump (`/nettest` chat command, dev builds).

## 3. Correction budgets (initial values — tune from telemetry, keep in sync with CorrectionPolicy.ts)

Vehicle length L ≈ 12 studs (Standard preset). Position error normalized by L; rotation in degrees.

| Band | Engage (pos ‖ rot) | Half-life pos/rot | Max settle | Notes |
|------|--------------------|-------------------|-----------|-------|
| Noise | < 0.015 L or < 0.5° | — (ignored, held) | — | dead zone with 2× release hysteresis |
| Small | < 0.10 L or < 6° | 60 ms / 50 ms | 0.4 s | uncontested driving corrections live here |
| Medium | < 0.45 L or < 25° | 110 ms / 90 ms | 0.8 s | |
| Large | < 2.5 L or < 90° | 180 ms / 140 ms | 1.2 s | prefers camera-least-visible axis |
| Catastrophic | ≥ 2.5 L, teleport, or penetration | snap | 1 frame | TeleportGen always snaps |

Context multipliers: airborne ×1.4 half-life (no ground reference), landing window ×0.6,
goal/ball proximity (< 25 studs to ball or goal plane) ×0.5, BlastGen event ×0.5.
Hard caps: visual-to-sim divergence ≤ 3 L (then snap); camera anchor displacement from correction
≤ 60 px @1080p equivalent; suspension visual travel clamped to preset range.

## 4. Cadence decision procedure

Shipped target: `SIM_RATE_HZ = 60`, `StepFrequency.Hz60`, priority 1000. Run L-11 full lobby
at P-4 and accept only if server simulation heartbeat ≥ 59 FPS sustained (visualizer), resim p95
within `stats.ResimulationTime` budget 4 ms, and the representative low-end client holds target
FPS. If this gate fails, optimize the simulation rather than silently falling back to 30 Hz.

## 5. Scenario ladder

L-1 one car flat ground → L-2 slopes/ramps/curbs/walls/landing → L-3 one car forced corrections
(replication lag toggled mid-drive) → L-4 one remote car no contact → L-5 car-car contact →
L-6 ball free flight → L-7 local car-ball → L-8 remote car-ball → L-9 pinch/simultaneous →
L-10 goal, blast, reset, kickoff → L-11 full lobby + streaming boundaries.

## 6. Manual Studio verifications still required (cannot run in this environment)

1. Enable `SIM_TIMELINE_ENABLED` (FeatureFlags) in a dev build; drive with Incoming Replication
   Lag ≥ 0.15 s; confirm the captured order is `Rollback → resim BindToSimulation ticks →
   Misprediction → PreRender` and that the corrected-present pose the renderer reads at PreRender
   matches the last resim tick's pose. If the order differs, only `simTimeline` output is
   affected — the renderer's discontinuity detection does not depend on it (ADR §3).
2. Confirm `BindToSimulation(fn, Enum.StepFrequency.Hz60, 1000)` is accepted (scheduler logs
   `bound via BindToSimulation(Hz60,prio1000)`) and the measured rate log reads ~60 Hz on both
   peers. The bare API fallback defaults to 30 Hz and must therefore be treated as a failed gate.
3. Run the baseline feel capture (`/feel` harness) on the legacy path, then V2, compare envelope
   (accel to top speed, stop distance, turn radius at 3 speeds, jump apex, boost gain, dodge
   distance, blast response) — targets in FeelHarness output; preserve within ±15% or retune
   presets.
4. Verify predicted-instance count while driving a V2 car is ≤ 8 (root + hitboxes + welds +
   model) vs ≈ 60+ on legacy (visualizer).
5. Attribute payload: `CarState.assertSchemaBudget()` warns at startup if the estimated predicted
   payload exceeds 700 bytes (cap 1024).
