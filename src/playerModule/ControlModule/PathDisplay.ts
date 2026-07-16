// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/PathDisplay (ModuleScript)

const Workspace = game.GetService("Workspace");
const Players = game.GetService("Players");

const spacing = 8;
const image = "rbxasset://textures/Cursors/Gamepad/Pointer.png";
const imageSize = new Vector2(2, 2);

let currentPoints: Array<Vector3> = [];
let renderedPoints: Array<ImageHandleAdornment> = [];

const pointModel = new Instance("Model");
pointModel.Name = "PathDisplayPoints";

const adorneePart = new Instance("Part");
adorneePart.Anchored = true;
adorneePart.CanCollide = false;
adorneePart.Transparency = 1;
adorneePart.Name = "PathDisplayAdornee";
adorneePart.CFrame = new CFrame(0, 0, 0);
adorneePart.Parent = pointModel;

const pointPool: Array<ImageHandleAdornment> = [];
let poolTop = 30;
for (let i = 1; i <= poolTop; i++) {
	const point = new Instance("ImageHandleAdornment");
	point.Archivable = false;
	point.Adornee = adorneePart;
	point.Image = image;
	point.Size = imageSize;
	pointPool[i - 1] = point;
}

function retrieveFromPool(): ImageHandleAdornment | undefined {
	const point = pointPool[0];
	if (point === undefined) {
		return undefined;
	}

	pointPool[0] = pointPool[poolTop - 1];
	pointPool[poolTop - 1] = undefined as unknown as ImageHandleAdornment;
	poolTop -= 1;
	return point;
}

function returnToPool(point: ImageHandleAdornment) {
	poolTop += 1;
	pointPool[poolTop - 1] = point;
}

function renderPoint(point: Vector3, isLast: boolean): ImageHandleAdornment | undefined {
	if (poolTop === 0) {
		return undefined;
	}

	const rayDown = new Ray(point.add(new Vector3(0, 2, 0)), new Vector3(0, -8, 0));
	const [hitPart, hitPoint, hitNormal] = Workspace.FindPartOnRayWithIgnoreList(rayDown, [
		Players.LocalPlayer.Character as Instance,
		Workspace.CurrentCamera as Instance,
	]);
	if (!hitPart) {
		return undefined;
	}

	const pointCFrame = new CFrame(hitPoint, hitPoint.add(hitNormal));

	// retrieveFromPool() is guaranteed non-undefined here since poolTop was just checked above
	// (matches the original, which does not null-check the result either).
	const adornment = retrieveFromPool()!;
	adornment.CFrame = pointCFrame;
	adornment.Parent = pointModel;
	return adornment;
}

function setCurrentPoints(points: unknown): void {
	if (typeIs(points, "table")) {
		currentPoints = points as Array<Vector3>;
	} else {
		currentPoints = [];
	}
}

function clearRenderedPath(): void {
	for (const oldPoint of renderedPoints) {
		oldPoint.Parent = undefined;
		returnToPool(oldPoint);
	}
	renderedPoints = [];
	pointModel.Parent = undefined;
}

function renderPath(): void {
	clearRenderedPath();
	if (!currentPoints || currentPoints.size() === 0) {
		return;
	}

	let currentIdx = currentPoints.size();
	const lastPos = currentPoints[currentIdx - 1];
	let distanceBudget = 0;

	renderedPoints[0] = renderPoint(lastPos, true)!;
	if (!renderedPoints[0]) {
		return;
	}

	while (true) {
		const currentPoint = currentPoints[currentIdx - 1];
		const nextPoint = currentPoints[currentIdx - 2];

		if (currentIdx < 2) {
			break;
		} else {
			const toNextPoint = nextPoint.sub(currentPoint);
			const distToNextPoint = toNextPoint.Magnitude;

			if (distanceBudget > distToNextPoint) {
				distanceBudget -= distToNextPoint;
				currentIdx -= 1;
			} else {
				const dirToNextPoint = toNextPoint.Unit;
				const pointPos = currentPoint.add(dirToNextPoint.mul(distanceBudget));
				const point = renderPoint(pointPos, false);

				if (point) {
					renderedPoints[renderedPoints.size()] = point;
				}

				distanceBudget += spacing;
			}
		}
	}

	pointModel.Parent = Workspace.CurrentCamera;
}

const PathDisplay = {
	spacing,
	image,
	imageSize,
	setCurrentPoints,
	clearRenderedPath,
	renderPath,
};

export = PathDisplay;
