// Original: ServerStorage/Classes/VehicleClass (ModuleScript)
//server side vehicle class

import GeneralUtils from "../GeneralUtils";
import DataUtils from "../Modules/DataUtilities";
import DataStore2 from "../Modules/DataStore2";
import DSDefaultValues from "../Modules/DataStoreDefaults";
import spawnVehicle from "../Modules/spawnVehicle";
import { Globals } from "../Globals";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";

//services
const RunService = game.GetService("RunService");
const Players = game.GetService("Players");
const TweenService = game.GetService("TweenService");
const MarketplaceService = game.GetService("MarketplaceService");

//Globals
Globals.CarCategorys = ["City", "Off Road", "Sports", "Specials", "Military"];

// ---- feel tuning knobs (a5318d46 baseline: 1.0 / 3 / 3 / 1.6 / uncapped / 0.01) ----
const DRIVE_FORCE_MULT = 1.25; // overall engine force, forward and reverse
const BOOST_FORCE_MULT = 3; // boost punch on the ground (baseline 3)
const BOOST_AIR_FORCE_MULT = 4.5; // boost authority in the air — nose-up boosting sustains airtime
const BOOST_TARGET_MULT = 1.6; // boost top speed as a fraction of targetVelocity
const DRIFT_MAX_SIDE_SPEED = 0.45; // cap on sideways drift speed (× targetVelocity); uncapped it outran boost
const DRIFT_MIN_PROP_VEL = 0.15; // no drift thrust below this fraction of top speed (stationary Space+A launched the car)
const DRIFT_SIDE_FORCE_FWD = 45; // side thrust per unit mass while drifting forward (a5318d46 used 200 — far too strong)
const DRIFT_SIDE_FORCE_REV = 30; // side thrust per unit mass while drifting in reverse (a5318d46 used 130)
const JUMP_FORCE_TIME = 0.15; // seconds the jump force stays on — 0.01s got swallowed by replication
// batching before the network-owning client ever applied the force (jump sound, no jump)
const JUMP_FORCE_GRAVITY_MULT = 3.5; // jump force as a multiple of gravity; net upward accel = (mult - 1) × g,
// so takeoff speed ≈ (mult - 1) × g × JUMP_FORCE_TIME (≈ 74 studs/s → ~14 studs of height)

// ---- Instance shape types (structural; the models live in the place file) ----

export interface VehicleWheel extends Model {
	WheelMount: BasePart & { SpringConstraint: SpringConstraint };
	turn: BasePart & {
		trail: Attachment;
		trail2: Attachment;
		HingeConstraint: HingeConstraint;
	};
	Wheel: BasePart;
	DisplayWheel: BasePart;
}

export interface VehicleBase extends BasePart {
	IdleSound: Sound;
	hornSound: Sound;
	driftSound: Sound;
	jumpSound: Sound;
	LinearVelocity: LinearVelocity;
	slopeCounterVelocity: LinearVelocity;
	DriftThrust: VectorForce;
	Aerial: BodyAngularVelocity;
	BodyGyro: BodyGyro;
	FlipMover: BodyPosition;
	HealthBar: BillboardGui & { Green: Frame; PlayerTag: TextLabel };
}

export interface VehicleModel extends Model {
	Base: VehicleBase;
	Model: Model;
	Wheels: Folder & Record<"FL" | "FR" | "BL" | "BR", VehicleWheel>;
	Seats: Folder & { VehicleSeat: VehicleSeat };
	Hitboxes: Folder & { damageBlock: BasePart };
	BoostEffectPart: BasePart & {
		Attachment: Attachment;
		Attachment2: Attachment;
		ParticleEmitter: ParticleEmitter;
		Trail: Trail;
		boostSound: Sound;
	};
}

export interface VehicleParams {
	cost: number;

	//DAMAGE
	health: number;
	damageMultiplier: number;

	//MOVEMENT
	mass: number;
	acceleration: number;
	targetVelocity: number;

	//TURNING
	minTurnRadius: number;
	maxTurnRadius: number;
	maxAngularSpeed: number;
	minAngularSpeed: number;

	//SPECIALS
	boostAmount: number;
	driftingMult: number;

	category: string;

	idleSoundId?: number;

	//SUSPENSION
	damping: number;
	stiffness: number;
	freeLength: number;

	model?: VehicleModel;
	owner?: Player;
}

function createInputEvent(vehicle: Model): RemoteEvent {
	// Original used Instance.new("RemoteEvent", vehicle) — parent set at creation.
	const event = new Instance("RemoteEvent");
	event.Parent = vehicle;
	event.Name = "inputChangedEvent";
	return event;
}

export class VehicleClass {
	// copied params
	cost!: number;
	health!: number;
	damageMultiplier!: number;
	mass!: number;
	acceleration!: number;
	targetVelocity!: number;
	minTurnRadius!: number;
	maxTurnRadius!: number;
	maxAngularSpeed!: number;
	minAngularSpeed!: number;
	boostAmount!: number;
	driftingMult!: number;
	category!: string;
	idleSoundId?: number;
	damping!: number;
	stiffness!: number;
	freeLength!: number;
	model!: VehicleModel;
	owner?: Player;

	// state initialised in the constructor
	velocity: number;
	propVelocity: number;
	drifting: boolean;
	boost: boolean;
	boostDelay: boolean;
	jumpDebounce: boolean;
	flipDebounce: boolean;
	hornSoundId: string;
	lastAttacker?: Player;
	ConnectionSteerFloat: number;
	ConnectionThrottleFloat: number;
	baseHealth: number;
	connectionThrottle?: number;
	wasKilled: boolean;
	lastMeterAmount?: number;
	driving: boolean;

	//ACKERMAN STUFF
	t: number;
	l: number;

	initialiseVehicleModel() {
		const base = this.model.Base;

		for (const wheel of this.model.Wheels.GetChildren() as VehicleWheel[]) {
			wheel.WheelMount.SpringConstraint.Damping = this.damping;
			wheel.WheelMount.SpringConstraint.Stiffness = this.stiffness;
			wheel.WheelMount.SpringConstraint.FreeLength = this.freeLength;

			wheel.turn.trail.Position = new Vector3(wheel.DisplayWheel.Size.X / 2, -wheel.Wheel.Size.Y / 2 + 0.15, 0);
			wheel.turn.trail2.Position = new Vector3(-wheel.DisplayWheel.Size.X / 2, -wheel.Wheel.Size.Y / 2 + 0.15, 0);
		}

		const density = this.mass / (base.Size.X * base.Size.Y * base.Size.Z);

		const physPropertiesBase = new PhysicalProperties(density, 0.4, 0.25, 1, 1);

		base.CustomPhysicalProperties = physPropertiesBase;

		const healthBar = (
			game.GetService("ServerStorage") as unknown as {
				HealthBar: BillboardGui & { PlayerTag: TextLabel };
			}
		).HealthBar.Clone();
		const [Cframe, size] = this.model.GetBoundingBox();

		healthBar.StudsOffsetWorldSpace = new Vector3(0, size.Y + 2, 0);
		if (this.owner) {
			healthBar.PlayerTag.Text = this.owner.Name;

			let hasVip = false;

			const [success, message] = pcall(() => {
				hasVip = MarketplaceService.UserOwnsGamePassAsync(this.owner!.UserId as unknown as never, Globals.VIP_PASS_ID);
			});

			if (hasVip) {
				// Original: Color3.new(212, 152, 0) — out-of-range Color3.new kept as-is.
				healthBar.PlayerTag.TextColor3 = new Color3(212, 152, 0);
			}

			if (this.owner.Neutral === false) {
				const teamHighlight = (
					game.GetService("ServerStorage") as unknown as { TeamHighlight: Highlight }
				).TeamHighlight.Clone();
				teamHighlight.OutlineColor = this.owner.TeamColor.Color;
				teamHighlight.Parent = this.model;
				teamHighlight.Adornee = this.model;
			}
		} else {
			healthBar.PlayerTag.Visible = false;
		}

		// Torque-free jump force: FlipMover (BodyPosition) applies its force at
		// the Base origin, not the assembly's center of mass — an off-center
		// vertical force is a torque, which flipped the car in random directions
		// on jump. A VectorForce with ApplyAtCenterOfMass is a pure vertical push.
		const jumpAttachment = new Instance("Attachment");
		jumpAttachment.Name = "JumpAttachment";
		jumpAttachment.Parent = base;
		const jumpThrust = new Instance("VectorForce");
		jumpThrust.Name = "JumpThrust";
		jumpThrust.Attachment0 = jumpAttachment;
		jumpThrust.ApplyAtCenterOfMass = true;
		jumpThrust.RelativeTo = Enum.ActuatorRelativeTo.World;
		jumpThrust.Force = new Vector3(0, 0, 0);
		jumpThrust.Parent = base;

		const InputEvent = createInputEvent(this.model);
		InputEvent.OnServerEvent.Connect((player, throttle, steer) => {
			// Server-authoritative input: accept only sane floats from the owner.
			if (player === this.owner && typeIs(throttle, "number") && typeIs(steer, "number")) {
				// NaN guard (NaN ~= NaN) — a NaN float would poison every force
				// computation in the drive loop.
				if (throttle === throttle && steer === steer) {
					this.ConnectionThrottleFloat = math.clamp(throttle, -1, 1);
					this.ConnectionSteerFloat = math.clamp(steer, -1, 1);
				}
			}
		});

		let wasInWorkspace: boolean | undefined = undefined;

		this.model.AncestryChanged.Connect(() => {
			if (this.model.Parent === (game.Workspace as unknown as { Vehicles: Folder }).Vehicles) {
				wasInWorkspace = true;
			} else if (wasInWorkspace && this.model.Parent === undefined) {
				if (!this.wasKilled) {
					if (this.lastAttacker && this.lastAttacker.Parent) {
						this.KillVehicle(this.lastAttacker, 10);
					} else {
						this.KillVehicle();
					}
				}
			}
		});

		healthBar.Parent = base;
	}

	constructor(params: VehicleParams) {
		// Original copies every entry of the params table onto the new object.
		for (const [i, param] of pairs(params as unknown as Record<string, unknown>)) {
			(this as unknown as Record<string, unknown>)[i as string] = param;
		}

		this.velocity = 0;
		this.propVelocity = 0;

		this.drifting = false;

		this.boost = false;
		this.boostDelay = false;

		this.jumpDebounce = true;
		this.flipDebounce = true;
		this.hornSoundId = "";
		this.lastAttacker = undefined;

		this.ConnectionSteerFloat = 0;
		this.ConnectionThrottleFloat = 0;

		this.baseHealth = this.health;

		this.connectionThrottle = undefined;
		this.wasKilled = false;
		this.driving = false;

		//ACKERMAN STUFF
		const wheels = this.model.Wheels;
		const fl = wheels.FL.WheelMount;
		const fr = wheels.FR.WheelMount;
		const bl = wheels.BL.WheelMount;
		const br = wheels.BR.WheelMount;
		this.t = fl.Position.sub(fr.Position).Magnitude;
		this.l = fl.Position.sub(bl.Position).Magnitude;

		this.initialiseVehicleModel();

		if (this.owner) {
			const paintJob = DataUtils.GetEquippedItemOnVehicle(this.owner, "color", this.model.Name) as string;

			this.PaintVehicle(paintJob);

			const boostTrail = DataUtils.GetEquippedItemOnVehicle(this.owner, "boostTrail", this.model.Name) as string;

			this.ChangeBoostTrail(boostTrail);

			const hornSound = DataUtils.GetEquippedItemOnVehicle(this.owner, "hornSound", this.model.Name) as string;

			this.ChangeHornSound(hornSound);
		}
	}

	PaintVehicle(PaintName: string) {
		const model = this.model;
		let colorValue: Color3Value | undefined = undefined;

		if (PaintName === "None") {
			for (const modelPiece of (
				(game.GetService("ServerStorage") as unknown as { VehicleModels: Folder }).VehicleModels.FindFirstChild(
					model.Name,
				) as VehicleModel
			).Model.GetChildren()) {
				if (modelPiece.FindFirstChild("Colored")) {
					const value = new Instance("Color3Value");
					value.Value = (modelPiece as BasePart).Color;
					colorValue = value;
					break;
				}
			}
		} else {
			colorValue = (
				game.GetService("ServerStorage") as unknown as { Colors: Folder }
			).Colors.FindFirstChild(PaintName) as Color3Value;
		}

		for (const modelPiece of model.Model.GetChildren()) {
			if (modelPiece.FindFirstChild("Colored")) {
				(modelPiece as BasePart).Color = colorValue!.Value;
				(modelPiece as BasePart).Material = Enum.Material.Metal;
				GeneralUtils.RemoveChildrenOfType(modelPiece, "Texture");

				for (const texture of colorValue!.GetChildren()) {
					texture.Clone().Parent = modelPiece;
				}
			}
		}
	}

	ChangeBoostTrail(EffectName: string) {
		const trailEffect = (
			game.GetService("ServerStorage") as unknown as { BoostTrails: Folder }
		).BoostTrails.FindFirstChild(EffectName)!;
		const baseTrail = this.model.BoostEffectPart.FindFirstChildWhichIsA("Trail")!;
		const newTrail = trailEffect.FindFirstChildWhichIsA("Trail")!.Clone();
		newTrail.Parent = this.model.BoostEffectPart;
		newTrail.Attachment0 = baseTrail.Attachment0;
		newTrail.Attachment1 = baseTrail.Attachment1;
		baseTrail.Destroy();

		this.model.BoostEffectPart.FindFirstChildWhichIsA("ParticleEmitter")!.Destroy();
		const newParticles = trailEffect.FindFirstChildWhichIsA("ParticleEmitter")!.Clone();
		newParticles.Parent = this.model.BoostEffectPart;
	}

	ChangeHornSound(hornSound: string) {
		const sound = (
			game.GetService("ServerStorage") as unknown as { CarHorns: Folder }
		).CarHorns.FindFirstChild(hornSound) as Sound | undefined;
		if (sound) {
			this.hornSoundId = sound.SoundId;
		}
	}

	IsOwner(player: Player): boolean {
		return player === this.owner;
	}

	GetOwner(): Player | undefined {
		return this.owner;
	}

	// ---- physics queries (restored server-side implementations, a5318d46) ----

	GetTotalMass(): number {
		let totalMass = getMassOfModel(this.model);
		if (this.model.FindFirstChild("Seats")) {
			for (const seat of this.model.Seats.GetChildren()) {
				const occupant = (seat as VehicleSeat).Occupant;
				if (occupant && occupant.Parent) {
					totalMass += getMassOfModel(occupant.Parent);
				}
			}
		}

		return totalMass;
	}

	onGround(): boolean {
		if (this.model !== undefined && this.model.FindFirstChild("Wheels") !== undefined) {
			// Filter the whole car + driver (the original filtered only the one
			// wheel, so a ray could hit the car's own chassis and read "grounded").
			const filter: Instance[] = [this.model];
			if (this.owner && this.owner.Character) {
				filter.push(this.owner.Character);
			}
			groundRaycastParams.FilterDescendantsInstances = filter;

			for (const wheel of this.model.Wheels.GetChildren() as VehicleWheel[]) {
				const raycaster = wheel.turn;
				const up = raycaster.CFrame.UpVector;
				// Start 1 stud above the hub: after hard landings the hub can end
				// up flush with (or inside) the floor, and a ray that starts inside
				// a surface never hits it — the car then read "airborne", propulsion
				// force was zeroed, and controls were dead until a jump popped it free.
				const raycastResult = game.Workspace.Raycast(
					raycaster.Position.add(up),
					up.mul(-(1 + wheel.Wheel.Size.Y / 2 + 0.5)),
					groundRaycastParams,
				);
				if (raycastResult) {
					return true;
				}
			}
		}
		return false;
	}

	closeGround(): LuaTuple<[boolean, CFrame?]> {
		const filter: Instance[] = [this.model];
		if (this.owner && this.owner.Character) {
			filter.push(this.owner.Character);
		}
		groundRaycastParams.FilterDescendantsInstances = filter;
		const [Cframe, size] = this.model.GetBoundingBox();
		const raycastResult = game.Workspace.Raycast(
			Cframe.Position,
			new Vector3(0, -size.X / 2, 0),
			groundRaycastParams,
		);
		if (raycastResult) {
			const vehicleLV = this.model.Base.CFrame.LookVector;
			const upVector = raycastResult.Normal;
			const newRV = vehicleLV.Cross(upVector).Unit;
			const newUV = newRV.Cross(vehicleLV).Unit;
			const GyroCFrame = CFrame.fromMatrix(this.model.Base.Position, newRV, newUV, vehicleLV.mul(-1));
			return $tuple(true, GyroCFrame);
		} else {
			return $tuple(false, undefined);
		}
	}

	DealDamage(target: VehicleModel, hitBox: BasePart, velocity: number) {
		if (target.Seats.VehicleSeat.Occupant) {
			const targetPlayer = Players.GetPlayerFromCharacter(target.Seats.VehicleSeat.Occupant!.Parent as Model)!;

			//For TDM
			if (this.owner!.Neutral === false && targetPlayer.Team === this.owner!.Team) {
				return;
			}

			const targetVehicle = Globals.vehiclesTable[targetPlayer.UserId]!;

			let damage = 0;
			if (velocity < 0.5) {
				damage = 15 * this.damageMultiplier;
			} else if (velocity < 0.7) {
				damage = 25 * this.damageMultiplier;
			} else if (velocity < 1) {
				damage = 35 * this.damageMultiplier;
			} else if (velocity < 1.3) {
				damage = 45 * this.damageMultiplier;
			} else if (velocity > 1.3) {
				damage = 60 * this.damageMultiplier;
			}

			targetVehicle.TakeDamage(damage, this.owner, hitBox, this.model.Hitboxes.damageBlock);
		}
	}

	SmokeEngine() {
		if (this.model.Base.FindFirstChild("EngineSmoke")) {
			return;
		}

		const smoke = (
			game.GetService("ServerStorage") as unknown as { Effects: { EngineSmoke: Instance } }
		).Effects.EngineSmoke.Clone();
		smoke.Parent = this.model.Base;
	}

	BurnEngine() {
		if (this.model.Base.FindFirstChild("EngineBurn")) {
			return;
		}

		const burn = (
			game.GetService("ServerStorage") as unknown as { Effects: { EngineBurn: Instance } }
		).Effects.EngineBurn.Clone();
		burn.Parent = this.model.Base;
	}

	TakeDamage(damage: number, attacker?: Player, hitBox?: BasePart, damagePart?: BasePart) {
		//print(attacker)
		this.lastAttacker = attacker;

		this.health -= damage;
		this.model.Base.HealthBar.Green.Size = new UDim2(this.health / this.baseHealth, 0, 1, 0);

		if (hitBox && damagePart) {
			task.spawn(() => {
				this.CollisionEffect(hitBox, damagePart, attacker!, damage, this.health <= 0);
			});
		}

		if (this.health <= 0) {
			task.spawn(() => {
				this.DeathEffect();
			});
			this.KillVehicle(attacker, damage);
		} else if (this.health <= this.baseHealth / 4.5) {
			this.BurnEngine();
		} else if (this.health <= this.baseHealth / 2) {
			this.SmokeEngine();
		}
		(
			game.GetService("ServerStorage") as unknown as { Events: { PlayerDamaged: BindableEvent } }
		).Events.PlayerDamaged.Fire(this.owner, attacker, damage, false);
	}

	KillVehicle(attacker?: Player, damage?: number) {
		this.wasKilled = true;
		if (this.owner && this.owner.Character) {
			(this.owner.Character as unknown as { Humanoid: Humanoid }).Humanoid.Health = 0;
		}
		spawnVehicle.KillVehicle(this.owner!);
		(
			game.GetService("ServerStorage") as unknown as { Events: { PlayerDamaged: BindableEvent } }
		).Events.PlayerDamaged.Fire(this.owner, attacker, damage, true);
	}

	CollisionEffect(hitBoxPart: BasePart, damagePart: BasePart, attacker: Player, damage: number, wasKill: boolean) {
		const collisionPoint = getCenterOfIntersectingPoints(hitBoxPart, damagePart);
		showMoneyGainedOnAttackersScreen(attacker, damage, wasKill, collisionPoint);
		const effect = (
			game.GetService("ServerStorage") as unknown as {
				Effects: { VehicleCollision: Attachment & { BillboardGui: BillboardGui } };
			}
		).Effects.VehicleCollision.Clone();
		effect.Parent = (game.Workspace as unknown as { GameEffects: Folder }).GameEffects;
		if (this.model.FindFirstChild("Base")) {
			const sound = (
				game.GetService("ServerStorage") as unknown as { Sounds: { crash: Sound } }
			).Sounds.crash.Clone();
			sound.Parent = this.model.Base;
			sound.Play();
		}
		effect.WorldCFrame = damagePart.CFrame;
		effect.WorldPosition = collisionPoint;
		//loop over ParticleEmitters and turn them on
		for (const emitter of effect.GetChildren()) {
			if (emitter.IsA("ParticleEmitter")) {
				emitter.Enabled = true;
			}
		}
		task.wait(0.2);
		effect.BillboardGui.Enabled = false;
		for (const emitter of effect.GetChildren()) {
			if (emitter.IsA("ParticleEmitter")) {
				emitter.Enabled = false;
			}
		}
		task.wait(3);
		effect.Destroy();
	}

	DeathEffect() {
		//print("death effect")
		const effect = (
			game.GetService("ServerStorage") as unknown as { Effects: { VehicleDeath: Attachment } }
		).Effects.VehicleDeath.Clone();
		effect.Parent = (game.Workspace as unknown as { GameEffects: Folder }).GameEffects;
		const sound = (
			game.GetService("ServerStorage") as unknown as { Sounds: { explosion: Sound } }
		).Sounds.explosion.Clone();
		sound.Parent = effect;
		sound.Play();
		effect.WorldCFrame = this.model.Base.CFrame;

		task.wait(0.4);
		for (const emitter of effect.GetChildren()) {
			if (emitter.IsA("ParticleEmitter")) {
				emitter.Enabled = false;
			}
		}
		task.wait(3);
		effect.Destroy();
	}

	drive() {
		if (this.idleSoundId !== undefined) {
			if (volumes.get(this.idleSoundId) !== undefined) {
				this.model.Base.IdleSound.Volume = volumes.get(this.idleSoundId)!;
			}
			this.model.Base.IdleSound.SoundId = "rbxassetid://" + this.idleSoundId;
		}

		this.model.Base.IdleSound.Play();

		let lastCarHit: Instance | undefined = undefined;

		this.model.Hitboxes.damageBlock.Touched.Connect((part) => {
			if (part.Parent === undefined) {
				if (part !== undefined) {
					part.Destroy();
				}

				return;
			}
			this.velocity = -this.model.Base.CFrame.VectorToObjectSpace(this.model.Base.Velocity).Z; //velocity of vehicle
			this.propVelocity = math.abs(this.velocity) / this.targetVelocity; //proportional velocity

			if (this.propVelocity > 0.05) {
				if (
					(part.Parent!.Name === "Hitboxes" || part.Name === "damageBlock") &&
					part.Parent!.Parent !== this.model &&
					part.Parent!.Parent !== lastCarHit
				) {
					lastCarHit = part.Parent!.Parent;
					this.DealDamage(part.Parent!.Parent as VehicleModel, part, this.propVelocity);

					task.delay(1, () => {
						//This is to stop hitting the same car twice at the same time. Only an issue if our hitboxes are made up of multiple parts
						lastCarHit = undefined;
					});
				}
			}
		});

		// ---- server-authoritative drive loop (restored from a5318d46) ----

		//gears are defined as percentage of max speed
		const gearLimits = [0.4, 0.7, 1];

		const gearTorques = [0.8, 0.55, 0.3];
		// 2, 3, 5
		const playbackSpeeds = [1.3, 1.7, 2.3];
		const gearSpeedDrop = 0.6;

		let lastIncrementTime = time();

		let lastThrottle = 0;
		let releasedThrottle = false;

		// Humanoid.Seated can fire again mid-drive (physics jolts flicker Sit);
		// never stack a second loop on the same vehicle.
		if (this.driving) {
			return;
		}
		this.driving = true;

		// Fresh sit: never inherit input or ability state from a previous drive.
		this.ConnectionThrottleFloat = 0;
		this.ConnectionSteerFloat = 0;
		this.drifting = false;
		if (this.boost) {
			this.boost = false;
			this.UpdateBoostEffect();
		}

		const character = this.owner!.Character;
		const humanoid = character && character.FindFirstChildOfClass("Humanoid");
		const vehicleSeat = this.model.Seats.FindFirstChild("VehicleSeat") as VehicleSeat | undefined;

		// Exit on the seat's Occupant (the weld's ground truth) instead of
		// Humanoid.Sit — Sit can flicker false for a frame during hard impacts,
		// which used to kill the loop and leave the car permanently uncontrollable
		// until re-seating.
		while (
			humanoid !== undefined &&
			vehicleSeat !== undefined &&
			vehicleSeat.Occupant === humanoid &&
			this.model.Parent !== undefined &&
			this.model.FindFirstChild("Base") !== undefined
		) {
			pcall(() => {
				const steerFloat = this.ConnectionSteerFloat; // Left and right direction, between -1 and 1
				let throttle = this.ConnectionThrottleFloat; // Forward and backward direction, between -1 and 1

				if (this.connectionThrottle !== undefined) {
					throttle = this.connectionThrottle;
				}

				let targetVelocity = throttle * this.targetVelocity; //Target velocity
				const totalMass = this.GetTotalMass();
				const onGround = this.onGround();
				const [closeGroundBool, gyroCFrame] = this.closeGround();
				// Propulsion fallback: if the wheel rays miss but the chassis is
				// hugging the ground (bumps, compressed suspension, ray edge cases)
				// the engine keeps power instead of dropping to zero force.
				const grounded = onGround || closeGroundBool;

				//acceleration defined as an attribute multiplied by total mass
				const forceAtt = this.acceleration * totalMass * DRIVE_FORCE_MULT;
				let force = forceAtt;
				this.velocity = -this.model.Base.CFrame.VectorToObjectSpace(this.model.Base.Velocity).Z; //velocity of vehicle
				this.propVelocity = math.abs(this.velocity) / this.targetVelocity; //proportional velocity

				//SOUNDS
				for (const [i, gear] of ipairs(gearLimits)) {
					if (this.propVelocity <= gear) {
						if (gearLimits[i - 2] !== undefined) {
							this.model.Base.IdleSound.PlaybackSpeed =
								((playbackSpeeds[i - 1] - (playbackSpeeds[i - 2] - gearSpeedDrop)) /
									(gear - gearLimits[i - 2])) *
									(this.propVelocity - gear) +
								playbackSpeeds[i - 1];
						} else {
							this.model.Base.IdleSound.PlaybackSpeed =
								((playbackSpeeds[i - 1] - 1) / gear) * (this.propVelocity - gear) +
								playbackSpeeds[i - 1];
						}
						break;
					}
				}

				//Aerial Correction and controls
				if (onGround) {
					this.model.Base.Aerial.MaxTorque = 0 as unknown as Vector3;
					this.model.Base.BodyGyro.MaxTorque = new Vector3(0, 0, 0);
					if (releasedThrottle) {
						this.Pitch(0);
					}
					releasedThrottle = false;
				} else if (!closeGroundBool) {
					this.model.Base.BodyGyro.MaxTorque = new Vector3(0, 0, 0);
					this.Yaw(steerFloat);

					if (releasedThrottle) {
						this.Pitch(throttle);
					}

					if (lastThrottle === 0 && throttle !== 0) {
						releasedThrottle = true;
					}
				} else {
					//closeGround
					this.model.Base.Aerial.MaxTorque = 0 as unknown as Vector3;
					this.model.Base.BodyGyro.CFrame = gyroCFrame!;
					this.model.Base.BodyGyro.MaxTorque = new Vector3(math.huge, 0, math.huge);
					if (lastThrottle === 0 && throttle !== 0) {
						releasedThrottle = true;
					}
				}
				lastThrottle = throttle;

				this.turnWheels(throttle, steerFloat, grounded);

				const lookVector = this.model.Base.CFrame.LookVector;
				const rightVector = this.model.Base.CFrame.RightVector;

				let slopeCounterForce = 0;
				if (math.abs(rightVector.Y) > 0.1 && math.abs(rightVector.Y) < math.sin(math.rad(50))) {
					slopeCounterForce = totalMass * game.Workspace.Gravity * math.abs(rightVector.Y);
				}

				if (throttle > 0 && grounded) {
					//holding W
					if (this.velocity >= 0) {
						//moving forwards (gears)
						for (const [i, gear] of ipairs(gearLimits)) {
							if (this.propVelocity <= gear) {
								force *= gearTorques[i - 1] + gear - this.propVelocity;
								break;
							}
						}
					} else {
						//moving backwards
						force *= 2.6;
					}

					if (lookVector.Y > 0.1 && lookVector.Y < math.sin(math.rad(50))) {
						//ensures forwards driving on upwards slope
						force += totalMass * game.Workspace.Gravity * lookVector.Y;
					}
				} else if (throttle < 0 && grounded) {
					//holding S
					if (this.velocity <= 0) {
						//moving backwards
						targetVelocity *= 0.3;
						force *= 0.6;
					} else {
						//moving forwards
						targetVelocity *= 0.1;
						force *= 2.6;
					}

					if (lookVector.Y < -0.1 && lookVector.Y > -math.sin(math.rad(50))) {
						//ensures backwards driving on downward slope
						force -= totalMass * game.Workspace.Gravity * lookVector.Y;
					}
				} else if (!grounded) {
					force = 0;
				}

				if (this.boost === true && this.boostAmount >= 0) {
					//if boosting go back to gear 1 accel
					lastIncrementTime = this.boostIncrement(false, lastIncrementTime); //decrease boostAmount
					if (this.boostAmount > 0) {
						// Aerial boost gets extra force so nose-up boosting can
						// fight gravity and extend airtime.
						force = forceAtt * (grounded ? BOOST_FORCE_MULT : BOOST_AIR_FORCE_MULT); //resets force
						force += totalMass * game.Workspace.Gravity * lookVector.Y;
						targetVelocity = BOOST_TARGET_MULT * this.targetVelocity;
					}
				} else if (!this.boostDelay) {
					lastIncrementTime = this.boostIncrement(true, lastIncrementTime); //increase boostAmount
				}

				if (this.propVelocity > 1 && this.boost === false) {
					//if faster than max velocity, slow down
					force = forceAtt;
				}

				this.model.Base.LinearVelocity.MaxForce = force;
				this.model.Base.LinearVelocity.LineVelocity = targetVelocity;
				this.model.Base.slopeCounterVelocity.MaxForce = slopeCounterForce;
			});

			RunService.Heartbeat.Wait();
		}

		this.driving = false;

		pcall(() => {
			this.model.Base.LinearVelocity.MaxForce = 100000;
			this.model.Base.LinearVelocity.LineVelocity = 0;
			this.turnWheels(0, 0, false);
		});
	}

	turnWheels(throttle: number, steerFloat: number, onGround: boolean) {
		//https://datagenetics.com/blog/december12016/index.html
		if (this.drifting === true && onGround) {
			this.drift(steerFloat);
		} else {
			this.undrift();
		}

		const fl = this.model.Wheels.FL.turn.HingeConstraint;
		const fr = this.model.Wheels.FR.turn.HingeConstraint;

		let turnRadius = this.minTurnRadius;
		fl.AngularSpeed = this.maxAngularSpeed;
		fr.AngularSpeed = this.maxAngularSpeed;

		if (this.propVelocity > 0.5) {
			turnRadius += math.clamp(
				this.propVelocity * (this.maxTurnRadius - turnRadius),
				0,
				2 * (this.maxTurnRadius - turnRadius),
			);

			fl.AngularSpeed -= math.clamp(
				this.propVelocity * (fl.AngularSpeed - this.minAngularSpeed),
				0,
				fl.AngularSpeed - this.minAngularSpeed,
			);
			fr.AngularSpeed -= math.clamp(
				this.propVelocity * (fr.AngularSpeed - this.minAngularSpeed),
				0,
				fr.AngularSpeed - this.minAngularSpeed,
			);
		}

		//ACKERMAN
		//local gammaI = math.deg(math.atan(self.l/ (turnRadius-(self.t/2))))  --internal wheel
		//local gammaE = math.deg(math.atan(self.l/ (turnRadius+(self.t/2)))) --external wheel

		//ANTI ACKERMAN
		const gammaE = math.deg(math.atan(this.l / (turnRadius - this.t / 2))); //internal wheel
		const gammaI = math.deg(math.atan(this.l / (turnRadius + this.t / 2))); //external wheel

		if (steerFloat > 0) {
			fl.TargetAngle = steerFloat * gammaI;
			fr.TargetAngle = steerFloat * gammaE;
		} else if (steerFloat < 0) {
			fl.TargetAngle = steerFloat * gammaE;
			fr.TargetAngle = steerFloat * gammaI;
		} else {
			fl.TargetAngle = 0;
			fr.TargetAngle = 0;
		}
	}

	DriftHandler(inputState: Enum.UserInputState) {
		if (inputState === Enum.UserInputState.Begin) {
			this.drifting = true;
		} else {
			this.drifting = false;
		}
	}

	drift(steerFloat: number) {
		let sideForce = 0;
		// Drift is a cornering tool: no side thrust when (near) stationary —
		// Space + A/D from a standstill used to launch the car sideways.
		if (this.propVelocity >= DRIFT_MIN_PROP_VEL) {
			if (this.velocity >= 0) {
				sideForce = steerFloat * this.mass * DRIFT_SIDE_FORCE_FWD * this.driftingMult;
			} else {
				sideForce = -steerFloat * this.mass * DRIFT_SIDE_FORCE_REV * this.driftingMult;
			}

			// The LinearVelocity constraint only governs the forward axis, so
			// nothing opposes this thrust sideways — uncapped, lateral speed grew
			// without bound (drifting outran boost). Stop pushing once the slide
			// reaches its designed maximum.
			const sideVelocity = this.model.Base.CFrame.VectorToObjectSpace(this.model.Base.Velocity).X;
			const maxSideSpeed = DRIFT_MAX_SIDE_SPEED * this.targetVelocity;
			if ((sideForce > 0 && sideVelocity > maxSideSpeed) || (sideForce < 0 && sideVelocity < -maxSideSpeed)) {
				sideForce = 0;
			}
		}
		this.model.Base.DriftThrust.Force = new Vector3(sideForce, 0, 0);

		if (!this.model.Base.driftSound.Playing && steerFloat !== 0) {
			this.model.Base.driftSound.Play();
		} else if (steerFloat === 0) {
			this.model.Base.driftSound.Stop();
		}

		for (const wheel of this.model.Wheels.GetChildren() as VehicleWheel[]) {
			if (wheel.turn.FindFirstChild("Trail")) {
				(wheel.turn.FindFirstChild("Trail") as Trail).Enabled = true;
			}
		}
	}

	undrift() {
		this.model.Base.DriftThrust.Force = new Vector3(0, 0, 0);
		this.model.Base.driftSound.Stop();
		for (const wheel of this.model.Wheels.GetChildren() as VehicleWheel[]) {
			if (wheel.turn.FindFirstChild("Trail")) {
				(wheel.turn.FindFirstChild("Trail") as Trail).Enabled = false;
			}
		}
	}

	Boost(inputState: Enum.UserInputState) {
		if (inputState === Enum.UserInputState.Begin) {
			this.boost = true;
		} else {
			this.boost = false;
			this.boostDelay = true;
			task.delay(3, () => {
				this.boostDelay = false;
			});
		}

		this.UpdateBoostEffect();
	}

	UpdateBoostEffect() {
		const boostPart = this.model.BoostEffectPart;

		boostPart.ParticleEmitter.Enabled = this.boost;
		boostPart.Trail.Enabled = this.boost;

		if (this.boost) {
			boostPart.boostSound.Play();
		} else {
			boostPart.boostSound.Stop();
		}
	}

	setBoostMeter() {
		// Only touch the GUI when the value actually changed — re-creating a
		// 0.2s tween every Heartbeat made the bar jitter up and down.
		if (this.lastMeterAmount === this.boostAmount) {
			return;
		}
		this.lastMeterAmount = this.boostAmount;

		pcall(() => {
			const tweenInfo = new TweenInfo(0.2, Enum.EasingStyle.Linear);

			const barThingy = (
				this.owner as unknown as {
					PlayerGui: { Game: { BoostMeter: { GuageBar: { BarThingy: Frame } } } };
				}
			).PlayerGui.Game.BoostMeter.GuageBar.BarThingy;
			const tween = TweenService.Create(barThingy, tweenInfo, {
				Size: new UDim2(barThingy.Size.X.Scale, barThingy.Size.X.Offset, this.boostAmount / 100, 0),
			});
			tween.Play();
		});
	}

	boostIncrement(increase: boolean, lastInc: number): number {
		const currentTime = time();
		if (currentTime - lastInc >= 0.2) {
			if (increase) {
				this.boostAmount = math.clamp(this.boostAmount + 1, 0, 100); //increase boost
				this.setBoostMeter();
				return currentTime;
			} else {
				if (this.boostAmount === 0) {
					this.Boost(Enum.UserInputState.End); //if boost == 0, delays increase for 3s
					this.setBoostMeter();
					return currentTime;
				} else {
					this.boostAmount = math.clamp(this.boostAmount - 4, 0, 100); //decrease boost if boost >0
					this.setBoostMeter();
					return currentTime;
				}
			}
		}
		this.setBoostMeter();
		return lastInc;
	}

	Jump(inputState: Enum.UserInputState) {
		if (inputState === Enum.UserInputState.Begin && this.jumpDebounce === true) {
			this.jumpDebounce = false;
			this.model.Base.jumpSound.Play();
			const jumpThrust = this.model.Base.FindFirstChild("JumpThrust") as VectorForce | undefined;
			if (jumpThrust) {
				jumpThrust.Force = new Vector3(
					0,
					this.GetTotalMass() * game.Workspace.Gravity * JUMP_FORCE_GRAVITY_MULT,
					0,
				);
				task.wait(JUMP_FORCE_TIME);
				jumpThrust.Force = new Vector3(0, 0, 0);
			}
			task.wait(2);
			this.jumpDebounce = true;
		}
	}

	Flip() {
		if (this.flipDebounce === true && math.abs(this.velocity) < 5 && this.closeGround()[0]) {
			if (
				this.model.PrimaryPart!.Orientation.X > 60 ||
				this.model.PrimaryPart!.Orientation.X < -60 ||
				this.model.PrimaryPart!.Orientation.Z > 60 ||
				this.model.PrimaryPart!.Orientation.Z < -60
			) {
				this.flipDebounce = false;
				const vehicleLV = this.model.PrimaryPart!.CFrame.LookVector;
				const upVector = new Vector3(0, 1, 0);
				const newRV = vehicleLV.Cross(upVector).Unit;
				const newUV = newRV.Cross(vehicleLV).Unit;
				const flipCFrame = CFrame.fromMatrix(
					this.model.PrimaryPart!.Position.add(new Vector3(0, 10, 0)),
					newRV,
					newUV,
					vehicleLV.mul(-1),
				);

				this.model.Base.FlipMover.Position = this.model.PrimaryPart!.Position.add(new Vector3(0, 10, 0));
				this.model.Base.FlipMover.MaxForce = new Vector3(0, math.huge, 0);
				this.model.Base.BodyGyro.CFrame = flipCFrame;
				this.model.Base.BodyGyro.MaxTorque = new Vector3(math.huge, math.huge, math.huge);
				task.wait(1);
				this.model.Base.FlipMover.MaxForce = new Vector3(0, 0, 0);
				this.model.Base.BodyGyro.MaxTorque = new Vector3(0, 0, 0);
				task.wait(2);
				this.flipDebounce = true;
			}
		}
	}

	aerialControls(axis: string, value: number) {
		const aerial = this.model.Base.Aerial;
		aerial.MaxTorque = (this.GetTotalMass() * 378) as unknown as Vector3; //Aerial Controls
		aerial.AngularVelocity = Vector3ComponentSetter(aerial.AngularVelocity, axis, value)!;
	}

	aerialControlsReset(axis: string, compValue: number) {
		if (this.model !== undefined && this.model.FindFirstChild("Base") !== undefined) {
			const aerial = this.model.Base.Aerial;
			if (Vector3ComponentChecker(aerial.AngularVelocity, axis, compValue)) {
				aerial.AngularVelocity = Vector3ComponentSetter(aerial.AngularVelocity, axis, 0)!;
				if (aerial.AngularVelocity === new Vector3(0, 0, 0)) {
					aerial.MaxTorque = 0 as unknown as Vector3;
				}
			}
		}
	}

	RollLeft(inputState: Enum.UserInputState) {
		const axis = "X";
		const value = -6;
		if (inputState === Enum.UserInputState.Begin && !this.closeGround()[0]) {
			this.aerialControls(axis, value);
		} else {
			this.aerialControlsReset(axis, value);
		}
	}

	RollRight(inputState: Enum.UserInputState) {
		const axis = "X";
		const value = 6;
		if (inputState === Enum.UserInputState.Begin && !this.closeGround()[0]) {
			this.aerialControls(axis, value);
		} else {
			this.aerialControlsReset(axis, value);
		}
	}

	Yaw(steerFloat: number) {
		const axis = "Y";
		const value = -steerFloat * 6;
		this.aerialControls(axis, value);
		const aerial = this.model.Base.Aerial;
		if (aerial.AngularVelocity === new Vector3(0, 0, 0)) {
			aerial.MaxTorque = 0 as unknown as Vector3;
		}
	}

	Pitch(throttle: number) {
		const axis = "Z";
		const value = -throttle * 3;
		this.aerialControls(axis, value);
		const aerial = this.model.Base.Aerial;
		if (aerial.AngularVelocity === new Vector3(0, 0, 0)) {
			aerial.MaxTorque = 0 as unknown as Vector3;
		}
	}

	ChangeTrail(trailName: string) {
		const boostPart = this.model.BoostEffectPart;

		boostPart.ParticleEmitter.Destroy();
		boostPart.Trail.Destroy();

		const trailModel = (
			game.GetService("ServerStorage") as unknown as { BoostTrails: Folder }
		).BoostTrails.FindFirstChild(trailName)!;

		for (const trail of trailModel.GetChildren()) {
			const newTrail = trail.Clone();
			newTrail.Parent = boostPart;
		}
	}

	Horn(inputState: Enum.UserInputState) {
		if (inputState === Enum.UserInputState.Begin) {
			if (this.model && this.model.FindFirstChild("Base")) {
				this.model.Base.hornSound.SoundId = this.hornSoundId;

				this.model.Base.hornSound.Play();
			}
		}
	}

	ApplySkin(skin: string) {
		const skinTexture = (
			game.GetService("ServerStorage") as unknown as { Skins: Folder }
		).Skins.FindFirstChild(skin)!;
		GeneralUtils.IterateOverDescendantsOfType(
			this.model,
			"BasePart",
			applySkinIfSkinned as unknown as (object: Instance, ...args: unknown[]) => void,
			skinTexture,
		);
	}

	GetCost(): number {
		//	print(self.health)
		return this.cost;
	}

	GetCategory(): string {
		return this.category;
		// if self.category then return
		// 	self.category
		// else
		// 	return  _G.CarCategorys[math.random(1,#_G.CarCategorys)]
		// end
	}

	resetVehicle() {
		const paintJob = DataUtils.GetEquippedItemOnVehicle(this.owner!, "color", this.model.Name) as string;

		this.PaintVehicle(paintJob);

		const boostTrail = DataUtils.GetEquippedItemOnVehicle(this.owner!, "boostTrail", this.model.Name) as string;

		this.ChangeBoostTrail(boostTrail);

		const hornSound = DataUtils.GetEquippedItemOnVehicle(this.owner!, "hornSound", this.model.Name) as string;

		this.ChangeHornSound(hornSound);
	}
}

// ---- module-level physics helpers (restored from a5318d46) ----

const groundRaycastParams = new RaycastParams();
groundRaycastParams.FilterType = Enum.RaycastFilterType.Blacklist;
groundRaycastParams.IgnoreWater = true;

function getMassOfModel(model: Instance): number {
	let totalMass = 0;
	for (const part of model.GetDescendants()) {
		if (part.IsA("BasePart")) {
			totalMass += part.GetMass();
		}
	}
	return totalMass;
}

function Vector3ComponentSetter(vector: Vector3, axis: string, value: number): Vector3 | undefined {
	if (axis === "X") {
		return new Vector3(value, vector.Y, vector.Z);
	} else if (axis === "Y") {
		return new Vector3(vector.X, value, vector.Z);
	} else if (axis === "Z") {
		return new Vector3(vector.X, vector.Y, value);
	}
	return undefined;
}

function Vector3ComponentChecker(vector: Vector3, axis: string, value: number): boolean {
	if (axis === "X" && vector === new Vector3(value, vector.Y, vector.Z)) {
		return true;
	} else if (axis === "Y" && vector === new Vector3(vector.X, value, vector.Z)) {
		return true;
	} else if (axis === "Z" && vector === new Vector3(vector.X, vector.Y, value)) {
		return true;
	}
	return false;
}

function CalculatePartVertexPositions(part: BasePart): LuaTuple<[Vector3[], Vector3]> {
	const partPosition = part.Position;
	const partSize = part.Size;
	const vertices: Vector3[] = [];
	vertices[0] = part.CFrame.PointToWorldSpace(new Vector3(part.Size.X / 2, part.Size.Y / 2, -part.Size.Z / 2));
	vertices[1] = part.CFrame.PointToWorldSpace(new Vector3(part.Size.X / 2, -part.Size.Y / 2, -part.Size.Z / 2));
	vertices[2] = part.CFrame.PointToWorldSpace(new Vector3(-part.Size.X / 2, part.Size.Y / 2, -part.Size.Z / 2));
	vertices[3] = part.CFrame.PointToWorldSpace(new Vector3(-part.Size.X / 2, -part.Size.Y / 2, -part.Size.Z / 2));

	return $tuple(vertices, part.CFrame.LookVector);
}

function getCenterOfIntersectingPoints(hitBoxPart: BasePart, damagePart: BasePart): Vector3 {
	const [vertices, direction] = CalculatePartVertexPositions(damagePart);
	//createDebugingPartsAtHitpoints(vertices)
	let centerPoint = new Vector3(0, 0, 0);
	const totalDistance = 0;
	let centerPointCount = 0;

	for (const vertex of vertices) {
		const raycastParams = new RaycastParams();
		raycastParams.FilterType = Enum.RaycastFilterType.Whitelist;
		raycastParams.FilterDescendantsInstances = hitBoxPart.Parent!.GetChildren();
		const raycastResult = game.Workspace.Raycast(vertex, direction.mul(200), raycastParams);
		if (raycastResult) {
			centerPoint = centerPoint.add(raycastResult.Position);
			centerPointCount = centerPointCount + 1;
		}
	}

	centerPoint = centerPoint.div(centerPointCount);
	return centerPoint;
}

function createDebugingPartsAtHitpoints(hitPoints: Vector3[]) {
	for (const hitPoint of hitPoints) {
		const debugPart = new Instance("Part");
		debugPart.Size = new Vector3(0.3, 0.3, 0.3);
		debugPart.Position = hitPoint;
		debugPart.Anchored = true;
		debugPart.CanCollide = false;
		debugPart.Material = Enum.Material.Neon;
		debugPart.BrickColor = new BrickColor("Bright red");
		debugPart.Parent = game.Workspace;
	}
}

function createDebugingPartForCenterPoint(centerPoint: Vector3) {
	const debugPart = new Instance("Part");
	debugPart.Size = new Vector3(0.5, 0.5, 0.5);
	debugPart.Position = centerPoint;
	debugPart.Anchored = true;
	debugPart.CanCollide = false;
	debugPart.Color = new Color3(0, 1, 0.333333);
	debugPart.Material = Enum.Material.Neon;
	debugPart.Parent = game.Workspace;
}

function CreateMoneyUiAnimation(MoneyUi: TextLabel, screenPosition: Vector3) {
	MoneyUi.Position = new UDim2(0, screenPosition.X, 0, screenPosition.Y);

	const startPos = new UDim2(
		(math.random(1, 20) - 10) / 50,
		screenPosition.X,
		(math.random(1, 20) - 10) / 50,
		screenPosition.Y,
	);

	const tweenIn = TweenService.Create(
		MoneyUi,
		new TweenInfo(1, Enum.EasingStyle.Elastic, Enum.EasingDirection.Out),
		{ Position: startPos },
	);
	tweenIn.Play();
	tweenIn.Completed.Wait();

	const tweenInfo = new TweenInfo(1, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);
	task.wait(0.6);

	const tweenOut = TweenService.Create(MoneyUi, tweenInfo, {
		Position: new UDim2(startPos.X.Scale, startPos.X.Offset, 1.5, startPos.Y.Offset),
	});
	tweenOut.Play();
}

function showMoneyGainedOnAttackersScreen(attacker: Player, damage: number, wasKill: boolean, collisionPoint: Vector3) {
	const Gui = (attacker as unknown as { PlayerGui: { PlayerMoneyGainedPopups: ScreenGui } }).PlayerGui
		.PlayerMoneyGainedPopups;
	let screenPosition: Vector3 | undefined = undefined;

	// eslint-disable-next-line no-self-compare
	if (collisionPoint !== collisionPoint) {
		// NaN check (raycast found no intersection points → 0/0)
		screenPosition = FunctionsAndEvents.GetPlayerPointToScreenSpace.InvokeClient(
			attacker,
			(attacker.Character as unknown as { HumanoidRootPart: BasePart }).HumanoidRootPart.Position,
		) as Vector3;
	} else {
		screenPosition = FunctionsAndEvents.GetPlayerPointToScreenSpace.InvokeClient(
			attacker,
			collisionPoint,
		) as Vector3;
	}

	const damageUi = (
		game.GetService("ReplicatedStorage") as unknown as { Ui: { DamageMoney: TextLabel } }
	).Ui.DamageMoney.Clone();
	task.delay(0.1, () => {
		const damageMoney = Globals.calculateMultMoney(attacker, damage * Globals.DAMAGE_MONEY_MULT);
		const sound = (
			game.GetService("ServerStorage") as unknown as { Sounds: { cashSmall: Sound; cashBig: Sound } }
		).Sounds.cashSmall.Clone();
		if (damageMoney >= 10) {
			// Original declared a shadowed `local sound` here that was never used
			// outside this branch — preserved (the outer cashSmall still plays).
			const soundBig = (
				game.GetService("ServerStorage") as unknown as { Sounds: { cashBig: Sound } }
			).Sounds.cashBig.Clone();
		}
		sound.Parent = (attacker as unknown as { PlayerGui: Instance }).PlayerGui;
		sound.Play();
		damageUi.Text = "+" + damageMoney + "$";

		damageUi.Parent = Gui;
		CreateMoneyUiAnimation(damageUi, screenPosition!);
	});

	if (wasKill) {
		for (let i = 1; i <= 2; i++) {
			const sound = (
				(game.GetService("ServerStorage") as unknown as { Sounds: Folder }).Sounds.FindFirstChild(
					"killCoins" + i,
				) as Sound
			).Clone();
			sound.Parent = (attacker as unknown as { PlayerGui: Instance }).PlayerGui;
			sound.Play();
		}
		const KillMoney = Globals.calculateMultMoney(attacker, Globals.KILL_MONEY);

		const killUi = (
			game.GetService("ReplicatedStorage") as unknown as { Ui: { KillMoney: TextLabel } }
		).Ui.KillMoney.Clone();
		killUi.Text = "+" + KillMoney + "$";
		task.delay(0.4, () => {
			killUi.Parent = Gui;
			CreateMoneyUiAnimation(killUi, screenPosition!);
		});
	}
}

function applySkinIfSkinned(part: BasePart, skinTexture: Instance) {
	if (part.FindFirstChild("Skinned")) {
		if (part.FindFirstChildWhichIsA("Texture")) {
			part.FindFirstChildWhichIsA("Texture")!.Destroy();
		}

		const skin = skinTexture.Clone();
		skin.Parent = part;
	}
}

const volumes = new Map<number, number>([
	[484883392, 0.1],
	[319804747, 0.3],
	[532147820, 0.5],
	[2458730465, 0.2],
	[1724607017, 0.3],
	[134024901, 0.05],
]);

// The client-sided architecture's UpdateBoostEffect / UpdateDriftEffect remote
// handlers were removed: boost and drift effects are now toggled directly by
// the server-authoritative methods above (a5318d46 behavior).

export default VehicleClass;
