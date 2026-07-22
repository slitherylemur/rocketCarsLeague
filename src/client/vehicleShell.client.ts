// Client-rendered vehicle shell — the "position smoothing" server-authority
// technique (render a different object than what is being simulated), applied
// to every car in Workspace.Vehicles.
//
// The physical (simulated/predicted) car keeps doing ALL the physics; this
// script hides its visible geometry locally (LocalTransparencyModifier — a
// client-only property that never replicates and never touches the sim) and
// renders anchored, massless, collision-free clones of the body and wheels:
//
//   LOCAL CAR   — rendered EXACTLY at the simulated pose: zero added latency,
//                 the whole point of prediction is preserved. Only when the
//                 physical pose JUMPS farther than its velocity can explain
//                 (a rollback correction landing) is the previous visual pose
//                 captured as an error offset, which then decays to zero with
//                 SmoothDamp — the correction becomes a glide instead of a
//                 snap. Position never teleports in legitimate physics (even
//                 a wall impact only flips velocity), so the jump detector
//                 cannot mistake ordinary collisions for corrections.
//   REMOTE CARS — PredictionMode.Off by design, so their replicated motion
//                 arrives steppy. The shell continuously SmoothDamps toward
//                 the authoritative pose: smooth believable motion at the
//                 cost of a few tens of ms of display delay they already had.
//
//   TELEPORTS   — the sim bumps the TeleportGen attribute on intentional
//                 relocations (kickoff placement, podium poses, respawns);
//                 the shell SNAPS immediately instead of smearing a
//                 map-scale "correction" across the pitch. A >TELEPORT_SNAP
//                 jump snaps too (belt-and-braces for unmarked paths).
//
// Wheels: every visible part's pose is copied RELATIVE TO THE CHASSIS each
// render frame and re-expressed on the rendered chassis, so steering angle,
// suspension travel and wheel spin all carry over with the single correction
// transform applied on top.
//
// Camera: while the local player is driving, CameraSubject is pointed at an
// invisible CameraTarget part pinned to the RENDERED chassis — otherwise the
// camera would follow the physical car and reveal every correction the shell
// just hid. Restored to the humanoid when the drive ends (and never touched
// while something else — spectate, menu — owns the subject).
//
// Known limits (accepted for this stage): particle/trail/sound effects stay
// on the physical parts (their positions match the shell except during the
// brief corrections), and a mid-drive repaint that swaps Texture children is
// mirrored only at the Color/Material/Transparency property level.

import { VehicleAttr, VehicleModelAttr } from "shared/vehicleSim/VehicleSim";

const RunService = game.GetService("RunService");
const TweenService = game.GetService("TweenService");
const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;

// Correction smoothing (local car): time constant of the error-offset decay.
const LOCAL_SMOOTH_TIME = 0.14;
const LOCAL_ROT_TAU = 0.1;
// Remote interpolation: short enough to stay honest, long enough to bridge
// ~2 replication intervals.
const REMOTE_SMOOTH_TIME = 0.09;
const REMOTE_ROT_TAU = 0.07;
// Any single-frame jump beyond this snaps outright (unmarked teleport).
const TELEPORT_SNAP = 60;
// Jump detector slack: legitimate per-frame travel is |v|·dt; corrections
// land on top of that. The constant floor absorbs suspension jitter.
const JUMP_SLACK = 1.25;
const JUMP_VELOCITY_FACTOR = 2.5;

const IDENTITY = new CFrame();

interface RenderPair {
	render: BasePart;
	source: BasePart;
	connections: RBXScriptConnection[];
}

interface Shell {
	model: Model;
	base: BasePart;
	isLocal: boolean;
	container: Model;
	// Sub-model holding ONLY the visible render parts: the TeamHighlight is
	// re-adorned here (not the container) so the invisible CameraTarget part
	// never gets an outline drawn around it.
	geometry: Model;
	// The server's TeamHighlight, locally re-pointed at the shell geometry —
	// the physical car it adorns is hidden on this client, and an outline
	// following the physical car would split from the shell during
	// corrections. Client-side Adornee writes don't replicate.
	highlight?: Highlight;
	cameraTarget: BasePart;
	pairs: RenderPair[];
	sourceSet: Set<BasePart>;
	connections: RBXScriptConnection[];
	lastTeleportGen: number;
	// local-car correction offset (world-space position + rotation-only CFrame)
	posOffset: Vector3;
	posOffsetVel: Vector3;
	rotOffset: CFrame;
	prevBasePos: Vector3;
	prevBaseVel: Vector3;
	// remote interpolation state
	smoothPos: Vector3;
	smoothPosVel: Vector3;
	smoothRot: CFrame;
	initialized: boolean;
}

const shells = new Map<Model, Shell>();
let cameraSubjectOwned = false; // we only restore a subject we set ourselves

function attrNumber(instance: Instance, name: string, fallback: number): number {
	const value = instance.GetAttribute(name);
	return typeIs(value, "number") ? value : fallback;
}

// Appearance-only children worth carrying into the shell clone.
function isAppearanceChild(instance: Instance): boolean {
	return (
		instance.IsA("Decal") ||
		instance.IsA("Texture") ||
		instance.IsA("DataModelMesh") ||
		instance.IsA("SurfaceAppearance") ||
		instance.IsA("WrapLayer") ||
		instance.IsA("WrapTarget")
	);
}

function shouldRender(part: BasePart): boolean {
	// Invisible parts (physics wheels, hitboxes, the Base slab, effect
	// anchors) have nothing to show — skip them and let LTM hiding no-op.
	return part.Transparency < 0.99;
}

function buildRenderPart(shell: Shell, source: BasePart) {
	if (shell.sourceSet.has(source) || !shouldRender(source)) {
		return;
	}
	shell.sourceSet.add(source);

	const render = new Instance("Part");
	render.Name = source.Name;
	render.Size = source.Size;
	render.Color = source.Color;
	render.Material = source.Material;
	render.MaterialVariant = source.MaterialVariant;
	render.Transparency = source.Transparency;
	render.Reflectance = source.Reflectance;
	render.CastShadow = source.CastShadow;
	render.Anchored = true;
	render.CanCollide = false;
	render.CanQuery = false;
	render.CanTouch = false;
	render.Massless = true;
	render.CFrame = source.CFrame;
	if (source.IsA("Part")) {
		render.Shape = source.Shape;
	}
	// MeshParts can't be created from Lua with their mesh — clone those whole
	// and strip the non-appearance children instead.
	let finalRender: BasePart = render;
	if (source.IsA("MeshPart") || source.IsA("UnionOperation")) {
		render.Destroy();
		const cloned = source.Clone();
		for (const child of cloned.GetChildren()) {
			if (!isAppearanceChild(child)) {
				child.Destroy();
			}
		}
		cloned.Anchored = true;
		cloned.CanCollide = false;
		cloned.CanQuery = false;
		cloned.CanTouch = false;
		cloned.Massless = true;
		finalRender = cloned;
	} else {
		for (const child of source.GetChildren()) {
			if (isAppearanceChild(child)) {
				child.Clone().Parent = render;
			}
		}
	}
	finalRender.Parent = shell.geometry;

	const pair: RenderPair = { render: finalRender, source, connections: [] };
	// Mirror live appearance edits (paint recolors, damage smoke darkening…).
	for (const property of ["Color", "Material", "Transparency"] as const) {
		pair.connections.push(
			source.GetPropertyChangedSignal(property).Connect(() => {
				if (property === "Color") {
					finalRender.Color = source.Color;
				} else if (property === "Material") {
					finalRender.Material = source.Material;
				} else {
					finalRender.Transparency = source.Transparency;
					source.LocalTransparencyModifier = 1; // keep the original hidden
				}
			}),
		);
	}
	shell.pairs.push(pair);

	// Hide the original locally; the physical part keeps simulating.
	source.LocalTransparencyModifier = 1;
}

function destroyShell(model: Model) {
	const shell = shells.get(model);
	if (!shell) {
		return;
	}
	shells.delete(model);
	for (const connection of shell.connections) {
		connection.Disconnect();
	}
	for (const pair of shell.pairs) {
		for (const connection of pair.connections) {
			connection.Disconnect();
		}
		pcall(() => {
			if (pair.source.Parent !== undefined) {
				pair.source.LocalTransparencyModifier = 0;
			}
		});
	}
	// Give the highlight back to the physical model before the shell (its
	// current adornee) is destroyed — the model may outlive this shell.
	if (shell.highlight !== undefined) {
		pcall(() => {
			if (shell.highlight!.Parent !== undefined) {
				shell.highlight!.Adornee = shell.model;
			}
		});
	}
	shell.container.Destroy();
	releaseCameraSubject();
}

function trackVehicle(model: Instance) {
	if (!model.IsA("Model")) {
		return;
	}
	task.spawn(() => {
		// Streaming: wait for the chassis, then build from whatever visible
		// geometry exists; DescendantAdded catches the rest as it arrives.
		const base = model.WaitForChild("Base", 20) as BasePart | undefined;
		if (!base || !base.IsA("BasePart") || model.Parent === undefined || shells.has(model)) {
			return;
		}

		const container = new Instance("Model");
		container.Name = `${model.Name}Shell`;

		const geometry = new Instance("Model");
		geometry.Name = "Geometry";
		geometry.Parent = container;

		const cameraTarget = new Instance("Part");
		cameraTarget.Name = "CameraTarget";
		cameraTarget.Size = new Vector3(1, 1, 1);
		cameraTarget.Transparency = 1;
		cameraTarget.Anchored = true;
		cameraTarget.CanCollide = false;
		cameraTarget.CanQuery = false;
		cameraTarget.CanTouch = false;
		cameraTarget.CFrame = base.CFrame;
		cameraTarget.Parent = container;

		const shell: Shell = {
			model,
			base,
			isLocal: model.GetAttribute(VehicleModelAttr.OwnerUserId) === LocalPlayer.UserId,
			container,
			geometry,
			cameraTarget,
			pairs: [],
			sourceSet: new Set(),
			connections: [],
			lastTeleportGen: attrNumber(base, VehicleAttr.TeleportGen, 0),
			posOffset: new Vector3(),
			posOffsetVel: new Vector3(),
			rotOffset: IDENTITY,
			prevBasePos: base.Position,
			prevBaseVel: new Vector3(),
			smoothPos: base.Position,
			smoothPosVel: new Vector3(),
			smoothRot: base.CFrame.Rotation,
			initialized: false,
		};

		// Ownership can replicate late — re-check when the attribute lands.
		shell.connections.push(
			model.GetAttributeChangedSignal(VehicleModelAttr.OwnerUserId).Connect(() => {
				shell.isLocal = model.GetAttribute(VehicleModelAttr.OwnerUserId) === LocalPlayer.UserId;
			}),
		);

		for (const descendant of model.GetDescendants()) {
			if (descendant.IsA("BasePart")) {
				buildRenderPart(shell, descendant);
			}
		}

		// Team-color highlight: the server adorns TeamHighlight to the vehicle
		// model, which is hidden on this client — re-point it (locally) at the
		// shell geometry so the red/blue outline hugs the car everyone SEES.
		// The server only ever writes OutlineColor after creation (side
		// changes), so the local Adornee write is never fought.
		const adoptHighlight = (child: Instance) => {
			if (child.Name === "TeamHighlight" && child.IsA("Highlight") && shells.get(model) === shell) {
				shell.highlight = child;
				pcall(() => {
					child.Adornee = geometry;
				});
			}
		};
		for (const child of model.GetChildren()) {
			adoptHighlight(child);
		}
		shell.connections.push(model.ChildAdded.Connect(adoptHighlight));

		shell.connections.push(
			model.DescendantAdded.Connect((descendant) => {
				if (descendant.IsA("BasePart") && shells.get(model) === shell) {
					buildRenderPart(shell, descendant);
				}
			}),
		);

		container.Parent = game.Workspace;
		shells.set(model, shell);
	});
}

function releaseCameraSubject() {
	if (!cameraSubjectOwned) {
		return;
	}
	cameraSubjectOwned = false;
	const camera = game.Workspace.CurrentCamera;
	if (!camera) {
		return;
	}
	const character = LocalPlayer.Character;
	const humanoid = character ? character.FindFirstChildOfClass("Humanoid") : undefined;
	camera.CameraSubject = humanoid;
}

function updateCameraSubject(shell: Shell, driving: boolean) {
	const camera = game.Workspace.CurrentCamera;
	if (!camera) {
		return;
	}
	if (driving) {
		if (camera.CameraSubject !== shell.cameraTarget) {
			// Take the subject only from the default humanoid follow — never
			// steal it from spectate/menu/showcase camera owners.
			const character = LocalPlayer.Character;
			const humanoid = character ? character.FindFirstChildOfClass("Humanoid") : undefined;
			if (camera.CameraSubject === humanoid || camera.CameraSubject === undefined || cameraSubjectOwned) {
				camera.CameraSubject = shell.cameraTarget;
				cameraSubjectOwned = true;
			}
		}
	} else if (cameraSubjectOwned && camera.CameraSubject === shell.cameraTarget) {
		releaseCameraSubject();
	}
}

function stepShell(shell: Shell, dt: number) {
	const base = shell.base;
	const baseCF = base.CFrame;
	const basePos = baseCF.Position;
	const baseRot = baseCF.Rotation;

	// Teleport marker: snap everything, no smoothing across the map.
	const teleportGen = attrNumber(base, VehicleAttr.TeleportGen, 0);
	const teleported = teleportGen !== shell.lastTeleportGen;
	shell.lastTeleportGen = teleportGen;

	let renderedCF: CFrame;

	if (shell.isLocal) {
		if (!shell.initialized || teleported) {
			shell.posOffset = new Vector3();
			shell.posOffsetVel = new Vector3();
			shell.rotOffset = IDENTITY;
		} else {
			// Rollback detector: physical position can only travel ~|v|·dt in
			// one frame; anything beyond that is a correction landing.
			const jump = basePos.sub(shell.prevBasePos).Magnitude;
			const speed = math.max(shell.prevBaseVel.Magnitude, base.AssemblyLinearVelocity.Magnitude);
			const allowance = JUMP_SLACK + speed * dt * JUMP_VELOCITY_FACTOR;
			if (jump > TELEPORT_SNAP) {
				// Unmarked map-scale relocation — treat as teleport.
				shell.posOffset = new Vector3();
				shell.posOffsetVel = new Vector3();
				shell.rotOffset = IDENTITY;
			} else if (jump > allowance) {
				// Preserve the on-screen pose across the correction: the shell
				// was at (basePrev + offset); recompute the offset against the
				// corrected physical pose so the rendered pose is continuous,
				// then let SmoothDamp bleed it off.
				const prevRenderedPos = shell.prevBasePos.add(shell.posOffset);
				shell.posOffset = prevRenderedPos.sub(basePos);
				// Rotation continuity comes along with the same event.
				const prevRenderedRot = shell.smoothRot.mul(shell.rotOffset);
				shell.rotOffset = baseRot.Inverse().mul(prevRenderedRot);
			}
		}

		// Decay the error offset toward zero (identity).
		if (shell.posOffset.Magnitude > 0.01) {
			const [nextOffset, nextVel] = TweenService.SmoothDamp(
				shell.posOffset,
				new Vector3(),
				shell.posOffsetVel,
				LOCAL_SMOOTH_TIME,
				math.huge,
				dt,
			);
			shell.posOffset = nextOffset;
			shell.posOffsetVel = nextVel;
		} else if (shell.posOffset.Magnitude > 0) {
			shell.posOffset = new Vector3();
			shell.posOffsetVel = new Vector3();
		}
		if (shell.rotOffset !== IDENTITY) {
			const alpha = 1 - math.exp(-dt / LOCAL_ROT_TAU);
			shell.rotOffset = shell.rotOffset.Lerp(IDENTITY, alpha);
			const [, angle] = shell.rotOffset.ToAxisAngle();
			if (angle < math.rad(0.5)) {
				shell.rotOffset = IDENTITY;
			}
		}

		renderedCF = baseRot.mul(shell.rotOffset).add(basePos.add(shell.posOffset));
		shell.prevBasePos = basePos;
		shell.prevBaseVel = base.AssemblyLinearVelocity;
		shell.smoothRot = baseRot; // reference for the next rotation-offset capture
	} else {
		// Remote car: continuous interpolation toward authoritative state.
		if (!shell.initialized || teleported || basePos.sub(shell.smoothPos).Magnitude > TELEPORT_SNAP) {
			shell.smoothPos = basePos;
			shell.smoothPosVel = new Vector3();
			shell.smoothRot = baseRot;
		} else {
			const [nextPos, nextVel] = TweenService.SmoothDamp(
				shell.smoothPos,
				basePos,
				shell.smoothPosVel,
				REMOTE_SMOOTH_TIME,
				math.huge,
				dt,
			);
			shell.smoothPos = nextPos;
			shell.smoothPosVel = nextVel;
			shell.smoothRot = shell.smoothRot.Lerp(baseRot, 1 - math.exp(-dt / REMOTE_ROT_TAU));
		}
		renderedCF = shell.smoothRot.add(shell.smoothPos);
	}
	shell.initialized = true;

	// One correction transform for chassis and wheels alike: every part's
	// pose is copied relative to the physical chassis and re-expressed on the
	// rendered chassis — steering angle, suspension travel and wheel spin all
	// carry over exactly.
	const baseCFInverse = baseCF.Inverse();
	for (const pair of shell.pairs) {
		if (pair.source.Parent === undefined) {
			continue;
		}
		pair.render.CFrame = renderedCF.mul(baseCFInverse.mul(pair.source.CFrame));
	}
	shell.cameraTarget.CFrame = renderedCF;

	if (shell.isLocal) {
		const character = LocalPlayer.Character;
		const humanoid = character ? character.FindFirstChildOfClass("Humanoid") : undefined;
		const seated =
			humanoid !== undefined && humanoid.SeatPart !== undefined && humanoid.SeatPart.IsDescendantOf(shell.model);
		updateCameraSubject(shell, seated && base.GetAttribute(VehicleAttr.Driving) === true);
	}
}

const vehiclesFolder = game.Workspace.WaitForChild("Vehicles");
vehiclesFolder.ChildAdded.Connect(trackVehicle);
vehiclesFolder.ChildRemoved.Connect((model) => {
	if (model.IsA("Model")) {
		destroyShell(model);
	}
});
for (const child of vehiclesFolder.GetChildren()) {
	trackVehicle(child);
}

RunService.RenderStepped.Connect((dt) => {
	for (const [model, shell] of shells) {
		if (model.Parent === undefined || shell.base.Parent === undefined) {
			destroyShell(model);
			continue;
		}
		const [ok, err] = pcall(() => stepShell(shell, dt));
		if (!ok) {
			// One warn per shell per session would hide recurrences; throttle
			// by shell instead of swallowing forever.
			warn(`[VehicleShell] ${model.Name}: ${err}`);
			destroyShell(model);
		}
	}
});
