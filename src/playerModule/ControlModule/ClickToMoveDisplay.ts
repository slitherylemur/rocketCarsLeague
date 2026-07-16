// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/ClickToMoveDisplay (ModuleScript)

import { legacyWait } from "shared/LegacyTiming";

const FAILURE_ANIMATION_ID = "rbxassetid://2874840706";

let TrailDotIcon = "rbxasset://textures/ui/traildot.png";
let EndWaypointIcon = "rbxasset://textures/ui/waypoint.png";

let WaypointsAlwaysOnTop = false;

const WAYPOINT_INCLUDE_FACTOR = 2;
const LAST_DOT_DISTANCE = 3;

const WAYPOINT_BILLBOARD_SIZE = new UDim2(0, 1.68 * 25, 0, 2 * 25);

const ENDWAYPOINT_SIZE_OFFSET_MIN = new Vector2(0, 0.5);
const ENDWAYPOINT_SIZE_OFFSET_MAX = new Vector2(0, 1);

const FAIL_WAYPOINT_SIZE_OFFSET_CENTER = new Vector2(0, 0.5);
const FAIL_WAYPOINT_SIZE_OFFSET_LEFT = new Vector2(0.1, 0.5);
const FAIL_WAYPOINT_SIZE_OFFSET_RIGHT = new Vector2(-0.1, 0.5);

const FAILURE_TWEEN_LENGTH = 0.125;
const FAILURE_TWEEN_COUNT = 4;

const TWEEN_WAYPOINT_THRESHOLD = 5;

const TRAIL_DOT_PARENT_NAME = "ClickToMoveDisplay";

let TrailDotSize = new Vector2(1.5, 1.5);

const TRAIL_DOT_MIN_SCALE = 1;
const TRAIL_DOT_MIN_DISTANCE = 10;
const TRAIL_DOT_MAX_SCALE = 2.5;
const TRAIL_DOT_MAX_DISTANCE = 100;

const PlayersService = game.GetService("Players");
const TweenService = game.GetService("TweenService");
const RunService = game.GetService("RunService");
const Workspace = game.GetService("Workspace");

const LocalPlayer = PlayersService.LocalPlayer;

function CreateWaypointTemplates(): LuaTuple<[Part, Part, Part]> {
	const TrailDotTemplate = new Instance("Part");
	TrailDotTemplate.Size = new Vector3(1, 1, 1);
	TrailDotTemplate.Anchored = true;
	TrailDotTemplate.CanCollide = false;
	TrailDotTemplate.Name = "TrailDot";
	TrailDotTemplate.Transparency = 1;
	const TrailDotImage = new Instance("ImageHandleAdornment");
	TrailDotImage.Name = "TrailDotImage";
	TrailDotImage.Size = TrailDotSize;
	TrailDotImage.SizeRelativeOffset = new Vector3(0, 0, -0.1);
	TrailDotImage.AlwaysOnTop = WaypointsAlwaysOnTop;
	TrailDotImage.Image = TrailDotIcon;
	TrailDotImage.Adornee = TrailDotTemplate;
	TrailDotImage.Parent = TrailDotTemplate;

	const EndWaypointTemplate = new Instance("Part");
	EndWaypointTemplate.Size = new Vector3(2, 2, 2);
	EndWaypointTemplate.Anchored = true;
	EndWaypointTemplate.CanCollide = false;
	EndWaypointTemplate.Name = "EndWaypoint";
	EndWaypointTemplate.Transparency = 1;
	const EndWaypointImage = new Instance("ImageHandleAdornment");
	EndWaypointImage.Name = "TrailDotImage";
	EndWaypointImage.Size = TrailDotSize;
	EndWaypointImage.SizeRelativeOffset = new Vector3(0, 0, -0.1);
	EndWaypointImage.AlwaysOnTop = WaypointsAlwaysOnTop;
	EndWaypointImage.Image = TrailDotIcon;
	EndWaypointImage.Adornee = EndWaypointTemplate;
	EndWaypointImage.Parent = EndWaypointTemplate;
	const EndWaypointBillboard = new Instance("BillboardGui");
	EndWaypointBillboard.Name = "EndWaypointBillboard";
	EndWaypointBillboard.Size = WAYPOINT_BILLBOARD_SIZE;
	EndWaypointBillboard.LightInfluence = 0;
	EndWaypointBillboard.SizeOffset = ENDWAYPOINT_SIZE_OFFSET_MIN;
	EndWaypointBillboard.AlwaysOnTop = true;
	EndWaypointBillboard.Adornee = EndWaypointTemplate;
	EndWaypointBillboard.Parent = EndWaypointTemplate;
	const EndWaypointImageLabel = new Instance("ImageLabel");
	EndWaypointImageLabel.Image = EndWaypointIcon;
	EndWaypointImageLabel.BackgroundTransparency = 1;
	EndWaypointImageLabel.Size = new UDim2(1, 0, 1, 0);
	EndWaypointImageLabel.Parent = EndWaypointBillboard;

	const FailureWaypointTemplate = new Instance("Part");
	FailureWaypointTemplate.Size = new Vector3(2, 2, 2);
	FailureWaypointTemplate.Anchored = true;
	FailureWaypointTemplate.CanCollide = false;
	FailureWaypointTemplate.Name = "FailureWaypoint";
	FailureWaypointTemplate.Transparency = 1;
	const FailureWaypointImage = new Instance("ImageHandleAdornment");
	FailureWaypointImage.Name = "TrailDotImage";
	FailureWaypointImage.Size = TrailDotSize;
	FailureWaypointImage.SizeRelativeOffset = new Vector3(0, 0, -0.1);
	FailureWaypointImage.AlwaysOnTop = WaypointsAlwaysOnTop;
	FailureWaypointImage.Image = TrailDotIcon;
	FailureWaypointImage.Adornee = FailureWaypointTemplate;
	FailureWaypointImage.Parent = FailureWaypointTemplate;
	const FailureWaypointBillboard = new Instance("BillboardGui");
	FailureWaypointBillboard.Name = "FailureWaypointBillboard";
	FailureWaypointBillboard.Size = WAYPOINT_BILLBOARD_SIZE;
	FailureWaypointBillboard.LightInfluence = 0;
	FailureWaypointBillboard.SizeOffset = FAIL_WAYPOINT_SIZE_OFFSET_CENTER;
	FailureWaypointBillboard.AlwaysOnTop = true;
	FailureWaypointBillboard.Adornee = FailureWaypointTemplate;
	FailureWaypointBillboard.Parent = FailureWaypointTemplate;
	const FailureWaypointFrame = new Instance("Frame");
	FailureWaypointFrame.BackgroundTransparency = 1;
	FailureWaypointFrame.Size = new UDim2(0, 0, 0, 0);
	FailureWaypointFrame.Position = new UDim2(0.5, 0, 1, 0);
	FailureWaypointFrame.Parent = FailureWaypointBillboard;
	const FailureWaypointImageLabel = new Instance("ImageLabel");
	FailureWaypointImageLabel.Image = EndWaypointIcon;
	FailureWaypointImageLabel.BackgroundTransparency = 1;
	FailureWaypointImageLabel.Position = new UDim2(
		0,
		-WAYPOINT_BILLBOARD_SIZE.X.Offset / 2,
		0,
		-WAYPOINT_BILLBOARD_SIZE.Y.Offset,
	);
	FailureWaypointImageLabel.Size = WAYPOINT_BILLBOARD_SIZE;
	FailureWaypointImageLabel.Parent = FailureWaypointFrame;

	return $tuple(TrailDotTemplate, EndWaypointTemplate, FailureWaypointTemplate);
}

let [TrailDotTemplate, EndWaypointTemplate, FailureWaypointTemplate] = CreateWaypointTemplates();

function getTrailDotParent(): Instance {
	const camera = Workspace.CurrentCamera!;
	let trailParent = camera.FindFirstChild(TRAIL_DOT_PARENT_NAME);
	if (!trailParent) {
		trailParent = new Instance("Model");
		trailParent.Name = TRAIL_DOT_PARENT_NAME;
		trailParent.Parent = camera;
	}
	return trailParent;
}

function placePathWaypoint(waypointModel: BasePart, position: Vector3): void {
	const ray = new Ray(position.add(new Vector3(0, 2.5, 0)), new Vector3(0, -10, 0));
	const [hitPart, hitPoint, hitNormal] = Workspace.FindPartOnRayWithIgnoreList(ray, [
		Workspace.CurrentCamera as Instance,
		LocalPlayer.Character as Instance,
	]);
	if (hitPart) {
		waypointModel.CFrame = new CFrame(hitPoint, hitPoint.add(hitNormal));
		waypointModel.Parent = getTrailDotParent();
	}
}

class TrailDot {
	DisplayModel: Part;
	ClosestWayPoint: number;

	constructor(position: Vector3, closestWaypoint: number) {
		this.DisplayModel = this.NewDisplayModel(position);
		this.ClosestWayPoint = closestWaypoint;
	}

	Destroy(): void {
		this.DisplayModel.Destroy();
	}

	NewDisplayModel(position: Vector3): Part {
		const newDisplayModel = TrailDotTemplate.Clone();
		placePathWaypoint(newDisplayModel, position);
		return newDisplayModel;
	}
}

class EndWaypoint {
	DisplayModel: Part;
	Destroyed: boolean;
	Tween: Tween;
	ClosestWayPoint: number | undefined;

	constructor(position: Vector3, closestWaypoint?: number, originalPosition?: Vector3) {
		this.DisplayModel = this.NewDisplayModel(position);
		this.Destroyed = false;
		if (originalPosition && originalPosition.sub(position).Magnitude > TWEEN_WAYPOINT_THRESHOLD) {
			this.Tween = this.TweenInFrom(originalPosition);
			coroutine.wrap(() => {
				this.Tween.Completed.Wait();
				if (!this.Destroyed) {
					this.Tween = this.CreateTween();
				}
			})();
		} else {
			this.Tween = this.CreateTween();
		}
		this.ClosestWayPoint = closestWaypoint;
	}

	Destroy(): void {
		this.Destroyed = true;
		this.Tween.Cancel();
		this.DisplayModel.Destroy();
	}

	NewDisplayModel(position: Vector3): Part {
		const newDisplayModel = EndWaypointTemplate.Clone();
		placePathWaypoint(newDisplayModel, position);
		return newDisplayModel;
	}

	CreateTween(): Tween {
		const tweenInfo = new TweenInfo(0.5, Enum.EasingStyle.Sine, Enum.EasingDirection.Out, -1, true);
		const tween = TweenService.Create(this.DisplayModel.FindFirstChild("EndWaypointBillboard") as BillboardGui, tweenInfo, {
			SizeOffset: ENDWAYPOINT_SIZE_OFFSET_MAX,
		});
		tween.Play();
		return tween;
	}

	TweenInFrom(originalPosition: Vector3): Tween {
		const currentPositon = this.DisplayModel.Position;
		const studsOffset = originalPosition.sub(currentPositon);
		(this.DisplayModel.FindFirstChild("EndWaypointBillboard") as BillboardGui).StudsOffset = new Vector3(
			0,
			studsOffset.Y,
			0,
		);
		const tweenInfo = new TweenInfo(1, Enum.EasingStyle.Sine, Enum.EasingDirection.Out);
		const tween = TweenService.Create(this.DisplayModel.FindFirstChild("EndWaypointBillboard") as BillboardGui, tweenInfo, {
			StudsOffset: new Vector3(0, 0, 0),
		});
		tween.Play();
		return tween;
	}
}

class FailureWaypoint {
	DisplayModel: Part;

	constructor(position: Vector3) {
		this.DisplayModel = this.NewDisplayModel(position);
	}

	Hide(): void {
		this.DisplayModel.Parent = undefined;
	}

	Destroy(): void {
		this.DisplayModel.Destroy();
	}

	NewDisplayModel(position: Vector3): Part {
		const newDisplayModel = FailureWaypointTemplate.Clone();
		placePathWaypoint(newDisplayModel, position);
		const ray = new Ray(position.add(new Vector3(0, 2.5, 0)), new Vector3(0, -10, 0));
		const [hitPart, hitPoint, hitNormal] = Workspace.FindPartOnRayWithIgnoreList(ray, [
			Workspace.CurrentCamera as Instance,
			LocalPlayer.Character as Instance,
		]);
		if (hitPart) {
			newDisplayModel.CFrame = new CFrame(hitPoint, hitPoint.add(hitNormal));
			newDisplayModel.Parent = getTrailDotParent();
		}
		return newDisplayModel;
	}

	RunFailureTween(): void {
		legacyWait(FAILURE_TWEEN_LENGTH); // Delay one tween length betfore starting tweening
		// Tween out from center
		const billboard = this.DisplayModel.FindFirstChild("FailureWaypointBillboard") as BillboardGui;
		const frame = billboard.FindFirstChild("Frame") as Frame;
		const imageLabel = frame.FindFirstChild("ImageLabel") as ImageLabel;

		let tweenInfo = new TweenInfo(FAILURE_TWEEN_LENGTH / 2, Enum.EasingStyle.Sine, Enum.EasingDirection.Out);
		const tweenLeft = TweenService.Create(billboard, tweenInfo, { SizeOffset: FAIL_WAYPOINT_SIZE_OFFSET_LEFT });
		tweenLeft.Play();

		const tweenLeftRoation = TweenService.Create(frame, tweenInfo, { Rotation: 10 });
		tweenLeftRoation.Play();

		tweenLeft.Completed.Wait();

		// Tween back and forth
		tweenInfo = new TweenInfo(
			FAILURE_TWEEN_LENGTH,
			Enum.EasingStyle.Sine,
			Enum.EasingDirection.Out,
			FAILURE_TWEEN_COUNT - 1,
			true,
		);
		const tweenSideToSide = TweenService.Create(billboard, tweenInfo, {
			SizeOffset: FAIL_WAYPOINT_SIZE_OFFSET_RIGHT,
		});
		tweenSideToSide.Play();

		// Tween flash dark and roate left and right
		tweenInfo = new TweenInfo(
			FAILURE_TWEEN_LENGTH,
			Enum.EasingStyle.Sine,
			Enum.EasingDirection.Out,
			FAILURE_TWEEN_COUNT - 1,
			true,
		);
		const tweenFlash = TweenService.Create(imageLabel, tweenInfo, {
			ImageColor3: new Color3(0.75, 0.75, 0.75),
		});
		tweenFlash.Play();

		const tweenRotate = TweenService.Create(frame, tweenInfo, { Rotation: -10 });
		tweenRotate.Play();

		tweenSideToSide.Completed.Wait();

		// Tween back to center
		tweenInfo = new TweenInfo(FAILURE_TWEEN_LENGTH / 2, Enum.EasingStyle.Sine, Enum.EasingDirection.Out);
		const tweenCenter = TweenService.Create(billboard, tweenInfo, {
			SizeOffset: FAIL_WAYPOINT_SIZE_OFFSET_CENTER,
		});
		tweenCenter.Play();

		const tweenRoation = TweenService.Create(frame, tweenInfo, { Rotation: 0 });
		tweenRoation.Play();

		tweenCenter.Completed.Wait();

		legacyWait(FAILURE_TWEEN_LENGTH); // Delay one tween length betfore removing
	}
}

const failureAnimation = new Instance("Animation");
failureAnimation.AnimationId = FAILURE_ANIMATION_ID;

let lastHumanoid: Humanoid | undefined = undefined;
let lastFailureAnimationTrack: AnimationTrack | undefined = undefined;

function getFailureAnimationTrack(myHumanoid: Humanoid): AnimationTrack {
	if (myHumanoid === lastHumanoid) {
		return lastFailureAnimationTrack!;
	}
	lastFailureAnimationTrack = myHumanoid.LoadAnimation(failureAnimation);
	lastFailureAnimationTrack.Priority = Enum.AnimationPriority.Action;
	lastFailureAnimationTrack.Looped = false;
	lastHumanoid = myHumanoid;
	return lastFailureAnimationTrack;
}

function findPlayerHumanoid(): Humanoid | undefined {
	const character = LocalPlayer.Character;
	if (character) {
		return character.FindFirstChildOfClass("Humanoid");
	}
	return undefined;
}

function createTrailDots(wayPoints: Array<PathWaypoint>, originalEndWaypoint: Vector3 | undefined): Array<TrailDot | EndWaypoint> {
	const newTrailDots: Array<TrailDot | EndWaypoint> = [];
	let count = 1;
	for (let i = 1; i <= wayPoints.size() - 1; i++) {
		const closeToEnd = wayPoints[i - 1].Position.sub(wayPoints[wayPoints.size() - 1].Position).Magnitude < LAST_DOT_DISTANCE;
		const includeWaypoint = i % WAYPOINT_INCLUDE_FACTOR === 0 && !closeToEnd;
		if (includeWaypoint) {
			const trailDot = new TrailDot(wayPoints[i - 1].Position, i);
			newTrailDots[count - 1] = trailDot;
			count += 1;
		}
	}

	const newEndWaypoint = new EndWaypoint(wayPoints[wayPoints.size() - 1].Position, wayPoints.size(), originalEndWaypoint);
	newTrailDots[newTrailDots.size()] = newEndWaypoint;

	const reversedTrailDots: Array<TrailDot | EndWaypoint> = [];
	count = 1;
	for (let i = newTrailDots.size(); i >= 1; i--) {
		reversedTrailDots[count - 1] = newTrailDots[i - 1];
		count += 1;
	}
	return reversedTrailDots;
}

function getTrailDotScale(distanceToCamera: number, defaultSize: Vector2): Vector2 {
	const rangeLength = TRAIL_DOT_MAX_DISTANCE - TRAIL_DOT_MIN_DISTANCE;
	const inRangePoint = math.clamp(distanceToCamera - TRAIL_DOT_MIN_DISTANCE, 0, rangeLength) / rangeLength;
	const scale = TRAIL_DOT_MIN_SCALE + (TRAIL_DOT_MAX_SCALE - TRAIL_DOT_MIN_SCALE) * inRangePoint;
	return defaultSize.mul(scale);
}

let createPathCount = 0;
// originalEndWaypoint is optional, causes the waypoint to tween from that position.
function CreatePathDisplay(
	wayPoints: Array<PathWaypoint>,
	originalEndWaypoint?: Vector3,
): LuaTuple<[() => void, (wayPointNumber: number) => void]> {
	createPathCount += 1;
	let trailDots: Array<(TrailDot | EndWaypoint) | undefined> = createTrailDots(wayPoints, originalEndWaypoint);

	function removePathBeforePoint(wayPointNumber: number): void {
		// kill all trailDots before and at wayPointNumber
		for (let i = trailDots.size(); i >= 1; i--) {
			const trailDot = trailDots[i - 1]!;
			if (trailDot.ClosestWayPoint! <= wayPointNumber) {
				trailDot.Destroy();
				trailDots[i - 1] = undefined;
			} else {
				break;
			}
		}
	}

	const reiszeTrailDotsUpdateName = `ClickToMoveResizeTrail${createPathCount}`;
	function resizeTrailDots(): void {
		if (trailDots.size() === 0) {
			RunService.UnbindFromRenderStep(reiszeTrailDotsUpdateName);
			return;
		}
		const cameraPos = Workspace.CurrentCamera!.CFrame.Position;
		for (let i = 1; i <= trailDots.size(); i++) {
			const trailDotImage = trailDots[i - 1]!.DisplayModel.FindFirstChild("TrailDotImage") as
				| ImageHandleAdornment
				| undefined;
			if (trailDotImage) {
				const distanceToCamera = trailDots[i - 1]!.DisplayModel.Position.sub(cameraPos).Magnitude;
				trailDotImage.Size = getTrailDotScale(distanceToCamera, TrailDotSize);
			}
		}
	}
	RunService.BindToRenderStep(reiszeTrailDotsUpdateName, Enum.RenderPriority.Camera.Value - 1, resizeTrailDots);

	function removePath(): void {
		removePathBeforePoint(wayPoints.size());
	}

	return $tuple(removePath, removePathBeforePoint);
}

let lastFailureWaypoint: FailureWaypoint | undefined = undefined;
function DisplayFailureWaypoint(position: Vector3): void {
	if (lastFailureWaypoint) {
		lastFailureWaypoint.Hide();
	}
	let failureWaypoint: FailureWaypoint | undefined = new FailureWaypoint(position);
	lastFailureWaypoint = failureWaypoint;
	coroutine.wrap(() => {
		failureWaypoint!.RunFailureTween();
		failureWaypoint!.Destroy();
		failureWaypoint = undefined;
	})();
}

function CreateEndWaypoint(position: Vector3): EndWaypoint {
	return new EndWaypoint(position);
}

function PlayFailureAnimation(): void {
	const myHumanoid = findPlayerHumanoid();
	if (myHumanoid) {
		const animationTrack = getFailureAnimationTrack(myHumanoid);
		animationTrack.Play();
	}
}

function CancelFailureAnimation(): void {
	if (lastFailureAnimationTrack !== undefined && lastFailureAnimationTrack.IsPlaying) {
		lastFailureAnimationTrack.Stop();
	}
}

function SetWaypointTexture(texture: string): void {
	TrailDotIcon = texture;
	[TrailDotTemplate, EndWaypointTemplate, FailureWaypointTemplate] = CreateWaypointTemplates();
}

function GetWaypointTexture(): string {
	return TrailDotIcon;
}

function SetWaypointRadius(radius: number): void {
	TrailDotSize = new Vector2(radius, radius);
	[TrailDotTemplate, EndWaypointTemplate, FailureWaypointTemplate] = CreateWaypointTemplates();
}

function GetWaypointRadius(): number {
	return TrailDotSize.X;
}

function SetEndWaypointTexture(texture: string): void {
	EndWaypointIcon = texture;
	[TrailDotTemplate, EndWaypointTemplate, FailureWaypointTemplate] = CreateWaypointTemplates();
}

function GetEndWaypointTexture(): string {
	return EndWaypointIcon;
}

function SetWaypointsAlwaysOnTop(alwaysOnTop: boolean): void {
	WaypointsAlwaysOnTop = alwaysOnTop;
	[TrailDotTemplate, EndWaypointTemplate, FailureWaypointTemplate] = CreateWaypointTemplates();
}

function GetWaypointsAlwaysOnTop(): boolean {
	return WaypointsAlwaysOnTop;
}

const ClickToMoveDisplay = {
	CreatePathDisplay,
	DisplayFailureWaypoint,
	CreateEndWaypoint,
	PlayFailureAnimation,
	CancelFailureAnimation,
	SetWaypointTexture,
	GetWaypointTexture,
	SetWaypointRadius,
	GetWaypointRadius,
	SetEndWaypointTexture,
	GetEndWaypointTexture,
	SetWaypointsAlwaysOnTop,
	GetWaypointsAlwaysOnTop,
};

export = ClickToMoveDisplay;
