// Original: ServerStorage/Modules/UiModules/itemPopulateSpecifics (ModuleScript)

//variables
import GeneralUtils from "../../GeneralUtils";
import DataUtilities from "../DataUtilities";
import requireModule from "shared/requireModule";
import type { VehicleSubClassModule } from "../../Classes/VehicleSubClass/subClassTypes";

const ServerStorage = game.GetService("ServerStorage");

const selectedColor = Color3.fromRGB(173, 138, 0); //Change in itemSelectedFunctions also
const unselectedColor = new Color3(0, 0, 0); //Change in itemSelectedFunctions also

// ---- uiFrame shapes (children of the DisplayButtons/LockedButtons templates
// in ReplicatedStorage.Ui — non-script instances, they stay in the place file) ----

interface BodyUiFrame extends GuiButton {
	Txt: TextLabel;
	ViewportFrame: ViewportFrame;
	Price: TextLabel;
}

interface BoostTrailUiFrame extends GuiButton {
	Txt: TextLabel;
	ImageLabel: ImageLabel & { UIGradient: UIGradient };
	particle: ImageLabel & { UIGradient: UIGradient };
}

//Module functions

function colorEquippedUiFrame(player: Player, Value: string, uiFrame: GuiObject, ItemType: string) {
	const equippedValue = DataUtilities.GetEquippedItemOnVehicle(player, ItemType);
	if (equippedValue === Value) {
		uiFrame.BackgroundColor3 = selectedColor;
	}
}

// (original declared this between Colors and BoostTrail — hoisted above the
// module table because TS object literals cannot contain statements)
const blancImage = "rbxassetid://5458835735";

// All functions are dot-called (and dispatched dynamically by tab name from
// setTab), so they are arrow properties — no implicit self.
const populateSpecifics = {
	Body: (uiFrame: BodyUiFrame, Value: string, player: Player) => {
		// Original: game.ServerStorage.Classes.VehicleSubClass — the compiled
		// subclass ModuleScripts live under <TS root>/Classes/VehicleSubClass
		// (same lookup as spawnVehicle).
		const subClassFolder = (script.Parent!.Parent!.Parent as unknown as { Classes: { VehicleSubClass: Folder } })
			.Classes.VehicleSubClass;

		if (subClassFolder.FindFirstChild(Value)) {
			const equippedValue = DataUtilities.getPlayerEquippedVehicle(player);
			if (equippedValue === Value) {
				uiFrame.BackgroundColor3 = selectedColor;
			}

			const carClass = requireModule(
				subClassFolder.FindFirstChild(Value) as ModuleScript,
			) as VehicleSubClassModule;
			//local carObject, model = carClass.new(nil)
			const carModel = (ServerStorage as unknown as { VehicleModels: Folder }).VehicleModels.FindFirstChild(
				Value,
			)!;
			const model = carModel.Clone();
			uiFrame.Txt.Text = carClass.displayName;
			model.Parent = uiFrame.ViewportFrame;

			const cost = carModel.GetAttribute("cost") as number;
			uiFrame.LayoutOrder = cost;

			if (uiFrame.FindFirstChild("Price")) {
				//	print(carClass)
				//	print(carClass:GetCost())

				uiFrame.Price.Text = `$${GeneralUtils.CommaNumber(cost)}`;
			}
		}
	},

	// function populateSpecifics.Skins(uiFrame, Value, player)

	// 	local equipedVehicle = DataUtilities.getPlayerEquippedVehicle(player)

	// 	local carClass = require(game.ServerStorage.Classes.VehicleSubClass:FindFirstChild(equipedVehicle))

	// 	uiFrame.Txt.Text = GeneralUtils.StringAddSpacesBeforeCaps(Value)

	// 	local car = carClass.new(player)

	// 	car:ApplySkin(Value)
	// 	car.model.Parent =  uiFrame.ViewportFrame

	// end

	CarHorn: (uiFrame: TextButton & { Txt: TextLabel }, Value: string, player: Player) => {
		colorEquippedUiFrame(player, Value, uiFrame, "hornSound");

		uiFrame.Txt.Text = GeneralUtils.StringAddSpacesBeforeCaps(Value);
	},

	Colors: (uiFrame: Frame & { Txt: TextLabel }, Value: string) => {
		// print(Value)
		// print(game.ServerStorage.Colors:GetChildren())
		uiFrame.BackgroundColor3 = (
			(ServerStorage as unknown as { Colors: Folder }).Colors.FindFirstChild(Value) as Color3Value
		).Value;
		uiFrame.Txt.Text = GeneralUtils.StringAddSpacesBeforeCaps(Value);
	},

	BoostTrail: (uiFrame: BoostTrailUiFrame, Value: string, player: Player) => {
		colorEquippedUiFrame(player, Value, uiFrame, "boostTrail");

		uiFrame.Txt.Text = GeneralUtils.StringAddSpacesBeforeCaps(Value);

		const trailModel = (ServerStorage as unknown as { BoostTrails: Folder }).BoostTrails.FindFirstChild(
			Value,
		) as Instance & { Trail: Trail; ParticleEmitter: ParticleEmitter };

		if (trailModel.Trail.Texture === "" || (trailModel.Trail.Texture as unknown) === undefined) {
			uiFrame.ImageLabel.Image = blancImage;
		} else {
			uiFrame.ImageLabel.Image = trailModel.Trail.Texture;
		}

		uiFrame.ImageLabel.UIGradient.Color = trailModel.Trail.Color;
		uiFrame.ImageLabel.UIGradient.Transparency = trailModel.Trail.Transparency;

		uiFrame.particle.Image = trailModel.ParticleEmitter.Texture;

		if (trailModel.ParticleEmitter.Texture === "" || (trailModel.ParticleEmitter.Texture as unknown) === undefined) {
			uiFrame.particle.Image = blancImage;
		} else {
			uiFrame.particle.Image = trailModel.ParticleEmitter.Texture;
		}

		uiFrame.particle.UIGradient.Color = trailModel.ParticleEmitter.Color;
	},
};

export = populateSpecifics;
