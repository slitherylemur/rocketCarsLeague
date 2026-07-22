# Claude Fable prompt: rebuild the Rocket Cars League vehicle for server-authoritative prediction

## How to use this file

Give Claude Fable access to this repository and paste everything from the PROMPT START marker through the PROMPT END marker. Use Fable's highest practical reasoning setting for this long-horizon engineering task. The prompt deliberately asks for repository inspection, small experiments, implementation, and measured verification rather than a speculative one-shot rewrite.

---

# PROMPT START

<role>
You are the principal physics, networking, and Roblox engine engineer for Rocket Cars League. You are working directly in an existing roblox-ts repository. Own this redesign from evidence gathering through implementation and validation.

Be decisive, but do not guess about undocumented Roblox Server Authority behavior. Inspect the code and place data, consult the current official Roblox documentation when an API detail matters, and run a small instrumented experiment when event timing or rollback semantics are ambiguous. Report concise evidence and decisions; do not expose private chain-of-thought.
</role>

<mission>
Rebuild the match vehicle system from the ground up so that it has the best realistically achievable Rocket League-like networking under Roblox Server Authority.

The local driver's controls must act immediately. In uncontested driving, the local rendered car and camera should remain visually continuous and convincing at simulated round-trip latencies up to 300 ms, with jitter and reasonable packet loss. Roblox may restore and resimulate the hidden gameplay object internally, but the visible car must not visibly rewind, split into pieces, shed wheels, or chase old server snapshots.

Preserve the current game's required vehicle capabilities: forward and reverse driving, braking, steering, slopes, suspension, drifting/handbrake behavior, boost and boost resource, jump, airborne pitch/yaw/roll, dodge or flip behavior, recovery, car-to-world and car-to-car interaction, ball contact, goal explosions or blast impulses, damage/gameplay integration, keyboard/gamepad/mobile input, vehicle selection, cosmetics, UI, sound, and camera presentation. Preserve the intended feel where it is good, but do not preserve an unstable implementation merely for source-level parity.

This is not a request for a prettier interpolation function. It is an architectural replacement of the simulated vehicle, its presentation boundary, and the associated validation tools.
</mission>

<definition_of_success>
"Butter smooth at 300 ms" must be treated as a measurable product target, not a claim that latency can be erased.

For the local player's own inputs and uncontested movement, 300 ms RTT should not introduce input waiting, visible rewind, body/wheel separation, persistent camera shake, or rubber-banding. Unpredictable shared events can still require correction: a remote player may hit the ball or car before the local client learns about it. In those cases, place the unavoidable error deliberately, preserve model integrity, correct toward present authoritative truth, and make the correction context-sensitive.

Never conceal a gameplay-critical disagreement indefinitely. The renderer may absorb a correction, but the authoritative/predicted simulation proxy must become correct immediately through Roblox's rollback/resimulation system.
</definition_of_success>

<repository_context>
Inspect the repository before editing. The following is a map and an initial audit, not a substitute for reading the source.

The project is roblox-ts. Important sources include:

- SERVER_AUTHORITY_PLAN.md: the previous migration plan and assumptions.
- BALL_PHYSICS.md: current custom ball design.
- src/shared/simScheduler.ts: shared simulation scheduling.
- src/shared/vehicleSim/VehicleSim.ts: current shared car simulation.
- src/client/initVehicleSim.client.ts and src/server/initVehicleSim.server.ts.
- src/client/vehicleShell.client.ts: invisible physical car plus anchored render-clone presentation.
- src/client/vehicleRenderer.client.ts: local audiovisual effects.
- src/client/VehicleKeyHandler.client.ts and src/server/Modules/vehicleInputActions.ts: Input Action System plumbing.
- src/client/netHealth.client.ts: current diagnostics.
- src/server/Modules/spawnVehicle.ts and src/server/Classes/VehicleClass.ts.
- src/server/Classes/VehicleSubClass: per-vehicle parameters.
- src/shared/ballSim/BallSim.ts and BallConfig.ts.
- src/client/ballRenderer.client.ts and src/server/Modules/ballSpawner.ts.
- src/server/Modules/footballMatch.ts: goals, placement, and goal blast.
- default.project.json, RocketCars.rbxlx, rocketcars_instance_tree.json, and rocketcars_instance_tree_no_maps.json.

Current architecture observed in the repository:

1. VehicleSim is shared between server and client through BindToSimulation. The client simulates its local car. Input Actions are read in the simulation callback, and the root and many descendants are marked with PredictionMode.On locally.

2. The scheduler currently declares 30 Hz. It probes Enum.SimulationFrequency, while the current documented BindToSimulation signature uses Enum.StepFrequency plus an optional priority. Its fallback to the default may happen to run at 30 Hz, but the intended cadence is not expressed robustly. Measure the real cadence and correct the API usage.

3. A vehicle is a complicated multi-assembly physical object. It has a Base plus four physical wheel systems in most models, with six or eight on some models. Each wheel commonly has SpringConstraint, CylindricalConstraint, HingeConstraint, a physical Wheel, and a DisplayWheel. VehicleSim also creates or controls LinearVelocity, VectorForce, AngularVelocity, AlignOrientation, and AlignPosition objects for driving, drift, jump, aerial control, flips, recovery, and showcase locking.

4. Ground checks raycast from the physical wheel assemblies. Steering changes hinge targets. Tire grip changes physical CustomPhysicalProperties. Several behaviors depend on constraint state and on separately simulated wheel parts. This produces a large rollback mismatch surface and creates internal solver state that is difficult for gameplay code to reason about.

5. The current client shell correctly tries to separate simulation and presentation: it hides physical parts and creates anchored, massless, non-colliding visual clones. However, each visual wheel follows the corresponding physical wheel's current relative CFrame. A rollback or temporarily incoherent constraint solution can therefore be copied directly into the visual rig, which explains visible flying or detached wheels.

6. On Misprediction, vehicleShell takes the Predicted minus Authoritative CFrame values from the first divergent historical step and adds that delta to a visual error offset. It then decays position with a local SmoothDamp time of about 0.8 seconds and rotation separately. This is suspect. Misprediction reports historical divergent values, while Roblox has to restore and resimulate to a corrected present. A historical snapshot delta is not necessarily the display error at the corrected present. Accumulating those deltas can overcorrect or stack stale errors.

7. Remote cars are not presented from a timestamped snapshot buffer. They continuously SmoothDamp toward the latest replicated pose. That is a moving-target chase filter, introduces permanent lag, and does not explicitly handle jitter, extrapolation, or remote input prediction.

8. The current camera follows a render-side target, which is the correct boundary in principle, but it inherits the shell's correction behavior and needs an explicit camera policy.

9. A large amount of cross-tick vehicle state lives in root attributes. Server Authority can restore replicated simulation properties and predicted attributes, but attributes have platform limits and ordering constraints. Audit every attribute, which ones actually predict, and the current official limit rather than relying on old comments.

10. Input Action System is already the core input route. Under Roblox Server Authority, IAS input is framed, sent, restored, and replayed with simulation. Do not blindly add a second custom input-sequence replay system on top of Roblox's one. Add custom protocol only where Roblox does not provide the required data, such as carefully designed remote-input forwarding.

11. The character is still seated and welded to the vehicle, then made invisible, massless, and noncolliding. This leaves unnecessary Humanoid, character, weld, occupancy, and predicted-descendant surface area in the match vehicle.

12. Vehicle cosmetics and model parts can affect real assembly mass. Vehicle classes mostly share similar driving values, while visual templates vary substantially. Physics and appearance are not cleanly separated.

13. BallSim is a shared, custom, server-authoritative/predicted simulation at the same 30 Hz. It uses a single noncolliding sphere, world casts, and overlap tests against vehicle Hitboxes.HitboxMain, then writes the ball transform and velocities. It predicts the local car's contact on the client. It appears to choose one deepest car contact per step and does not give the car a reciprocal ball impulse. At current speeds and 30 Hz, continuous relative collision and multi-contact/pinch behavior need careful review.

14. The ball renderer hides the physical ball and smooths a clone based mostly on a distance threshold and SmoothDamp. It lacks the full object/context correction policy required here.

15. Goal handling currently calls ApplyImpulse on each car outside the shared simulation callback. Long-lived movement constraints or speed controllers can fight that impulse. Placement and velocity clearing also have to address multiple wheel assemblies. Goal blast, teleports, respawns, and other discontinuities need explicit simulation events.

16. netHealth has useful ideas, but its Misprediction parser appears inconsistent with the current event shape: Misprediction provides time, an array of entries containing Instance plus Properties/Attributes dictionaries, and stats. Confirm and repair diagnostics as part of this work.

17. The current template catalogue has roughly thirty-one vehicle models. Most have four wheel visuals; a few use six or eight. A successful redesign must dynamically adapt the existing catalogue instead of hand-rebuilding one car and abandoning the content pipeline.

Verify all of these findings against the working tree. If the code has changed, prefer the repository's current truth and note the difference.
</repository_context>

<verified_platform_and_industry_facts>
Use these primary sources as the baseline, and re-check current documentation when implementation depends on an exact signature:

- Roblox Server Authority overview:
  https://create.roblox.com/docs/projects/server-authority

- Roblox Server Authority techniques:
  https://create.roblox.com/docs/projects/server-authority/techniques

- RunService reference, including BindToSimulation, Rollback, and Misprediction:
  https://create.roblox.com/docs/reference/engine/classes/RunService

- The source reference for the precise current Misprediction entry/stat shape:
  https://github.com/Roblox/creator-docs/blob/main/content/en-us/reference/engine/classes/RunService.yaml

- PredictionMode:
  https://create.roblox.com/docs/reference/engine/enums/PredictionMode

- Streaming and replication focus:
  https://create.roblox.com/docs/workspace/streaming

- BasePart and WorldRoot simulation-access operations:
  https://create.roblox.com/docs/reference/engine/classes/BasePart
  https://create.roblox.com/docs/reference/engine/classes/WorldRoot

- Psyonix's Rocket League physics/networking presentation:
  https://media.gdcvault.com/gdc2018/presentations/Cone_Jared_It_Is_Rocket.pdf

- State synchronization and visual error-offset smoothing:
  https://gafferongames.com/post/state_synchronization/

- Timestamped snapshot interpolation:
  https://gafferongames.com/post/snapshot_interpolation/

- Source multiplayer interpolation, extrapolation, prediction, and correction:
  https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking

Important distinctions:

- Roblox Server Authority already predicts the client's simulation, detects a mismatch, restores an authoritative historical state, and resimulates through present inputs. Shared simulation-affecting logic belongs in BindToSimulation. Custom state not represented by rollback-aware simulation properties/attributes must be derivable or explicitly restored using the Rollback hook and a bounded history.

- Misprediction's Predicted and Authoritative values describe the first divergent historical step. The visible target after reconciliation must be the resimulated present proxy, not that past authoritative transform.

- Roblox recommends an invisible simulated object and a massless, noncolliding visual object. Smoothing should be engaged by actual correction/error policy, not used as permanent input-delaying follow lag.

- Prediction/resimulation only works for streamed regions. Important cars, the ball, arena collision, and other dependencies must be kept in an appropriate replication focus and validated under streaming.

- Rocket League uses fixed 120 Hz Bullet physics, buffers inputs by physics frame on the server, predicts the relevant world on clients, stores history, restores authoritative state, and catches up through subsequent frames. It also deliberately simplifies vehicle physics and separates a limited number of physics presets from visual cars. Do not infer that 120 Hz is automatically appropriate for Roblox. First target a stable explicit 60 Hz only if the full server maintains the necessary simulation rate and resimulation budget; otherwise choose and document the best measured cadence.

- The Psyonix presentation supports prediction, frame history, resimulation, server authority, fixed stepping, and deliberately simplified car physics. It does not by itself prove every detail of Rocket League's modern render smoothing. Treat the presentation-proxy architecture as the correct cross-industry and Roblox-recommended solution, not as an unsupported claim about proprietary implementation.
</verified_platform_and_industry_facts>

<mandatory_architecture_decision>
Replace the constraint-driven multi-assembly match car with a compact ray-contact vehicle controller built around one stable dynamic rigid assembly.

Do not make the production match car an anchored model that is CFramed forward every tick. It still needs credible world/car collision, impulses, and Server Authority integration. The recommended proxy is:

- One unanchored, server-owned VehicleRoot as the authoritative and locally predicted rigid body.
- If a compound collision shape is genuinely required, use the smallest possible set of invisible parts welded into one rigid assembly. No separately simulated wheels.
- No SpringConstraint, CylindricalConstraint, steering HingeConstraint, physical wheel friction mutation, VehicleSeat weld, Humanoid assembly, cosmetic body mass, or display geometry in the predicted physics object.
- Fixed physics presets independent of cosmetic model: collision dimensions/offset, center of mass policy, four canonical suspension/contact hardpoints, wheelbase, track width, wheel radius, and tuned handling values.
- Four canonical physics contacts are the default even when a visual truck has six or eight wheels. Extra visual axles can derive compression/steer/spin from the nearest/interpolated canonical contacts unless testing proves that extra physical contact rays materially improve the game. This follows the "few physics presets, many visual bodies" approach. Make the mapping explicit and data-driven.
- A wholly separate client render rig, built from the selected existing vehicle template or an extracted render asset. It is anchored, massless, noncolliding, nonquerying, and never marked as a predicted gameplay object.
- Rendered wheels are mathematical children of the rendered chassis. Their poses come from wheel hardpoints, steering angle, integrated visual spin, and simulated ray-contact compression. They must never copy physical wheel-part CFrames, because physical wheel assemblies no longer exist.

This design is less visually literal than a constraint car but far more controllable, replayable, tunable, and robust under rollback. If experiments justify a different choice, document objective evidence and preserve the same single-assembly/presentation boundaries.
</mandatory_architecture_decision>

<simulation_model_requirements>
Build the new movement as an explicit, shared, fixed-step state machine that runs on server and predicting clients inside one correctly configured BindToSimulation schedule.

State should be compact and intentional. At minimum account for:

- Root position/orientation and linear/angular velocity through rollback-aware BasePart properties.
- Current grounded/contact summary where it cannot simply be recomputed.
- Steering state only if steering is deliberately rate-limited.
- Boost amount and pad/pickup generation.
- Jump eligibility, held-time thrust, release, and cooldown.
- Airborne/dodge/flip phase, direction, timer, and consumed state.
- Drift/handbrake phase where hysteresis is necessary.
- Recovery or upright-assist phase.
- External impulse/event state for goal blasts, collisions, scripted launches, and damage reactions.
- Teleport/respawn generation.
- Any deterministic visual state that cannot be derived, although visual-only state should normally stay outside authoritative simulation.

Prefer deriving a value from current rollback-aware physics state and current input over storing another attribute. For example, suspension damping can use contact-point velocity projected onto the contact normal rather than depending on untracked previous compression. Enumerate every predicted attribute, its writer, its type, its rollback need, and its lifetime. Stay safely below current Roblox limits and add an automated schema assertion.

Do not let server Heartbeat and client rendering mutate gameplay state. Queue external authoritative events and consume them deterministically in BindToSimulation at a named simulation step. Define event ordering relative to vehicle integration and BallSim.

Use the same constants, fixed dt, cast geometry, collision filters, presets, and state transitions on both peers. Avoid os.clock, task.delay, wall-clock animation state, unordered iteration, random values without a replicated seed, and non-simulation side effects inside replayable code.

Use an explicit StepFrequency and priority with a single scheduler. Benchmark 30 and 60 Hz in a representative multiplayer scene. Prefer 60 Hz if and only if the server simulation heartbeat remains at least 59 FPS with correction/resimulation load and device/client constraints remain acceptable. Do not pursue 120 Hz merely because Rocket League does.
</simulation_model_requirements>

<ray_contact_vehicle_requirements>
Implement suspension and tire response through world queries and forces/impulses applied to VehicleRoot, not physical wheels.

For each canonical contact:

1. Transform its local hardpoint into world space.
2. Raycast or shape-cast down the suspension axis through rest length plus wheel radius, against a stable, explicit include/exclude policy.
3. Determine contact point, normal, suspension length, compression, and a robust contact frame.
4. Obtain point velocity with GetVelocityAtPosition.
5. Compute spring and damper response. Clamp separating forces and extreme values; make units and dt dependence explicit.
6. Apply suspension impulse at a deliberately chosen point so pitch/roll response is stable.
7. Decompose point velocity into steered forward and lateral axes projected onto the contact plane.
8. Compute longitudinal drive/brake and lateral tire response using bounded curves based on slip speed/ratio/angle. Use a friction budget or friction circle so combined braking/turning force cannot grow without bound.
9. Apply the contact impulse through ApplyImpulseAtPosition, or another documented simulation-access operation justified by testing.
10. Pair left/right contacts for controlled anti-roll if needed.

Guard all casts against missing streamed geometry, steep/degenerate normals, initial penetration, curb edges, ray discontinuity, and airborne transitions. Decide how short suspension loss is filtered without creating hidden nondeterministic state.

Stability is more important than simulating a production drivetrain. Use explicit acceleration/speed curves, steering reduction at speed, braking, reverse rules, lateral grip, and controlled yaw. Keep effective physics mass/preset constant across cosmetics. Apply forces near a tuned center-of-mass height if that produces the desired stable Rocket League-like handling.

Ground drive, drift, and air control must not fight one another. Use an explicit mode/blend policy:

- Grounded normal grip.
- Braking/reversing.
- Handbrake/drift with reduced lateral grip, yaw authority, and regrip hysteresis.
- Launch/short coyote transition.
- Airborne boost.
- Airborne pitch/yaw/roll.
- Jump hold/release.
- Dodge/flip impulse and rotation.
- Recovery/upright assist.
- Scripted/external impulse.

Goal blast and collision impulses must survive the drive controller. Do not immediately clamp them away as excess velocity or have an alignment/velocity controller cancel them. Represent external velocity/impulse response deliberately and define when normal control regains authority.
</ray_contact_vehicle_requirements>

<input_and_prediction_requirements>
Keep Roblox Input Action System for the local driver's core controls so that input participates in Server Authority replay.

Map keyboard, gamepad, and touch into one fixed-step input sample with throttle, steer, brake/reverse intent, handbrake, jump, boost, pitch, yaw, and roll as required. Edge-triggered actions must be replay-safe. Remove duplicate watchdog/state paths once the replacement is proven, but preserve a robust response to focus loss and disabled contexts.

Do not wait for the server before applying local input. The predicted local proxy responds in the next simulation tick, and steering animation, engine audio, boost presentation, and camera intent respond immediately from the local predicted/input state.

Roblox handles local IAS history and resimulation. Do not create a conflicting manual restore-and-replay loop. If remote vehicles need better prediction, design a separate compact remote-input-forwarding scheme, as Roblox's racing guidance suggests:

- Server validates and reflects a low-rate/current remote input state or simulation-framed changes through rollback-aware data.
- Clients predict relevant nearby remote proxies only when the data is streamed and useful.
- Stale input has a bounded expiry/fallback.
- This must not allow remote clients to authoritatively move another vehicle.

Define a clear policy for which objects each client predicts: its own car always, the match ball when relevant and streamed, nearby remote cars if the chosen remote-input experiment is successful, and never arbitrary distant content.
</input_and_prediction_requirements>

<rollback_and_reconciliation_requirements>
First instrument the exact local engine event order in the current Roblox version:

- BindToSimulation calls before and during normal prediction.
- RunService.Rollback, documented as firing after state restore and before resimulation.
- RunService.Misprediction and its first-divergent-step entries/stats.
- PostSimulation/PreRender or the actual render update where the corrected present proxy can be observed.

Record a small timeline with simulation frame/time, root CFrame/velocities, and event identity under forced latency and a known correction. Use this to choose the continuity-capture point. Do not build the renderer around an assumed Misprediction timing.

The presentation rule is:

authoritative past + Roblox's replayed IAS inputs = corrected present simulation proxy

The visible car converges to that corrected present proxy. It never interpolates to the old authoritative snapshot.

When the corrected current proxy changes discontinuously, preserve the visible transform by recomputing a persistent render error offset. In transform notation, if S is the corrected current simulation transform and V is the transform that was visible just before the correction, choose an offset E such that composing S and E still displays V. Then decay E to identity. Use one consistent local/world convention and test it under simultaneous translation and rotation.

Do not repeatedly lerp the render object toward a moving target. Do not start/restart long tweens. Do not add historical Predicted-minus-Authoritative deltas from successive Misprediction entries. A new correction recomputes the offset from the current visible pose and the corrected present proxy, preserving C0 positional/orientational continuity while allowing its decay rate to change.

Custom gameplay state outside rollback-aware properties/attributes must either:

- Be derivable from restored state and current input.
- Be stored as a bounded, simulation-frame-keyed history and restored in RunService.Rollback.
- Be moved into a supported predicted property/attribute with clear ownership.

Do not roll back sound instances, particle emitters, camera objects, UI, cosmetic animation objects, or the render rig. Drive them from current predicted state with idempotent event generation and explicit handling of speculative effects that were rejected.
</rollback_and_reconciliation_requirements>

<intelligent_local_render_correction>
Implement correction as an object- and context-aware policy over a persistent error offset.

Position and orientation must be handled independently but coherently:

- Position: exponential half-life or a critically damped state with persistent correction velocity. The mathematical behavior must be stable across render frame rates.
- Orientation: quaternion/CFrame rotational error with shortest-path interpolation, quaternion log/exp, or another robust method. Do not interpolate Euler angles.
- Optionally account for velocity mismatch when it materially improves derivative continuity, but never make the render rig become a second gameplay simulation.

The policy must consider:

- Local car versus remote car versus ball.
- Position error normalized by vehicle length.
- Rotation error and angular velocity.
- Error direction relative to current motion and camera.
- Vehicle speed; a small forward error at high speed is less visible than the same sideways error while stopped.
- Grounded, airborne, landing, drifting, flipping, and collision states.
- Whether correction would visually penetrate floor, wall, another car, or goal geometry.
- Whether a goal/ball event requires rapid truth.
- A teleport/respawn generation, which snaps intentionally.
- A maximum allowed visual-to-simulation divergence and maximum correction duration.

Use dead zones and hysteresis so numerical noise does not engage smoothing every frame. Use severity bands whose thresholds are scaled and tuned from telemetry, not blindly copied constants:

- Noise: ignore.
- Small: short, subtle decay.
- Medium: bounded adaptive decay.
- Large but recoverable: much faster correction, possibly favoring the direction least visible to the camera.
- Catastrophic/invalid/teleport/penetrating: snap or perform a very short collision-safe recovery.

The present 0.8-second local SmoothDamp is too long as a general policy. A correction must not leave the visible car materially detached from collision truth for seconds. Start with short half-lives measured in tens to low hundreds of milliseconds and tune from screen-space/perceptual data.

The render chassis and every rendered wheel always form one coherent hierarchy. Suspension travel may animate relative to the render chassis, but clamp it to the valid range and derive it from the current predicted contact state. If contact data becomes invalid during correction, prefer a visually plausible neutral suspension pose over exposing broken physics.

Build debug overlays that can show simulation proxy, visual chassis, contact rays, contact normals, error offset, correction severity, and camera anchor simultaneously.
</intelligent_local_render_correction>

<remote_vehicle_presentation>
Do not use unconditional SmoothDamp toward the latest network position.

For remote vehicles that are not actively predicted, maintain a simulation-timestamped snapshot buffer. Render between two known snapshots at a jitter-adaptive delay. Use velocities for Hermite-style positional interpolation where it improves continuity and slerp orientation. Allow only short, bounded extrapolation when packets are missing, then hold or transition to a recovery policy.

For remote vehicles involved in likely near-future car/car or car/ball contact, evaluate forwarding their input state and predicting their hidden proxy. Measure whether it improves contact accuracy under Roblox Server Authority. The rendered remote policy and collision-time proxy policy must be explicitly distinguished; do not silently collide the local present against a remote car rendered far in the past without documenting the temporal tradeoff.

Remote cosmetic rigs use the same coherent generated hierarchy as the local car. They never expose separately replicated wheel assemblies.
</remote_vehicle_presentation>

<camera_and_immediate_feedback>
The camera follows the rendered vehicle, never the rollbacked simulation proxy.

Create dedicated camera position and orientation anchors. Stabilize them separately:

- Preserve immediate player look/camera intent.
- Preserve immediate steering, boost FOV, engine pitch, skid/boost effects, and control feedback.
- Filter only world-space correction and unwanted high-frequency suspension/solver motion.
- Consider yaw-dominant ground following and a stable horizon during short correction events.
- Avoid double-smoothing the same correction once in the car and again with a long camera lag.
- Define special behavior for flips, landings, demolitions, goals, respawns, and spectating.

Camera telemetry should be able to attribute a visible jerk to simulation correction, render correction, or camera filtering.
</camera_and_immediate_feedback>

<ball_and_shared_collision_requirements>
Treat the ball as a first-class shared predicted object, not a visual afterthought.

Preserve the useful current design: one compact ball state, server authority, client prediction of free flight, and speculative local-car contact. Re-audit and improve:

- Free-flight integration and angular state.
- Continuous relative collision detection between a fast ball and moving vehicle hitbox, not only a current-frame overlap.
- World sweep/penetration recovery at the selected simulation rate.
- Deterministic tie-breaking.
- Multiple simultaneous contacts and pinches.
- Restitution/friction/spin transfer.
- Whether the car should receive a reciprocal impulse and how that interacts with local prediction.
- Goal-plane truth and correction priority.
- Ball hit attribution without model-name ambiguity.
- Streaming availability of ball, arena, and nearby cars.

The new vehicle physics preset owns one simple car-ball collision box or other analytically testable shape, independent of the visual body. Its transform is derived from VehicleRoot. Confirm that every spawned vehicle actually exposes the hitbox contract BallSim reads; add spawn-time validation.

Ball rendering uses the same corrected-present continuity principle but a different severity policy. Free-flight corrections may be smoothed subtly. Near a contact, save, goal line, or scored goal, truth is more important and correction must be faster. Avoid a threshold that causes all errors below it to snap and all errors above it to lag.

Server remains the final authority on ball contacts and goals. Speculative local hits can feel immediate, but rejected hits must reconcile without corrupting car state, score, camera, or effects.
</ball_and_shared_collision_requirements>

<dynamic_vehicle_and_content_pipeline>
Reuse the existing vehicle catalogue as render content while severing it from physics.

Create a validated vehicle-definition layer with:

- Cosmetic/template identifier.
- Physics preset identifier.
- Render-body source and local pivot.
- Visual wheel entries: local hardpoint, radius, axle, steering behavior, spin axis, side, and mapping to a canonical physics contact.
- Effect attachments for boost, trails, lights, audio, damage, and health UI.
- Paint/material/cosmetic data.
- Gameplay statistics that are genuinely intended to vary.

At match spawn:

- Server creates the minimal VehicleRoot simulation proxy, query hitbox contract, replicated identity/preset metadata, and gameplay wrapper.
- Client creates the anchored, nonphysical visual rig from the metadata and local assets.
- The render rig contains no gameplay constraints, seats, collision, mass, or predicted instances.
- Menu/garage display vehicles can use a separate display path and need not instantiate a match proxy.

Provide an automated validator/migration report for every existing template, including four-, six-, and eight-wheel appearances. Do not silently guess missing pivots or axes. Supply a small explicit override manifest for exceptional models.

Keep compatibility adapters for VehicleClass/economy/selection only as a migration boundary. Cosmetics must never change physics mass. Once the new path passes gates, delete or quarantine obsolete physical-wheel and constraint setup so two vehicle systems cannot accidentally run at once.
</dynamic_vehicle_and_content_pipeline>

<gameplay_integration>
Preserve and deliberately reconnect:

- Player spawn/despawn and match ownership.
- Vehicle selection and per-class intended stats.
- Health, damage queries, destruction, and attribution.
- Boost meter, boost pads/pickups, and server validation.
- Team/paint/cosmetics.
- Horns, engine/boost/drift/jump sounds and effects.
- Goal scoring, goal presentation, launch impulse, reset, kickoff, and camera.
- Control locking during menus, countdowns, goals, and round transitions.
- Mobile, keyboard, and gamepad controls.
- Garage/menu vehicle display.

Replace the VehicleSeat/Humanoid weld dependency in match simulation with an explicit player-to-vehicle association unless a documented Roblox requirement makes that impossible. The avatar can be hidden/presented independently; it must not join the predicted car assembly.

Make goal blast, respawn, teleport, pad pickup, and scripted impulses frame-addressable simulation events. Teleport/respawn changes the generation and intentionally clears visual error. Goal blast is not a teleport: it produces visible, predicted/authoritative motion and must not be suppressed by normal speed control.
</gameplay_integration>

<security_and_authority>
The server remains authoritative for motion, boost resource, jump/flip eligibility, damage, ball contacts, score, respawn, and external impulses.

Server Authority is not a reason to omit gameplay validation. Validate impossible input combinations/rates, preset identity, boost spending, event eligibility, and streamed/spawned object contracts. Never accept client-supplied transforms, velocities, hit results, damage, or score.

Keep local prediction deterministic enough for comfort, while accepting that the server decides conflicts. Log exploit-relevant disagreement separately from benign network/physics divergence.
</security_and_authority>

<telemetry_and_debugging>
Replace "looks jittery" with measurements.

Correctly parse Misprediction(time, instances, stats). For each affected vehicle/ball, collect:

- First divergent simulation time/frame.
- Property or attribute name.
- Predicted and authoritative position/orientation/linear/angular velocity error where applicable.
- Resimulation time and estimated rollback depth.
- Current ping, jitter/loss test profile, input acceptance, client/server step delta, server simulation heartbeat, and predicted-instance count.
- Contact state, movement mode, collision/goal/teleport context.
- Corrected-present proxy delta.
- Render error offset at capture, peak, half-life, time to settle, snap reason, and maximum screen-space displacement.
- Camera-anchor displacement.
- Streaming readiness and missing cast dependencies.

Use Roblox's Server Authority visualizer metrics as part of the test process. Alert if server simulation falls below 59 FPS for a 60 Hz target, input is dropped, step deltas grow, predicted count is excessive, or resimulation time exceeds budget.

Provide repeatable debug commands or a test harness for artificial RTT, asymmetric latency if possible, jitter, loss, reorder where the platform supports it, client render FPS, and server load. Keep telemetry cheap or disabled in production.
</telemetry_and_debugging>

<validation_and_acceptance_gates>
Do not declare success from a smooth local Studio run.

First capture a behavioral baseline of the current vehicle on a small course: acceleration, top speed, reverse, stop distance, steady turn radius at multiple speeds, drift initiation/sustain/regrip, slope hold, ramp launch, jump height/hold curve, aerial angular response, boost acceleration/consumption, dodge/flip trajectory, landing recovery, collision response, and goal blast. Preserve the desired envelope rather than every current number.

Add focused automated or deterministic tests where practical:

- Fixed-step and dt invariance.
- Vehicle-definition/template validation.
- Ray/contact frame construction.
- Spring/damper bounds.
- Tire force/friction-budget bounds.
- Ground/air/drift/jump/flip state transitions.
- External impulse not being cancelled.
- Transform error-offset composition under translation plus rotation.
- Frame-rate-invariant error decay.
- Teleport generation clearing correction.
- Ball continuous sweep and deterministic collision ordering.
- Attribute/state schema limits.

Progress through this scenario ladder. Do not skip directly to a crowded match:

1. One car, flat static ground.
2. Slopes, ramps, curbs, walls, and landing.
3. One car under forced corrections.
4. One remote car with no contact.
5. Car-to-car contact.
6. Ball free flight.
7. Local car-to-ball contact.
8. Remote car-to-ball contact.
9. Pinch/simultaneous contacts.
10. Goal, blast, reset, kickoff.
11. Full lobby and streaming boundaries.

Run network profiles at minimum:

- 0, 50, 100, 150, 200, and 300 ms RTT.
- Stable latency and jittered latency.
- Representative packet loss.
- 30, 60, and high-refresh client rendering where available.
- A representative low-end/mobile client.
- Full expected server player/vehicle count.

Required outcome gates:

- Local input is applied by the next simulation tick and never waits one RTT.
- No rendered body/wheel separation is possible by construction.
- No constraint/wheel assembly can fling independently because none participates in match physics.
- Uncontested local driving at 300 ms has no visible historical rewind and stays within defined render/camera correction metrics.
- Corrections always converge to corrected present simulation truth within a bounded time.
- No permanent local render-follow delay when there is no correction.
- Teleports/respawns snap intentionally and atomically.
- Goal blast reliably launches the single proxy and is visible locally.
- Ball contact remains authoritative and usable under tested latency; corrections near goals favor truth.
- Different cosmetics on the same preset have identical physics.
- Client FPS does not change gameplay trajectory beyond a documented tolerance.
- Server simulation sustains the selected fixed rate under full load, including resimulation.
- Misprediction telemetry names the actual properties/attributes and contexts rather than reporting unknown entries.
- The old and new movement systems cannot both apply forces to the same vehicle.

Choose concrete numeric budgets during the prototype from vehicle dimensions, speed, camera distance, screen-space measurements, and user testing. Put them in one acceptance document/config, not scattered magic constants. Suggested dimensions to budget include maximum local visual divergence in vehicle lengths, peak screen pixels, camera jerk, correction settle time by severity, server frame time, and p95 resimulation cost.
</validation_and_acceptance_gates>

<implementation_strategy>
Work in vertical, reversible milestones behind a clearly named development switch only while both systems must coexist:

Phase 0: Audit and prove platform semantics

- Re-read all relevant source.
- Record current Workspace Server Authority/fixed simulation/streaming settings from the actual place or runtime, not just default.project.json.
- Verify StepFrequency, Misprediction entry shape, Rollback timing, attribute limits, simulation-access operations, and prediction/streaming behavior.
- Repair or build instrumentation first.
- Produce a short architecture decision record and acceptance metric file.

Phase 1: Isolated single-proxy prototype

- Create VehicleRoot, one physics preset, four ray contacts, basic acceleration/brake/steer/suspension, and stable collision.
- Run it through shared BindToSimulation at the selected explicit cadence.
- Prove fixed-step behavior and server/client prediction before adding every feature.

Phase 2: Complete local vehicle and render boundary

- Add drift, boost, jump, aerial control, flip/dodge, recovery, slopes, external impulses.
- Build the coherent visual rig and wheel animation.
- Implement corrected-present error-offset smoothing and camera anchors.
- Pass the single-car latency ladder.

Phase 3: Shared interactions

- Reconnect/improve ball simulation and ball rendering.
- Add remote snapshot interpolation and test remote input prediction.
- Pass car-car, car-ball, pinch, goal, and reset gates.

Phase 4: Content and gameplay migration

- Build/validate definitions for all current vehicle templates.
- Reconnect damage, UI, effects, economy, selection, and match lifecycle.
- Remove VehicleSeat/character assembly and cosmetic mass from match physics.

Phase 5: Load, tune, and remove legacy path

- Full-lobby performance and streaming tests.
- Tune physics and correction thresholds from telemetry.
- Delete/quarantine legacy constraints, physical wheels, duplicate smoothers, and obsolete state only after parity gates pass.
- Update SERVER_AUTHORITY_PLAN.md and BALL_PHYSICS.md to describe the shipped architecture.

At each phase, run the smallest relevant build/tests and inspect failures. Do not create a broad unverified rewrite and leave the repository half-migrated. Keep a concise progress ledger in a repository document so another session can resume safely.
</implementation_strategy>

<engineering_constraints>
- Use roblox-ts and the repository's established conventions unless a local convention is itself part of the defect.
- Preserve unrelated user changes and avoid destructive git operations.
- Prefer pure functions for tire/contact/state math so they can be tested independently.
- Keep simulation, presentation, camera, effects, content definitions, and diagnostics as separate modules with one-way dependencies.
- Avoid per-tick allocations, unbounded histories, broad descendant scans, and unnecessary predicted instances.
- Use stable iteration order for contacts and vehicles.
- Add comments for Roblox rollback constraints and non-obvious transform math, not narration of obvious code.
- Do not retain obsolete components merely because deleting them is uncomfortable once migration gates prove they are unused.
- Do not tune smoothing to hide a continuously divergent simulation. Find and correct systematic prediction mismatch first.
- Do not promise that 300 ms makes unknown remote collisions equivalent to 20 ms. Make own-car response and rendering excellent and make unavoidable shared corrections honest, bounded, and coherent.
</engineering_constraints>

<required_deliverables>
Complete the implementation, not just a design essay. Leave:

1. A repository-grounded architecture decision record showing current defects, verified Roblox behavior, selected proxy/preset/state model, and rejected alternatives.
2. The new single-assembly ray-contact vehicle simulation shared by server and predicting clients.
3. Dynamic visual-rig generation for all supported vehicle templates, with no physical display wheels.
4. Corrected-present local render reconciliation and context-sensitive smoothing.
5. Remote snapshot buffering/interpolation plus the measured decision on remote input prediction.
6. Updated ball interaction/presentation sufficient for the acceptance ladder.
7. Camera and immediate-feedback integration.
8. Updated spawn, match, goal blast, reset, UI/effects, damage, selection, and cosmetics integration.
9. Correct Misprediction/rollback/network telemetry and repeatable latency test instructions.
10. Tests, template validation, benchmark results, and an acceptance report with numeric results at each latency profile.
11. Removal or hard isolation of the old constraint-driven match path after the new path passes.
12. Updated documentation explaining how future developers add a visual car, add a physics preset, tune handling, and diagnose a correction.
</required_deliverables>

<working_method>
Begin by inspecting the repository and quoting short, relevant code facts into an audit table with file and line references. Then verify the platform assumptions that can change. Make an explicit design/state/preset schema and an acceptance matrix before invasive edits.

After that, implement milestone by milestone and keep working until the requested system and gates are complete. Use tools to inspect, edit, build, and test. Do not stop after proposing code or saying what should be done. If a Roblox engine behavior cannot be validated in the current environment, build the smallest runtime diagnostic needed, document the exact manual Studio step, and continue every other unblocked part.

At the end, give a compact handoff: architecture shipped, files changed, tests and network profiles run, measured results, remaining engine/manual checks, and any honest limitations.
</working_method>

<task>
Now inspect this repository, validate the audit above, and rebuild the vehicle/networking system according to this specification. Optimize for one outcome: a locally controlled car that is immediately responsive and visually coherent under Roblox Server Authority, while retaining server truth and robust shared car/ball gameplay.
</task>

# PROMPT END
