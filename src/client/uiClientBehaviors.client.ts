// Recreates the behaviour of the 27 LocalScripts that lived INSIDE the original
// StarterGui tree (they ran once per clone of their ScreenGui). The UI is now
// server-rendered React (see src/server/ui) and scripts can't be embedded in
// it, so this client script watches PlayerGui and re-attaches the behaviours to
// every fresh mount — the exact per-clone execution the embedded scripts had.
//
// Original scripts reproduced here (paths relative to their ScreenGui):
//  A) EnableWithConsole (icon + parent transparency) ×6 — Game/Controls/*/ImageLabel/consoleIcon
//  B) EnableWithConsole (icon only) ×11 — Spectate Respawn + Garage buttons
//  C) coinFrame scroll animation ×8 — Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel
//  E) hover click sound ×1 — Garage/hover (Sound)
//
// Like the originals, connections are not explicitly disconnected when a gui is
// replaced — they end up referencing destroyed instances, which is harmless and
// matches the original lifetime behaviour.

const UserInputService = game.GetService("UserInputService");
const RunService = game.GetService("RunService");
const TweenService = game.GetService("TweenService");
const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;

// ---- path helpers ------------------------------------------------------

/** WaitForChild along a path (first match per segment), like the original
 * scripts' implicit position inside the tree. */
function waitForPath(root: Instance, path: string): Instance {
	let current = root;
	for (const [part] of string.gmatch(path, "[^/]+")) {
		current = current.WaitForChild(part as string);
	}
	return current;
}

/** All children with the given name (some behaviours applied to several
 * identically-named siblings, e.g. the 8 coinFrames and 2 Buttons consoleIcons). */
function childrenNamed(parent: Instance, name: string): Instance[] {
	const out: Instance[] = [];
	for (const child of parent.GetChildren()) {
		if (child.Name === name) {
			out.push(child);
		}
	}
	return out;
}

// ---- Variant A: EnableWithConsole with parent ImageTransparency ----------
// Original: StarterGui/Game/Controls/<btn>/ImageLabel/consoleIcon/EnableWithConsole
function enableWithConsoleTransparency(consoleIcon: GuiObject) {
	const parentImage = consoleIcon.Parent as ImageLabel;
	if (UserInputService.GamepadEnabled) {
		consoleIcon.Visible = true;
		parentImage.ImageTransparency = 1;
	}
	UserInputService.GamepadConnected.Connect((gamepad) => {
		consoleIcon.Visible = true;
		parentImage.ImageTransparency = 1;
	});

	UserInputService.GamepadDisconnected.Connect((gamepad) => {
		consoleIcon.Visible = false;
		parentImage.ImageTransparency = 0;
	});
}

// ---- Variant B: EnableWithConsole visibility only ------------------------
function enableWithConsoleVisible(consoleIcon: GuiObject) {
	if (UserInputService.GamepadEnabled) {
		consoleIcon.Visible = true;
	}
	UserInputService.GamepadConnected.Connect((gamepad) => {
		consoleIcon.Visible = true;
	});

	UserInputService.GamepadDisconnected.Connect((gamepad) => {
		consoleIcon.Visible = false;
	});
}

// ---- Variant C: coinFrame scroll animation -------------------------------
// Original: StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript
function coinFrameAnimation(imageLabel: ImageLabel) {
	RunService.RenderStepped.Connect((step) => {
		imageLabel.Position = imageLabel.Position.add(new UDim2(0, 0, 0.0025, 0));

		if (imageLabel.Position.Y.Scale >= 1) {
			imageLabel.Position = new UDim2(0, 0, -3, 0);
		}
	});
}

// ---- Variant E: hover click sound ----------------------------------------
// Original: StarterGui/Garage/hover/LocalScript (script.Parent = the hover Sound,
// script.Parent.Parent = the Garage ScreenGui)
function hoverSound(sound: Sound) {
	const garage = sound.Parent!;
	for (const dec of garage.GetDescendants()) {
		if (dec.IsA("ImageButton") || dec.IsA("TextButton")) {
			dec.MouseButton1Click.Connect(() => {
				sound.Play();
			});
		}
	}
	garage.DescendantAdded.Connect((dec) => {
		if (dec.IsA("ImageButton") || dec.IsA("TextButton")) {
			dec.MouseButton1Click.Connect(() => {
				sound.Play();
			});
		}
	});
}

// Landing buttons widen locally on hover, giving immediate feedback without
// changing the vertical list's spacing or affecting any other menu page.
function attachLandingBehaviors(landingGui: Instance) {
	const buttons = waitForPath(landingGui, "Panel/Buttons");
	const sound = landingGui.WaitForChild("HoverSound") as Sound;
	const tweenInfo = new TweenInfo(0.12, Enum.EasingStyle.Quad, Enum.EasingDirection.Out);

	for (const child of buttons.GetChildren()) {
		if (!child.IsA("TextButton")) continue;

		child.MouseEnter.Connect(() => {
			TweenService.Create(child, tweenInfo, { Size: new UDim2(1.045, 0, 0.27, 0) }).Play();
			sound.TimePosition = 0;
			sound.Play();
		});
		child.MouseLeave.Connect(() => {
			TweenService.Create(child, tweenInfo, { Size: new UDim2(1, 0, 0.27, 0) }).Play();
		});
	}
}

// ---- attachment ----------------------------------------------------------

const GAME_CONTROL_BUTTONS = ["Boost", "Drift", "Horn", "Jump", "RollLeft", "RollRight"];

const GARAGE_CONSOLE_ICON_PATHS = [
	"Inventory/SpawnButton/Button/consoleIcon",
	"Inventory/BuyButton/Button/consoleIcon",
	"Inventory/ShopButton/consoleIcon",
	"Shop/InventoryButton/consoleIcon",
	"cashPurchace/closeButton/consoleIcon",
	"CrateMenu/BackButton/consoleIcon",
	"CrateMenu/OpenButton/consoleIcon",
	"Money/Currency/Add/consoleIcon",
];

function attachGameBehaviors(gameGui: Instance) {
	// Spectate respawn console icon (variant B)
	task.spawn(() => {
		enableWithConsoleVisible(waitForPath(gameGui, "Spectate/Information/Respawn/consoleIcon") as GuiObject);
	});
	// Controls buttons (variant A)
	for (const buttonName of GAME_CONTROL_BUTTONS) {
		task.spawn(() => {
			enableWithConsoleTransparency(
				waitForPath(gameGui, "Controls/" + buttonName + "/ImageLabel/consoleIcon") as GuiObject,
			);
		});
	}
}

function attachGarageBehaviors(garageGui: Instance) {
	for (const path of GARAGE_CONSOLE_ICON_PATHS) {
		task.spawn(() => {
			enableWithConsoleVisible(waitForPath(garageGui, path) as GuiObject);
		});
	}

	// The two identically-named consoleIcons under Inventory/Buttons/Buttons (variant B)
	task.spawn(() => {
		const buttonsBar = waitForPath(garageGui, "Inventory/Buttons/Buttons");
		for (const consoleIcon of childrenNamed(buttonsBar, "consoleIcon")) {
			enableWithConsoleVisible(consoleIcon as GuiObject);
		}
	});

	// The 8 coinFrame scroll animations (variant C)
	task.spawn(() => {
		const buyOptions = waitForPath(garageGui, "cashPurchace/cash/buyOptions");
		for (const coinFrame of childrenNamed(buyOptions, "coinFrame")) {
			task.spawn(() => {
				coinFrameAnimation(coinFrame.WaitForChild("ImageLabel") as ImageLabel);
			});
		}
	});

	// Hover click sound (variant E)
	task.spawn(() => {
		hoverSound(garageGui.WaitForChild("hover") as Sound);
	});
}

function onGuiAdded(child: Instance) {
	if (child.Name === "Game") {
		attachGameBehaviors(child);
	} else if (child.Name === "Garage") {
		attachGarageBehaviors(child);
	} else if (child.Name === "Landing") {
		attachLandingBehaviors(child);
	}
}

const playerGui = LocalPlayer.WaitForChild("PlayerGui");
for (const child of playerGui.GetChildren()) {
	task.spawn(() => onGuiAdded(child));
}
playerGui.ChildAdded.Connect(onGuiAdded);
