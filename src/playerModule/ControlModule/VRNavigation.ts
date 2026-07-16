//--!nolint GlobalUsedAsLocal (original directive)

// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/VRNavigation (ModuleScript)
//
//		VRNavigation

const VRService = game.GetService("VRService");
const UserInputService = game.GetService("UserInputService");
const RunService = game.GetService("RunService");
const Players = game.GetService("Players");
const PathfindingService = game.GetService("PathfindingService");
const ContextActionService = game.GetService("ContextActionService");
const StarterGui = game.GetService("StarterGui");

import BaseCharacterController from "./BaseCharacterController";
// Original: local PathDisplay = nil, then lazily require()'d via `coroutine.wrap(function() ... end)()`
// pulling in the sibling PathDisplay ModuleScript. The sibling is always present, so a static
// import is behaviorally equivalent (the original's `if PathDisplay then` guards are preserved
// below even though PathDisplay is now always defined, to keep the control flow byte-identical).
import PathDisplay from "./PathDisplay";

const LocalPlayer = Players.LocalPlayer;

//--[[ Constants ]]--
const RECALCULATE_PATH_THRESHOLD = 4;
const NO_PATH_THRESHOLD = 12;
const MAX_PATHING_DISTANCE = 200;
const POINT_REACHED_THRESHOLD = 1;
const OFFTRACK_TIME_THRESHOLD = 2;
const THUMBSTICK_DEADZONE = 0.22;

const ZERO_VECTOR3 = new Vector3(0, 0, 0);
const XZ_VECTOR3 = new Vector3(1, 0, 1);

//--[[ Utility Functions ]]--
function IsFinite(num: number): boolean {
	return num === num && num !== math.huge && num !== -math.huge;
}

function IsFiniteVector3(vec3: Vector3): boolean {
	return IsFinite(vec3.X) && IsFinite(vec3.Y) && IsFinite(vec3.Z);
}

const movementUpdateEvent = new Instance("BindableEvent");
movementUpdateEvent.Name = "MovementUpdate";
// Original: movementUpdateEvent.Parent = script (parented under the VRNavigation ModuleScript
// instance itself). script-self-parenting has no roblox-ts equivalent (there is no `script`
// object for a class field); the event is kept alive as a module-level upvalue instead, which is
// behaviorally equivalent for the only use (Fire from inside the class, no external listeners in
// this file access it via the instance tree).

// NOTE (faithful bug preservation): the original module declares `currentPath`, `currentPoints`,
// `currentPointIdx`, `moving`, `expectedTimeToNextPoint`, and `timeReachedLastPoint` as fields on
// `self` inside the constructor, but every read/write to these names elsewhere in the file
// (StartFollowingPath, GoToPoint, StopFollowingPath, TryComputePath) omits `self.` and so are, per
// Lua scoping rules, undeclared-global assignments distinct from the `self.*` fields (hence the
// `--!nolint GlobalUsedAsLocal` directive at the top of the source file suppressing the linter
// warning for this). This means:
//   - `self.currentPath`/`self.currentPoints`/`self.currentPointIdx`/`self.moving`/
//     `self.expectedTimeToNextPoint`/`self.timeReachedLastPoint` are set once in the constructor
//     and never reassigned afterwards.
//   - The *actual* live state used by StartFollowingPath/GoToPoint/StopFollowingPath/OnHeartbeat's
//     inner waypoint-walking logic is these bare (module-scope) variables below.
//   - `OnHeartbeat`'s gating condition `self.moving and self.currentPoints` is therefore always
//     false/undefined (since those self fields never change), meaning the path-walking block of
//     OnHeartbeat never actually executes. This is preserved exactly, bugs and all.
let currentPath: Path | boolean | undefined;
let currentPoints: Array<Vector3> | undefined;
let currentPointIdx = 0;
let moving = false;
let expectedTimeToNextPoint = 0;
let timeReachedLastPoint = tick();

//--[[ The Class ]]--
class VRNavigation extends BaseCharacterController {
	CONTROL_ACTION_PRIORITY: number;

	navigationRequestedConn: RBXScriptConnection | undefined;
	heartbeatConn: RBXScriptConnection | undefined;

	currentDestination: Vector3 | undefined;
	currentPath: Path | boolean | undefined;
	currentPoints: Array<Vector3> | undefined;
	currentPointIdx: number;

	expectedTimeToNextPoint: number;
	timeReachedLastPoint: number;
	moving: boolean;

	isJumpBound: boolean;
	moveLatch: boolean;

	userCFrameEnabledConn: RBXScriptConnection | undefined;

	constructor(CONTROL_ACTION_PRIORITY: number) {
		super();

		this.CONTROL_ACTION_PRIORITY = CONTROL_ACTION_PRIORITY;

		this.navigationRequestedConn = undefined;
		this.heartbeatConn = undefined;

		this.currentDestination = undefined;
		this.currentPath = undefined;
		this.currentPoints = undefined;
		this.currentPointIdx = 0;

		this.expectedTimeToNextPoint = 0;
		this.timeReachedLastPoint = tick();
		this.moving = false;

		this.isJumpBound = false;
		this.moveLatch = false;

		this.userCFrameEnabledConn = undefined;
	}

	SetLaserPointerMode(mode: string): void {
		pcall(() => {
			// "VRLaserPointerMode" is not part of the public SettableCores surface exposed by the
			// type definitions (it's an internal/undocumented core), hence the cast.
			(StarterGui.SetCore as unknown as (parameter: string, option: unknown) => void)(
				"VRLaserPointerMode",
				mode,
			);
		});
	}

	GetLocalHumanoid(): Humanoid | undefined {
		const character = LocalPlayer.Character;
		if (!character) {
			return undefined;
		}

		for (const child of character.GetChildren()) {
			if (child.IsA("Humanoid")) {
				return child;
			}
		}
		return undefined;
	}

	HasBothHandControllers(): boolean {
		return (
			VRService.GetUserCFrameEnabled(Enum.UserCFrame.RightHand) &&
			VRService.GetUserCFrameEnabled(Enum.UserCFrame.LeftHand)
		);
	}

	HasAnyHandControllers(): boolean {
		return (
			VRService.GetUserCFrameEnabled(Enum.UserCFrame.RightHand) ||
			VRService.GetUserCFrameEnabled(Enum.UserCFrame.LeftHand)
		);
	}

	IsMobileVR(): boolean {
		return UserInputService.TouchEnabled;
	}

	HasGamepad(): boolean {
		return UserInputService.GamepadEnabled;
	}

	ShouldUseNavigationLaser(): boolean {
		// Places where we use the navigation laser:
		// mobile VR with any number of hands tracked
		// desktop VR with only one hand tracked
		// desktop VR with no hands and no gamepad (i.e. with Oculus remote?)
		// using an Xbox controller with a desktop VR headset means no laser since the user has a thumbstick.
		// in the future, we should query thumbstick presence with a features API
		if (this.IsMobileVR()) {
			return true;
		} else {
			if (this.HasBothHandControllers()) {
				return false;
			}
			if (!this.HasAnyHandControllers()) {
				return !this.HasGamepad();
			}
			return true;
		}
	}

	StartFollowingPath(newPath: Path): void {
		currentPath = newPath;
		currentPoints = newPath.GetPointCoordinates() as unknown as Array<Vector3>;
		currentPointIdx = 1;
		moving = true;

		timeReachedLastPoint = tick();

		const humanoid = this.GetLocalHumanoid();
		if (humanoid && humanoid.Torso && currentPoints.size() >= 1) {
			const dist = currentPoints[0].sub(humanoid.Torso.Position).Magnitude;
			expectedTimeToNextPoint = dist / humanoid.WalkSpeed;
		}

		movementUpdateEvent.Fire("targetPoint", this.currentDestination);
	}

	GoToPoint(point: Vector3): void {
		currentPath = true;
		currentPoints = [point];
		currentPointIdx = 1;
		moving = true;

		const humanoid = this.GetLocalHumanoid();
		const distance = humanoid!.Torso!.Position.sub(point).Magnitude;
		const estimatedTimeRemaining = distance / humanoid!.WalkSpeed;

		timeReachedLastPoint = tick();
		expectedTimeToNextPoint = estimatedTimeRemaining;

		movementUpdateEvent.Fire("targetPoint", point);
	}

	StopFollowingPath(): void {
		currentPath = undefined;
		currentPoints = undefined;
		currentPointIdx = 0;
		moving = false;
		this.moveVector = ZERO_VECTOR3;
	}

	TryComputePath(startPos: Vector3, destination: Vector3): Path | undefined {
		let numAttempts = 0;
		let newPath: Path | undefined = undefined;

		while (!newPath && numAttempts < 5) {
			newPath = PathfindingService.ComputeSmoothPathAsync(startPos, destination, MAX_PATHING_DISTANCE);
			numAttempts += 1;

			if (
				newPath.Status === Enum.PathStatus.ClosestNoPath ||
				newPath.Status === Enum.PathStatus.ClosestOutOfRange
			) {
				newPath = undefined;
				break;
			}

			if (newPath && newPath.Status === Enum.PathStatus.FailStartNotEmpty) {
				startPos = startPos.add(destination.sub(startPos).Unit);
				newPath = undefined;
			}

			if (newPath && newPath.Status === Enum.PathStatus.FailFinishNotEmpty) {
				destination = destination.add(new Vector3(0, 1, 0));
				newPath = undefined;
			}
		}

		return newPath;
	}

	OnNavigationRequest(destinationCFrame: CFrame, inputUserCFrame: Enum.UserCFrame): void {
		const destinationPosition = destinationCFrame.Position;
		const lastDestination = this.currentDestination;

		if (!IsFiniteVector3(destinationPosition)) {
			return;
		}

		this.currentDestination = destinationPosition;

		const humanoid = this.GetLocalHumanoid();
		if (!humanoid || !humanoid.Torso) {
			return;
		}

		const currentPosition = humanoid.Torso.Position;
		const distanceToDestination = this.currentDestination.sub(currentPosition).Magnitude;

		if (distanceToDestination < NO_PATH_THRESHOLD) {
			this.GoToPoint(this.currentDestination);
			return;
		}

		if (!lastDestination || this.currentDestination.sub(lastDestination).Magnitude > RECALCULATE_PATH_THRESHOLD) {
			const newPath = this.TryComputePath(currentPosition, this.currentDestination);
			if (newPath) {
				this.StartFollowingPath(newPath);
				if (PathDisplay) {
					PathDisplay.setCurrentPoints(this.currentPoints);
					PathDisplay.renderPath();
				}
			} else {
				this.StopFollowingPath();
				if (PathDisplay) {
					PathDisplay.clearRenderedPath();
				}
			}
		} else {
			if (moving) {
				// Faithful bug preservation: self.currentPoints is always undefined (see the note
				// above the module-scope state variables), so this indexes into `undefined` and
				// throws at runtime exactly like the original Luau (`attempt to index nil`).
				(this.currentPoints as unknown as Array<Vector3>)[currentPoints!.size() - 1] = this.currentDestination;
			} else {
				this.GoToPoint(this.currentDestination);
			}
		}
	}

	OnJumpAction(actionName?: string, inputState?: Enum.UserInputState, inputObj?: InputObject): Enum.ContextActionResult {
		if (inputState === Enum.UserInputState.Begin) {
			this.isJumping = true;
		}
		return Enum.ContextActionResult.Sink;
	}

	BindJumpAction(active: boolean): void {
		if (active) {
			if (!this.isJumpBound) {
				this.isJumpBound = true;
				ContextActionService.BindActionAtPriority(
					"VRJumpAction",
					() => this.OnJumpAction(),
					false,
					this.CONTROL_ACTION_PRIORITY,
					Enum.KeyCode.ButtonA,
				);
			}
		} else {
			if (this.isJumpBound) {
				this.isJumpBound = false;
				ContextActionService.UnbindAction("VRJumpAction");
			}
		}
	}

	ControlCharacterGamepad(
		actionName: string,
		inputState: Enum.UserInputState,
		inputObject: InputObject,
	): Enum.ContextActionResult | undefined {
		if (inputObject.KeyCode !== Enum.KeyCode.Thumbstick1) return undefined;

		if (inputState === Enum.UserInputState.Cancel) {
			this.moveVector = ZERO_VECTOR3;
			return undefined;
		}

		if (inputState !== Enum.UserInputState.End) {
			this.StopFollowingPath();
			if (PathDisplay) {
				PathDisplay.clearRenderedPath();
			}

			if (this.ShouldUseNavigationLaser()) {
				this.BindJumpAction(true);
				this.SetLaserPointerMode("Hidden");
			}

			if (inputObject.Position.Magnitude > THUMBSTICK_DEADZONE) {
				this.moveVector = new Vector3(inputObject.Position.X, 0, -inputObject.Position.Y);
				if (this.moveVector.Magnitude > 0) {
					this.moveVector = this.moveVector.Unit.mul(math.min(1, inputObject.Position.Magnitude));
				}

				this.moveLatch = true;
			}
		} else {
			this.moveVector = ZERO_VECTOR3;

			if (this.ShouldUseNavigationLaser()) {
				this.BindJumpAction(false);
				this.SetLaserPointerMode("Navigation");
			}

			if (this.moveLatch) {
				this.moveLatch = false;
				movementUpdateEvent.Fire("offtrack");
			}
		}
		return Enum.ContextActionResult.Sink;
	}

	OnHeartbeat(dt: number): void {
		let newMoveVector = this.moveVector;
		const humanoid = this.GetLocalHumanoid();
		if (!humanoid || !humanoid.Torso) {
			return;
		}

		// See the faithful-bug-preservation note above the module-scope state variables:
		// self.moving is always false and self.currentPoints is always undefined, so this branch
		// never actually runs (matching the original's dead code).
		if (this.moving && this.currentPoints) {
			const currentPosition = humanoid.Torso.Position;
			const goalPosition = currentPoints![0];
			const vectorToGoal = goalPosition.sub(currentPosition).mul(XZ_VECTOR3);
			const moveDist = vectorToGoal.Magnitude;
			const moveDir = vectorToGoal.div(moveDist);

			if (moveDist < POINT_REACHED_THRESHOLD) {
				let estimatedTimeRemaining = 0;
				let prevPoint = currentPoints![0];
				for (const [i, point] of pairs(currentPoints!)) {
					if (i !== 1) {
						const dist = point.sub(prevPoint).Magnitude;
						prevPoint = point;
						estimatedTimeRemaining += dist / humanoid.WalkSpeed;
					}
				}

				currentPoints!.remove(0);
				currentPointIdx += 1;

				if (currentPoints!.size() === 0) {
					this.StopFollowingPath();
					if (PathDisplay) {
						PathDisplay.clearRenderedPath();
					}
					return;
				} else {
					if (PathDisplay) {
						PathDisplay.setCurrentPoints(currentPoints);
						PathDisplay.renderPath();
					}

					const newGoal = currentPoints![0];
					const distanceToGoal = newGoal.sub(currentPosition).Magnitude;
					expectedTimeToNextPoint = distanceToGoal / humanoid.WalkSpeed;
					timeReachedLastPoint = tick();
				}
			} else {
				const ignoreTable: Array<Instance> = [
					Players.LocalPlayer.Character as Instance,
					game.Workspace.CurrentCamera as Instance,
				];
				const obstructRay = new Ray(currentPosition.sub(new Vector3(0, 1, 0)), moveDir.mul(3));
				const [obstructPart, obstructPoint, obstructNormal] = game.Workspace.FindPartOnRayWithIgnoreList(
					obstructRay,
					ignoreTable,
				);

				if (obstructPart) {
					const heightOffset = new Vector3(0, 100, 0);
					const jumpCheckRay = new Ray(
						obstructPoint.add(moveDir.mul(0.5)).add(heightOffset),
						heightOffset.mul(-1),
					);
					const [jumpCheckPart, jumpCheckPoint, jumpCheckNormal] = game.Workspace.FindPartOnRayWithIgnoreList(
						jumpCheckRay,
						ignoreTable,
					);

					const heightDifference = jumpCheckPoint.Y - currentPosition.Y;
					if (heightDifference < 6 && heightDifference > -2) {
						humanoid.Jump = true;
					}
				}

				const timeSinceLastPoint = tick() - timeReachedLastPoint;
				if (timeSinceLastPoint > expectedTimeToNextPoint + OFFTRACK_TIME_THRESHOLD) {
					this.StopFollowingPath();
					if (PathDisplay) {
						PathDisplay.clearRenderedPath();
					}

					movementUpdateEvent.Fire("offtrack");
				}

				newMoveVector = this.moveVector.Lerp(moveDir, dt * 10);
			}
		}

		if (IsFiniteVector3(newMoveVector)) {
			this.moveVector = newMoveVector;
		}
	}

	OnUserCFrameEnabled(): void {
		if (this.ShouldUseNavigationLaser()) {
			this.BindJumpAction(false);
			this.SetLaserPointerMode("Navigation");
		} else {
			this.BindJumpAction(true);
			this.SetLaserPointerMode("Hidden");
		}
	}

	Enable(enable: boolean): boolean {
		this.moveVector = ZERO_VECTOR3;
		this.isJumping = false;

		if (enable) {
			this.navigationRequestedConn = VRService.NavigationRequested.Connect((destinationCFrame, inputUserCFrame) =>
				this.OnNavigationRequest(destinationCFrame, inputUserCFrame),
			);
			this.heartbeatConn = RunService.Heartbeat.Connect((dt) => this.OnHeartbeat(dt));

			ContextActionService.BindAction(
				"MoveThumbstick",
				(actionName, inputState, inputObject) => this.ControlCharacterGamepad(actionName, inputState, inputObject),
				false,
				this.CONTROL_ACTION_PRIORITY,
				Enum.KeyCode.Thumbstick1,
			);
			ContextActionService.BindActivate(Enum.UserInputType.Gamepad1, Enum.KeyCode.ButtonR2);

			this.userCFrameEnabledConn = VRService.UserCFrameEnabled.Connect(() => this.OnUserCFrameEnabled());
			this.OnUserCFrameEnabled();

			VRService.SetTouchpadMode(Enum.VRTouchpad.Left, Enum.VRTouchpadMode.VirtualThumbstick);
			VRService.SetTouchpadMode(Enum.VRTouchpad.Right, Enum.VRTouchpadMode.ABXY);

			this.enabled = true;
		} else {
			// Disable
			this.StopFollowingPath();

			ContextActionService.UnbindAction("MoveThumbstick");
			ContextActionService.UnbindActivate(Enum.UserInputType.Gamepad1, Enum.KeyCode.ButtonR2);

			this.BindJumpAction(false);
			this.SetLaserPointerMode("Disabled");

			if (this.navigationRequestedConn) {
				this.navigationRequestedConn.Disconnect();
				this.navigationRequestedConn = undefined;
			}
			if (this.heartbeatConn) {
				this.heartbeatConn.Disconnect();
				this.heartbeatConn = undefined;
			}
			if (this.userCFrameEnabledConn) {
				this.userCFrameEnabledConn.Disconnect();
				this.userCFrameEnabledConn = undefined;
			}
			this.enabled = false;
		}

		return this.enabled;
	}
}

export = VRNavigation;
