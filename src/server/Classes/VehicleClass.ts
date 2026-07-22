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
import { getUiIntentEvent } from "shared/UiIntents";
import * as VehicleSim from "shared/vehicleSim/VehicleSim";
import { VehicleModel, VehicleModelAttr } from "shared/vehicleSim/VehicleSim";

// The instance shape types moved to the shared sim; re-exported so the
// subclasses and spawnVehicle keep importing them from here.
export type { VehicleWheel, VehicleBase, VehicleModel } from "shared/vehicleSim/VehicleSim";

//services
const Players = game.GetService("Players");
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
				// Side-tinted player icon above the name in the car's
				// billboard: the same ReplicatedStorage.Ui.PlayerIcon the
				// match HUD rosters use (background = side color, Person =
				// headshot), so the car overhead matches the HUD art.
				// Square via RelativeYY. Keep it inside the BillboardGui canvas:
				// GuiObjects above the canvas (the former negative-Y placement) are
				// clipped by the billboard renderer and never become visible.
				let sideIcon: (Frame & { Person: ImageLabel; Value: TextLabel }) | undefined;
				const [iconCreated, iconError] = pcall(() => {
					const template = (
						game.GetService("ReplicatedStorage") as unknown as {
							Ui: { PlayerIcon: Frame & { Person: ImageLabel; Value: TextLabel } };
						}
					).Ui.PlayerIcon;
					const icon = template.Clone();
					icon.Name = "SideIcon";
					icon.Value.Visible = false; // kill-count slot from the deathmatch row
					icon.Person.Image = `rbxthumb://type=AvatarHeadShot&id=${this.owner!.UserId}&w=48&h=48`;
					icon.AnchorPoint = new Vector2(0.5, 0);
					icon.Position = new UDim2(0.5, 0, 0.02, 0);
					icon.Size = new UDim2(0.42, 0, 0.42, 0);
					icon.SizeConstraint = Enum.SizeConstraint.RelativeYY;
					icon.Parent = healthBar;

					// Reserve the middle band for the name and the bottom band for
					// health. These are explicit because the place-file template was
					// authored before the overhead avatar icon existed.
					healthBar.PlayerTag.Position = new UDim2(0, 0, 0.44, 0);
					healthBar.PlayerTag.Size = new UDim2(1, 0, 0.36, 0);
					const green = healthBar.FindFirstChild("Green");
					const red = healthBar.FindFirstChild("Red");
					for (const bar of [green, red]) {
						if (bar && bar.IsA("GuiObject")) {
							bar.Position = new UDim2(bar.Position.X.Scale, bar.Position.X.Offset, 0.82, 0);
							bar.Size = new UDim2(bar.Size.X.Scale, bar.Size.X.Offset, 0.18, 0);
						}
					}
					sideIcon = icon;
				});
				if (!iconCreated) {
					warn(`[VehicleClass] Could not create overhead icon for ${this.owner.Name}: ${tostring(iconError)}`);
				}
				// Top Table D1: the outline shows the pitch SIDE (Red/Blue),
				// not the ladder team's list color. CB_Side is set by the
				// match layer before SpawnVehicle runs, and changes mid-round
				// when a team is moved between pitches (muckabout rescue /
				// free-play pairing) without a respawn. The billboard icon
				// follows the same color so overhead identity matches the
				// outline and the HUD.
				const applySideColor = () => {
					const side = this.owner!.GetAttribute("CB_Side");
					let color: Color3;
					if (side === "Blue") {
						color = Color3.fromRGB(79, 168, 255);
					} else if (side === "Red") {
						color = Color3.fromRGB(255, 80, 80);
					} else {
						color = this.owner!.TeamColor.Color;
					}
					teamHighlight.OutlineColor = color;
					if (sideIcon !== undefined) {
						sideIcon.BackgroundColor3 = color;
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
		// Damage broadphase at 30 Hz, not every Heartbeat: with the damage
		// boxes spanning whole cars, even a 300 stud/s closing pass overlaps
		// for ≥ 2 ticks at this cadence, and halving N per-car overlap queries
		// per second is real server headroom with a full lobby.
		const DAMAGE_QUERY_INTERVAL = 1 / 30;
		let damageQueryAccum = 0;
		const damageConnection = RunService.Heartbeat.Connect((heartbeatDt) => {
			if (this.model.Parent === undefined) {
				damageConnection.Disconnect();
				return;
			}
			damageQueryAccum += heartbeatDt;
			if (damageQueryAccum < DAMAGE_QUERY_INTERVAL) {
				return;
			}
			damageQueryAccum = 0;
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

		// The Metal swap moves real mass (~11× plastic density) — flag the sim
		// to re-measure SimMass; mass is no longer sampled per tick.
		VehicleSim.refreshMass(model);
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
		// Textures are weightless today, but any future skin that swaps parts
		// or materials must keep SimMass honest — the refresh is cheap and rare.
		VehicleSim.refreshMass(this.model);
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

// Phase 3 (client UI migration): PlayerMoneyGainedPopups is CLIENT-mounted and
// the whole presentation (label clones, tweens, cash/coin sounds) runs in
// src/client/ui/moneyPopups.client.ts. The server keeps computing the amounts
// exactly as before (calculateMultMoney × DAMAGE_MONEY_MULT / KILL_MONEY —
// display-only; the actual grant stays in roundHandler's PlayerDamaged handler)
// and pushes them over the Ui_MoneyGained remote with the WORLD anchor point —
// no more per-hit GetPlayerPointToScreenSpace.InvokeClient (a server-blocking
// client invoke), server-side tweens, or Sounds parented into PlayerGui.
let moneyGainedRemote: RemoteEvent | undefined;

function moneyGainedEvent(): RemoteEvent {
	if (moneyGainedRemote === undefined) {
		moneyGainedRemote = getUiIntentEvent("Ui_MoneyGained");
	}
	return moneyGainedRemote;
}

function showMoneyGainedOnAttackersScreen(attacker: Player, damage: number, wasKill: boolean, collisionPoint: Vector3) {
	let worldPoint = collisionPoint;
	// eslint-disable-next-line no-self-compare
	if (collisionPoint !== collisionPoint) {
		// NaN check (raycast found no intersection points → 0/0) — anchor on the
		// attacker's own character instead, like the original screen-space
		// fallback did (originally a dot-access that threw without a character).
		const character = attacker.Character;
		const root = character ? character.FindFirstChild("HumanoidRootPart") : undefined;
		if (!root || !root.IsA("BasePart")) {
			return;
		}
		worldPoint = root.Position;
	}

	const damageMoney = Globals.calculateMultMoney(attacker, damage * Globals.DAMAGE_MONEY_MULT);
	moneyGainedEvent().FireClient(attacker, damageMoney, "damage", worldPoint);

	if (wasKill) {
		const killMoney = Globals.calculateMultMoney(attacker, Globals.KILL_MONEY);
		moneyGainedEvent().FireClient(attacker, killMoney, "kill", worldPoint);
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
