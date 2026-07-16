// Original: ReplicatedStorage/EffectComposerPro/RuntimeEngine (ModuleScript)
//!strict (original directive)

import requireModule from "shared/requireModule";

const RunService = game.GetService("RunService");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const Workspace = game.GetService("Workspace");
const MIN_DURATION = 0.05;

interface ChannelPoint {
	time: number;
	value: number;
}

interface Channel {
	id: string;
	visible?: boolean;
	minValue: number;
	maxValue: number;
	points?: ChannelPoint[];
}

interface ElementProperty {
	propertyKey: string;
	channels: Channel[];
}

interface EffectElement {
	id: string;
	name: string;
	enabled?: boolean;
	sourceElementId?: string;
	clipStart?: number;
	clipDuration?: number;
	properties: ElementProperty[];
}

interface EffectData {
	name: string;
	duration: number;
	origin: Vector3;
	elements: EffectElement[];
}

interface VisibilityEntry {
	instance: Instance;
	property: string;
	activeValue: unknown;
	inactiveValue: unknown;
}

interface TransformState {
	root: BasePart | undefined;
	modelToRoot: CFrame | undefined;
}

interface EffectHandle {
	stop: () => void;
}

function lerp(a: number, b: number, alpha: number): number {
	return a + (b - a) * alpha;
}

function evaluatePoints(points: ChannelPoint[], normalizedTime: number): number {
	if (points.size() === 0) {
		return 0;
	}
	if (normalizedTime <= points[0].time) {
		return points[0].value;
	}
	if (normalizedTime >= points[points.size() - 1].time) {
		return points[points.size() - 1].value;
	}
	for (let i = 1; i <= points.size() - 1; i++) {
		const left = points[i - 1];
		const right = points[i];
		if (normalizedTime >= left.time && normalizedTime <= right.time) {
			const span = math.max(1e-5, right.time - left.time);
			return lerp(left.value, right.value, (normalizedTime - left.time) / span);
		}
	}
	return points[points.size() - 1].value;
}

function evaluateChannel(channel: Channel, normalizedTime: number): number {
	const normalizedValue = evaluatePoints(channel.points ?? [], normalizedTime);
	return channel.minValue + normalizedValue * (channel.maxValue - channel.minValue);
}

function forEachRelevantInstance(instance: Instance, callback: (target: Instance) => void) {
	callback(instance);
	for (const descendant of instance.GetDescendants()) {
		callback(descendant);
	}
}

function buildVisibilityState(instance: Instance): VisibilityEntry[] {
	const entries: VisibilityEntry[] = [];
	forEachRelevantInstance(instance, (target) => {
		if (target.IsA("BasePart")) {
			entries.push({ instance: target, property: "Transparency", activeValue: target.Transparency, inactiveValue: 1 });
		} else if (target.IsA("ParticleEmitter") || target.IsA("Beam") || target.IsA("Trail")) {
			entries.push({ instance: target, property: "Enabled", activeValue: target.Enabled, inactiveValue: false });
		} else if (target.IsA("Light") || target.IsA("BillboardGui") || target.IsA("SurfaceGui")) {
			entries.push({ instance: target, property: "Enabled", activeValue: target.Enabled, inactiveValue: false });
		} else if (target.IsA("GuiObject")) {
			entries.push({ instance: target, property: "Visible", activeValue: target.Visible, inactiveValue: false });
		}
	});
	return entries;
}

function setInstanceActive(entries: VisibilityEntry[], active: boolean) {
	for (const entry of entries) {
		const target = entry.instance;
		if (target.Parent !== undefined) {
			(target as unknown as Record<string, unknown>)[entry.property] = active
				? entry.activeValue
				: entry.inactiveValue;
		}
	}
}

function findRootPart(instance: Instance): BasePart | undefined {
	if (instance.IsA("BasePart")) {
		return instance;
	}
	if (instance.IsA("Model")) {
		if (instance.PrimaryPart) {
			return instance.PrimaryPart;
		}
	}
	for (const child of (instance as Instance).GetDescendants()) {
		if (child.IsA("BasePart")) {
			return child;
		}
	}
	return undefined;
}

function getComponent(instance: Instance, className: keyof Instances): Instance | undefined {
	if (instance.IsA(className)) {
		return instance;
	}
	for (const child of (instance as Instance).GetDescendants()) {
		if (child.IsA(className)) {
			return child;
		}
	}
	return undefined;
}

function getPackageChild(effectPackage: Instance, childName: string, className: keyof Instances): Instance {
	const child = effectPackage.FindFirstChild(childName);
	if (!child || !child.IsA(className)) {
		error(string.format("Invalid effect package '%s': missing %s %s", effectPackage.Name, className, childName));
	}
	return child;
}

function captureTransformState(instance: Instance): TransformState {
	const root = findRootPart(instance);
	if (!root) {
		return { root: undefined, modelToRoot: undefined };
	}
	if (instance.IsA("Model")) {
		return { root: root, modelToRoot: instance.GetPivot().ToObjectSpace(root.CFrame) };
	}
	return { root: root, modelToRoot: undefined };
}

function applyRootTransform(instance: Instance, state: TransformState, rootCFrame: CFrame) {
	if (!state.root) {
		return;
	}
	if (instance.IsA("Model") && state.modelToRoot) {
		instance.PivotTo(rootCFrame.mul(state.modelToRoot.Inverse()));
		return;
	}
	state.root.CFrame = rootCFrame;
}

function buildRootCFrame(targetCFrame: CFrame, channelValuesByProperty: Record<string, Record<string, number>>): CFrame {
	const positionValues = channelValuesByProperty.ROOT_POSITION ?? {};
	const orientationValues = channelValuesByProperty.ROOT_ORIENTATION ?? {};
	return targetCFrame
		.mul(new CFrame(positionValues.X ?? 0, positionValues.Y ?? 0, positionValues.Z ?? 0))
		.mul(
			CFrame.fromOrientation(
				math.rad(orientationValues.X ?? 0),
				math.rad(orientationValues.Y ?? 0),
				math.rad(orientationValues.Z ?? 0),
			),
		);
}

function resolveSizeChannel(channelValues: Record<string, number>, axisId: string, fallback: number): number {
	const master = channelValues.Master;
	const axis = channelValues[axisId];
	if (master !== undefined) {
		return math.max(0.01, master + (axis ?? 0));
	}
	return math.max(0.01, axis ?? fallback);
}

function makeSafeNumberRange(minValue: number, maxValue: number): NumberRange {
	let safeMin = math.max(0, minValue);
	const safeMax = math.max(0, maxValue);
	if (safeMin > safeMax) {
		safeMin = safeMax;
	}
	return new NumberRange(safeMin, safeMax);
}

function updateBillboardSize(root: BasePart | undefined, gui: Instance | undefined) {
	if (!root || !gui) {
		return;
	}
	(gui as BillboardGui).Size = UDim2.fromOffset(
		math.max(1, math.floor(root.Size.X * 100)),
		math.max(1, math.floor(root.Size.Y * 100)),
	);
}

function applyBillboardImageColor(image: ImageLabel) {
	const baseColor = image.GetAttribute("EffectComposerProBillboardColor");
	const brightness = image.GetAttribute("EffectComposerProBillboardBrightness");
	const resolvedColor = typeOf(baseColor) === "Color3" ? (baseColor as Color3) : new Color3(1, 1, 1);
	const resolvedBrightness = typeOf(brightness) === "number" ? (brightness as number) : 1;
	image.ImageColor3 = new Color3(
		math.clamp(resolvedColor.R * resolvedBrightness, 0, 1),
		math.clamp(resolvedColor.G * resolvedBrightness, 0, 1),
		math.clamp(resolvedColor.B * resolvedBrightness, 0, 1),
	);
}

function applyProperty(instance: Instance, propertyKey: string, channelValues: Record<string, number>) {
	const root = findRootPart(instance);
	if (propertyKey === "ROOT_POSITION" || propertyKey === "ROOT_ORIENTATION") {
		return;
	}
	if (propertyKey === "ROOT_SIZE" && root) {
		root.Size = new Vector3(
			resolveSizeChannel(channelValues, "X", root.Size.X),
			resolveSizeChannel(channelValues, "Y", root.Size.Y),
			resolveSizeChannel(channelValues, "Z", root.Size.Z),
		);
		updateBillboardSize(root, getComponent(instance, "BillboardGui"));
		return;
	}
	if (propertyKey === "ROOT_TRANSPARENCY" && root) {
		root.Transparency = math.clamp(channelValues.Value ?? root.Transparency, 0, 1);
		return;
	}
	if (propertyKey === "ROOT_COLOR" && root) {
		root.Color = Color3.fromRGB(
			math.clamp(channelValues.R ?? 255, 0, 255),
			math.clamp(channelValues.G ?? 255, 0, 255),
			math.clamp(channelValues.B ?? 255, 0, 255),
		);
		return;
	}
	if (string.find(propertyKey, "LIGHT_")[0] !== undefined) {
		const light = (getComponent(instance, "PointLight") ??
			getComponent(instance, "SpotLight") ??
			getComponent(instance, "SurfaceLight")) as PointLight | SpotLight | SurfaceLight | undefined;
		if (!light) {
			return;
		}
		if (propertyKey === "LIGHT_BRIGHTNESS") {
			light.Brightness = channelValues.Value ?? light.Brightness;
		} else if (propertyKey === "LIGHT_RANGE") {
			light.Range = channelValues.Value ?? light.Range;
		} else if (propertyKey === "LIGHT_COLOR") {
			light.Color = Color3.fromRGB(
				math.clamp(channelValues.R ?? 255, 0, 255),
				math.clamp(channelValues.G ?? 255, 0, 255),
				math.clamp(channelValues.B ?? 255, 0, 255),
			);
		}
		return;
	}
	if (propertyKey === "PARTICLE_RATE") {
		const emitter = getComponent(instance, "ParticleEmitter") as ParticleEmitter | undefined;
		if (emitter) {
			emitter.Rate = math.max(0, channelValues.Value ?? emitter.Rate);
		}
		return;
	}
	if (propertyKey === "PARTICLE_BRIGHTNESS") {
		const emitter = getComponent(instance, "ParticleEmitter") as ParticleEmitter | undefined;
		if (emitter) {
			emitter.Brightness = math.max(0, channelValues.Value ?? emitter.Brightness);
		}
		return;
	}
	if (propertyKey === "PARTICLE_SPREAD_ANGLE") {
		const emitter = getComponent(instance, "ParticleEmitter") as ParticleEmitter | undefined;
		if (emitter) {
			emitter.SpreadAngle = new Vector2(
				math.max(0, channelValues.X ?? emitter.SpreadAngle.X),
				math.max(0, channelValues.Y ?? emitter.SpreadAngle.Y),
			);
		}
		return;
	}
	if (propertyKey === "PARTICLE_SPEED") {
		const emitter = getComponent(instance, "ParticleEmitter") as ParticleEmitter | undefined;
		if (emitter) {
			emitter.Speed = makeSafeNumberRange(
				math.max(0, channelValues.Min ?? emitter.Speed.Min),
				math.max(0, channelValues.Max ?? emitter.Speed.Max),
			);
		}
		return;
	}
	if (propertyKey === "PARTICLE_ACCELERATION") {
		const emitter = getComponent(instance, "ParticleEmitter") as ParticleEmitter | undefined;
		if (emitter) {
			emitter.Acceleration = new Vector3(
				channelValues.X ?? emitter.Acceleration.X,
				channelValues.Y ?? emitter.Acceleration.Y,
				channelValues.Z ?? emitter.Acceleration.Z,
			);
		}
		return;
	}
	if (propertyKey === "PARTICLE_LIFETIME") {
		const emitter = getComponent(instance, "ParticleEmitter") as ParticleEmitter | undefined;
		if (emitter) {
			emitter.Lifetime = makeSafeNumberRange(
				math.max(0, channelValues.Min ?? emitter.Lifetime.Min),
				math.max(0, channelValues.Max ?? emitter.Lifetime.Max),
			);
		}
		return;
	}
	if (propertyKey === "BILLBOARD_IMAGE_TRANSPARENCY") {
		const image = getComponent(instance, "ImageLabel") as ImageLabel | undefined;
		if (image) {
			image.ImageTransparency = math.clamp(channelValues.Value ?? image.ImageTransparency, 0, 1);
		}
		return;
	}
	if (propertyKey === "BILLBOARD_IMAGE_BRIGHTNESS") {
		const image = getComponent(instance, "ImageLabel") as ImageLabel | undefined;
		if (image) {
			image.SetAttribute("EffectComposerProBillboardBrightness", math.max(0, channelValues.Value ?? 1));
			applyBillboardImageColor(image);
		}
		return;
	}
	if (propertyKey === "BILLBOARD_IMAGE_ROTATION") {
		const image = getComponent(instance, "ImageLabel") as ImageLabel | undefined;
		if (image) {
			image.Rotation = channelValues.Value ?? image.Rotation;
		}
		return;
	}
	if (propertyKey === "BILLBOARD_IMAGE_COLOR") {
		const image = getComponent(instance, "ImageLabel") as ImageLabel | undefined;
		if (image) {
			image.SetAttribute(
				"EffectComposerProBillboardColor",
				Color3.fromRGB(
					math.clamp(channelValues.R ?? 255, 0, 255),
					math.clamp(channelValues.G ?? 255, 0, 255),
					math.clamp(channelValues.B ?? 255, 0, 255),
				),
			);
			applyBillboardImageColor(image);
		}
		return;
	}
	if (propertyKey === "BEAM_WIDTH0" || propertyKey === "BEAM_WIDTH1") {
		const beam = getComponent(instance, "Beam") as Beam | undefined;
		if (beam) {
			if (propertyKey === "BEAM_WIDTH0") {
				beam.Width0 = math.max(0, channelValues.Value ?? beam.Width0);
			} else {
				beam.Width1 = math.max(0, channelValues.Value ?? beam.Width1);
			}
		}
	}
}

function loadEffectData(effectPackage: Instance): EffectData {
	const dataModule = getPackageChild(effectPackage, "EffectData", "ModuleScript") as ModuleScript;
	const readClone = dataModule.Clone();
	readClone.Name = dataModule.Name + "_Read";
	readClone.Parent = effectPackage;
	// Original: require(readClone) — a dynamic instance require.
	const effect = requireModule(readClone) as EffectData;
	readClone.Destroy();
	effect.name = effectPackage.Name;
	return effect;
}

function resolveEffectPackage(effectName: string): Instance {
	const systemRoot = ReplicatedStorage.FindFirstChild("EffectComposerPro");
	if (!systemRoot) {
		error("EffectComposerPro root folder is missing");
	}
	const effectsFolder = systemRoot.FindFirstChild("Effects");
	if (!effectsFolder || !effectsFolder.IsA("Folder")) {
		error("EffectComposerPro/Effects folder is missing");
	}
	const effectPackage = effectsFolder.FindFirstChild(effectName);
	if (!effectPackage || !effectPackage.IsA("Model")) {
		error(string.format("Effect package '%s' was not found", effectName));
	}
	return effectPackage;
}

function playLoadedEffect(
	effectPackage: Instance,
	effect: EffectData,
	parent: Instance,
	targetCFrame: CFrame | undefined,
	startNormalized: number | undefined,
	looped: boolean,
	onStopped?: () => void,
): EffectHandle {
	const elementsFolder = getPackageChild(effectPackage, "Elements", "Folder");
	const container = new Instance("Folder");
	container.Name = effect.name + "_Runtime";
	container.Parent = parent;

	const baseCFrame = targetCFrame ?? new CFrame(effect.origin);
	const map = new Map<string, Instance>();
	const visibilityMap = new Map<string, VisibilityEntry[]>();
	const transformStateMap = new Map<string, TransformState>();

	for (const element of effect.elements) {
		if (element.enabled === false) {
			continue;
		}
		let source: Instance | undefined = undefined;
		if (element.sourceElementId !== undefined) {
			source = elementsFolder.FindFirstChild(element.sourceElementId);
		}
		if (!source) {
			const placeholder = new Instance("Part");
			placeholder.Anchored = true;
			placeholder.CanCollide = false;
			placeholder.CanTouch = false;
			placeholder.CanQuery = false;
			placeholder.Transparency = 1;
			placeholder.Name = element.name;
			source = placeholder;
		}
		const clone = source.Clone();
		clone.Name = element.name;
		clone.Parent = container;
		transformStateMap.set(element.id, captureTransformState(clone));
		applyRootTransform(clone, transformStateMap.get(element.id)!, baseCFrame);
		map.set(element.id, clone);
		visibilityMap.set(element.id, buildVisibilityState(clone));
	}

	const start = os.clock();
	let stopped = false;
	let conn: RBXScriptConnection | undefined;
	const startOffset = math.clamp(startNormalized ?? 0, 0, 1);
	const handle: EffectHandle = {
		stop: () => {
			if (stopped) {
				return;
			}
			stopped = true;
			if (conn) {
				conn.Disconnect();
			}
			container.Destroy();
			if (onStopped) {
				onStopped();
			}
		},
	};

	conn = RunService.Heartbeat.Connect(() => {
		if (stopped) {
			return;
		}
		const duration = math.max(MIN_DURATION, effect.duration);
		const totalElapsed = os.clock() - start + duration * startOffset;
		const effectTime = looped ? totalElapsed % duration : math.min(totalElapsed, duration);
		for (const element of effect.elements) {
			const instance = map.get(element.id);
			if (instance !== undefined && element.enabled !== false) {
				const clipStart = math.clamp(tonumber(element.clipStart) ?? 0, 0, duration);
				const clipDuration = math.max(MIN_DURATION, tonumber(element.clipDuration) ?? duration);
				const clipEnd = math.min(duration, clipStart + clipDuration);
				const active = effectTime >= clipStart && effectTime <= clipEnd;
				setInstanceActive(visibilityMap.get(element.id)!, active);
				if (!active) {
					continue;
				}
				const t = math.clamp((effectTime - clipStart) / math.max(MIN_DURATION, clipDuration), 0, 1);
				const channelValuesByProperty: Record<string, Record<string, number>> = {};
				for (const prop of element.properties) {
					const values: Record<string, number> = {};
					for (const channel of prop.channels) {
						if (channel.visible !== false) {
							values[channel.id] = evaluateChannel(channel, t);
						}
					}
					channelValuesByProperty[prop.propertyKey] = values;
				}
				applyRootTransform(
					instance,
					transformStateMap.get(element.id)!,
					buildRootCFrame(baseCFrame, channelValuesByProperty),
				);
				for (const prop of element.properties) {
					applyProperty(instance, prop.propertyKey, channelValuesByProperty[prop.propertyKey] ?? {});
				}
			}
		}
		if (!looped && totalElapsed >= duration) {
			handle.stop();
		}
	});

	return handle;
}

const RuntimeEngine = {
	Load: (effectName: string, parentOverride?: Instance, effectOverride?: EffectData) => {
		const effectPackage = resolveEffectPackage(effectName);
		const loadedEffect = {} as {
			play: (targetCFrame?: CFrame, startNormalized?: number) => EffectHandle;
			playLooped: (targetCFrame?: CFrame, startNormalized?: number) => EffectHandle;
			stop: () => void;
		};
		let activeHandle: EffectHandle | undefined = undefined;
		const loadedAsset = effectOverride ?? loadEffectData(effectPackage);
		const resolvedParent = parentOverride ?? Workspace;

		const beginPlayback = (
			targetCFrame: CFrame | undefined,
			startNormalized: number | undefined,
			looped: boolean,
		): EffectHandle => {
			if (activeHandle) {
				activeHandle.stop();
				activeHandle = undefined;
			}
			activeHandle = playLoadedEffect(
				effectPackage,
				loadedAsset,
				resolvedParent,
				targetCFrame,
				startNormalized,
				looped,
				() => {
					activeHandle = undefined;
				},
			);
			return activeHandle;
		};

		loadedEffect.play = (targetCFrame?: CFrame, startNormalized?: number) => {
			return beginPlayback(targetCFrame, startNormalized, false);
		};

		loadedEffect.playLooped = (targetCFrame?: CFrame, startNormalized?: number) => {
			return beginPlayback(targetCFrame, startNormalized, true);
		};

		loadedEffect.stop = () => {
			if (activeHandle) {
				activeHandle.stop();
				activeHandle = undefined;
			}
		};

		return loadedEffect;
	},

	Stop: (handle: EffectHandle | undefined) => {
		if (handle && handle.stop !== undefined) {
			handle.stop();
		}
	},
};

export = RuntimeEngine;
