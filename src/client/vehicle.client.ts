// Original: StarterPlayer/StarterPlayerScripts/vehicle (LocalScript)

import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import { legacyWait, legacyDelay } from "shared/LegacyTiming";

const TweenService = game.GetService("TweenService");
const ContextActionService = game.GetService("ContextActionService");
const RunService = game.GetService("RunService");
const UserInputService = game.GetService("UserInputService");
const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;
const GetKeyBinding = FunctionsAndEvents.GetKeyBinding;

// ---- instance shapes (same vehicle model tree the server class uses) ----

interface VehicleWheel extends Model {
	WheelMount: BasePart & { SpringConstraint: SpringConstraint };
	turn: BasePart & { HingeConstraint: HingeConstraint };
	Wheel: BasePart;
	DisplayWheel: BasePart;
}

interface VehicleBase extends BasePart {
	IdleSound: Sound;
	jumpSound: Sound;
	LinearVelocity: LinearVelocity;
	slopeCounterVelocity: LinearVelocity;
	DriftThrust: VectorForce;
	Aerial: BodyAngularVelocity;
	BodyGyro: BodyGyro;
	FlipMover: BodyPosition;
}

interface ClientVehicleModel extends Model {
	Base: VehicleBase;
	Wheels: Folder & Record<"FL" | "FR" | "BL" | "BR", VehicleWheel>;
	Seats: Folder & { VehicleSeat: VehicleSeat };
}

// The serialized server VehicleClass object received through DriveVehicle
// (methods are stripped by remote serialization; data fields survive).
interface VehicleParams {
	model: ClientVehicleModel;
	owner: Player;
	mass: number;
	acceleration: number;
	targetVelocity: number;
	minTurnRadius: number;
	maxTurnRadius: number;
	maxAngularSpeed: number;
	minAngularSpeed: number;
	boostAmount: number;
	driftingMult: number;
	[key: string]: unknown;
}

interface MobileInterfaceShape extends ScreenGui {
	Jump: TextButton;
	Drift: TextButton;
	Boost: TextButton;
}

class Vehicle {
	model!: ClientVehicleModel;
	owner!: Player;
	mass!: number;
	acceleration!: number;
	targetVelocity!: number;
	minTurnRadius!: number;
	maxTurnRadius!: number;
	maxAngularSpeed!: number;
	minAngularSpeed!: number;
	boostAmount!: number;
	driftingMult!: number;
	velocity!: number;
	propVelocity!: number;
	drifting!: boolean;
	boost!: boolean;
	boostDelay!: boolean;
	jumpDebounce!: boolean;
	flipDebounce!: boolean;
	t!: number;
	l!: number;

	constructor(params: VehicleParams) {
		for (const [i, param] of pairs(params as unknown as Record<string, unknown>)) {
			(this as unknown as Record<string, unknown>)[i as string] = param;
		}

		const newVehicle = this;

		//JUMP
		const jumpFunction = (actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) => {
			newVehicle.Jump(inputState);
		};

		ContextActionService.BindAction(
			"Jump1",
			jumpFunction as never,
			false,
			GetKeyBinding.InvokeServer("Jump") as Enum.KeyCode,
		);
		let connection: RBXScriptConnection;
		connection = game.GetService("UserInputService").InputBegan.Connect((input) => {
			if (input.KeyCode === Enum.KeyCode.ButtonA) {
				connection.Disconnect();
				ContextActionService.BindAction("Jump2", jumpFunction as never, false, Enum.KeyCode.ButtonA);
			}
		});
		const mobileInterface = (
			LocalPlayer as unknown as { PlayerGui: { MobileInterface: MobileInterfaceShape } }
		).PlayerGui.MobileInterface;
		mobileInterface.Jump.MouseButton1Down.Connect(() => {
			jumpFunction("Jump1", Enum.UserInputState.Begin, undefined);
		});
		mobileInterface.Jump.MouseButton1Up.Connect(() => {
			jumpFunction("Jump1", Enum.UserInputState.End, undefined);
		});

		//DRIFT
		const driftFunction = (actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) => {
			newVehicle.DriftHandler(inputState);
		};

		ContextActionService.BindAction(
			"Drift",
			driftFunction as never,
			false,
			GetKeyBinding.InvokeServer("Drift") as Enum.KeyCode,
			Enum.KeyCode.ButtonL1,
		);

		mobileInterface.Drift.MouseButton1Down.Connect(() => {
			driftFunction("Drift", Enum.UserInputState.Begin, undefined);
		});
		mobileInterface.Drift.MouseButton1Up.Connect(() => {
			driftFunction("Drift", Enum.UserInputState.End, undefined);
		});

		//BOOST
		const boostFunction = (actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) => {
			newVehicle.Boost(inputState);
		};

		ContextActionService.BindAction(
			"Boost",
			boostFunction as never,
			false,
			GetKeyBinding.InvokeServer("Boost") as Enum.KeyCode,
			Enum.KeyCode.ButtonR1,
		);
		mobileInterface.Boost.MouseButton1Down.Connect(() => {
			boostFunction("Boost", Enum.UserInputState.Begin, undefined);
		});
		mobileInterface.Boost.MouseButton1Up.Connect(() => {
			boostFunction("Boost", Enum.UserInputState.End, undefined);
		});

		//ROLL
		const rollLeft = (actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) => {
			newVehicle.RollLeft(inputState);
		};

		const rollRight = (actionName: string, inputState: Enum.UserInputState, inputObject?: InputObject) => {
			newVehicle.RollRight(inputState);
		};

		ContextActionService.BindAction(
			"RollLeft",
			rollLeft as never,
			false,
			GetKeyBinding.InvokeServer("RollLeft") as Enum.KeyCode,
			Enum.KeyCode.ButtonL3,
		);
		ContextActionService.BindAction(
			"RollRight",
			rollRight as never,
			false,
			GetKeyBinding.InvokeServer("RollRight") as Enum.KeyCode,
			Enum.KeyCode.ButtonR3,
		);

		newVehicle.drive();
	}

	drive() {
		//gears are defined as percentage of max speed
		const gearLimits = [0.4, 0.7, 1];

		const gearTorques = [0.8, 0.55, 0.3];
		// 2, 3, 5
		const playbackSpeeds = [1.3, 1.7, 2.3];
		const gearSpeedDrop = 0.6;

		const canDealDamage = true;

		let lastIncrementTime = time();

		let lastThrottle = 0;
		let releasedThrottle = false;

		while (
			this.owner.Character !== undefined &&
			(this.owner.Character as unknown as { Humanoid: Humanoid }).Humanoid.Sit &&
			this.model !== undefined &&
			this.model.FindFirstChild("Base") !== undefined
		) {
			pcall(() => {
				let throttle = 0;
				let steerFloat = 0;
				if (UserInputService.TouchEnabled) {
					// mobile
					throttle = joystickThrottle();
					steerFloat = joystickSteer();
				} else if (UserInputService.GamepadEnabled) {
					// console
					throttle = getThrottle();

					steerFloat = joystickSteer();
					if (steerFloat === 0) {
						steerFloat = getSteer();
					}
				} else {
					// pc
					throttle = getThrottle();
					steerFloat = getSteer();
				}

				let targetVelocity = throttle * this.targetVelocity; //Target velocity
				const totalMass = this.GetTotalMass();
				const onGround = this.onGround();
				const [closeGroundBool, gyroCFrame] = this.closeGround();

				//acceleration defined as an attribute multiplied by total mass
				const forceAtt = this.acceleration * totalMass;
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
								((playbackSpeeds[i - 1] - 1) / gear) * (this.propVelocity - gear) + playbackSpeeds[i - 1];
						}
						break;
					}
				}
				//print("Velocity: ", math.round(self.velocity))
				//print(self.boostAmount)

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

				this.turnWheels(throttle, steerFloat, onGround);

				const lookVector = this.model.Base.CFrame.LookVector;
				const upVector = this.model.Base.CFrame.UpVector;
				const rightVector = this.model.Base.CFrame.RightVector;

				let slopeCounterForce = 0;
				if (math.abs(rightVector.Y) > 0.1 && math.abs(rightVector.Y) < math.sin(math.rad(50))) {
					slopeCounterForce = totalMass * game.Workspace.Gravity * math.abs(rightVector.Y);
				}

				if (throttle > 0 && onGround) {
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
				} else if (throttle < 0 && onGround) {
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
				} else if (!onGround) {
					force = 0;
				}

				if (this.boost === true && this.boostAmount >= 0) {
					//if boosting go back to gear 1 accel
					lastIncrementTime = this.boostIncrement(false, lastIncrementTime); //decrease boostAmount
					if (this.boostAmount > 0) {
						force = forceAtt * 3; //resets force
						force += totalMass * game.Workspace.Gravity * lookVector.Y;
						targetVelocity = 1.6 * this.targetVelocity;
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

		pcall(() => {
			this.model.Base.LinearVelocity.MaxForce = 100000;
			this.model.Base.LinearVelocity.LineVelocity = 0;
			this.turnWheels(0, undefined as unknown as number, undefined);
		});
	}

	turnWheels(throttle: number, steerFloat: number, onGround: boolean | undefined) {
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
		if (this.velocity >= 0) {
			this.model.Base.DriftThrust.Force = new Vector3(steerFloat * this.mass * 200 * this.driftingMult, 0, 0); //OLD 70,000 self.mass*467
		} else {
			this.model.Base.DriftThrust.Force = new Vector3(-steerFloat * this.mass * 130 * this.driftingMult, 0, 0); //OLD 40,000 self.mass*267
		}

		FunctionsAndEvents.UpdateDriftEffect.FireServer(true, this, steerFloat);
	}

	undrift() {
		this.model.Base.DriftThrust.Force = new Vector3(0, 0, 0);

		FunctionsAndEvents.UpdateDriftEffect.FireServer(false, this);
	}

	Boost(inputState: Enum.UserInputState) {
		if (inputState === Enum.UserInputState.Begin) {
			this.boost = true;
		} else {
			this.boost = false;
			this.boostDelay = true;
			legacyDelay(3, () => {
				this.boostDelay = false;
			});
		}

		this.UpdateBoostEffect();
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
					//fuck u
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

	setBoostMeter() {
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
	}

	UpdateBoostEffect() {
		FunctionsAndEvents.UpdateBoostEffect.FireServer(this);
	}

	onGround(): boolean | undefined {
		if (this.model !== undefined && this.model.FindFirstChild("Wheels") !== undefined) {
			for (const wheel of this.model.Wheels.GetChildren() as VehicleWheel[]) {
				groundRaycastParams.FilterDescendantsInstances = [wheel.GetChildren() as unknown as Instance];
				const raycaster = wheel.turn;
				const raycastResult = game.Workspace.Raycast(
					raycaster.Position,
					raycaster.CFrame.UpVector.mul(-(wheel.Wheel.Size.Y / 2 + 0.5)),
					groundRaycastParams,
				);
				if (raycastResult) {
					return true;
				}
			}
		}
		return undefined;
	}

	closeGround(): LuaTuple<[boolean, CFrame?]> {
		groundRaycastParams.FilterDescendantsInstances = [
			this.model.GetDescendants() as unknown as Instance,
			GetDecendantsOfType(this.owner.Character!, "BasePart") as unknown as Instance,
		];
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

	GetTotalMass(): number {
		let totalMass = getMassOfModel(this.model);
		if (this.model.FindFirstChild("Seats")) {
			for (const seat of this.model.Seats.GetChildren()) {
				totalMass += getMassOfModel((seat as VehicleSeat).Occupant!.Parent as Model);
			}
		}

		return totalMass;
	}

	Jump(inputState: Enum.UserInputState) {
		if (inputState === Enum.UserInputState.Begin && this.jumpDebounce === true) {
			this.jumpDebounce = false;
			this.model.Base.jumpSound.Play();
			this.model.Base.FlipMover.Position = this.model.PrimaryPart!.Position.add(new Vector3(0, 45, 0));
			this.model.Base.FlipMover.MaxForce = new Vector3(0, math.huge, 0);
			legacyWait(0.01);
			this.model.Base.FlipMover.MaxForce = new Vector3(0, 0, 0);
			legacyWait(2);
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
				legacyWait(1);
				this.model.Base.FlipMover.MaxForce = new Vector3(0, 0, 0);
				this.model.Base.BodyGyro.MaxTorque = new Vector3(0, 0, 0);
				legacyWait(2);
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
}

function getThrottle(): number {
	let throttle = 0;

	if (
		UserInputService.IsKeyDown(Enum.KeyCode.W) ||
		UserInputService.IsGamepadButtonDown(Enum.UserInputType.Gamepad1, Enum.KeyCode.ButtonR2)
	) {
		throttle += 1;
	}

	if (
		UserInputService.IsKeyDown(Enum.KeyCode.S) ||
		UserInputService.IsGamepadButtonDown(Enum.UserInputType.Gamepad1, Enum.KeyCode.ButtonL2)
	) {
		throttle -= 1;
	}

	return throttle;
}

function getSteer(): number {
	let steer = 0;

	if (UserInputService.IsKeyDown(Enum.KeyCode.D)) {
		steer += 1;
	}

	if (UserInputService.IsKeyDown(Enum.KeyCode.A)) {
		steer -= 1;
	}

	return steer;
}

function joystickThrottle(): number {
	let throttleFloat = 0;

	if (LocalPlayer.Character) {
		const MoveDirection = (LocalPlayer.Character as unknown as { Humanoid: Humanoid }).Humanoid.MoveDirection;
		const newMoveVector = (
			LocalPlayer.Character as unknown as { HumanoidRootPart: BasePart }
		).HumanoidRootPart.CFrame.VectorToObjectSpace(MoveDirection);

		if (math.abs(newMoveVector.Z - throttleFloat) > 0.2) {
			throttleFloat = newMoveVector.Z * -1;
		}
	}

	return throttleFloat;
}

function joystickSteer(): number {
	let steerFloat = 0;

	if (LocalPlayer.Character) {
		const MoveDirection = (LocalPlayer.Character as unknown as { Humanoid: Humanoid }).Humanoid.MoveDirection;
		const newMoveVector = (
			LocalPlayer.Character as unknown as { HumanoidRootPart: BasePart }
		).HumanoidRootPart.CFrame.VectorToObjectSpace(MoveDirection);

		if (math.abs(newMoveVector.X - steerFloat) > 0.2) {
			steerFloat = newMoveVector.X;
		}
	}

	return steerFloat;
}

const groundRaycastParams = new RaycastParams();
groundRaycastParams.FilterType = Enum.RaycastFilterType.Blacklist;
groundRaycastParams.IgnoreWater = true;

function GetDecendantsOfType(instance: Instance, typeName: keyof Instances): Instance[] {
	const descendantsOfType: Instance[] = [];
	for (const desc of instance.GetDescendants()) {
		if (desc.IsA(typeName)) {
			descendantsOfType.push(desc);
		}
	}
	return descendantsOfType;
}

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
		vector = new Vector3(value, vector.Y, vector.Z);
		return vector;
	} else if (axis === "Y") {
		vector = new Vector3(vector.X, value, vector.Z);
		return vector;
	} else if (axis === "Z") {
		vector = new Vector3(vector.X, vector.Y, value);
		return vector;
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

FunctionsAndEvents.DriveVehicle.OnClientEvent.Connect((...args: unknown[]) => {
	new Vehicle(args[0] as VehicleParams);
});
