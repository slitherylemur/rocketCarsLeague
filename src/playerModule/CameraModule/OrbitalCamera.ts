// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/OrbitalCamera (ModuleScript)
//
// OrbitalCamera - Spherical coordinates control camera for top-down games
// 2018 Camera Update - AllYourBlox

import BaseCamera from "./BaseCamera";
import CameraInput from "./CameraInput";
import Util from "./CameraUtils";

// Local private variables and constants
const UNIT_Z = new Vector3(0, 0, 1);
const X1_Y0_Z1 = new Vector3(1, 0, 1); //Note: not a unit vector, used for projecting onto XZ plane
const ZERO_VECTOR3 = new Vector3(0, 0, 0);
const TAU = 2 * math.pi;

// Do not edit these values, they are not the developer-set limits, they are limits
// to the values the camera system equations can correctly handle
const MIN_ALLOWED_ELEVATION_DEG = -80;
const MAX_ALLOWED_ELEVATION_DEG = 80;

// Module-level defaults table from the original source - never referenced again after this
// (each OrbitalCamera instance builds its own `self.externalProperties` copy in the
// constructor), but preserved here as in the original Lua.
const externalProperties: Record<string, number | boolean> = {};
externalProperties["InitialDistance"] = 25;
externalProperties["MinDistance"] = 10;
externalProperties["MaxDistance"] = 100;
externalProperties["InitialElevation"] = 35;
externalProperties["MinElevation"] = 35;
externalProperties["MaxElevation"] = 35;
externalProperties["ReferenceAzimuth"] = -45; // Angle around the Y axis where the camera starts. -45 offsets the camera in the -X and +Z directions equally
externalProperties["CWAzimuthTravel"] = 90; // How many degrees the camera is allowed to rotate from the reference position, CW as seen from above
externalProperties["CCWAzimuthTravel"] = 90; // How many degrees the camera is allowed to rotate from the reference position, CCW as seen from above
externalProperties["UseAzimuthLimits"] = false; // Full rotation around Y axis available by default

//[[ Services ]]--
const PlayersService = game.GetService("Players");
const VRService = game.GetService("VRService");

//[[ The Module ]]--
class OrbitalCamera extends BaseCamera {
	lastUpdate: number | undefined;

	// OrbitalCamera-specific members
	changedSignalConnections: Record<string, RBXScriptConnection>;
	// `refAzimuthRad` is assigned nil in the original constructor and never read or written
	// again anywhere in the module - preserved as a dead field.
	refAzimuthRad: number | undefined;
	// The remaining "cur/min/max" fields are nil-initialized in the constructor and always
	// populated synchronously by `LoadNumberValueParameters()` before any other method can
	// observe them (mirroring the Lua `self.x = nil` placeholders), so they're declared as
	// definitely-assigned numbers/booleans rather than optional to keep every downstream
	// consumer's math untouched.
	curAzimuthRad!: number;
	minAzimuthAbsoluteRad!: number;
	maxAzimuthAbsoluteRad!: number;
	useAzimuthLimits!: boolean;
	curElevationRad!: number;
	minElevationRad!: number;
	maxElevationRad!: number;
	curDistance!: number;
	minDistance!: number;
	maxDistance!: number;

	gamepadDollySpeedMultiplier: number;

	externalProperties: Record<string, number | boolean>;

	constructor() {
		super();

		this.lastUpdate = tick();

		// OrbitalCamera-specific members
		this.changedSignalConnections = {};
		this.refAzimuthRad = undefined;
		this.curAzimuthRad = undefined as unknown as number;
		this.minAzimuthAbsoluteRad = undefined as unknown as number;
		this.maxAzimuthAbsoluteRad = undefined as unknown as number;
		this.useAzimuthLimits = undefined as unknown as boolean;
		this.curElevationRad = undefined as unknown as number;
		this.minElevationRad = undefined as unknown as number;
		this.maxElevationRad = undefined as unknown as number;
		this.curDistance = undefined as unknown as number;
		this.minDistance = undefined as unknown as number;
		this.maxDistance = undefined as unknown as number;

		this.gamepadDollySpeedMultiplier = 1;

		this.lastUserPanCamera = tick();

		this.externalProperties = {};
		this.externalProperties["InitialDistance"] = 25;
		this.externalProperties["MinDistance"] = 10;
		this.externalProperties["MaxDistance"] = 100;
		this.externalProperties["InitialElevation"] = 35;
		this.externalProperties["MinElevation"] = 35;
		this.externalProperties["MaxElevation"] = 35;
		this.externalProperties["ReferenceAzimuth"] = -45; // Angle around the Y axis where the camera starts. -45 offsets the camera in the -X and +Z directions equally
		this.externalProperties["CWAzimuthTravel"] = 90; // How many degrees the camera is allowed to rotate from the reference position, CW as seen from above
		this.externalProperties["CCWAzimuthTravel"] = 90; // How many degrees the camera is allowed to rotate from the reference position, CCW as seen from above
		this.externalProperties["UseAzimuthLimits"] = false; // Full rotation around Y axis available by default
		this.LoadNumberValueParameters();
	}

	LoadOrCreateNumberValueParameter(
		name: string,
		valueType: "NumberValue" | "BoolValue",
		// Original Lua passes bare method references (`self.SetAndBoundsCheckAzimuthValues`) and
		// invokes them as `updateFunction(self)`; the closest faithful TS shape is a plain
		// function taking the instance explicitly, called the same way below.
		updateFunction: ((self: OrbitalCamera) => void) | undefined,
	): void {
		let valueObj = script.FindFirstChild(name) as NumberValue | BoolValue | undefined;

		if (valueObj !== undefined && valueObj.IsA(valueType)) {
			// Value object exists and is the correct type, use its value
			this.externalProperties[name] = valueObj.Value;
		} else if (this.externalProperties[name] !== undefined) {
			// Create missing (or replace incorrectly-typed) valueObject with default value
			valueObj = new Instance(valueType);
			valueObj.Name = name;
			valueObj.Parent = script;
			(valueObj as unknown as { Value: number | boolean }).Value = this.externalProperties[name];
		} else {
			return;
		}

		if (updateFunction) {
			if (this.changedSignalConnections[name]) {
				this.changedSignalConnections[name].Disconnect();
			}
			this.changedSignalConnections[name] = (
				valueObj.Changed as unknown as RBXScriptSignal<(newValue: number | boolean) => void>
			).Connect((newValue) => {
				this.externalProperties[name] = newValue;
				if (updateFunction) {
					updateFunction(this);
				}
			});
		}
	}

	SetAndBoundsCheckAzimuthValues(): void {
		this.minAzimuthAbsoluteRad =
			math.rad(this.externalProperties["ReferenceAzimuth"] as number) -
			math.abs(math.rad(this.externalProperties["CWAzimuthTravel"] as number));
		this.maxAzimuthAbsoluteRad =
			math.rad(this.externalProperties["ReferenceAzimuth"] as number) +
			math.abs(math.rad(this.externalProperties["CCWAzimuthTravel"] as number));
		this.useAzimuthLimits = this.externalProperties["UseAzimuthLimits"] as boolean;
		if (this.useAzimuthLimits) {
			this.curAzimuthRad = math.max(this.curAzimuthRad, this.minAzimuthAbsoluteRad);
			this.curAzimuthRad = math.min(this.curAzimuthRad, this.maxAzimuthAbsoluteRad);
		}
	}

	// These degree values are the direct user input values. It is deliberate that they are
	// ranged checked only against the extremes, and not against each other. Any time one
	// is changed, both of the internal values in radians are recalculated. This allows for
	// A developer to change the values in any order and for the end results to be that the
	// internal values adjust to match intent as best as possible.
	SetAndBoundsCheckElevationValues(): void {
		const minElevationDeg = math.max(this.externalProperties["MinElevation"] as number, MIN_ALLOWED_ELEVATION_DEG);
		const maxElevationDeg = math.min(this.externalProperties["MaxElevation"] as number, MAX_ALLOWED_ELEVATION_DEG);

		// Set internal values in radians
		this.minElevationRad = math.rad(math.min(minElevationDeg, maxElevationDeg));
		this.maxElevationRad = math.rad(math.max(minElevationDeg, maxElevationDeg));
		this.curElevationRad = math.max(this.curElevationRad, this.minElevationRad);
		this.curElevationRad = math.min(this.curElevationRad, this.maxElevationRad);
	}

	SetAndBoundsCheckDistanceValues(): void {
		this.minDistance = this.externalProperties["MinDistance"] as number;
		this.maxDistance = this.externalProperties["MaxDistance"] as number;
		this.curDistance = math.max(this.curDistance, this.minDistance);
		this.curDistance = math.min(this.curDistance, this.maxDistance);
	}

	// This loads from, or lazily creates, NumberValue objects for exposed parameters
	LoadNumberValueParameters(): void {
		// These initial values do not require change listeners since they are read only once
		this.LoadOrCreateNumberValueParameter("InitialElevation", "NumberValue", undefined);
		this.LoadOrCreateNumberValueParameter("InitialDistance", "NumberValue", undefined);

		// Note: ReferenceAzimuth is also used as an initial value, but needs a change listener because it is used in the calculation of the limits
		//
		// The original Lua passes `self.SetAndBoundsCheckAzimuthValue` here (singular "Value"),
		// which does not match the actual method name `SetAndBoundsCheckAzimuthValues` (plural).
		// That typo means the referenced field is nil in the original source, so no change
		// listener actually gets attached for ReferenceAzimuth - preserved verbatim below.
		this.LoadOrCreateNumberValueParameter("ReferenceAzimuth", "NumberValue", undefined);
		this.LoadOrCreateNumberValueParameter("CWAzimuthTravel", "NumberValue", (self) =>
			self.SetAndBoundsCheckAzimuthValues(),
		);
		this.LoadOrCreateNumberValueParameter("CCWAzimuthTravel", "NumberValue", (self) =>
			self.SetAndBoundsCheckAzimuthValues(),
		);
		this.LoadOrCreateNumberValueParameter("MinElevation", "NumberValue", (self) =>
			self.SetAndBoundsCheckElevationValues(),
		);
		this.LoadOrCreateNumberValueParameter("MaxElevation", "NumberValue", (self) =>
			self.SetAndBoundsCheckElevationValues(),
		);
		this.LoadOrCreateNumberValueParameter("MinDistance", "NumberValue", (self) =>
			self.SetAndBoundsCheckDistanceValues(),
		);
		this.LoadOrCreateNumberValueParameter("MaxDistance", "NumberValue", (self) =>
			self.SetAndBoundsCheckDistanceValues(),
		);
		this.LoadOrCreateNumberValueParameter("UseAzimuthLimits", "BoolValue", (self) =>
			self.SetAndBoundsCheckAzimuthValues(),
		);

		// Internal values set (in radians, from degrees), plus sanitization
		this.curAzimuthRad = math.rad(this.externalProperties["ReferenceAzimuth"] as number);
		this.curElevationRad = math.rad(this.externalProperties["InitialElevation"] as number);
		this.curDistance = this.externalProperties["InitialDistance"] as number;

		this.SetAndBoundsCheckAzimuthValues();
		this.SetAndBoundsCheckElevationValues();
		this.SetAndBoundsCheckDistanceValues();
	}

	GetModuleName(): string {
		return "OrbitalCamera";
	}

	SetInitialOrientation(humanoid: Humanoid): void {
		if (!humanoid || !humanoid.RootPart) {
			warn("OrbitalCamera could not set initial orientation due to missing humanoid");
			return;
		}
		const newDesiredLook = humanoid.RootPart.CFrame.LookVector.sub(new Vector3(0, 0.23, 0)).Unit;
		let horizontalShift = Util.GetAngleBetweenXZVectors(newDesiredLook, this.GetCameraLookVector());
		let vertShift = math.asin(this.GetCameraLookVector().Y) - math.asin(newDesiredLook.Y);
		if (!Util.IsFinite(horizontalShift)) {
			horizontalShift = 0;
		}
		if (!Util.IsFinite(vertShift)) {
			vertShift = 0;
		}
	}

	//[[ Functions of BaseCamera that are overridden by OrbitalCamera ]]--
	GetCameraToSubjectDistance(): number {
		return this.curDistance;
	}

	SetCameraToSubjectDistance(desiredSubjectDistance: number): number {
		const player = PlayersService.LocalPlayer;
		if (player) {
			this.currentSubjectDistance = math.clamp(desiredSubjectDistance, this.minDistance, this.maxDistance);

			// OrbitalCamera is not allowed to go into the first-person range
			this.currentSubjectDistance = math.max(this.currentSubjectDistance, this.FIRST_PERSON_DISTANCE_THRESHOLD);
		}
		this.inFirstPerson = false;
		this.UpdateMouseBehavior();
		return this.currentSubjectDistance;
	}

	CalculateNewLookVector(suppliedLookVector: Vector3 | undefined, xyRotateVector: Vector2): Vector3 {
		const currLookVector: Vector3 = suppliedLookVector ?? this.GetCameraLookVector();
		const currPitchAngle: number = math.asin(currLookVector.Y);
		const yTheta: number = math.clamp(
			xyRotateVector.Y,
			currPitchAngle - math.rad(MAX_ALLOWED_ELEVATION_DEG),
			currPitchAngle - math.rad(MIN_ALLOWED_ELEVATION_DEG),
		);
		const constrainedRotateInput: Vector2 = new Vector2(xyRotateVector.X, yTheta);
		const startCFrame: CFrame = new CFrame(ZERO_VECTOR3, currLookVector);
		const newLookVector: Vector3 = CFrame.Angles(0, -constrainedRotateInput.X, 0)
			.mul(startCFrame)
			.mul(CFrame.Angles(-constrainedRotateInput.Y, 0, 0)).LookVector;
		return newLookVector;
	}

	//[[ Update ]]--
	Update(dt: number): LuaTuple<[CFrame, CFrame]> {
		const now = tick();
		const timeDelta = now - (this.lastUpdate as number);
		const userPanningTheCamera = CameraInput.getRotation() !== new Vector2();
		const camera = game.Workspace.CurrentCamera as Camera;
		let newCameraCFrame = camera.CFrame;
		let newCameraFocus = camera.Focus;
		const player = PlayersService.LocalPlayer;
		const cameraSubject = camera && camera.CameraSubject;
		const isInVehicle = cameraSubject !== undefined && cameraSubject.IsA("VehicleSeat");
		const isOnASkateboard = cameraSubject !== undefined && cameraSubject.IsA("SkateboardPlatform");

		if (this.lastUpdate === undefined || timeDelta > 1) {
			this.lastCameraTransform = undefined;
		}

		// Reset tween speed if user is panning
		if (userPanningTheCamera) {
			this.lastUserPanCamera = tick();
		}

		const subjectPosition = this.GetSubjectPosition();

		if (subjectPosition !== undefined && player && camera) {
			// Process any dollying being done by gamepad
			// TODO: Move this
			if (this.gamepadDollySpeedMultiplier !== 1) {
				this.SetCameraToSubjectDistance(this.currentSubjectDistance * this.gamepadDollySpeedMultiplier);
			}

			const VREnabled = VRService.VREnabled;
			newCameraFocus = VREnabled ? this.GetVRFocus(subjectPosition, timeDelta) : new CFrame(subjectPosition);

			const flaggedRotateInput = CameraInput.getRotation();

			const cameraFocusP = newCameraFocus.Position;
			if (VREnabled && !this.IsInFirstPerson()) {
				const cameraHeight = this.GetCameraHeight();
				let vecToSubject: Vector3 = subjectPosition.sub(camera.CFrame.Position);
				const distToSubject: number = vecToSubject.Magnitude;

				// Only move the camera if it exceeded a maximum distance to the subject in VR
				if (distToSubject > this.currentSubjectDistance || flaggedRotateInput.X !== 0) {
					const desiredDist = math.min(distToSubject, this.currentSubjectDistance);

					// Note that CalculateNewLookVector is overridden from BaseCamera
					vecToSubject = this.CalculateNewLookVector(vecToSubject.Unit.mul(X1_Y0_Z1), new Vector2(flaggedRotateInput.X, 0)).mul(
						desiredDist,
					);

					const newPos = cameraFocusP.sub(vecToSubject);
					let desiredLookDir = camera.CFrame.LookVector;
					if (flaggedRotateInput.X !== 0) {
						desiredLookDir = vecToSubject;
					}
					const lookAt = new Vector3(newPos.X + desiredLookDir.X, newPos.Y, newPos.Z + desiredLookDir.Z);
					newCameraCFrame = new CFrame(newPos, lookAt).add(new Vector3(0, cameraHeight, 0));
				}
			} else {
				// rotateInput is a Vector2 of mouse movement deltas since last update
				this.curAzimuthRad = this.curAzimuthRad - flaggedRotateInput.X;

				if (this.useAzimuthLimits) {
					this.curAzimuthRad = math.clamp(this.curAzimuthRad, this.minAzimuthAbsoluteRad, this.maxAzimuthAbsoluteRad);
				} else {
					this.curAzimuthRad =
						this.curAzimuthRad !== 0
							? math.sign(this.curAzimuthRad) * (math.abs(this.curAzimuthRad) % TAU)
							: 0;
				}

				this.curElevationRad = math.clamp(
					this.curElevationRad + flaggedRotateInput.Y,
					this.minElevationRad,
					this.maxElevationRad,
				);

				const cameraPosVector = CFrame.fromEulerAnglesYXZ(-this.curElevationRad, this.curAzimuthRad, 0)
					.mul(UNIT_Z)
					.mul(this.currentSubjectDistance);
				const camPos = subjectPosition.add(cameraPosVector);

				newCameraCFrame = new CFrame(camPos, subjectPosition);
			}

			this.lastCameraTransform = newCameraCFrame;
			this.lastCameraFocus = newCameraFocus;
			if ((isInVehicle || isOnASkateboard) && cameraSubject!.IsA("BasePart")) {
				this.lastSubjectCFrame = (cameraSubject as BasePart).CFrame;
			} else {
				this.lastSubjectCFrame = undefined;
			}
		}

		this.lastUpdate = now;
		return $tuple(newCameraCFrame, newCameraFocus);
	}
}

export = OrbitalCamera;
