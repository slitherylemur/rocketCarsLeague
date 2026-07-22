// Client-owned money-gained popups (client-side UI migration, Phase 3).
//
// Replaces the old SERVER-side implementation in VehicleClass.ts
// (showMoneyGainedOnAttackersScreen + CreateMoneyUiAnimation), which cloned
// TextLabels into PlayerMoneyGainedPopups server-side, ran server-side tweens,
// parented Sounds into PlayerGui, and blocked on a per-hit
// GetPlayerPointToScreenSpace.InvokeClient for screen coordinates.
//
// The server now only computes the amounts and fires Ui_MoneyGained at the
// attacker with (amount: number, kind: "damage" | "kill", worldPoint: Vector3).
// This script reproduces the original presentation byte-for-byte:
//   * screen anchor: camera.WorldToScreenPoint(worldPoint) — the same
//     projection the old GetPlayerPointToScreenSpace client handler used,
//     captured ONCE on receipt (the original captured it before its delays).
//   * "damage": +0.1s → cashSmall sound + ReplicatedStorage.Ui.DamageMoney
//     clone ("+N$") animated in. (The original also cloned cashBig for
//     amounts >= 10 but never parented or played it — quirk preserved by
//     simply not playing it.)
//   * "kill": killCoins1 + killCoins2 sounds immediately, then +0.4s →
//     ReplicatedStorage.Ui.KillMoney clone ("+N$") animated in.
//   * animation (CreateMoneyUiAnimation): start at the screen point, 1s
//     Elastic/Out tween to a ±0.2-scale random offset, hold 0.6s, then 1s
//     Quad/Out slide down to Y-scale 1.5 (off screen).
// Unlike the original (which leaked labels until the server's PlayerGui
// sweep), every label and sound cleans itself up via Debris.
//
// Sound templates are place-file assets from ServerStorage.Sounds, replicated
// at startup into ReplicatedStorage.UiIntents.UiSounds by UiIntents.server.ts.

import { getUiIntentEvent, getUiSoundsFolder, UiSoundName } from "shared/UiIntents";

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const SoundService = game.GetService("SoundService");
const TweenService = game.GetService("TweenService");
const Debris = game.GetService("Debris");

const LocalPlayer = Players.LocalPlayer;
const playerGui = LocalPlayer.WaitForChild("PlayerGui") as Instance;

function popupsGui(): ScreenGui | undefined {
	const gui = playerGui.FindFirstChild("PlayerMoneyGainedPopups");
	return gui && gui.IsA("ScreenGui") ? gui : undefined;
}

function playUiSound(name: UiSoundName) {
	const template = getUiSoundsFolder().FindFirstChild(name);
	if (!template || !template.IsA("Sound")) {
		return; // UiIntents.server.ts already warned about the missing asset
	}
	const sound = template.Clone();
	sound.Parent = SoundService;
	sound.Play();
	Debris.AddItem(sound, 10);
}

function labelTemplate(name: "DamageMoney" | "KillMoney"): TextLabel | undefined {
	const uiFolder = ReplicatedStorage.FindFirstChild("Ui");
	const template = uiFolder ? uiFolder.FindFirstChild(name) : undefined;
	return template && template.IsA("TextLabel") ? template : undefined;
}

// Verbatim port of the server's CreateMoneyUiAnimation (VehicleClass.ts):
// same tween infos, same random start offset, same hold — plus self-cleanup.
function createMoneyUiAnimation(moneyUi: TextLabel, screenPosition: Vector3) {
	moneyUi.Position = new UDim2(0, screenPosition.X, 0, screenPosition.Y);

	const startPos = new UDim2(
		(math.random(1, 20) - 10) / 50,
		screenPosition.X,
		(math.random(1, 20) - 10) / 50,
		screenPosition.Y,
	);

	const tweenIn = TweenService.Create(
		moneyUi,
		new TweenInfo(1, Enum.EasingStyle.Elastic, Enum.EasingDirection.Out),
		{ Position: startPos },
	);
	tweenIn.Play();
	tweenIn.Completed.Wait();

	const tweenInfo = new TweenInfo(1, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);
	task.wait(0.6);

	const tweenOut = TweenService.Create(moneyUi, tweenInfo, {
		Position: new UDim2(startPos.X.Scale, startPos.X.Offset, 1.5, startPos.Y.Offset),
	});
	tweenOut.Play();
	// The original never destroyed the label (the server's destroy-all PlayerGui
	// sweep collected them eventually) — client popups must self-clean.
	Debris.AddItem(moneyUi, 1.5);
}

function showPopup(templateName: "DamageMoney" | "KillMoney", amount: number, screenPosition: Vector3) {
	const gui = popupsGui();
	const template = labelTemplate(templateName);
	if (!gui || !template) {
		return;
	}
	const label = template.Clone();
	label.Text = "+" + amount + "$";
	label.Parent = gui;
	createMoneyUiAnimation(label, screenPosition);
}

getUiIntentEvent("Ui_MoneyGained").OnClientEvent.Connect((amount, kind, worldPoint) => {
	if (!typeIs(amount, "number") || !typeIs(kind, "string") || !typeIs(worldPoint, "Vector3")) {
		return;
	}
	const camera = game.Workspace.CurrentCamera;
	if (!camera) {
		return;
	}
	// Same projection as the retired GetPlayerPointToScreenSpace handler.
	const [screenPosition] = camera.WorldToScreenPoint(worldPoint);

	if (kind === "damage") {
		// The original's server-side 0.1s delay covered both the sound and the
		// label — the popup and cashSmall land together.
		task.delay(0.1, () => {
			playUiSound("cashSmall");
			showPopup("DamageMoney", amount, screenPosition);
		});
	} else if (kind === "kill") {
		// Coin sounds fire immediately; the kill label follows 0.4s later so it
		// lands after the damage popup of the same hit — exactly like before.
		playUiSound("killCoins1");
		playUiSound("killCoins2");
		task.delay(0.4, () => {
			showPopup("KillMoney", amount, screenPosition);
		});
	}
});
