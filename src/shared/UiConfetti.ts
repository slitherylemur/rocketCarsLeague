// Lightweight 2D UI particle system (client-side): a single celebratory BURST
// of confetti launched from the bottom corners of a container Frame, simulated
// in pixels on Heartbeat (velocity + gravity + spin + end-of-life fade). No
// engine ParticleEmitters — these are plain Frames, so they layer inside
// ScreenGuis and clip to the container.
//
// Burst-only by design (perf): everything spawns up front, and the Heartbeat
// connection disconnects itself the moment the last piece dies, so the system
// costs nothing for the rest of the scene. startUiConfetti() returns a stop()
// function; the emitter also shuts itself down if the container leaves the
// tree (gui remount on respawn).

const RunService = game.GetService("RunService");

interface ConfettiPiece {
	frame: Frame;
	x: number; // px, container space
	y: number;
	vx: number; // px/s
	vy: number;
	spin: number; // deg/s
	sway: number; // horizontal flutter phase
	age: number;
	life: number;
}

// Mobile-safe cap — pieces are cheap Frames but keep the count modest.
const MAX_PIECES = 140;
const BURST_PER_CORNER = 45;

const rng = new Random();

export function startUiConfetti(container: Frame, colors: Color3[]): () => void {
	const pieces: ConfettiPiece[] = [];
	let running = true;

	const spawnPiece = (corner: "left" | "right") => {
		if (pieces.size() >= MAX_PIECES || colors.size() === 0) {
			return;
		}
		const width = container.AbsoluteSize.X;
		const height = container.AbsoluteSize.Y;
		if (width < 1 || height < 1) {
			return;
		}
		const side = corner === "left" ? 1 : -1;
		const size = height * rng.NextNumber(0.011, 0.02);
		const frame = new Instance("Frame");
		frame.Name = "ConfettiPiece";
		frame.AnchorPoint = new Vector2(0.5, 0.5);
		frame.BackgroundColor3 = colors[rng.NextInteger(0, colors.size() - 1)];
		frame.BorderSizePixel = 0;
		frame.Size = UDim2.fromOffset(size * rng.NextNumber(0.55, 1), size);
		frame.Rotation = rng.NextNumber(0, 360);
		frame.ZIndex = container.ZIndex;
		frame.Parent = container;
		pieces.push({
			frame: frame,
			x: corner === "left" ? -size : width + size,
			y: height + size,
			// Up and inward from the corner, cannon-style spread.
			vx: side * width * rng.NextNumber(0.12, 0.4),
			vy: -height * rng.NextNumber(1.05, 1.55),
			spin: rng.NextNumber(-420, 420),
			sway: rng.NextNumber(0, math.pi * 2),
			age: 0,
			life: rng.NextNumber(2.2, 3.2),
		});
	};

	let burstFired = false;
	const fireBurst = () => {
		for (let i = 0; i < BURST_PER_CORNER; i++) {
			spawnPiece("left");
			spawnPiece("right");
		}
		burstFired = true;
	};

	// A freshly mounted container reports AbsoluteSize 0x0 for a frame; in
	// that case the first sized Heartbeat fires the burst instead.
	if (container.AbsoluteSize.X >= 1 && container.AbsoluteSize.Y >= 1) {
		fireBurst();
	}

	const connection = RunService.Heartbeat.Connect((dt) => {
		if (!running || container.Parent === undefined) {
			stop();
			return;
		}
		const height = container.AbsoluteSize.Y;
		const gravity = height * 1.1;

		if (!burstFired) {
			if (container.AbsoluteSize.X < 1 || height < 1) {
				return;
			}
			fireBurst();
		}
		if (pieces.size() === 0) {
			// Burst played out — release the connection entirely.
			stop();
			return;
		}

		for (let i = pieces.size() - 1; i >= 0; i--) {
			const piece = pieces[i];
			piece.age += dt;
			if (piece.age >= piece.life || piece.y > height * 1.2) {
				piece.frame.Destroy();
				pieces.remove(i);
				continue;
			}
			piece.vy += gravity * dt;
			// Terminal-velocity drag so pieces flutter down, not plummet.
			if (piece.vy > height * 0.45) {
				piece.vy = height * 0.45;
			}
			piece.x += (piece.vx + math.sin(piece.age * 6 + piece.sway) * height * 0.05) * dt;
			piece.y += piece.vy * dt;
			piece.frame.Position = UDim2.fromOffset(piece.x, piece.y);
			piece.frame.Rotation += piece.spin * dt;
			const fadeStart = piece.life - 0.5;
			if (piece.age > fadeStart) {
				piece.frame.BackgroundTransparency = (piece.age - fadeStart) / 0.5;
			}
		}
	});

	function stop() {
		if (!running) {
			return;
		}
		running = false;
		connection.Disconnect();
		for (const piece of pieces) {
			piece.frame.Destroy();
		}
		pieces.clear();
	}

	return stop;
}
