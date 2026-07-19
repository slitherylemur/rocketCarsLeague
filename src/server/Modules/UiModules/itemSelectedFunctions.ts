// Original: ServerStorage/Modules/UiModules/itemSelectedFunctions (ModuleScript)

//variables
import spawnVehicle from "../spawnVehicle";
import DataUtilities from "../DataUtilities";
import GeneralUtils from "../../GeneralUtils";
import { getCarTrophyCost } from "../carTrophyCosts";
import { Globals } from "../../Globals";
import { CASH_PURCHACE_MENU_OPEN_SIZE } from "../../ui/uiConstants";
import type { VehicleModel } from "../../Classes/VehicleClass";

const ServerStorage = game.GetService("ServerStorage");

const selectedColor = Color3.fromRGB(173, 138, 0); //Change in itemPopulateSpecifics also
const unselectedColor = new Color3(0, 0, 0); //Change in itemPopulateSpecifics also

// ---- Instance shape types (per-player UI rendered into PlayerGui) ----

// "mainUI" in the callbacks — the Inventory frame (PlayerGui.Garage.Inventory);
// setTab passes it as scrollFrame.Parent.Parent.Parent.Parent.Parent.
interface MainUi extends Frame {
	BuyButton: Frame & {
		Button: TextButton & { Price: TextLabel; TextLabel: TextLabel };
		// BindableEvent child of the BuyButton frame (fired by the console
		// client behavior)
		BuyButtonConsole: BindableEvent;
	};
	SpawnButton: GuiObject;
}

function SetTeamNameStripVisible(mainUI: MainUi, visible: boolean) {
	const strip = mainUI.FindFirstChild("TeamNameStrip");
	if (strip?.IsA("GuiObject")) {
		strip.Visible = visible;
	}
}

interface CashPurchaceMenu extends Frame {
	cash: Frame;
}

interface CashPurchaceOption extends ImageLabel {
	buy: GuiButton;
	ID: NumberValue;
}

//Module functions
// (every function is dot-called in the original — and dispatched dynamically by
// tab name from setTab — so they are arrow properties: no implicit self)

const buyConnections = new Map<Player, RBXScriptConnection>();
const buyConnectionsConsole = new Map<Player, RBXScriptConnection>();

function EnableSpawnButton(mainUI: MainUi | undefined) {
	if (mainUI) {
		mainUI.BuyButton.Visible = false;
		mainUI.SpawnButton.Visible = true;
		SetTeamNameStripVisible(mainUI, true);
	}
}

function SelectUiFrame(uiFrame: GuiObject, parent: Instance) {
	for (const ui of parent.GetDescendants()) {
		let breakLoop = false;
		pcall(() => {
			// GuiBase descendants without BackgroundColor3 error here — the
			// pcall swallows that, exactly like the original.
			if (ui.IsA("GuiBase") && (ui as GuiObject).BackgroundColor3 === selectedColor) {
				(ui as GuiObject).BackgroundColor3 = unselectedColor;
				breakLoop = true;
			}
		});
		if (breakLoop) {
			break;
		}
	}
	uiFrame.BackgroundColor3 = selectedColor;
}

// Trophy unlock button (progression rework): cars are gated by LIFETIME
// trophy count — meeting the threshold unlocks the car for FREE (trophies are
// never spent). Green when unlockable, grey when the player is short; a short
// player's click does nothing (no cash-purchase fallback — cash can't buy cars).
const UNLOCK_AFFORDABLE_COLOR = Color3.fromRGB(60, 200, 90);
const UNLOCK_LOCKED_COLOR = Color3.fromRGB(110, 110, 110);

function UnlockButtonPressed(player: Player, cost: number, Item: string, mainUI: MainUi) {
	// Server-side re-check at click time — the threshold may have been met
	// since the button was drawn (or a stale green button clicked after data
	// changed elsewhere).
	if (DataUtilities.GetTrophies(player) >= cost) {
		DataUtilities.GivePlayerItem(player, "vehicles", Item);
		DataUtilities.EquipItemIfOwned(player, Item, "equippedVehicle", "vehicles");
		EnableSpawnButton(mainUI);
	}
}

function SetupUnlockButton(mainUI: MainUi, cost: number, player: Player, Item: string) {
	mainUI.BuyButton.Visible = true;
	mainUI.SpawnButton.Visible = false;
	SetTeamNameStripVisible(mainUI, false);

	if (buyConnections.get(player)) {
		buyConnections.get(player)!.Disconnect();
		buyConnections.delete(player);
	}
	const button = mainUI.BuyButton.Button;
	button.TextLabel.Text = "UNLOCK";
	button.Price.Text = `🏆 ${GeneralUtils.CommaNumber(cost)}`;
	button.BackgroundColor3 =
		DataUtilities.GetTrophies(player) >= cost ? UNLOCK_AFFORDABLE_COLOR : UNLOCK_LOCKED_COLOR;

	buyConnections.set(
		player,
		button.MouseButton1Click.Connect(() => {
			UnlockButtonPressed(player, cost, Item, mainUI);
		}),
	);

	if (buyConnectionsConsole.get(player)) {
		buyConnectionsConsole.get(player)!.Disconnect();
		buyConnectionsConsole.delete(player);
	}

	buyConnectionsConsole.set(
		player,
		mainUI.BuyButton.BuyButtonConsole.Event.Connect(() => {
			UnlockButtonPressed(player, cost, Item, mainUI);
		}),
	);
}

const selectedFunctions = {
	openCashPurchaceMenu: (player: Player) => {
		const TweenService = game.GetService("TweenService");
		// Original: game.StarterGui.Garage.cashPurchace.Size — the StarterGui
		// template is replaced by the server-rendered React UI, so the open size
		// is the extracted template constant (see src/server/ui/uiConstants.ts).
		const cashPurchaceMenuOpenSize = CASH_PURCHACE_MENU_OPEN_SIZE;
		const MarketplaceService = game.GetService("MarketplaceService");

		const closeCashPurchaceMenu = (player: Player) => {
			const cashPurchaceMenu = (
				player as unknown as { PlayerGui: { Garage: { cashPurchace: CashPurchaceMenu } } }
			).PlayerGui.Garage.cashPurchace;
			const cashPurchaceMenuClosedSize = new UDim2(0, 0, 0, 0);
			const cashPurchaceMenuTween = TweenService.Create(cashPurchaceMenu, new TweenInfo(0.2), {
				Size: cashPurchaceMenuClosedSize,
			});
			cashPurchaceMenuTween.Play();

			cashPurchaceMenu.Visible = false;
		};

		const cashPurchaceMenu = (player as unknown as { PlayerGui: { Garage: { cashPurchace: CashPurchaceMenu } } })
			.PlayerGui.Garage.cashPurchace;
		cashPurchaceMenu.Size = new UDim2(0, 0, 0, 0);
		const UiTween = TweenService.Create(cashPurchaceMenu, new TweenInfo(0.1), {
			Size: cashPurchaceMenuOpenSize,
		});
		cashPurchaceMenu.Visible = true;
		UiTween.Play();
		UiTween.Completed.Wait();

		(cashPurchaceMenu.WaitForChild("closeButton") as GuiButton).MouseButton1Click.Connect(() => {
			closeCashPurchaceMenu(player);
		});

		for (const cashPurchaceUi of cashPurchaceMenu.cash.GetChildren()) {
			if (cashPurchaceUi.IsA("ImageLabel")) {
				(cashPurchaceUi as CashPurchaceOption).buy.MouseButton1Click.Connect(() => {
					const productId = (cashPurchaceUi as CashPurchaceOption).ID.Value;
					MarketplaceService.PromptProductPurchase(player, productId);
				});
			}
		}

	},

	Body: (player: Player, Value: string, locked: boolean, mainUI: MainUi, uiFrame: GuiObject) => {
		const playerGarage = Globals.findPlayerGarage(player);
		if (locked) {
			//local carClass = require(game.ServerStorage.Classes.VehicleSubClass:FindFirstChild(Value)).new()

			const cost = getCarTrophyCost(Value);
			spawnVehicle.SpawnVehicle(player, false, Value, playerGarage!.spawnPlate.CFrame, true);

			SetupUnlockButton(mainUI, cost, player, Value);
		} else {
			spawnVehicle.SpawnVehicle(player, false, Value, playerGarage!.spawnPlate.CFrame, true);
			EnableSpawnButton(mainUI);
			DataUtilities.EquipItemIfOwned(player, Value, "equippedVehicle", "vehicles");
			SelectUiFrame(uiFrame, uiFrame.Parent!.Parent!);
		}
	},

	Colors: (player: Player, Value: string, locked: boolean, mainUI: MainUi) => {
		EnableSpawnButton(mainUI);
		Globals.vehiclesTable[player.UserId]!.PaintVehicle(Value);

		if (!locked) {
			DataUtilities.EquipItemOnVehicleIfOwned(player, Value, "colors", "color");
		}
	},

	Skins: (player: Player, Value: string, mainUI: MainUi) => {
		EnableSpawnButton(mainUI);

		Globals.vehiclesTable[player.UserId]!.ApplySkin(Value);

		DataUtilities.EquipItemOnVehicleIfOwned(player, Value, "skins", "skin");
	},

	createMenuBoostTrail: (trailModel: Instance, car: VehicleModel) => {
		const att1 = car.BoostEffectPart.Attachment;
		const att2 = car.BoostEffectPart.Attachment2;

		const trail: Trail = trailModel.FindFirstChildWhichIsA("Trail")!;

		const beam: Beam | undefined = car.BoostEffectPart.FindFirstChildWhichIsA("Beam");

		if (beam) {
			beam.Texture = trail.Texture;
			beam.Color = trail.Color;
			beam.Transparency = trail.Transparency;
			beam.TextureLength = trail.TextureLength;
			beam.LightEmission = trail.LightEmission;
			beam.LightInfluence = trail.LightInfluence;
			beam.FaceCamera = trail.FaceCamera;
			beam.TextureMode = trail.TextureMode;
		} else {
			const width0 = math.abs(att1.Position.Y - att2.Position.Y);

			att1.Position = new Vector3(att1.Position.X, (att1.Position.Y + att2.Position.Y) / 2, att1.Position.Z);
			att2.Position = att1.Position.add(new Vector3(0, 0, -50));

			const beam = new Instance("Beam");
			beam.Texture = trail.Texture;
			beam.Color = trail.Color;
			beam.Transparency = trail.Transparency;
			beam.TextureLength = trail.TextureLength;
			beam.LightEmission = trail.LightEmission;
			beam.LightInfluence = trail.LightInfluence;
			beam.FaceCamera = trail.FaceCamera;
			beam.TextureMode = trail.TextureMode;
			beam.Width0 = width0;
			beam.Width1 = width0;
			beam.Parent = car.BoostEffectPart;
			beam.Enabled = true;
			beam.Attachment0 = att1;
			beam.Attachment1 = att2;
		}

		const particleEmitter: ParticleEmitter | undefined =
			car.BoostEffectPart.FindFirstChildWhichIsA("ParticleEmitter");

		if (particleEmitter) {
			const particle: ParticleEmitter = trailModel.FindFirstChildWhichIsA("ParticleEmitter")!;
			particleEmitter.Destroy();
			const pe = particle.Clone();
			pe.Parent = car.BoostEffectPart;
			pe.Enabled = true;
		} else {
			const particle: ParticleEmitter = trailModel.FindFirstChildWhichIsA("ParticleEmitter")!;

			const pe = particle.Clone();
			pe.Parent = car.BoostEffectPart;
			pe.Enabled = true;
		}
	},

	BoostTrail: (player: Player, Value: string, locked: boolean, mainUI: MainUi, uiFrame: GuiObject) => {
		selectedFunctions.createMenuBoostTrail(
			(ServerStorage as unknown as { BoostTrails: Folder }).BoostTrails.FindFirstChild(Value)!,
			Globals.vehiclesTable[player.UserId]!.model,
		);

		if (!locked) {
			DataUtilities.EquipItemOnVehicleIfOwned(player, Value, "boostTrails", "boostTrail");
			SelectUiFrame(uiFrame, uiFrame.Parent!);
		}
	},

	CarHorn: (player: Player, Value: string, locked: boolean, mainUI: MainUi, uiFrame: GuiObject) => {
		if (!locked) {
			DataUtilities.EquipItemOnVehicleIfOwned(player, Value, "hornSounds", "hornSound");
			SelectUiFrame(uiFrame, uiFrame.Parent!);
		}

		if (mainUI.FindFirstChildWhichIsA("Sound")) {
			mainUI.FindFirstChildWhichIsA("Sound")!.Destroy();
		}

		const sound = (ServerStorage as unknown as { CarHorns: Folder }).CarHorns.FindFirstChild(Value)!;
		const newSound = sound.Clone() as Sound;
		newSound.Parent = mainUI;
		newSound.Play();
		newSound.Stopped.Wait();
		newSound.Destroy();
	},
};

export = selectedFunctions;
