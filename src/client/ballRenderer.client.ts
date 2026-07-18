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
const TweenService = game.GetService("TweenService");

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

	ball.LocalTransparencyModifier = 1;

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
	});

	let cleaned = false;
	const cleanup = () => {
		if (cleaned) {
			return;
		}
		cleaned = true;
		renderConn.Disconnect();
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
