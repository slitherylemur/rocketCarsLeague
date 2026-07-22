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
import { BallAttr } from "shared/ballSim/BallSim";

const RunService = game.GetService("RunService");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const TweenService = game.GetService("TweenService");
const Players = game.GetService("Players");
const SoundService = game.GetService("SoundService");
const Debris = game.GetService("Debris");
const ContentProvider = game.GetService("ContentProvider");

const SOCCER_BALL_MESH_NAME = "SoccerBallMesh";
const PITCH_ATTRIBUTE = "CB_PitchId";
const BLUE_SCORE_ATTRIBUTE = "FB_BlueScore";
const RED_SCORE_ATTRIBUTE = "FB_RedScore";
const LocalPlayer = Players.LocalPlayer;

const goalSoundTemplate = new Instance("Sound");
goalSoundTemplate.Name = "GoalSound";
goalSoundTemplate.SoundId = "rbxassetid://79833203443837";
goalSoundTemplate.Volume = 0.6;
// Keep the source parented and finish loading it before goal listeners are
// installed. The previous background preload could still be fetching on an
// early goal, making the clone begin noticeably after the particles.
goalSoundTemplate.Parent = SoundService;
pcall(() => ContentProvider.PreloadAsync([goalSoundTemplate]));

// Ball impact sounds — client-predicted cosmetics. BallSim (which the local
// client runs predictively) stamps every world bounce / car punch into Ball*
// attributes; the per-ball watcher in setupBall plays these positional sounds
// from the renderer part the frame a stamp advances, so the local player's
// own touches sound the instant they resolve, with no server round-trip.
// One uploaded impact asset covers both events at different pitches.
const IMPACT_SOUND_ID = "rbxassetid://106780504707238";

function impactSoundTemplate(name: string, volume: number): Sound {
	const sound = new Instance("Sound");
	sound.Name = name;
	sound.SoundId = IMPACT_SOUND_ID;
	sound.Volume = volume;
	sound.RollOffMode = Enum.RollOffMode.InverseTapered;
	sound.RollOffMinDistance = 100;
	sound.RollOffMaxDistance = 800;
	sound.Parent = SoundService;
	return sound;
}
const carHitSoundTemplate = impactSoundTemplate("BallCarHitSound", 4);
const bounceSoundTemplate = impactSoundTemplate("BallBounceSound", 3);
pcall(() => ContentProvider.PreloadAsync([carHitSoundTemplate, bounceSoundTemplate]));

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
	// SetPredictionMode is CLIENT-ONLY since the 2026-07 engine update — this
	// is the ball's ONLY marking (the old server-side pass is gone). Mark
	// DEEP: the AntiGravity VectorForce and its Attachment must be predicted
	// with the part, or the engine refuses the half-marked assembly. A
	// DescendantAdded watch covers children that replicate after the part.
	//
	// Per-pitch scope: only the LOCAL pitch's ball is predicted (On). Every
	// other pitch's ball is explicitly Off — authoritative, rendered through
	// the same smoother below — so N pitches no longer cost N predicted ball
	// sims on every client (BallSim's client tick skips them the same way).
	// Re-evaluated when the ball's pitch or the local player's pitch changes.
	const modeConnections: RBXScriptConnection[] = [];
	const desiredMode = (): Enum.PredictionMode => {
		const ballPitch = ball.GetAttribute(PITCH_ATTRIBUTE);
		if (ballPitch === undefined || ballPitch === LocalPlayer.GetAttribute(PITCH_ATTRIBUTE)) {
			return Enum.PredictionMode.On;
		}
		return Enum.PredictionMode.Off;
	};
	const applyMode = () => {
		const mode = desiredMode();
		pcall(() => {
			RunService.SetPredictionMode(ball, mode);
		});
		for (const descendant of ball.GetDescendants()) {
			pcall(() => {
				RunService.SetPredictionMode(descendant, mode);
			});
		}
	};
	applyMode();
	modeConnections.push(
		ball.DescendantAdded.Connect((descendant) => {
			pcall(() => {
				RunService.SetPredictionMode(descendant, desiredMode());
			});
		}),
	);
	modeConnections.push(ball.GetAttributeChangedSignal(PITCH_ATTRIBUTE).Connect(applyMode));
	modeConnections.push(LocalPlayer.GetAttributeChangedSignal(PITCH_ATTRIBUTE).Connect(applyMode));

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

	// Impact sound watcher. Plays when a BallSim stamp advances past the last
	// one heard: comparing sim time keeps resimulated ticks from replaying an
	// impact, and a mispredicted impact that later rolls back has already
	// sounded — the accepted trade for zero-latency feedback. The shared
	// real-time gate collapses a hit-plus-bounce pinch (or correction jitter)
	// into a single sound.
	const readStamp = (name: string): number => {
		const value = ball.GetAttribute(name);
		return typeIs(value, "number") ? value : 0;
	};
	let heardHitStamp = readStamp(BallAttr.LastHitTime);
	let heardBounceStamp = readStamp(BallAttr.LastBounceTime);
	let soundGateUntil = 0;
	const playImpact = (
		template: Sound,
		speed: number,
		minAudibleSpeed: number,
		fullVolumeSpeed: number,
		pitchMin: number,
		pitchMax: number,
	) => {
		if (speed < minAudibleSpeed || os.clock() < soundGateUntil) {
			return;
		}
		soundGateUntil = os.clock() + 0.08;
		const sound = template.Clone();
		sound.Volume = template.Volume * math.clamp(speed / fullVolumeSpeed, 0.5, 1);
		sound.PlaybackSpeed = pitchMin + math.random() * (pitchMax - pitchMin);
		sound.Parent = renderer;
		sound.TimePosition = 0.1;
		sound.Play();
		Debris.AddItem(sound, 3);
	};
	const pollImpactSounds = () => {
		const hitStamp = readStamp(BallAttr.LastHitTime);
		if (hitStamp > heardHitStamp + 1e-3) {
			playImpact(carHitSoundTemplate, readStamp(BallAttr.LastHitSpeed), 3, 50, 0.75, 0.95);
		}
		heardHitStamp = math.max(heardHitStamp, hitStamp);

		const bounceStamp = readStamp(BallAttr.LastBounceTime);
		if (bounceStamp > heardBounceStamp + 1e-3) {
			// Min audible speed must stay above per-tick gravity accumulation
			// (~6.5 studs/s at the 30 Hz sim rate) or resting/rolling floor
			// contact rattles.
			playImpact(bounceSoundTemplate, readStamp(BallAttr.LastBounceSpeed), 8, 50, 1.05, 1.3);
		}
		heardBounceStamp = math.max(heardBounceStamp, bounceStamp);
	};

	// Goal burst is authored beneath GoalEffects on the cloned rendered mesh.
	// Watch this ball's own pitch scoreboard so simultaneous pitches only fire
	// the visual belonging to the ball that was scored with.
	const scoreConnections: RBXScriptConnection[] = [];
	let goalEffectGeneration = 0;
	const goalEffects = ballVisual?.instance.FindFirstChild("GoalEffects", true);
	const goalEmitters: ParticleEmitter[] = [];
	if (goalEffects && goalEffects.IsA("Attachment")) {
		for (const descendant of goalEffects.GetDescendants()) {
			if (descendant.IsA("ParticleEmitter")) {
				descendant.Enabled = false;
				goalEmitters.push(descendant);
			}
		}
	}
	const triggerGoalEffects = () => {
		goalEffectGeneration += 1;
		const generation = goalEffectGeneration;
		if (ballVisual) {
			const visualInstances = [ballVisual.instance, ...ballVisual.instance.GetDescendants()];
			for (const instance of visualInstances) {
				if (instance.IsA("BasePart")) {
					instance.Transparency = 1;
				}
			}
		}
		for (const emitter of goalEmitters) {
			emitter.Enabled = true;
		}
		if (ball.GetAttribute(PITCH_ATTRIBUTE) === LocalPlayer.GetAttribute(PITCH_ATTRIBUTE)) {
			const sound = goalSoundTemplate.Clone();
			sound.Parent = SoundService;
			sound.TimePosition = 0.2;
			sound.Play();
			Debris.AddItem(sound, 10);
		}
		task.delay(0.2, () => {
			if (goalEffectGeneration !== generation) {
				return;
			}
			for (const emitter of goalEmitters) {
				if (emitter.Parent !== undefined) {
					emitter.Enabled = false;
				}
			}
		});
	};
	const pitchId = ball.GetAttribute(PITCH_ATTRIBUTE);
	const mapFolder = game.Workspace.FindFirstChild("Map");
	const pitch = typeIs(pitchId, "string") && mapFolder ? mapFolder.FindFirstChild(pitchId) : undefined;
	if (pitch) {
		let blueScore = pitch.GetAttribute(BLUE_SCORE_ATTRIBUTE);
		let redScore = pitch.GetAttribute(RED_SCORE_ATTRIBUTE);
		const onScoreChanged = () => {
			const nextBlue = pitch.GetAttribute(BLUE_SCORE_ATTRIBUTE);
			const nextRed = pitch.GetAttribute(RED_SCORE_ATTRIBUTE);
			if (
				(typeIs(nextBlue, "number") && (!typeIs(blueScore, "number") || nextBlue > blueScore)) ||
				(typeIs(nextRed, "number") && (!typeIs(redScore, "number") || nextRed > redScore))
			) {
				triggerGoalEffects();
			}
			blueScore = nextBlue;
			redScore = nextRed;
		};
		scoreConnections.push(pitch.GetAttributeChangedSignal(BLUE_SCORE_ATTRIBUTE).Connect(onScoreChanged));
		scoreConnections.push(pitch.GetAttributeChangedSignal(RED_SCORE_ATTRIBUTE).Connect(onScoreChanged));
	}

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
		pollImpactSounds();
	});

	let cleaned = false;
	const cleanup = () => {
		if (cleaned) {
			return;
		}
		cleaned = true;
		goalEffectGeneration += 1;
		for (const connection of modeConnections) {
			connection.Disconnect();
		}
		for (const connection of scoreConnections) {
			connection.Disconnect();
		}
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
