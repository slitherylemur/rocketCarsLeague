// Client-side vehicle renderer (SERVER_AUTHORITY_PLAN.md Phase 2).
//
// Draws everything audiovisual about vehicles from the attributes the shared
// sim (shared/vehicleSim/VehicleSim) and the server VehicleClass write:
//   - idle engine sound: play state + the gear pitch curve
//   - boost particles/trail/sound, drift wheel trails + drift sound
//   - jump sound
//   - health bar fill
//   - the local player's boost meter GUI
//
// Under server authority the client simulation is only ever a prediction, so
// effects must be derived from synchronized state (attributes) rather than
// triggered imperatively — a rolled-back boost flips the attribute back and
// the effect stops with it. Nothing in this script affects the simulation.

import {
	ENGINE_SOUND,
	VehicleAttr,
	VehicleModelAttr,
	VehicleBase,
	VehicleModel,
} from "shared/vehicleSim/VehicleSim";

const RunService = game.GetService("RunService");
const TweenService = game.GetService("TweenService");
const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;

interface TrackedCar {
	model: VehicleModel;
	base: VehicleBase;
	boostOn: boolean;
	driftTrailsOn: boolean;
	driftSoundOn: boolean;
	lastJumpForceUntil: number;
	lastHealth?: number;
	lastBoostAmount?: number;
}

const tracked = new Map<Model, TrackedCar>();

// ---- boost FOV kick (local car only) ----
// Recomputed every frame from the tracked cars' attributes (never latched on
// an event), so it recovers by itself if the car despawns or rolls back
// mid-boost. The pre-boost FOV is captured at kick-on and restored at
// kick-off.
const BOOST_FOV_KICK = 6; // degrees added while boosting
const BOOST_FOV_TWEEN_INFO = new TweenInfo(0.25, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);
let fovKickOn = false;
let fovRestore: number | undefined;
let fovTween: Tween | undefined;

function setBoostFov(on: boolean) {
	if (on === fovKickOn) {
		return;
	}
	fovKickOn = on;
	const camera = game.Workspace.CurrentCamera;
	if (!camera) {
		return;
	}
	if (fovTween) {
		fovTween.Cancel();
		fovTween = undefined;
	}
	let target: number;
	if (on) {
		fovRestore = fovRestore ?? camera.FieldOfView;
		target = fovRestore + BOOST_FOV_KICK;
	} else {
		target = fovRestore ?? camera.FieldOfView;
		fovRestore = undefined;
	}
	fovTween = TweenService.Create(camera, BOOST_FOV_TWEEN_INFO, { FieldOfView: target });
	fovTween.Play();
}

function track(model: Instance) {
	if (!model.IsA("Model")) {
		return;
	}
	task.spawn(() => {
		// Under StreamingEnabled the car's parts can arrive over several frames.
		const base = model.WaitForChild("Base", 15) as VehicleBase | undefined;
		if (!base || !model.Parent) {
			return;
		}
		tracked.set(model, {
			model: model as VehicleModel,
			base,
			boostOn: false,
			driftTrailsOn: false,
			driftSoundOn: false,
			lastJumpForceUntil: 0,
			lastHealth: undefined,
			lastBoostAmount: undefined,
		});
	});
}

function untrack(model: Instance) {
	if (model.IsA("Model")) {
		tracked.delete(model);
	}
}

function attrNumber(instance: Instance, name: string, fallback: number): number {
	const value = instance.GetAttribute(name);
	return typeIs(value, "number") ? value : fallback;
}

function attrBool(instance: Instance, name: string): boolean {
	return instance.GetAttribute(name) === true;
}

// The gear pitch curve, exactly as the old server drive loop computed it.
function updateEnginePitch(car: TrackedCar) {
	const base = car.base;
	const targetVelocity = attrNumber(base, VehicleAttr.TargetVelocity, 150);
	const velocity = -base.CFrame.VectorToObjectSpace(base.AssemblyLinearVelocity).Z;
	const propVelocity = math.abs(velocity) / targetVelocity;

	const gearLimits = ENGINE_SOUND.gearLimits;
	const playbackSpeeds = ENGINE_SOUND.playbackSpeeds;
	const gearSpeedDrop = ENGINE_SOUND.gearSpeedDrop;

	for (const [i, gear] of ipairs(gearLimits)) {
		if (propVelocity <= gear) {
			if (gearLimits[i - 2] !== undefined) {
				base.IdleSound.PlaybackSpeed =
					((playbackSpeeds[i - 1] - (playbackSpeeds[i - 2] - gearSpeedDrop)) / (gear - gearLimits[i - 2])) *
						(propVelocity - gear) +
					playbackSpeeds[i - 1];
			} else {
				base.IdleSound.PlaybackSpeed =
					((playbackSpeeds[i - 1] - 1) / gear) * (propVelocity - gear) + playbackSpeeds[i - 1];
			}
			break;
		}
	}
}

function updateCar(car: TrackedCar) {
	const base = car.base;
	const model = car.model;

	// ---- idle engine sound (played per client; the old server loop started
	// it once per drive and never stopped it — preserved) ----
	const driving = attrBool(base, VehicleAttr.Driving);
	if (driving) {
		if (!base.IdleSound.IsPlaying) {
			base.IdleSound.Play();
		}
		updateEnginePitch(car);
	}

	// ---- boost effect ----
	const boostOn = attrBool(base, VehicleAttr.BoostHeld) && attrNumber(base, VehicleAttr.BoostAmount, 0) > 0;
	if (boostOn !== car.boostOn) {
		car.boostOn = boostOn;
		const boostPart = model.FindFirstChild("BoostEffectPart") as VehicleModel["BoostEffectPart"] | undefined;
		if (boostPart) {
			const emitter = boostPart.FindFirstChildWhichIsA("ParticleEmitter");
			if (emitter) {
				emitter.Enabled = boostOn;
			}
			const trail = boostPart.FindFirstChildWhichIsA("Trail");
			if (trail) {
				trail.Enabled = boostOn;
			}
			const boostSound = boostPart.FindFirstChild("boostSound") as Sound | undefined;
			if (boostSound) {
				if (boostOn) {
					boostSound.Play();
				} else {
					boostSound.Stop();
				}
			}
		}
	}

	// ---- drift trails + sound ----
	const driftEngaged = attrBool(base, VehicleAttr.DriftEngaged);
	if (driftEngaged !== car.driftTrailsOn) {
		car.driftTrailsOn = driftEngaged;
		const wheels = model.FindFirstChild("Wheels");
		if (wheels) {
			for (const wheel of wheels.GetChildren()) {
				const turn = wheel.FindFirstChild("turn");
				const trail = turn && turn.FindFirstChild("Trail");
				if (trail && trail.IsA("Trail")) {
					trail.Enabled = driftEngaged;
				}
			}
		}
	}
	// Old behavior: drift sound only while actually steering in the slide.
	const driftSoundOn = driftEngaged && attrNumber(base, VehicleAttr.Steer, 0) !== 0;
	if (driftSoundOn !== car.driftSoundOn) {
		car.driftSoundOn = driftSoundOn;
		if (driftSoundOn) {
			base.driftSound.Play();
		} else {
			base.driftSound.Stop();
		}
	}

	// ---- jump sound (attribute edge = a jump fired) ----
	const jumpForceUntil = attrNumber(base, VehicleAttr.JumpForceUntil, 0);
	if (jumpForceUntil > car.lastJumpForceUntil) {
		car.lastJumpForceUntil = jumpForceUntil;
		base.jumpSound.Play();
	}

	// ---- health bar fill ----
	const health = attrNumber(model, VehicleModelAttr.Health, -1);
	if (health >= 0 && health !== car.lastHealth) {
		car.lastHealth = health;
		const maxHealth = attrNumber(model, VehicleModelAttr.MaxHealth, 100);
		const healthBar = base.FindFirstChild("HealthBar") as VehicleBase["HealthBar"] | undefined;
		if (healthBar) {
			// Only health controls the fill width. Preserve the template/layout
			// height so the bar stays in its bottom band below the overhead icon.
			const currentSize = healthBar.Green.Size;
			healthBar.Green.Size = new UDim2(
				health / maxHealth,
				0,
				currentSize.Y.Scale,
				currentSize.Y.Offset,
			);
		}
	}

	// ---- local player's boost meter GUI (was a server-side tween into
	// PlayerGui every Heartbeat) ----
	if (attrNumber(model, VehicleModelAttr.OwnerUserId, 0) === LocalPlayer.UserId) {
		const boostAmount = attrNumber(base, VehicleAttr.BoostAmount, 0);
		if (boostAmount !== car.lastBoostAmount) {
			car.lastBoostAmount = boostAmount;
			pcall(() => {
				const barThingy = (
					LocalPlayer as unknown as {
						PlayerGui: { Game: { BoostMeter: { GuageBar: { BarThingy: Frame } } } };
					}
				).PlayerGui.Game.BoostMeter.GuageBar.BarThingy;
				const tween = TweenService.Create(barThingy, new TweenInfo(0.2, Enum.EasingStyle.Linear), {
					Size: new UDim2(barThingy.Size.X.Scale, barThingy.Size.X.Offset, boostAmount / 100, 0),
				});
				tween.Play();
			});
		}
	}
}

const vehiclesFolder = game.Workspace.WaitForChild("Vehicles");
vehiclesFolder.ChildAdded.Connect(track);
vehiclesFolder.ChildRemoved.Connect(untrack);
for (const child of vehiclesFolder.GetChildren()) {
	track(child);
}

RunService.RenderStepped.Connect(() => {
	let localBoosting = false;
	for (const [model, car] of tracked) {
		if (!model.Parent || !car.base.Parent) {
			tracked.delete(model);
			continue;
		}
		pcall(() => updateCar(car));
		if (
			car.boostOn &&
			attrBool(car.base, VehicleAttr.Driving) &&
			attrNumber(model, VehicleModelAttr.OwnerUserId, 0) === LocalPlayer.UserId
		) {
			localBoosting = true;
		}
	}
	setBoostFov(localBoosting);
});
