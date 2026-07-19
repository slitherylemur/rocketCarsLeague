// Audio must not be started from BallSim's BindToSimulation callback. Observe
// its hit attributes here and defer playback onto the normal client scheduler.

import { BALL_NAME } from "shared/ballSim/BallConfig";
import { BallAttr } from "shared/ballSim/BallSim";

const Players = game.GetService("Players");
const Debris = game.GetService("Debris");
const ContentProvider = game.GetService("ContentProvider");
const LocalPlayer = Players.LocalPlayer;

const template = new Instance("Sound");
template.Name = "BallHitSound";
template.SoundId = "rbxassetid://4458219865";
template.Volume = 0.35;
template.RollOffMode = Enum.RollOffMode.InverseTapered;
template.RollOffMinDistance = 8;
template.RollOffMaxDistance = 140;

// Remove the first-impact asset fetch delay.
task.spawn(() => pcall(() => ContentProvider.PreloadAsync([template])));

const connections = new Map<BasePart, RBXScriptConnection>();
const lastPlayedSerial = new Map<BasePart, number>();

function localPlayerOwnsCar(carName: string): boolean {
	const vehicles = game.Workspace.FindFirstChild("Vehicles");
	const car = vehicles && vehicles.FindFirstChild(carName);
	return car !== undefined && car.IsA("Model") && car.GetAttribute("OwnerUserId") === LocalPlayer.UserId;
}

function handleHit(ball: BasePart) {
	const serial = ball.GetAttribute(BallAttr.ImpactSerial);
	const kind = ball.GetAttribute(BallAttr.ImpactKind);
	const carName = ball.GetAttribute(BallAttr.ImpactCar);
	if (!typeIs(serial, "number") || serial <= (lastPlayedSerial.get(ball) ?? -math.huge)) {
		return;
	}
	// Car hits remain private to their driver; arena/ground bounces are heard
	// spatially by every client within the Sound's rolloff range.
	if (kind === "Car" && (!typeIs(carName, "string") || !localPlayerOwnsCar(carName))) {
		return;
	}
	if (kind !== "Car" && kind !== "World") {
		return;
	}

	lastPlayedSerial.set(ball, serial);
	task.defer(() => {
		if (ball.Parent === undefined) {
			return;
		}
		const sound = template.Clone();
		sound.Parent = ball;
		sound.Play();
		Debris.AddItem(sound, 10);
	});
}

function adoptBall(instance: Instance) {
	if (instance.Name !== BALL_NAME || !instance.IsA("BasePart") || connections.has(instance)) {
		return;
	}
	connections.set(instance, instance.GetAttributeChangedSignal(BallAttr.ImpactSerial).Connect(() => handleHit(instance)));
	instance.Destroying.Connect(() => {
		connections.get(instance)?.Disconnect();
		connections.delete(instance);
		lastPlayedSerial.delete(instance);
	});
}

game.Workspace.ChildAdded.Connect(adoptBall);
for (const child of game.Workspace.GetChildren()) {
	adoptBall(child);
}
