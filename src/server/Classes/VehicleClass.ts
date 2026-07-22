// Original: ServerStorage/Classes/VehicleClass (ModuleScript)
//
// Phase 2 of the server authority migration (SERVER_AUTHORITY_PLAN.md): this
// class is now the SERVER WRAPPER only — ownership, damage, health, economy,
// cosmetics. Everything that determines the car's motion lives in the shared
// simulation core (shared/vehicleSim/VehicleSim), which this class registers
// the vehicle with and forwards inputs to. Rendering (sounds, trails, boost
// meter, health bar fill) happens in client/vehicleRenderer.client.ts from
// the attributes the sim and this class write.

import GeneralUtils from "../GeneralUtils";
import DataUtils from "../Modules/DataUtilities";
import DataStore2 from "../Modules/DataStore2";
import DSDefaultValues from "../Modules/DataStoreDefaults";
import spawnVehicle from "../Modules/spawnVehicle";
import { Globals } from "../Globals";
import { COLLISION_GROUPS } from "shared/collisionGroups";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import { VehicleModel, VehicleModelAttr } from "shared/vehicleSim/VehicleSim";

// The instance shape types moved to the shared sim; re-exported so the
// subclasses and spawnVehicle keep importing them from here.
export type { VehicleWheel, VehicleBase, VehicleModel } from "shared/vehicleSim/VehicleSim";

//services
const Players = game.GetService("Players");
const TweenService = game.GetService("TweenService");
const MarketplaceService = game.GetService("MarketplaceService");
const RunService = game.GetService("RunService");

//Globals
Globals.CarCategorys = ["City", "Off Road", "Sports", "Specials", "Military"];

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
	hornSoundId: string;
	lastAttacker?: Player;
	baseHealth: number;
	wasKilled: boolean;

	initialiseVehicleModel() {
		const base = this.model.Base;

		for (const wheel of this.model.Wheels.GetChildren() as VehicleSim.VehicleWheel[]) {
			wheel.WheelMount.SpringConstraint.Damping = this.damping;
			wheel.WheelMount.SpringConstraint.Stiffness = this.stiffness;
			wheel.WheelMount.SpringConstraint.FreeLength = this.freeLength;

			wheel.turn.trail.Position = new Vector3(wheel.DisplayWheel.Size.X / 2, -wheel.Wheel.Size.Y / 2 + 0.15, 0);
			wheel.turn.trail2.Position = new Vector3(-wheel.DisplayWheel.Size.X / 2, -wheel.Wheel.Size.Y / 2 + 0.15, 0);
		}

		const density = this.mass / (base.Size.X * base.Size.Y * base.Size.Z);

		const physPropertiesBase = new PhysicalProperties(density, 0.4, 0.25, 1, 1);

		base.CustomPhysicalProperties = physPropertiesBase;

		// Idle engine sound config (the renderer plays and pitches it).
		if (this.idleSoundId !== undefined) {
			if (volumes.get(this.idleSoundId) !== undefined) {
				base.IdleSound.Volume = volumes.get(this.idleSoundId)!;
			}
			base.IdleSound.SoundId = "rbxassetid://" + this.idleSoundId;
		}

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
				// Top Table D1: the outline shows the pitch SIDE (Red/Blue),
				// not the ladder team's list color. CB_Side is set by the
				// match layer before SpawnVehicle runs, and changes mid-round
				// when a team is moved between pitches (muckabout rescue /
				// free-play pairing) without a respawn.
				const applySideColor = () => {
					const side = this.owner!.GetAttribute("CB_Side");
					if (side === "Blue") {
						teamHighlight.OutlineColor = Color3.fromRGB(79, 168, 255);
					} else if (side === "Red") {
						teamHighlight.OutlineColor = Color3.fromRGB(255, 80, 80);
					} else {
						teamHighlight.OutlineColor = this.owner!.TeamColor.Color;
					}
				};
				applySideColor();
				const sideConnection = this.owner.GetAttributeChangedSignal("CB_Side").Connect(applySideColor);
				this.model.Destroying.Connect(() => sideConnection.Disconnect());
				teamHighlight.Parent = this.model;
				teamHighlight.Adornee = this.model;
			}
		} else {
			healthBar.PlayerTag.Visible = false;
		}

		// Register with the shared simulation core: creates the constraint
		// movers, writes the tuning/state attributes, sets wheel friction.
		VehicleSim.register(
			this.model,
			{
				mass: this.mass,
				acceleration: this.acceleration,
				targetVelocity: this.targetVelocity,
				minTurnRadius: this.minTurnRadius + 5,
				maxTurnRadius: this.maxTurnRadius,
				maxAngularSpeed: this.maxAngularSpeed,
				minAngularSpeed: this.minAngularSpeed,
				boostAmount: this.boostAmount,
				driftingMult: this.driftingMult,
			},
			this.owner,
		);

		// Game-state attributes (the renderer draws the health bar from these).
		this.model.SetAttribute(VehicleModelAttr.MaxHealth, this.baseHealth);
		this.model.SetAttribute(VehicleModelAttr.Health, this.health);

		// (Phase 3: the per-vehicle inputChangedEvent RemoteEvent is gone —
		// movement floats arrive through the owner's InputActions, read by the
		// sim tick.)

		// Damage detection (server): a spatial query instead of .Touched — a
		// Touched connection plants a TouchTransmitter inside the assembly,
		// and the prediction system refuses assemblies containing
		// unpredictable instance types. Same checks, same speed gate, same
		// single-slot 1s dedupe as the old handler.
		this.model.Hitboxes.damageBlock.CanQuery = true; // spatial queries need it
		let lastCarHit: Instance | undefined = undefined;
		const overlapParams = new OverlapParams();
		overlapParams.FilterType = Enum.RaycastFilterType.Whitelist;
		overlapParams.FilterDescendantsInstances = [(game.Workspace as unknown as { Vehicles: Folder }).Vehicles];
		// Hitbox parts live in the Hitbox collision group (ball contact surface,
		// spawnVehicle), which does NOT collide with Default — the group this
		// query would otherwise run under, silently excluding every hitbox.
		// HitboxQuery is a query-only group that collides with Hitbox parts only.
		overlapParams.CollisionGroup = COLLISION_GROUPS.HitboxQuery;
		const damageConnection = RunService.Heartbeat.Connect(() => {
			if (this.model.Parent === undefined) {
				damageConnection.Disconnect();
				return;
			}
			const hitboxes = this.model.FindFirstChild("Hitboxes");
			const damageBlock = hitboxes && hitboxes.FindFirstChild("damageBlock");
			if (!damageBlock || !damageBlock.IsA("BasePart") || !this.model.FindFirstChild("Base")) {
				return;
			}
			// GetVelocityAtPosition(Base.Position) == the old Base.Velocity read.
			const velocity = -this.model.Base.CFrame.VectorToObjectSpace(
				this.model.Base.GetVelocityAtPosition(this.model.Base.Position),
			).Z;
			const propVelocity = math.abs(velocity) / this.targetVelocity;
			if (propVelocity <= 0.05) {
				return;
			}
			for (const part of game.Workspace.GetPartsInPart(damageBlock, overlapParams)) {
				if (part.Parent === undefined) {
					continue;
				}
				if (
					(part.Parent!.Name === "Hitboxes" || part.Name === "damageBlock") &&
					part.Parent!.Parent !== this.model &&
					part.Parent!.Parent !== lastCarHit
				) {
					lastCarHit = part.Parent!.Parent;
					this.DealDamage(part.Parent!.Parent as VehicleModel, part, propVelocity);

					task.delay(1, () => {
						//This is to stop hitting the same car twice at the same time. Only an issue if our hitboxes are made up of multiple parts
						lastCarHit = undefined;
					});
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

		this.hornSoundId = "";
		this.lastAttacker = undefined;
		this.baseHealth = this.health;
		this.wasKilled = false;

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
			// Assign the SoundId now, not at first honk: clients download the
			// asset ahead of time, and the owner's local-first horn playback
			// (VehicleKeyHandler) clones a ready-to-play sound.
			if (this.model && this.model.FindFirstChild("Base")) {
				this.model.Base.hornSound.SoundId = this.hornSoundId;
			}
		}
	}

	IsOwner(player: Player): boolean {
		return player === this.owner;
	}

	GetOwner(): Player | undefined {
		return this.owner;
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
		// The renderer draws the health bar fill from this attribute.
		this.model.SetAttribute(VehicleModelAttr.Health, this.health);

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

	// ---- input & ability forwarding into the shared sim ----

	DriftHandler(inputState: Enum.UserInputState) {
		VehicleSim.setDriftHeld(this.model, inputState === Enum.UserInputState.Begin);
	}

	Boost(inputState: Enum.UserInputState) {
		VehicleSim.setBoostHeld(this.model, inputState === Enum.UserInputState.Begin);
	}

	Jump(inputState: Enum.UserInputState) {
		if (inputState === Enum.UserInputState.Begin) {
			VehicleSim.requestJump(this.model);
		}
	}

	Flip() {
		VehicleSim.requestFlip(this.model);
	}

	RollLeft(inputState: Enum.UserInputState) {
		VehicleSim.setRoll(this.model, -1, inputState === Enum.UserInputState.Begin);
	}

	RollRight(inputState: Enum.UserInputState) {
		VehicleSim.setRoll(this.model, 1, inputState === Enum.UserInputState.Begin);
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

// ---- module-level helpers (server-only: money popups, skins, effects) ----

function CalculatePartVertexPositions(part: BasePart): LuaTuple<[Vector3[], Vector3]> {
	const vertices: Vector3[] = [];
	vertices[0] = part.CFrame.PointToWorldSpace(new Vector3(part.Size.X / 2, part.Size.Y / 2, -part.Size.Z / 2));
	vertices[1] = part.CFrame.PointToWorldSpace(new Vector3(part.Size.X / 2, -part.Size.Y / 2, -part.Size.Z / 2));
	vertices[2] = part.CFrame.PointToWorldSpace(new Vector3(-part.Size.X / 2, part.Size.Y / 2, -part.Size.Z / 2));
	vertices[3] = part.CFrame.PointToWorldSpace(new Vector3(-part.Size.X / 2, -part.Size.Y / 2, -part.Size.Z / 2));

	return $tuple(vertices, part.CFrame.LookVector);
}

function getCenterOfIntersectingPoints(hitBoxPart: BasePart, damagePart: BasePart): Vector3 {
	const [vertices, direction] = CalculatePartVertexPositions(damagePart);
	let centerPoint = new Vector3(0, 0, 0);
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

export default VehicleClass;
