// Ball renderer + smoother — the "Position smoothing" server-authority
// technique (soccer-template variation).
//
// The simulated ball replicates from the server and is predicted locally so
// collisions with the local (predicted) car resolve instantly. This script
// hides the simulated part (LocalTransparencyModifier) and renders a
// visual-only clone that pins exactly to the simulation under normal
// conditions — zero visual latency — engaging SmoothDamp only after the
// simulated ball jumps (rollback correction or a late-arriving remote hit),
// then re-pinning once converged. Nothing here affects the simulation.

// Smoothing values are read from the mutable ballTunables table EVERY frame
// (not captured at setup) so the tuning HUD can adjust them live.
import { BALL_NAME, ballTunables } from "shared/ballSim/BallConfig";

const RunService = game.GetService("RunService");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const TweenService = game.GetService("TweenService");

const SOCCER_BALL_MESH_NAME = "SoccerBallMesh";

interface BallVisual {
	instance: BasePart | Model;
	setCFrame: (cframe: CFrame) => void;
	setSize: (size: Vector3) => void;
}

function makeVisualOnly(instance: Instance) {
	const candidates = [instance, ...instance.GetDescendants()];
	for (const candidate of candidates) {
		if (candidate.IsA("BasePart")) {
			candidate.Anchored = false;
			candidate.CanCollide = false;
			candidate.CanQuery = false;
			candidate.CanTouch = false;
			candidate.Massless = true;
		}
	}
}

function createBallVisual(ballSize: Vector3, cframe: CFrame): BallVisual | undefined {
	const template = ReplicatedStorage.FindFirstChild(SOCCER_BALL_MESH_NAME);
	if (template === undefined || (!template.IsA("BasePart") && !template.IsA("Model"))) {
		warn(`[BallRenderer] ReplicatedStorage.${SOCCER_BALL_MESH_NAME} must be a BasePart or Model`);
		return undefined;
	}

	if (template.IsA("BasePart")) {
		const mesh = template.Clone();
		mesh.Name = `${BALL_NAME}MeshRenderer`;
		makeVisualOnly(mesh);
		mesh.Size = ballSize;
		mesh.CFrame = cframe;
		mesh.Parent = game.Workspace;
		return {
			instance: mesh,
			setCFrame: (nextCFrame) => (mesh.CFrame = nextCFrame),
			setSize: (size) => (mesh.Size = size),
		};
	}

	const model = template.Clone();
	model.Name = `${BALL_NAME}MeshRenderer`;
	makeVisualOnly(model);
	model.Parent = game.Workspace;

	const setSize = (size: Vector3) => {
		const extents = model.GetExtentsSize();
		const currentDiameter = math.max(extents.X, extents.Y, extents.Z);
		if (currentDiameter > 0) {
			model.ScaleTo(model.GetScale() * (size.X / currentDiameter));
		}
	};
	const setCFrame = (nextCFrame: CFrame) => {
		// Align the model's visible bounding-box centre, rather than relying on
		// an authored pivot that may be offset from the mesh geometry.
		const [boundsCFrame] = model.GetBoundingBox();
		model.PivotTo(nextCFrame.mul(boundsCFrame.Inverse()).mul(model.GetPivot()));
	};
	setSize(ballSize);
	setCFrame(cframe);
	return { instance: model, setCFrame, setSize };
}

function setupBall(ball: BasePart) {
	// The server already marks the ball On; re-assert locally the same way
	// VehicleKeyHandler does for the seated car.
	pcall(() => {
		RunService.SetPredictionMode(ball, Enum.PredictionMode.On);
	});

	// Visual-only stand-in, built fresh (not Clone) so nothing physical
	// comes along.
	const renderer = new Instance("Part");
	renderer.Name = `${BALL_NAME}Renderer`;
	renderer.Shape = Enum.PartType.Ball;
	renderer.Size = ball.Size;
	renderer.Material = ball.Material;
	renderer.Color = ball.Color;
	renderer.CastShadow = ball.CastShadow;
	renderer.Anchored = true;
	renderer.CanCollide = false;
	renderer.CanQuery = false;
	renderer.CanTouch = false;
	renderer.Massless = true;
	renderer.CFrame = ball.CFrame;
	renderer.Parent = game.Workspace;
	// The original sphere remains as the smoothing proxy, but only the cloned
	// soccer-ball asset is rendered.
	renderer.Transparency = 1;
	const ballVisual = createBallVisual(ball.Size, renderer.CFrame);

	ball.LocalTransparencyModifier = 1;
	const sizeConn = ball.GetPropertyChangedSignal("Size").Connect(() => {
		renderer.Size = ball.Size;
		ballVisual?.setSize(ball.Size);
	});

	let smoothing = false;
	let smoothVelocity = new Vector3();

	const renderConn = RunService.RenderStepped.Connect((dt) => {
		const simCF = ball.CFrame;

		if (!smoothing && renderer.Position.sub(simCF.Position).Magnitude > ballTunables.smoothEngageDistance) {
			smoothing = true;
			smoothVelocity = new Vector3();
		}

		if (smoothing) {
			const [smoothPos, newVelocity] = TweenService.SmoothDamp(
				renderer.Position,
				simCF.Position,
				smoothVelocity,
				ballTunables.smoothTime,
				math.huge,
				dt,
			);
			smoothVelocity = newVelocity;

			if (smoothPos.sub(simCF.Position).Magnitude <= ballTunables.smoothReleaseDistance) {
				smoothing = false;
				renderer.CFrame = simCF;
			} else {
				// Keep the sim's rotation (rolling), smooth only the position.
				renderer.CFrame = simCF.Rotation.add(smoothPos);
			}
		} else {
			renderer.CFrame = simCF;
		}

		ballVisual?.setCFrame(renderer.CFrame);
	});

	let cleaned = false;
	const cleanup = () => {
		if (cleaned) {
			return;
		}
		cleaned = true;
		renderConn.Disconnect();
		sizeConn.Disconnect();
		ballVisual?.instance.Destroy();
		renderer.Destroy();
	};
	ball.Destroying.Connect(cleanup);
	ball.AncestryChanged.Connect((_, parent) => {
		if (parent === undefined) {
			cleanup();
		}
	});
}

// The ball respawns every round (and streams in/out under StreamingEnabled),
// so watch for every (re)appearance.
function onChildAdded(child: Instance) {
	if (child.Name === BALL_NAME && child.IsA("BasePart")) {
		setupBall(child);
	}
}

game.Workspace.ChildAdded.Connect(onChildAdded);
for (const child of game.Workspace.GetChildren()) {
	onChildAdded(child);
}
