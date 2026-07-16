// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/VehicleController (ModuleScript)
//
// FileName: VehicleControl
// Version 1.0
// Written by: jmargh
// Description: Implements in-game vehicle controls for all input devices
//
// NOTE: This works for basic vehicles (single vehicle seat). If you use custom VehicleSeat code,
// multiple VehicleSeats or your own implementation of a VehicleSeat this will not work.

const ContextActionService = game.GetService("ContextActionService");

// Constants
// Set this to true if you want to instead use the triggers for the throttle
const useTriggersForThrottle = true;
// Also set this to true if you want the thumbstick to not affect throttle, only triggers when a gamepad is conected
const onlyTriggersForThrottle = true;
const ZERO_VECTOR3 = new Vector3(0, 0, 0);

const AUTO_PILOT_DEFAULT_MAX_STEERING_ANGLE = 35;

// Note that VehicleController does not derive from BaseCharacterController, it is a special case
class VehicleController {
	CONTROL_ACTION_PRIORITY: number;

	enabled = false;
	vehicleSeat?: VehicleSeat;
	throttle = 0;
	steer = 0;

	acceleration = 0;
	decceleration = 0;
	turningRight = 0;
	turningLeft = 0;

	vehicleMoveVector: Vector3 = ZERO_VECTOR3;

	autoPilot: { MaxSpeed: number; MaxSteeringAngle: number } = {
		MaxSpeed: 0,
		MaxSteeringAngle: 0,
	};

	constructor(CONTROL_ACTION_PRIORITY: number) {
		this.CONTROL_ACTION_PRIORITY = CONTROL_ACTION_PRIORITY;
	}

	BindContextActions(): void {
		if (useTriggersForThrottle) {
			ContextActionService.BindActionAtPriority(
				"throttleAccel",
				(actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
					this.OnThrottleAccel(actionName, inputState, inputObject);
					return Enum.ContextActionResult.Pass;
				},
				false,
				this.CONTROL_ACTION_PRIORITY,
				Enum.KeyCode.ButtonR2,
			);
			ContextActionService.BindActionAtPriority(
				"throttleDeccel",
				(actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
					this.OnThrottleDeccel(actionName, inputState, inputObject);
					return Enum.ContextActionResult.Pass;
				},
				false,
				this.CONTROL_ACTION_PRIORITY,
				Enum.KeyCode.ButtonL2,
			);
		}
		ContextActionService.BindActionAtPriority(
			"arrowSteerRight",
			(actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
				this.OnSteerRight(actionName, inputState, inputObject);
				return Enum.ContextActionResult.Pass;
			},
			false,
			this.CONTROL_ACTION_PRIORITY,
			Enum.KeyCode.Right,
		);
		ContextActionService.BindActionAtPriority(
			"arrowSteerLeft",
			(actionName: string, inputState: Enum.UserInputState, inputObject: InputObject) => {
				this.OnSteerLeft(actionName, inputState, inputObject);
				return Enum.ContextActionResult.Pass;
			},
			false,
			this.CONTROL_ACTION_PRIORITY,
			Enum.KeyCode.Left,
		);
	}

	Enable(enable: boolean, vehicleSeat?: VehicleSeat): void {
		if (enable === this.enabled && vehicleSeat === this.vehicleSeat) {
			return;
		}

		this.enabled = enable;
		this.vehicleMoveVector = ZERO_VECTOR3;

		if (enable) {
			if (vehicleSeat) {
				this.vehicleSeat = vehicleSeat;

				this.SetupAutoPilot();
				this.BindContextActions();
			}
		} else {
			if (useTriggersForThrottle) {
				ContextActionService.UnbindAction("throttleAccel");
				ContextActionService.UnbindAction("throttleDeccel");
			}
			ContextActionService.UnbindAction("arrowSteerRight");
			ContextActionService.UnbindAction("arrowSteerLeft");
			this.vehicleSeat = undefined;
		}
	}

	OnThrottleAccel(actionName: string, inputState: Enum.UserInputState, inputObject: InputObject): void {
		if (inputState === Enum.UserInputState.End || inputState === Enum.UserInputState.Cancel) {
			this.acceleration = 0;
		} else {
			this.acceleration = -1;
		}
		this.throttle = this.acceleration + this.decceleration;
	}

	OnThrottleDeccel(actionName: string, inputState: Enum.UserInputState, inputObject: InputObject): void {
		if (inputState === Enum.UserInputState.End || inputState === Enum.UserInputState.Cancel) {
			this.decceleration = 0;
		} else {
			this.decceleration = 1;
		}
		this.throttle = this.acceleration + this.decceleration;
	}

	OnSteerRight(actionName: string, inputState: Enum.UserInputState, inputObject: InputObject): void {
		if (inputState === Enum.UserInputState.End || inputState === Enum.UserInputState.Cancel) {
			this.turningRight = 0;
		} else {
			this.turningRight = 1;
		}
		this.steer = this.turningRight + this.turningLeft;
	}

	OnSteerLeft(actionName: string, inputState: Enum.UserInputState, inputObject: InputObject): void {
		if (inputState === Enum.UserInputState.End || inputState === Enum.UserInputState.Cancel) {
			this.turningLeft = 0;
		} else {
			this.turningLeft = -1;
		}
		this.steer = this.turningRight + this.turningLeft;
	}

	// Call this from a function bound to Renderstep with Input Priority
	Update(moveVector: Vector3, cameraRelative: boolean, usingGamepad: boolean): LuaTuple<[Vector3, boolean]> {
		if (this.vehicleSeat) {
			if (cameraRelative) {
				// This is the default steering mode
				moveVector = moveVector.add(new Vector3(this.steer, 0, this.throttle));
				if (usingGamepad && onlyTriggersForThrottle && useTriggersForThrottle) {
					this.vehicleSeat.ThrottleFloat = -this.throttle;
				} else {
					this.vehicleSeat.ThrottleFloat = -moveVector.Z;
				}
				this.vehicleSeat.SteerFloat = moveVector.X;

				return $tuple(moveVector, true);
			} else {
				// This is the path following mode
				const localMoveVector = this.vehicleSeat.Occupant!.RootPart!.CFrame.VectorToObjectSpace(moveVector);

				this.vehicleSeat.ThrottleFloat = this.ComputeThrottle(localMoveVector);
				this.vehicleSeat.SteerFloat = this.ComputeSteer(localMoveVector);

				return $tuple(ZERO_VECTOR3, true);
			}
		}
		return $tuple(moveVector, false);
	}

	ComputeThrottle(localMoveVector: Vector3): number {
		if (localMoveVector !== ZERO_VECTOR3) {
			const throttle = -localMoveVector.Z;
			return throttle;
		} else {
			return 0.0;
		}
	}

	ComputeSteer(localMoveVector: Vector3): number {
		if (localMoveVector !== ZERO_VECTOR3) {
			const steerAngle = -math.atan2(-localMoveVector.X, -localMoveVector.Z) * (180 / math.pi);
			return steerAngle / this.autoPilot.MaxSteeringAngle;
		} else {
			return 0.0;
		}
	}

	SetupAutoPilot(): void {
		// Setup default
		this.autoPilot.MaxSpeed = this.vehicleSeat!.MaxSpeed;
		this.autoPilot.MaxSteeringAngle = AUTO_PILOT_DEFAULT_MAX_STEERING_ANGLE;

		// VehicleSeat should have a MaxSteeringAngle as well.
		// Or we could look for a child "AutoPilotConfigModule" to find these values
		// Or allow developer to set them through the API as like the CLickToMove customization API
	}
}

export = VehicleController;
