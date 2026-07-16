// Original: StarterPlayer/StarterPlayerScripts/menuCamera (LocalScript)
// (One non-functional offensive comment from the original was not carried over.)

import { FunctionsAndEvents } from "shared/FunctionsAndEvents";

const UserInputService = game.GetService("UserInputService");
const RunService = game.GetService("RunService");
const Players = game.GetService("Players");

const camera = game.Workspace.CurrentCamera!;

const player = Players.LocalPlayer;
//local character = player.CharacterAdded:Wait()
//local torso = character:WaitForChild("HumanoidRootPart")
//local playerPosition = torso.Position
const default_Rotation = (
	game.Workspace as unknown as { PlayerGarages: { garageModel: { spawnPlate: BasePart } } }
).PlayerGarages.garageModel.spawnPlate.Orientation;

//local default_CameraPosition = workspace.PlayerGarages.garageModel.Cameras.Body.Position --torso.Position
const default_CameraRotation = new Vector2(-1.17809725, 0); //Vector2.new(math.rad(workspace.PlayerGarages.garageModel.spawnPlate.Orientation.Y),0)
const default_CameraZoom = 15;
const default_CameraFOV = 75;

let playersCar: Model | undefined = undefined;
let playerGarage: (Model & { spawnPlate: BasePart; spawnPlateModel: BasePart }) | undefined = undefined;
FunctionsAndEvents.CreateClientSidedCar.OnClientEvent.Connect((...args: unknown[]) => {
	playersCar = args[0] as Model;
});

let cameraCFrame: CFrame | undefined = undefined; //workspace.garageModel.Cameras.Body

//local cameraPosition = default_CameraPosition
let cameraRotation = default_CameraRotation;
const cameraZoom = default_CameraZoom;
let cameraFOV = default_CameraFOV;

const cameraZoomBounds: [number, number] | undefined = [60, 90];
const cameraRotateSpeed = 10;
const cameraMouseRotateSpeed = 0.25;
const cameraTouchRotateSpeed = 10;
const TweenService = game.GetService("TweenService");

function SetCameraMode() {
	camera.CameraType = "Scriptable" as unknown as Enum.CameraType;
	camera.FieldOfView = 80;
	camera.CameraSubject = undefined;
}

function changeCframePos(cframe: CFrame, pos: Vector3): CFrame {
	const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = cframe.GetComponents();

	return new CFrame(pos.X, pos.Y, pos.Z, r00, r01, r02, r10, r11, r12, r20, r21, r22);
}

let rotationDifference = 0;
let lastCameraRotation = 0;
function UpdateCamera() {
	SetCameraMode();
	const cameraRotationCFrame = CFrame.Angles(0, cameraRotation.X, 0).mul(CFrame.Angles(cameraRotation.Y, 0, 0));

	playerGarage!.spawnPlateModel.Orientation = new Vector3(0, math.deg(cameraRotation.X), -90);
	playerGarage!.spawnPlate.Orientation = new Vector3(0, math.deg(cameraRotation.X), 0);

	rotationDifference = cameraRotation.X - lastCameraRotation;

	if (playersCar && playersCar.PrimaryPart) {
		const carCFrame = playersCar.GetPrimaryPartCFrame();
		playersCar.SetPrimaryPartCFrame(carCFrame.mul(CFrame.Angles(0, rotationDifference, 0)));
		//playersCar:SetPrimaryPartCFrame(changeCframePos (playerGarage.spawnPlate.CFrame, playersCar.PrimaryPart.Position) )
	} else {
		//cameraRotation = default_CameraRotation
		playerGarage!.spawnPlateModel.Orientation = new Vector3(0, math.deg(cameraRotation.X), -90);
		playerGarage!.spawnPlate.Orientation = new Vector3(0, math.deg(cameraRotation.X), 0);
	}
	//	local tweenInfo = TweenInfo.new(0.1, Enum.EasingStyle.Linear)

	//	local tween1 = TweenService:Create(workspace.garageModel.spawnPlateModel, tweenInfo, { Orientation = Vector3.new(0, math.deg(cameraRotation.X), -90)})
	//	tween1:Play()

	//workspace.garageModel.spawnPlateModel.HingeConstraint.TargetAngle = math.deg(cameraRotation.X)
	camera.CFrame = cameraCFrame!; // cameraRotationCFrame + cameraPosition + cameraRotationCFrame * Vector3.new(0, 0, cameraZoom)
	//camera.Focus = camera.CFrame - Vector3.new(0, camera.CFrame.p.Y, 0)
	camera.FieldOfView = cameraFOV;

	lastCameraRotation = cameraRotation.X;
}

let lastTouchTranslation: Vector2 | undefined = undefined;
function TouchMove(_touchPositions: unknown, totalTranslation: Vector2, _velocity: unknown, state: Enum.UserInputState) {
	if (state === Enum.UserInputState.Change || state === Enum.UserInputState.End) {
		if (lastTouchTranslation !== undefined && totalTranslation !== undefined) {
			const difference = totalTranslation.sub(lastTouchTranslation);
			cameraRotation = cameraRotation.add(difference.div(160));
			//cameraPosition = cameraPosition + Vector3.new(difference.X, 0, difference.Y)
			UpdateCamera();
		}
	}
	if (totalTranslation !== undefined) {
		lastTouchTranslation = totalTranslation;
	}
}

let lastTouchRotation: number | undefined = undefined;
function TouchRotate(_touchPositions: unknown, rotation: number, _velocity: unknown, state: Enum.UserInputState) {
	if (state === Enum.UserInputState.Change || state === Enum.UserInputState.End) {
		const difference = rotation - lastTouchRotation!;
		cameraRotation = cameraRotation.add(
			new Vector2(-difference, 0).mul(math.rad(cameraTouchRotateSpeed * cameraRotateSpeed)),
		);
		UpdateCamera();
	}
	lastTouchRotation = rotation;
}

let lastTouchScale: number | undefined = undefined;
function TouchZoom(_touchPositions: unknown, scale: number, _velocity: unknown, state: Enum.UserInputState) {
	if (state === Enum.UserInputState.Change || state === Enum.UserInputState.End) {
		const difference = scale - lastTouchScale!;
		cameraFOV = cameraFOV * (1 + difference);
		if (cameraZoomBounds !== undefined) {
			cameraFOV = math.min(math.max(cameraFOV, cameraZoomBounds[0]), cameraZoomBounds[1]);
		} else {
			cameraFOV = math.max(cameraFOV, 0);
		}
		UpdateCamera();
	}
	lastTouchScale = scale;
}

function Input(inputObject: InputObject) {
	//if inputObject.UserInputType == Enum.UserInputType.Keyboard then
	//	if inputObject.UserInputState == Enum.UserInputState.Begin then
	//		-- (I) Zoom In
	//		if inputObject.KeyCode == Enum.KeyCode.I then
	//			cameraZoom = cameraZoom - 15
	//		elseif inputObject.KeyCode == Enum.KeyCode.O then
	//			cameraZoom = cameraZoom + 15
	//		end

	//		-- (O) Zoom Out
	//		if cameraZoomBounds ~= nil then
	//			cameraZoom = math.min(math.max(cameraZoom, cameraZoomBounds[1]), cameraZoomBounds[2])
	//		else
	//			cameraZoom = math.max(cameraZoom, 0)
	//		end

	//		UpdateCamera()
	//	end
	//end
	//SCROLLING
	// if inputObject.UserInputType == Enum.UserInputType.MouseWheel then
	// 	if inputObject.Position.Z == 1 then
	// 		cameraFOV -= 5
	// 	elseif inputObject.Position.Z == -1 then
	// 		cameraFOV += 5
	// 	end
	//
	// 	if cameraZoomBounds ~= nil then
	// 		cameraFOV = math.min(math.max(cameraFOV, cameraZoomBounds[1]), cameraZoomBounds[2])
	// 	else
	// 		cameraFOV = math.max(cameraFOV, 0)
	// 	end
	//
	// 	UpdateCamera()
	// end

	const pressed = UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton1);
	if (pressed) {
		UserInputService.MouseBehavior = Enum.MouseBehavior.LockCurrentPosition;
		const rotation = UserInputService.GetMouseDelta();
		cameraRotation = cameraRotation.add(rotation.mul(math.rad(cameraMouseRotateSpeed)));
	} else {
		UserInputService.MouseBehavior = Enum.MouseBehavior.Default;
	}

	UpdateCamera();
}

// local function PlayerChanged()
// 	--local movement = torso.Position - playerPosition
// 	--cameraPosition = cameraPosition + movement
// 	--playerPosition = torso.Position

// 	UpdateCamera()
// end

const comnections = new Map<number, RBXScriptConnection>();

// Determine whether the user is on a mobile device

function toggleCamera(toggle: boolean, playerGarageParam?: Model & { spawnPlate: BasePart; spawnPlateModel: BasePart }) {
	if (toggle) {
		playerGarage = playerGarageParam;
		game.GetService("StarterGui").SetCoreGuiEnabled(Enum.CoreGuiType.Chat, false);
		for (const [, comenction] of pairs(comnections)) {
			comenction.Disconnect();
		}
		if (UserInputService.TouchEnabled) {
			// The user is on a mobile device, use Touch events
			comnections.set(1, UserInputService.TouchPan.Connect(TouchMove as never));
			//UserInputService.TouchRotate:Connect(TouchRotate)
			comnections.set(2, UserInputService.TouchPinch.Connect(TouchZoom as never));
		} else {
			// The user is not on a mobile device use Input events
			comnections.set(3, UserInputService.InputBegan.Connect(Input as never));
			comnections.set(4, UserInputService.InputChanged.Connect(Input as never));
			comnections.set(5, UserInputService.InputEnded.Connect(Input as never));

			// Camera controlled by player movement
			task.wait(2);
			// pcall(function()
			// RunService:UnbindFromRenderStep("PlayerChanged")
			// end)

			//RunService:BindToRenderStep("PlayerChanged", Enum.RenderPriority.Camera.Value - 1, PlayerChanged)
		}
	} else {
		//RunService:UnbindFromRenderStep("PlayerChanged")

		camera.CameraType = Enum.CameraType.Custom;

		for (const [, comenction] of pairs(comnections)) {
			comenction.Disconnect();
		}

		pcall(() => {
			game.GetService("StarterGui").SetCoreGuiEnabled(Enum.CoreGuiType.Chat, true);
		});
	}
}

FunctionsAndEvents.ToggleMenuCamera.OnClientEvent.Connect((...args: unknown[]) => {
	toggleCamera(args[0] as boolean, args[1] as never);
});

FunctionsAndEvents.SetMenuCameraCFrame.OnClientEvent.Connect((...args: unknown[]) => {
	cameraCFrame = args[0] as CFrame;
	UpdateCamera();
});
