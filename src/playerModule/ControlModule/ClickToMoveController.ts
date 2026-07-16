// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/ClickToMoveController (ModuleScript)
//
//	-- Original By Kip Turner, Copyright Roblox 2014
//	-- Updated by Garnold to utilize the new PathfindingService API, 2017
//	-- 2018 PlayerScripts Update - AllYourBlox

import Keyboard from "./Keyboard";
import ClickToMoveDisplay from "./ClickToMoveDisplay";
import { legacyWait } from "shared/LegacyTiming";

//--[[ Flags ]]
let FFlagUserExcludeNonCollidableForPathfinding: boolean;
{
	const [success, value] = pcall(() =>
		UserSettings().IsUserFeatureEnabled("UserExcludeNonCollidableForPathfinding"),
	);
	FFlagUserExcludeNonCollidableForPathfinding = success && (value as boolean);
}

//--[[ Roblox Services ]]--
const UserInputService = game.GetService("UserInputService");
const PathfindingService = game.GetService("PathfindingService");
const Players = game.GetService("Players");
const DebrisService = game.GetService("Debris");
const StarterGui = game.GetService("StarterGui");
const Workspace = game.GetService("Workspace");
const CollectionService = game.GetService("CollectionService");
const GuiService = game.GetService("GuiService");

//--[[ Configuration ]]
let ShowPath = true;
let PlayFailureAnimationConfig = true;
let UseDirectPath = false;
let UseDirectPathForVehicle = true;
let AgentSizeIncreaseFactor = 1.0;
let UnreachableWaypointTimeout = 8;

//--[[ Constants ]]--
const movementKeys = new Map<Enum.KeyCode, boolean>([
	[Enum.KeyCode.W, true],
	[Enum.KeyCode.A, true],
	[Enum.KeyCode.S, true],
	[Enum.KeyCode.D, true],
	[Enum.KeyCode.Up, true],
	[Enum.KeyCode.Down, true],
]);

const Player = Players.LocalPlayer;

const ZERO_VECTOR3 = new Vector3(0, 0, 0);
const ALMOST_ZERO = 0.000001;

// Minimal structural shape for TouchJumpController (a ControlModule sibling translated elsewhere);
// only the members ClickToMove actually calls are declared here, matching the "structurally
// duplicated, not imported" pattern already used by Popper.ts for cross-sibling shapes.
interface TouchJumpControllerLike {
	Enable(enable: boolean): void;
}

//------------------------UTIL LIBRARY-------------------------------
function FindCharacterAncestor(part: Instance | undefined): LuaTuple<[Instance | undefined, Humanoid | undefined]> {
	if (part) {
		const humanoid = part.FindFirstChildOfClass("Humanoid");
		if (humanoid) {
			return $tuple(part, humanoid);
		} else {
			return FindCharacterAncestor(part.Parent);
		}
	}
	return $tuple(undefined, undefined);
}

function Raycast(
	ray: Ray,
	ignoreNonCollidable: boolean,
	ignoreList: Array<Instance>,
): LuaTuple<[BasePart | undefined, Vector3 | undefined, Vector3 | undefined, Enum.Material | undefined]> {
	ignoreList = ignoreList || [];
	const [hitPart, hitPos, hitNorm, hitMat] = Workspace.FindPartOnRayWithIgnoreList(ray, ignoreList);
	if (hitPart) {
		if (ignoreNonCollidable && hitPart.CanCollide === false) {
			// We always include character parts so a user can click on another character
			// to walk to them.
			const [, humanoid] = FindCharacterAncestor(hitPart);
			if (humanoid === undefined) {
				ignoreList.push(hitPart);
				return Raycast(ray, ignoreNonCollidable, ignoreList);
			}
		}
		return $tuple(hitPart, hitPos, hitNorm, hitMat);
	}
	return $tuple(undefined, undefined, undefined, undefined);
}

const Utility = { FindCharacterAncestor, Raycast };

const humanoidCache = new Map<Player, Humanoid>();
function findPlayerHumanoid(player: Player | undefined): Humanoid | undefined {
	const character = player && player.Character;
	if (character) {
		const resultHumanoid = humanoidCache.get(player!);
		if (resultHumanoid && resultHumanoid.Parent === character) {
			return resultHumanoid;
		} else {
			humanoidCache.delete(player!); // Bust Old Cache
			const humanoid = character.FindFirstChildOfClass("Humanoid");
			if (humanoid) {
				humanoidCache.set(player!, humanoid);
			}
			return humanoid;
		}
	}
	return undefined;
}

//------------------------CHARACTER CONTROL-------------------------------
let CurrentIgnoreList: Array<Instance> | undefined;
let CurrentIgnoreTag: string | undefined = undefined;

let TaggedInstanceAddedConnection: RBXScriptConnection | undefined = undefined;
let TaggedInstanceRemovedConnection: RBXScriptConnection | undefined = undefined;

function GetCharacter(): Model | undefined {
	return Player && Player.Character;
}

function UpdateIgnoreTag(newIgnoreTag: string | undefined): void {
	if (newIgnoreTag === CurrentIgnoreTag) {
		return;
	}
	if (TaggedInstanceAddedConnection) {
		TaggedInstanceAddedConnection.Disconnect();
		TaggedInstanceAddedConnection = undefined;
	}
	if (TaggedInstanceRemovedConnection) {
		TaggedInstanceRemovedConnection.Disconnect();
		TaggedInstanceRemovedConnection = undefined;
	}
	CurrentIgnoreTag = newIgnoreTag;
	CurrentIgnoreList = [GetCharacter() as Instance];
	if (CurrentIgnoreTag !== undefined) {
		const ignoreParts = CollectionService.GetTagged(CurrentIgnoreTag);
		for (const ignorePart of ignoreParts) {
			CurrentIgnoreList.push(ignorePart);
		}
		TaggedInstanceAddedConnection = CollectionService.GetInstanceAddedSignal(CurrentIgnoreTag).Connect(
			(ignorePart) => {
				CurrentIgnoreList!.push(ignorePart);
			},
		);
		TaggedInstanceRemovedConnection = CollectionService.GetInstanceRemovedSignal(CurrentIgnoreTag).Connect(
			(ignorePart) => {
				for (let i = 1; i <= CurrentIgnoreList!.size(); i++) {
					if (CurrentIgnoreList![i - 1] === ignorePart) {
						CurrentIgnoreList![i - 1] = CurrentIgnoreList![CurrentIgnoreList!.size() - 1];
						CurrentIgnoreList!.remove(CurrentIgnoreList!.size() - 1);
						break;
					}
				}
			},
		);
	}
}

function getIgnoreList(): Array<Instance> {
	if (CurrentIgnoreList) {
		return CurrentIgnoreList;
	}
	CurrentIgnoreList = [];
	CurrentIgnoreList.push(GetCharacter() as Instance);
	return CurrentIgnoreList;
}

function minV(a: Vector3, b: Vector3): Vector3 {
	return new Vector3(math.min(a.X, b.X), math.min(a.Y, b.Y), math.min(a.Z, b.Z));
}
function maxV(a: Vector3, b: Vector3): Vector3 {
	return new Vector3(math.max(a.X, b.X), math.max(a.Y, b.Y), math.max(a.Z, b.Z));
}
function getCollidableExtentsSize(character: Model | undefined): Vector3 | undefined {
	if (character === undefined || character.PrimaryPart === undefined) return undefined;
	const toLocalCFrame = character.PrimaryPart.CFrame.Inverse();
	let min = new Vector3(math.huge, math.huge, math.huge);
	let max = new Vector3(-math.huge, -math.huge, -math.huge);
	for (const descendant of character.GetDescendants()) {
		if (descendant.IsA("BasePart") && descendant.CanCollide) {
			const localCFrame = toLocalCFrame.mul(descendant.CFrame);
			const size = new Vector3(descendant.Size.X / 2, descendant.Size.Y / 2, descendant.Size.Z / 2);
			const vertices = [
				new Vector3(size.X, size.Y, size.Z),
				new Vector3(size.X, size.Y, -size.Z),
				new Vector3(size.X, -size.Y, size.Z),
				new Vector3(size.X, -size.Y, -size.Z),
				new Vector3(-size.X, size.Y, size.Z),
				new Vector3(-size.X, size.Y, -size.Z),
				new Vector3(-size.X, -size.Y, size.Z),
				new Vector3(-size.X, -size.Y, -size.Z),
			];
			for (const vertex of vertices) {
				const v = localCFrame.PointToWorldSpace(vertex);
				min = minV(min, v);
				max = maxV(max, v);
			}
		}
	}
	const r = max.sub(min);
	if (r.X < 0 || r.Y < 0 || r.Z < 0) return undefined;
	return r;
}

//-----------------------------------PATHER--------------------------------------

class Pather {
	Cancelled = false;
	Started = false;

	Finished = new Instance("BindableEvent");
	PathFailed = new Instance("BindableEvent");

	PathComputing = false;
	PathComputed = false;

	OriginalTargetPoint: Vector3;
	TargetPoint: Vector3;
	TargetSurfaceNormal: Vector3;

	DiedConn: RBXScriptConnection | undefined = undefined;
	SeatedConn: RBXScriptConnection | undefined = undefined;
	BlockedConn: RBXScriptConnection | undefined = undefined;
	TeleportedConn: RBXScriptConnection | undefined = undefined;

	CurrentPoint = 0;

	HumanoidOffsetFromPath: Vector3 = ZERO_VECTOR3;

	CurrentWaypointPosition: Vector3 | undefined = undefined;
	CurrentWaypointPlaneNormal: Vector3 = ZERO_VECTOR3;
	CurrentWaypointPlaneDistance = 0;
	CurrentWaypointNeedsJump = false;

	CurrentHumanoidPosition: Vector3 = ZERO_VECTOR3;
	CurrentHumanoidVelocity: Vector3 | number = 0;

	NextActionMoveDirection: Vector3 = ZERO_VECTOR3;
	NextActionJump = false;

	Timeout = 0;

	Humanoid: Humanoid | undefined;
	OriginPoint: Vector3 | undefined = undefined;
	AgentCanFollowPath = false;
	DirectPath = false;
	DirectPathRiseFirst = false;

	pathResult: Path | undefined = undefined;
	pointList: Array<PathWaypoint> = [];

	stopTraverseFunc: (() => void) | undefined = undefined;
	setPointFunc: ((wayPointNumber: number) => void) | undefined = undefined;
	MoveToConn: RBXScriptConnection | undefined = undefined;

	Recomputing = false;

	constructor(endPoint: Vector3, surfaceNormal: Vector3, overrideUseDirectPath?: boolean) {
		let directPathForHumanoid: boolean;
		let directPathForVehicle: boolean;
		if (overrideUseDirectPath !== undefined) {
			directPathForHumanoid = overrideUseDirectPath;
			directPathForVehicle = overrideUseDirectPath;
		} else {
			directPathForHumanoid = UseDirectPath;
			directPathForVehicle = UseDirectPathForVehicle;
		}

		this.OriginalTargetPoint = endPoint;
		this.TargetPoint = endPoint;
		this.TargetSurfaceNormal = surfaceNormal;

		this.Humanoid = findPlayerHumanoid(Player);

		const rootPart: BasePart | undefined = this.Humanoid?.RootPart;
		if (rootPart) {
			// Setup origin
			this.OriginPoint = rootPart.CFrame.Position;

			// Setup agent
			let agentRadius = 2;
			let agentHeight = 5;
			let agentCanJump = true;

			const seat = this.Humanoid!.SeatPart;
			if (seat && seat.IsA("VehicleSeat")) {
				// Humanoid is seated on a vehicle
				const vehicle = seat.FindFirstAncestorOfClass("Model");
				if (vehicle) {
					// Make sure the PrimaryPart is set to the vehicle seat while we compute the extends.
					const tempPrimaryPart = vehicle.PrimaryPart;
					vehicle.PrimaryPart = seat;

					// For now, only direct path
					if (directPathForVehicle) {
						const extents = vehicle.GetExtentsSize();
						agentRadius = AgentSizeIncreaseFactor * 0.5 * math.sqrt(extents.X * extents.X + extents.Z * extents.Z);
						agentHeight = AgentSizeIncreaseFactor * extents.Y;
						agentCanJump = false;
						this.AgentCanFollowPath = true;
						this.DirectPath = directPathForVehicle;
					}

					// Reset PrimaryPart
					vehicle.PrimaryPart = tempPrimaryPart;
				}
			} else {
				let extents: Vector3 | undefined;
				if (FFlagUserExcludeNonCollidableForPathfinding) {
					const character = GetCharacter();
					if (character !== undefined) {
						extents = getCollidableExtentsSize(character);
					}
				}
				if (extents === undefined) {
					extents = GetCharacter()!.GetExtentsSize();
				}
				agentRadius = AgentSizeIncreaseFactor * 0.5 * math.sqrt(extents.X * extents.X + extents.Z * extents.Z);
				agentHeight = AgentSizeIncreaseFactor * extents.Y;
				agentCanJump = this.Humanoid!.JumpPower > 0;
				this.AgentCanFollowPath = true;
				this.DirectPath = directPathForHumanoid;
				this.DirectPathRiseFirst = this.Humanoid!.Sit;
			}

			// Build path object
			this.pathResult = PathfindingService.CreatePath({
				AgentRadius: agentRadius,
				AgentHeight: agentHeight,
				AgentCanJump: agentCanJump,
			});
		}

		// We always raycast to the ground in the case that the user clicked a wall.
		const offsetPoint = this.TargetPoint.add(this.TargetSurfaceNormal.mul(1.5));
		const ray = new Ray(offsetPoint, new Vector3(0, -1, 0).mul(50));
		const [newHitPart, newHitPos] = Workspace.FindPartOnRayWithIgnoreList(ray, getIgnoreList());
		if (newHitPart) {
			this.TargetPoint = newHitPos;
		}
		this.ComputePath();
	}

	Cleanup(): void {
		if (this.stopTraverseFunc) {
			this.stopTraverseFunc();
			this.stopTraverseFunc = undefined;
		}

		if (this.MoveToConn) {
			this.MoveToConn.Disconnect();
			this.MoveToConn = undefined;
		}

		if (this.BlockedConn) {
			this.BlockedConn.Disconnect();
			this.BlockedConn = undefined;
		}

		if (this.DiedConn) {
			this.DiedConn.Disconnect();
			this.DiedConn = undefined;
		}

		if (this.SeatedConn) {
			this.SeatedConn.Disconnect();
			this.SeatedConn = undefined;
		}

		if (this.TeleportedConn) {
			this.TeleportedConn.Disconnect();
			this.TeleportedConn = undefined;
		}

		this.Started = false;
	}

	Cancel(): void {
		this.Cancelled = true;
		this.Cleanup();
	}

	IsActive(): boolean {
		return this.AgentCanFollowPath && this.Started && !this.Cancelled;
	}

	OnPathInterrupted(): void {
		// Stop moving
		this.Cancelled = true;
		this.OnPointReached(false);
	}

	ComputePath(): void {
		if (this.OriginPoint) {
			if (this.PathComputed || this.PathComputing) return;
			this.PathComputing = true;
			if (this.AgentCanFollowPath) {
				if (this.DirectPath) {
					this.pointList = [
						new PathWaypoint(this.OriginPoint, Enum.PathWaypointAction.Walk),
						new PathWaypoint(
							this.TargetPoint,
							this.DirectPathRiseFirst ? Enum.PathWaypointAction.Jump : Enum.PathWaypointAction.Walk,
						),
					];
					this.PathComputed = true;
				} else {
					this.pathResult!.ComputeAsync(this.OriginPoint, this.TargetPoint);
					this.pointList = this.pathResult!.GetWaypoints();
					this.BlockedConn = this.pathResult!.Blocked.Connect((blockedIdx) => this.OnPathBlocked(blockedIdx));
					this.PathComputed = this.pathResult!.Status === Enum.PathStatus.Success;
				}
			}
			this.PathComputing = false;
		}
	}

	IsValidPath(): boolean {
		this.ComputePath();
		return this.PathComputed && this.AgentCanFollowPath;
	}

	OnPathBlocked(blockedWaypointIdx: number): void {
		const pathBlocked = blockedWaypointIdx >= this.CurrentPoint;
		if (!pathBlocked || this.Recomputing) {
			return;
		}

		this.Recomputing = true;

		if (this.stopTraverseFunc) {
			this.stopTraverseFunc();
			this.stopTraverseFunc = undefined;
		}

		this.OriginPoint = this.Humanoid!.RootPart!.CFrame.Position;

		this.pathResult!.ComputeAsync(this.OriginPoint, this.TargetPoint);
		this.pointList = this.pathResult!.GetWaypoints();
		if (this.pointList.size() > 0) {
			this.HumanoidOffsetFromPath = this.pointList[0].Position.sub(this.OriginPoint);
		}
		this.PathComputed = this.pathResult!.Status === Enum.PathStatus.Success;

		if (ShowPath) {
			[this.stopTraverseFunc, this.setPointFunc] = ClickToMoveDisplay.CreatePathDisplay(this.pointList);
		}
		if (this.PathComputed) {
			this.CurrentPoint = 1; // The first waypoint is always the start location. Skip it.
			this.OnPointReached(true); // Move to first point
		} else {
			this.PathFailed.Fire();
			this.Cleanup();
		}

		this.Recomputing = false;
	}

	OnRenderStepped(dt: number): void {
		if (this.Started && !this.Cancelled) {
			// Check for Timeout (if a waypoint is not reached within the delay, we fail)
			this.Timeout += dt;
			if (this.Timeout > UnreachableWaypointTimeout) {
				this.OnPointReached(false);
				return;
			}

			// Get Humanoid position and velocity
			this.CurrentHumanoidPosition = this.Humanoid!.RootPart!.Position.add(this.HumanoidOffsetFromPath);
			this.CurrentHumanoidVelocity = this.Humanoid!.RootPart!.Velocity;

			// Check if it has reached some waypoints
			while (this.Started && this.IsCurrentWaypointReached()) {
				this.OnPointReached(true);
			}

			// If still started, update actions
			if (this.Started) {
				// Move action
				this.NextActionMoveDirection = this.CurrentWaypointPosition!.sub(this.CurrentHumanoidPosition);
				if (this.NextActionMoveDirection.Magnitude > ALMOST_ZERO) {
					this.NextActionMoveDirection = this.NextActionMoveDirection.Unit;
				} else {
					this.NextActionMoveDirection = ZERO_VECTOR3;
				}
				// Jump action
				if (this.CurrentWaypointNeedsJump) {
					this.NextActionJump = true;
					this.CurrentWaypointNeedsJump = false; // Request jump only once
				} else {
					this.NextActionJump = false;
				}
			}
		}
	}

	IsCurrentWaypointReached(): boolean {
		let reached = false;

		// Check we do have a plane, if not, we consider the waypoint reached
		if (this.CurrentWaypointPlaneNormal !== ZERO_VECTOR3) {
			// Compute distance of Humanoid from destination plane
			const dist = this.CurrentWaypointPlaneNormal.Dot(this.CurrentHumanoidPosition) - this.CurrentWaypointPlaneDistance;
			// Compute the component of the Humanoid velocity that is towards the plane
			const velocity =
				-this.CurrentWaypointPlaneNormal.Dot(this.CurrentHumanoidVelocity as Vector3);
			// Compute the threshold from the destination plane based on Humanoid velocity
			const threshold = math.max(1.0, 0.0625 * velocity);
			// If we are less then threshold in front of the plane (between 0 and threshold) or if we are behing the plane (less then 0), we consider we reached it
			reached = dist < threshold;
		} else {
			reached = true;
		}

		if (reached) {
			this.CurrentWaypointPosition = undefined;
			this.CurrentWaypointPlaneNormal = ZERO_VECTOR3;
			this.CurrentWaypointPlaneDistance = 0;
		}

		return reached;
	}

	OnPointReached(reached: boolean): void {
		if (reached && !this.Cancelled) {
			// First, destroyed the current displayed waypoint
			if (this.setPointFunc) {
				this.setPointFunc(this.CurrentPoint);
			}

			const nextWaypointIdx = this.CurrentPoint + 1;

			if (nextWaypointIdx > this.pointList.size()) {
				// End of path reached
				if (this.stopTraverseFunc) {
					this.stopTraverseFunc();
				}
				this.Finished.Fire();
				this.Cleanup();
			} else {
				const currentWaypoint = this.pointList[this.CurrentPoint - 1];
				const nextWaypoint = this.pointList[nextWaypointIdx - 1];

				// If airborne, only allow to keep moving
				// if nextWaypoint.Action ~= Jump, or path mantains a direction
				// Otherwise, wait until the humanoid gets to the ground
				const currentState = this.Humanoid!.GetState();
				const isInAir =
					currentState === Enum.HumanoidStateType.FallingDown ||
					currentState === Enum.HumanoidStateType.Freefall ||
					currentState === Enum.HumanoidStateType.Jumping;

				if (isInAir) {
					let shouldWaitForGround = nextWaypoint.Action === Enum.PathWaypointAction.Jump;
					if (!shouldWaitForGround && this.CurrentPoint > 1) {
						const prevWaypoint = this.pointList[this.CurrentPoint - 2];

						const prevDir = currentWaypoint.Position.sub(prevWaypoint.Position);
						const currDir = nextWaypoint.Position.sub(currentWaypoint.Position);

						const prevDirXZ = new Vector2(prevDir.X, prevDir.Z).Unit;
						const currDirXZ = new Vector2(currDir.X, currDir.Z).Unit;

						const THRESHOLD_COS = 0.996; // ~cos(5 degrees)
						shouldWaitForGround = prevDirXZ.Dot(currDirXZ) < THRESHOLD_COS;
					}

					if (shouldWaitForGround) {
						this.Humanoid!.FreeFalling.Wait();

						// Give time to the humanoid's state to change
						// Otherwise, the jump flag in Humanoid
						// will be reset by the state change
						legacyWait(0.1);
					}
				}

				// Move to the next point
				this.MoveToNextWayPoint(currentWaypoint, nextWaypoint, nextWaypointIdx);
			}
		} else {
			this.PathFailed.Fire();
			this.Cleanup();
		}
	}

	MoveToNextWayPoint(currentWaypoint: PathWaypoint, nextWaypoint: PathWaypoint, nextWaypointIdx: number): void {
		// Build next destination plane
		// (plane normal is perpendicular to the y plane and is from next waypoint towards current one (provided the two waypoints are not at the same location))
		// (plane location is at next waypoint)
		let planeNormal = currentWaypoint.Position.sub(nextWaypoint.Position);
		planeNormal = new Vector3(planeNormal.X, 0, planeNormal.Z);
		if (planeNormal.Magnitude > ALMOST_ZERO) {
			this.CurrentWaypointPlaneNormal = planeNormal.Unit;
			this.CurrentWaypointPlaneDistance = this.CurrentWaypointPlaneNormal.Dot(nextWaypoint.Position);
		} else {
			// Next waypoint is the same as current waypoint so no plane
			this.CurrentWaypointPlaneNormal = ZERO_VECTOR3;
			this.CurrentWaypointPlaneDistance = 0;
		}

		// Should we jump
		this.CurrentWaypointNeedsJump = nextWaypoint.Action === Enum.PathWaypointAction.Jump;

		// Remember next waypoint position
		this.CurrentWaypointPosition = nextWaypoint.Position;

		// Move to next point
		this.CurrentPoint = nextWaypointIdx;

		// Finally reset Timeout
		this.Timeout = 0;
	}

	Start(overrideShowPath?: boolean): void {
		if (!this.AgentCanFollowPath) {
			this.PathFailed.Fire();
			return;
		}

		if (this.Started) return;
		this.Started = true;

		ClickToMoveDisplay.CancelFailureAnimation();

		if (ShowPath) {
			if (overrideShowPath === undefined || overrideShowPath) {
				[this.stopTraverseFunc, this.setPointFunc] = ClickToMoveDisplay.CreatePathDisplay(
					this.pointList,
					this.OriginalTargetPoint,
				);
			}
		}

		if (this.pointList.size() > 0) {
			// Determine the humanoid offset from the path's first point
			// Offset of the first waypoint from the path's origin point
			this.HumanoidOffsetFromPath = new Vector3(0, this.pointList[0].Position.Y - this.OriginPoint!.Y, 0);

			// As well as its current position and velocity
			this.CurrentHumanoidPosition = this.Humanoid!.RootPart!.Position.add(this.HumanoidOffsetFromPath);
			this.CurrentHumanoidVelocity = this.Humanoid!.RootPart!.Velocity;

			// Connect to events
			this.SeatedConn = this.Humanoid!.Seated.Connect((isSeated, seat) => this.OnPathInterrupted());
			this.DiedConn = this.Humanoid!.Died.Connect(() => this.OnPathInterrupted());
			this.TeleportedConn = this.Humanoid!.RootPart!.GetPropertyChangedSignal("CFrame").Connect(() =>
				this.OnPathInterrupted(),
			);

			// Actually start
			this.CurrentPoint = 1; // The first waypoint is always the start location. Skip it.
			this.OnPointReached(true); // Move to first point
		} else {
			this.PathFailed.Fire();
			if (this.stopTraverseFunc) {
				this.stopTraverseFunc();
			}
		}
	}
}

//-------------------------------------------------------------------------

function CheckAlive(): boolean {
	const humanoid = findPlayerHumanoid(Player);
	return humanoid !== undefined && humanoid.Health > 0;
}

function GetEquippedTool(character: Model | undefined): Tool | undefined {
	if (character !== undefined) {
		for (const child of character.GetChildren()) {
			if (child.IsA("Tool")) {
				return child;
			}
		}
	}
	return undefined;
}

let ExistingPather: Pather | undefined = undefined;
let ExistingIndicator: { Destroy(): void; Model: Instance } | undefined = undefined;
let PathCompleteListener: RBXScriptConnection | undefined = undefined;
let PathFailedListener: RBXScriptConnection | undefined = undefined;

function CleanupPath(): void {
	if (ExistingPather) {
		ExistingPather.Cancel();
		ExistingPather = undefined;
	}
	if (PathCompleteListener) {
		PathCompleteListener.Disconnect();
		PathCompleteListener = undefined;
	}
	if (PathFailedListener) {
		PathFailedListener.Disconnect();
		PathFailedListener = undefined;
	}
	if (ExistingIndicator) {
		ExistingIndicator.Destroy();
	}
}

function HandleMoveTo(
	thisPather: Pather,
	hitPt: Vector3,
	hitChar: Instance | undefined,
	character: Model,
	overrideShowPath?: boolean,
): void {
	if (ExistingPather) {
		CleanupPath();
	}
	ExistingPather = thisPather;
	thisPather.Start(overrideShowPath);

	PathCompleteListener = thisPather.Finished.Event.Connect(() => {
		CleanupPath();
		if (hitChar) {
			const currentWeapon = GetEquippedTool(character);
			if (currentWeapon) {
				currentWeapon.Activate();
			}
		}
	});
	PathFailedListener = thisPather.PathFailed.Event.Connect(() => {
		CleanupPath();
		if (overrideShowPath === undefined || overrideShowPath) {
			const shouldPlayFailureAnim = PlayFailureAnimationConfig && !(ExistingPather && ExistingPather.IsActive());
			if (shouldPlayFailureAnim) {
				ClickToMoveDisplay.PlayFailureAnimation();
			}
			ClickToMoveDisplay.DisplayFailureWaypoint(hitPt);
		}
	});
}

function ShowPathFailedFeedback(hitPt: Vector3): void {
	if (ExistingPather && ExistingPather.IsActive()) {
		ExistingPather.Cancel();
	}
	if (PlayFailureAnimationConfig) {
		ClickToMoveDisplay.PlayFailureAnimation();
	}
	ClickToMoveDisplay.DisplayFailureWaypoint(hitPt);
}

// Original: declared without `local`, making this a Lua global (`_G.OnTap`) rather than a module
// upvalue. Nothing else in this ControlModule cluster reads a global `OnTap`, so a normal
// module-scope function here is behaviorally equivalent for every call site in this file.
function OnTap(tapPositions: Array<Vector2 | Vector3>, goToPoint?: Vector3, wasTouchTap?: boolean): void {
	// Good to remember if this is the latest tap event
	const camera = Workspace.CurrentCamera;
	const character = Player.Character;

	if (!CheckAlive()) return;

	// This is a path tap position
	if (tapPositions.size() === 1 || goToPoint) {
		if (camera) {
			const unitRay = camera.ScreenPointToRay(tapPositions[0].X, tapPositions[0].Y);
			const ray = new Ray(unitRay.Origin, unitRay.Direction.mul(1000));

			const myHumanoid = findPlayerHumanoid(Player);
			let [hitPart, hitPt, hitNormal] = Utility.Raycast(ray, true, getIgnoreList());

			let [hitChar, hitHumanoid] = Utility.FindCharacterAncestor(hitPart);
			if (wasTouchTap && hitHumanoid && StarterGui.GetCore("AvatarContextMenuEnabled")) {
				const clickedPlayer = Players.GetPlayerFromCharacter(hitHumanoid.Parent);
				if (clickedPlayer) {
					CleanupPath();
					return;
				}
			}
			if (goToPoint) {
				hitPt = goToPoint;
				hitChar = undefined;
			}
			if (hitPt && character) {
				// Clean up current path
				CleanupPath();
				const thisPather = new Pather(hitPt, hitNormal!);
				if (thisPather.IsValidPath()) {
					HandleMoveTo(thisPather, hitPt, hitChar, character);
				} else {
					// Clean up
					thisPather.Cleanup();
					// Feedback here for when we don't have a good path
					ShowPathFailedFeedback(hitPt);
				}
			}
		}
	} else if (tapPositions.size() >= 2) {
		if (camera) {
			// Do shoot
			const currentWeapon = GetEquippedTool(character);
			if (currentWeapon) {
				currentWeapon.Activate();
			}
		}
	}
}

function DisconnectEvent(event: RBXScriptConnection | undefined): void {
	if (event) {
		event.Disconnect();
	}
}

//--[[ The ClickToMove Controller Class ]]--
class ClickToMove extends Keyboard {
	fingerTouches: Map<InputObject, boolean>;
	numUnsunkTouches: number;
	// PC simulation
	mouse1Down: number;
	mouse1DownPos: Vector2 | Vector3;
	mouse2DownTime: number;
	mouse2DownPos: Vector2 | Vector3;
	mouse2UpTime: number;
	// Original sets `self.mouse1DownTime` (note: NOT `mouse1Down`, the field initialized above) from
	// OnCharacterAdded's InputBegan handler; that field name is never read anywhere in the source,
	// so it (like `mouse1Down` and `mouse1DownPos`) is dead/write-only state. Preserved faithfully.
	mouse1DownTime: number | undefined = undefined;

	keyboardMoveVector: Vector3;

	tapConn: RBXScriptConnection | undefined;
	inputBeganConn: RBXScriptConnection | undefined;
	inputChangedConn: RBXScriptConnection | undefined;
	inputEndedConn: RBXScriptConnection | undefined;
	humanoidDiedConn: RBXScriptConnection | undefined;
	characterChildAddedConn: RBXScriptConnection | undefined;
	onCharacterAddedConn: RBXScriptConnection | undefined;
	characterChildRemovedConn: RBXScriptConnection | undefined;
	renderSteppedConn: RBXScriptConnection | undefined;
	menuOpenedConnection: RBXScriptConnection | undefined;

	running: boolean;

	wasdEnabled: boolean;

	touchJumpController: TouchJumpControllerLike | undefined = undefined;

	constructor(CONTROL_ACTION_PRIORITY: number) {
		super(CONTROL_ACTION_PRIORITY);

		this.fingerTouches = new Map<InputObject, boolean>();
		this.numUnsunkTouches = 0;
		// PC simulation
		this.mouse1Down = tick();
		this.mouse1DownPos = new Vector2();
		this.mouse2DownTime = tick();
		this.mouse2DownPos = new Vector2();
		this.mouse2UpTime = tick();

		this.keyboardMoveVector = ZERO_VECTOR3;

		this.tapConn = undefined;
		this.inputBeganConn = undefined;
		this.inputChangedConn = undefined;
		this.inputEndedConn = undefined;
		this.humanoidDiedConn = undefined;
		this.characterChildAddedConn = undefined;
		this.onCharacterAddedConn = undefined;
		this.characterChildRemovedConn = undefined;
		this.renderSteppedConn = undefined;
		this.menuOpenedConnection = undefined;

		this.running = false;

		this.wasdEnabled = false;
	}

	DisconnectEvents(): void {
		DisconnectEvent(this.tapConn);
		DisconnectEvent(this.inputBeganConn);
		DisconnectEvent(this.inputChangedConn);
		DisconnectEvent(this.inputEndedConn);
		DisconnectEvent(this.humanoidDiedConn);
		DisconnectEvent(this.characterChildAddedConn);
		DisconnectEvent(this.onCharacterAddedConn);
		DisconnectEvent(this.renderSteppedConn);
		DisconnectEvent(this.characterChildRemovedConn);
		DisconnectEvent(this.menuOpenedConnection);
	}

	OnTouchBegan(input: InputObject, processed: boolean): void {
		if (this.fingerTouches.get(input) === undefined && !processed) {
			this.numUnsunkTouches += 1;
		}
		this.fingerTouches.set(input, processed);
	}

	OnTouchChanged(input: InputObject, processed: boolean): void {
		if (this.fingerTouches.get(input) === undefined) {
			this.fingerTouches.set(input, processed);
			if (!processed) {
				this.numUnsunkTouches += 1;
			}
		}
	}

	OnTouchEnded(input: InputObject, processed: boolean): void {
		if (this.fingerTouches.get(input) !== undefined && this.fingerTouches.get(input) === false) {
			this.numUnsunkTouches -= 1;
		}
		this.fingerTouches.delete(input);
	}

	OnCharacterAdded(character: Model): void {
		this.DisconnectEvents();

		this.inputBeganConn = UserInputService.InputBegan.Connect((input, processed) => {
			if (input.UserInputType === Enum.UserInputType.Touch) {
				this.OnTouchBegan(input, processed);
			}

			// Cancel path when you use the keyboard controls if wasd is enabled.
			if (
				this.wasdEnabled &&
				processed === false &&
				input.UserInputType === Enum.UserInputType.Keyboard &&
				movementKeys.get(input.KeyCode)
			) {
				CleanupPath();
				ClickToMoveDisplay.CancelFailureAnimation();
			}
			if (input.UserInputType === Enum.UserInputType.MouseButton1) {
				this.mouse1DownTime = tick();
				this.mouse1DownPos = input.Position;
			}
			if (input.UserInputType === Enum.UserInputType.MouseButton2) {
				this.mouse2DownTime = tick();
				this.mouse2DownPos = input.Position;
			}
		});

		this.inputChangedConn = UserInputService.InputChanged.Connect((input, processed) => {
			if (input.UserInputType === Enum.UserInputType.Touch) {
				this.OnTouchChanged(input, processed);
			}
		});

		this.inputEndedConn = UserInputService.InputEnded.Connect((input, processed) => {
			if (input.UserInputType === Enum.UserInputType.Touch) {
				this.OnTouchEnded(input, processed);
			}

			if (input.UserInputType === Enum.UserInputType.MouseButton2) {
				this.mouse2UpTime = tick();
				const currPos: Vector3 = input.Position;
				// We allow click to move during path following or if there is no keyboard movement
				const allowed = ExistingPather || this.keyboardMoveVector.Magnitude <= 0;
				if (
					this.mouse2UpTime - this.mouse2DownTime < 0.25 &&
					currPos.sub(this.mouse2DownPos as Vector3).Magnitude < 5 &&
					allowed
				) {
					const positions: Array<Vector2 | Vector3> = [currPos];
					OnTap(positions);
				}
			}
		});

		this.tapConn = UserInputService.TouchTap.Connect((touchPositions, processed) => {
			if (!processed) {
				OnTap(touchPositions, undefined, true);
			}
		});

		this.menuOpenedConnection = GuiService.MenuOpened.Connect(() => {
			CleanupPath();
		});

		const OnCharacterChildAdded = (child: Instance) => {
			if (UserInputService.TouchEnabled) {
				if (child.IsA("Tool")) {
					child.ManualActivationOnly = true;
				}
			}
			if (child.IsA("Humanoid")) {
				DisconnectEvent(this.humanoidDiedConn);
				this.humanoidDiedConn = child.Died.Connect(() => {
					if (ExistingIndicator) {
						DebrisService.AddItem(ExistingIndicator.Model, 1);
					}
				});
			}
		};

		this.characterChildAddedConn = character.ChildAdded.Connect((child) => {
			OnCharacterChildAdded(child);
		});
		this.characterChildRemovedConn = character.ChildRemoved.Connect((child) => {
			if (UserInputService.TouchEnabled) {
				if (child.IsA("Tool")) {
					child.ManualActivationOnly = false;
				}
			}
		});
		for (const child of character.GetChildren()) {
			OnCharacterChildAdded(child);
		}
	}

	Start(): void {
		this.Enable(true);
	}

	Stop(): void {
		this.Enable(false);
	}

	CleanupPath(): void {
		CleanupPath();
	}

	Enable(enable: boolean, enableWASD?: boolean, touchJumpController?: TouchJumpControllerLike): boolean {
		if (enable) {
			if (!this.running) {
				if (Player.Character) {
					// retro-listen
					this.OnCharacterAdded(Player.Character);
				}
				this.onCharacterAddedConn = Player.CharacterAdded.Connect((char) => {
					this.OnCharacterAdded(char);
				});
				this.running = true;
			}
			this.touchJumpController = touchJumpController;
			if (this.touchJumpController) {
				this.touchJumpController.Enable(this.jumpEnabled);
			}
		} else {
			if (this.running) {
				this.DisconnectEvents();
				CleanupPath();
				// Restore tool activation on shutdown
				if (UserInputService.TouchEnabled) {
					const character = Player.Character;
					if (character) {
						for (const child of character.GetChildren()) {
							if (child.IsA("Tool")) {
								child.ManualActivationOnly = false;
							}
						}
					}
				}
				this.running = false;
			}
			if (this.touchJumpController && !this.jumpEnabled) {
				this.touchJumpController.Enable(true);
			}
			this.touchJumpController = undefined;
		}

		// Extension for initializing Keyboard input as this class now derives from Keyboard
		if (UserInputService.KeyboardEnabled && enable !== this.enabled) {
			this.forwardValue = 0;
			this.backwardValue = 0;
			this.leftValue = 0;
			this.rightValue = 0;

			this.moveVector = ZERO_VECTOR3;

			if (enable) {
				this.BindContextActions();
				this.ConnectFocusEventListeners();
			} else {
				this.UnbindContextActions();
				this.DisconnectFocusEventListeners();
			}
		}

		this.wasdEnabled = (enable && enableWASD) || false;
		this.enabled = enable;
		return this.enabled;
	}

	OnRenderStepped(dt: number): void {
		// Reset jump
		this.isJumping = false;

		// Handle Pather
		if (ExistingPather) {
			// Let the Pather update
			ExistingPather.OnRenderStepped(dt);

			// If we still have a Pather, set the resulting actions
			if (ExistingPather) {
				// Setup move (NOT relative to camera)
				this.moveVector = ExistingPather.NextActionMoveDirection;
				this.moveVectorIsCameraRelative = false;

				// Setup jump (but do NOT prevent the base Keayboard class from requesting jumps as well)
				if (ExistingPather.NextActionJump) {
					this.isJumping = true;
				}
			} else {
				this.moveVector = this.keyboardMoveVector;
				this.moveVectorIsCameraRelative = true;
			}
		} else {
			this.moveVector = this.keyboardMoveVector;
			this.moveVectorIsCameraRelative = true;
		}

		// Handle Keyboard's jump
		if (this.jumpRequested) {
			this.isJumping = true;
		}
	}

	// Overrides Keyboard:UpdateMovement(inputState) to conditionally consider self.wasdEnabled and let OnRenderStepped handle the movement
	UpdateMovement(inputState: Enum.UserInputState): void {
		if (inputState === Enum.UserInputState.Cancel) {
			this.keyboardMoveVector = ZERO_VECTOR3;
		} else if (this.wasdEnabled) {
			this.keyboardMoveVector = new Vector3(this.leftValue + this.rightValue, 0, this.forwardValue + this.backwardValue);
		}
	}

	// Overrides Keyboard:UpdateJump() because jump is handled in OnRenderStepped
	UpdateJump(): void {
		// Nothing to do (handled in OnRenderStepped)
	}

	//Public developer facing functions
	SetShowPath(value: boolean): void {
		ShowPath = value;
	}

	GetShowPath(): boolean {
		return ShowPath;
	}

	SetWaypointTexture(texture: string): void {
		ClickToMoveDisplay.SetWaypointTexture(texture);
	}

	GetWaypointTexture(): string {
		return ClickToMoveDisplay.GetWaypointTexture();
	}

	SetWaypointRadius(radius: number): void {
		ClickToMoveDisplay.SetWaypointRadius(radius);
	}

	GetWaypointRadius(): number {
		return ClickToMoveDisplay.GetWaypointRadius();
	}

	SetEndWaypointTexture(texture: string): void {
		ClickToMoveDisplay.SetEndWaypointTexture(texture);
	}

	GetEndWaypointTexture(): string {
		return ClickToMoveDisplay.GetEndWaypointTexture();
	}

	SetWaypointsAlwaysOnTop(alwaysOnTop: boolean): void {
		ClickToMoveDisplay.SetWaypointsAlwaysOnTop(alwaysOnTop);
	}

	GetWaypointsAlwaysOnTop(): boolean {
		return ClickToMoveDisplay.GetWaypointsAlwaysOnTop();
	}

	SetFailureAnimationEnabled(enabled: boolean): void {
		PlayFailureAnimationConfig = enabled;
	}

	GetFailureAnimationEnabled(): boolean {
		return PlayFailureAnimationConfig;
	}

	SetIgnoredPartsTag(tag: string | undefined): void {
		UpdateIgnoreTag(tag);
	}

	GetIgnoredPartsTag(): string | undefined {
		return CurrentIgnoreTag;
	}

	SetUseDirectPath(directPath: boolean): void {
		UseDirectPath = directPath;
	}

	GetUseDirectPath(): boolean {
		return UseDirectPath;
	}

	SetAgentSizeIncreaseFactor(increaseFactorPercent: number): void {
		AgentSizeIncreaseFactor = 1.0 + increaseFactorPercent / 100.0;
	}

	GetAgentSizeIncreaseFactor(): number {
		return (AgentSizeIncreaseFactor - 1.0) * 100.0;
	}

	SetUnreachableWaypointTimeout(timeoutInSec: number): void {
		UnreachableWaypointTimeout = timeoutInSec;
	}

	GetUnreachableWaypointTimeout(): number {
		return UnreachableWaypointTimeout;
	}

	SetUserJumpEnabled(jumpEnabled: boolean): void {
		this.jumpEnabled = jumpEnabled;
		if (this.touchJumpController) {
			this.touchJumpController.Enable(jumpEnabled);
		}
	}

	GetUserJumpEnabled(): boolean {
		return this.jumpEnabled;
	}

	MoveTo(position: Vector3, showPath?: boolean, useDirectPath?: boolean): boolean {
		const character = Player.Character;
		if (character === undefined) {
			return false;
		}
		const thisPather = new Pather(position, new Vector3(0, 1, 0), useDirectPath);
		if (thisPather && thisPather.IsValidPath()) {
			HandleMoveTo(thisPather, position, undefined, character, showPath);
			return true;
		}
		return false;
	}
}

export = ClickToMove;
