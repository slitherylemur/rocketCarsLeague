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
//                 the whole point of prediction is preserved. When Roblox's
//                 Misprediction event reports a chassis CFrame mismatch, the
//                 predicted-to-authoritative delta becomes a visual offset.
//                 SmoothDamp decays that offset to zero, making the correction
//                 a glide while normal physics stays pinned exactly.
//   REMOTE CARS — PredictionMode.Off by design, so their replicated motion
//                 arrives steppy. The shell continuously SmoothDamps toward
//                 the authoritative pose: smooth believable motion at the
//                 cost of a few tens of ms of display delay they already had.
//
//   TELEPORTS   — the sim bumps the TeleportGen attribute on intentional
//                 relocations (kickoff placement, podium poses, respawns);
//                 the shell SNAPS immediately instead of smearing a
//                 map-scale "correction" across the pitch. A mismatch beyond
//                 TELEPORT_SNAP snaps too (belt-and-braces for unmarked paths).
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
const RENDER_BIND_NAME = "VehicleShellBeforeCamera";

// Correction smoothing (local car): time constants of the error-offset
// decay. Deliberately long — a rollback correction should read as the car
// gently re-converging on the corrected prediction over a couple of seconds,
// not a quick snap-back (SmoothDamp at 0.8 reaches ~95% in roughly 2.5s).
// The offset only affects RENDERING: input latency stays zero because new
// motion still comes from the live predicted pose underneath.
const LOCAL_SMOOTH_TIME = 0.8;
const LOCAL_ROT_TAU = 0.35;
// Cap on a captured error offset: a correction bigger than this starts its
// glide from MAX_OFFSET studs away instead (and TELEPORT_SNAP still snaps
// outright above it) so the shell can never trail absurdly far behind.
const MAX_OFFSET = 40;
// Remote interpolation: short enough to stay honest, long enough to bridge
// ~2 replication intervals.
const REMOTE_SMOOTH_TIME = 0.09;
const REMOTE_ROT_TAU = 0.07;
// Any reported correction beyond this snaps outright (unmarked teleport).
const TELEPORT_SNAP = 60;
// Ignore sub-pixel mismatch noise. These gates apply to the explicit engine
// mismatch delta, not ordinary frame-to-frame movement.
const LOCAL_POS_ENGAGE = 0.02;
const LOCAL_ROT_ENGAGE = math.rad(0.1);

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
	// V2 cars are rendered by carRig.client.ts (single-assembly proxy + rig);
	// the legacy shell must never double-render one. The attribute is stamped
	// server-side before the model is parented, so no race here.
	if (model.GetAttribute("V2") !== undefined) {
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

		// Register before adopting children that already replicated with the
		// vehicle. adoptHighlight deliberately rejects stale shells, so doing
		// this at the end meant the initial TeamHighlight always rejected the
		// shell and only a highlight added later could ever be displayed.
		container.Parent = game.Workspace;
		shells.set(model, shell);

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

interface MispredictedValues {
	Predicted?: unknown;
	Authoritative?: unknown;
}

interface MispredictedEntry {
	Instance?: unknown;
	Properties?: unknown;
	Attributes?: unknown;
}

function mismatchValues(container: unknown, name: string): MispredictedValues | undefined {
	if (!typeIs(container, "table")) {
		return undefined;
	}
	const rawValues = (container as Record<string, unknown>)[name];
	return typeIs(rawValues, "table") ? (rawValues as MispredictedValues) : undefined;
}

function clearLocalCorrection(shell: Shell) {
	shell.posOffset = new Vector3();
	shell.posOffsetVel = new Vector3();
	shell.rotOffset = IDENTITY;
}

// RunService supplies the predicted and authoritative values from the first
// divergent simulation step. Their difference gives us a correction-specific
// render offset without inferring one from ordinary movement. Applying that
// predicted-authoritative offset on the corrected live chassis hides the
// correction, while subsequent physical movement still has zero latency.
function captureLocalMisprediction(entries: Array<unknown>) {
	for (const rawEntry of entries) {
		if (!typeIs(rawEntry, "table")) {
			continue;
		}
		const entry = rawEntry as MispredictedEntry;
		const instance = entry.Instance;
		if (!typeIs(instance, "Instance")) {
			continue;
		}

		for (const [, shell] of shells) {
			if (!shell.isLocal || (instance !== shell.base && instance !== shell.base.AssemblyRootPart)) {
				continue;
			}

			// TeleportGen is rollback state and can be reported in this same
			// event as the pose. Never construct a smoothing offset for it.
			if (
				mismatchValues(entry.Attributes, VehicleAttr.TeleportGen) !== undefined ||
				attrNumber(shell.base, VehicleAttr.TeleportGen, 0) !== shell.lastTeleportGen
			) {
				clearLocalCorrection(shell);
				continue;
			}

			let posDelta = new Vector3();
			let rotDelta = IDENTITY;
			let hasPosition = false;
			let hasRotation = false;

			const cframeValues = mismatchValues(entry.Properties, "CFrame");
			if (
				cframeValues !== undefined &&
				typeIs(cframeValues.Predicted, "CFrame") &&
				typeIs(cframeValues.Authoritative, "CFrame")
			) {
				posDelta = cframeValues.Predicted.Position.sub(cframeValues.Authoritative.Position);
				rotDelta = cframeValues.Authoritative.Rotation.Inverse().mul(cframeValues.Predicted.Rotation);
				hasPosition = true;
				hasRotation = true;
			} else {
				// Some engine builds report the translational component separately.
				const positionValues = mismatchValues(entry.Properties, "Position");
				if (
					positionValues !== undefined &&
					typeIs(positionValues.Predicted, "Vector3") &&
					typeIs(positionValues.Authoritative, "Vector3")
				) {
					posDelta = positionValues.Predicted.sub(positionValues.Authoritative);
					hasPosition = true;
				}
			}

			const [, rotAngle] = rotDelta.ToAxisAngle();
			if (
				(!hasPosition || posDelta.Magnitude < LOCAL_POS_ENGAGE) &&
				(!hasRotation || rotAngle < LOCAL_ROT_ENGAGE)
			) {
				continue;
			}
			if (posDelta.Magnitude > TELEPORT_SNAP) {
				clearLocalCorrection(shell);
				continue;
			}

			if (hasPosition) {
				shell.posOffset = shell.posOffset.add(posDelta);
				if (shell.posOffset.Magnitude > MAX_OFFSET) {
					shell.posOffset = shell.posOffset.Unit.mul(MAX_OFFSET);
				}
				shell.posOffsetVel = new Vector3();
			}
			if (hasRotation) {
				shell.rotOffset = rotDelta.mul(shell.rotOffset);
			}
		}
	}
}

const [mispredictionConnected] = pcall(() => {
	RunService.Misprediction.Connect((_time, entries) => captureLocalMisprediction(entries));
});
if (!mispredictionConnected) {
	warn(
		"[VehicleShell] RunService.Misprediction unavailable; local corrections will snap instead of risking false smoothing",
	);
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
			clearLocalCorrection(shell);
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

// The default camera consumes CameraSubject at the Camera render priority.
// Move both the shell and its target immediately before that, so the camera
// can never follow the previous-frame target while the geometry is already at
// the current pose (the source of the ordinary-driving shake).
RunService.BindToRenderStep(RENDER_BIND_NAME, Enum.RenderPriority.Camera.Value - 1, (dt) => {
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
