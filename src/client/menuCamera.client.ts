// Original: StarterPlayer/StarterPlayerScripts/menuCamera (LocalScript)
// (One non-functional offensive comment from the original was not carried over.)

import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import { onAimMenuCamera } from "shared/ui/menuCameraBus";

const UserInputService = game.GetService("UserInputService");
const RunService = game.GetService("RunService");
const Players = game.GetService("Players");

// Re-fetch every use: the Camera instance can be replaced while we're running,
// and a reference captured at boot would silently target a dead camera.
function currentCamera(): Camera {
	return game.Workspace.CurrentCamera!;
}

const player = Players.LocalPlayer;
//local character = player.CharacterAdded:Wait()
//local torso = character:WaitForChild("HumanoidRootPart")
//local playerPosition = torso.Position
// (Removed dead `default_Rotation` read: it dot-accessed
// PlayerGarages.garageModel.spawnPlate at startup, which errors under
// StreamingEnabled when the garage hasn't streamed in yet — killing this
// whole script before any event handlers connected. The value was never used.)

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

// Whether the menu camera currently owns the camera. Guards against the
// join-team race: a mouse move (or a late SetMenuCameraCFrame) landing after
// ToggleMenuCamera(false) used to re-force Scriptable with a nil
// CameraSubject, leaving the player stuck at the menu shot in-game.
let menuActive = false;

function SetCameraMode() {
	const camera = currentCamera();
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
	// Camera target not received yet (e.g. mouse input on the landing page
	// before SetMenuCameraCFrame arrives) — nothing to aim at. Also bail when
	// the menu no longer owns the camera, so nothing here can steal it back
	// from gameplay.
	if (!menuActive || cameraCFrame === undefined) {
		return;
	}
	// Camera FIRST, garage cosmetics second. Under StreamingEnabled the garage's
	// BaseParts routinely haven't streamed in at join; the old order forced
	// Scriptable, then threw on a spawnPlate dot-access before ever assigning
	// CFrame — a Scriptable camera frozen at the default sky shot, permanently
	// (every later call threw the same way, and streaming follows the camera,
	// so the garage never streamed in either).
	SetCameraMode();
	const camera = currentCamera();
	camera.CFrame = cameraCFrame!; // cameraRotationCFrame + cameraPosition + cameraRotationCFrame * Vector3.new(0, 0, cameraZoom)
	//camera.Focus = camera.CFrame - Vector3.new(0, camera.CFrame.p.Y, 0)
	camera.FieldOfView = cameraFOV;
	// Tells the ReplicatedFirst loading screen it can fade out.
	if (player.GetAttribute("MenuCameraApplied") !== true) {
		player.SetAttribute("MenuCameraApplied", true);
	}

	rotationDifference = cameraRotation.X - lastCameraRotation;

	// Turntable cosmetics — every part access via FindFirstChild, so a
	// not-yet-streamed garage degrades to "plate doesn't spin" instead of
	// killing the camera update above.
	const spawnPlateModel = playerGarage?.FindFirstChild("spawnPlateModel");
	const spawnPlate = playerGarage?.FindFirstChild("spawnPlate");
	if (spawnPlateModel !== undefined && spawnPlateModel.IsA("BasePart")) {
		spawnPlateModel.Orientation = new Vector3(0, math.deg(cameraRotation.X), -90);
	}
	if (spawnPlate !== undefined && spawnPlate.IsA("BasePart")) {
		spawnPlate.Orientation = new Vector3(0, math.deg(cameraRotation.X), 0);
	}
	if (playersCar && playersCar.PrimaryPart) {
		const carCFrame = playersCar.GetPrimaryPartCFrame();
		playersCar.SetPrimaryPartCFrame(carCFrame.mul(CFrame.Angles(0, rotationDifference, 0)));
		//playersCar:SetPrimaryPartCFrame(changeCframePos (playerGarage.spawnPlate.CFrame, playersCar.PrimaryPart.Position) )
	}
	//	local tweenInfo = TweenInfo.new(0.1, Enum.EasingStyle.Linear)

	//	local tween1 = TweenService:Create(workspace.garageModel.spawnPlateModel, tweenInfo, { Orientation = Vector3.new(0, math.deg(cameraRotation.X), -90)})
	//	tween1:Play()

	//workspace.garageModel.spawnPlateModel.HingeConstraint.TargetAngle = math.deg(cameraRotation.X)
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

// The server passes the garage Model by reference over the remote. Under
// StreamingEnabled an instance argument the client hasn't received yet
// arrives as nil — so when that happens, resolve it ourselves from
// workspace.PlayerGarages (the Model containers and their Player NumberValue
// replicate eagerly; only BaseParts stream).
function resolveGarageLocally() {
	task.spawn(() => {
		const garagesFolder = game.Workspace.WaitForChild("PlayerGarages", 30);
		while (menuActive && playerGarage === undefined && garagesFolder !== undefined) {
			for (const garage of garagesFolder.GetChildren()) {
				const owner = garage.FindFirstChild("Player");
				if (owner !== undefined && owner.IsA("NumberValue") && owner.Value === player.UserId) {
					playerGarage = garage as never;
					UpdateCamera();
					break;
				}
			}
			if (playerGarage === undefined) {
				task.wait(0.5);
			}
		}
	});
}

function toggleCamera(toggle: boolean, playerGarageParam?: Model & { spawnPlate: BasePart; spawnPlateModel: BasePart }) {
	menuActive = toggle;
	if (toggle) {
		playerGarage = playerGarageParam ?? playerGarage;
		if (playerGarage === undefined) {
			resolveGarageLocally();
		}
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

		const camera = currentCamera();
		camera.CameraType = Enum.CameraType.Custom;
		// SetCameraMode nulled CameraSubject while the menu owned the camera.
		// The engine only re-points the subject on CharacterAdded, which can
		// fire BEFORE this event arrives (LoadCharacter runs first on the
		// server) — so restore it here or a Custom camera with a nil subject
		// sits at the menu shot forever.
		const humanoid = player.Character?.FindFirstChildOfClass("Humanoid");
		if (humanoid) {
			camera.CameraSubject = humanoid;
		}

		for (const [, comenction] of pairs(comnections)) {
			comenction.Disconnect();
		}

	}
}

FunctionsAndEvents.ToggleMenuCamera.OnClientEvent.Connect((...args: unknown[]) => {
	toggleCamera(args[0] as boolean, args[1] as never);
});

FunctionsAndEvents.SetMenuCameraCFrame.OnClientEvent.Connect((...args: unknown[]) => {
	// Always remember the target (a toggle-on may follow), but only steer the
	// camera while the menu owns it — UpdateCamera's menuActive guard keeps a
	// late-arriving CFrame from re-forcing Scriptable mid-game.
	cameraCFrame = args[0] as CFrame;
	// An omitted FOV restores normal menu framing, preventing the landing shot
	// from carrying into the garage pages.
	cameraFOV = (args[1] as number | undefined) ?? default_CameraFOV;
	UpdateCamera();
});

// Phase 5: the client-owned garage aims tab-switch shots LOCALLY over the
// menuCameraBus — treated exactly like a SetMenuCameraCFrame push (the
// server keeps aiming the landing/garage-entry/crate shots over the remote).
onAimMenuCamera((cframe, fov) => {
	cameraCFrame = cframe;
	cameraFOV = fov ?? default_CameraFOV;
	UpdateCamera();
});

// Join handshake: the server fires ToggleMenuCamera/SetMenuCameraCFrame from
// PlayerAdded, i.e. potentially before this script's connections above exist —
// fires in that window can be lost. Now that everything is connected, ask the
// server to re-send the current menu camera state. Runs in its own thread so
// the WaitForChild (the remote is created by initializePlayer at runtime)
// can't delay the connections above. Both sides are idempotent, so receiving
// the state twice is harmless.
task.spawn(() => {
	const menuCameraReady = FunctionsAndEvents.WaitForChild("MenuCameraReady", 30);
	if (menuCameraReady !== undefined && menuCameraReady.IsA("RemoteEvent")) {
		menuCameraReady.FireServer();
	}
});
