// Original: ReplicatedStorage/PopulateCrateFrame (ModuleScript)
// Shared module — used by the server (initializePlayer crate menu) and the
// client (crateAnimation).

interface CrateItemLike {
	name: string;
	type: string;
	rarity: number;
}

interface ItemGui extends Frame {
	Frame: Frame & { TextLabel: TextLabel; ImageLabel: ImageLabel };
	Rarity: IntValue;
	Type: StringValue;
}

interface BoostUiFrame extends GuiButton {
	Txt: TextLabel;
	ImageLabel: ImageLabel & { UIGradient: UIGradient };
	particle: ImageLabel & { UIGradient: UIGradient };
}

function stringAddSpacesBeforeCaps(String: string): string {
	const SplitLocation = string.find(String, "%l%u")[0];

	if (SplitLocation !== undefined) {
		const FirstString = string.sub(String, 0, SplitLocation);
		const SecondString = string.sub(String, SplitLocation + 1);

		if (SecondString !== undefined) {
			return FirstString + " " + stringAddSpacesBeforeCaps(SecondString);
		} else {
			return String;
		}
	} else {
		return String;
	}
}

const module = {
	setRarityColor: (item: CrateItemLike, itemGui: ItemGui) => {
		const rarity = item.rarity;
		if (rarity === 0) {
			itemGui.Frame.BackgroundColor3 = Color3.fromRGB(138, 138, 138);
		} else if (rarity === 1) {
			itemGui.Frame.BackgroundColor3 = Color3.fromRGB(0, 179, 0);
		} else if (rarity === 2) {
			itemGui.Frame.BackgroundColor3 = Color3.fromRGB(153, 0, 255);
		} else if (rarity === 3) {
			itemGui.Frame.BackgroundColor3 = Color3.fromRGB(170, 0, 0);
		} else if (rarity === 4) {
			itemGui.Frame.BackgroundColor3 = Color3.fromRGB(214, 200, 0);
		}
	},

	PopulateFrame: (itemGui: ItemGui, itemToShow: CrateItemLike, parentFrame: Instance) => {
		itemGui.Frame.TextLabel.Text = stringAddSpacesBeforeCaps(itemToShow.name);
		module.setRarityColor(itemToShow, itemGui);
		itemGui.Rarity.Value = itemToShow.rarity;
		itemGui.Type.Value = itemToShow.type;
		itemGui.Parent = parentFrame;
		if (itemToShow.type === "Colors") {
			const colorVal = (
				game.GetService("ReplicatedStorage") as unknown as { Colors: Record<string, Color3Value> }
			).Colors[itemToShow.name];
			itemGui.Frame.ImageLabel.BackgroundColor3 = colorVal.Value;
			itemGui.Frame.ImageLabel.BackgroundTransparency = 0;
			if (colorVal.FindFirstChildWhichIsA("Texture")) {
				itemGui.Frame.ImageLabel.Image = colorVal.FindFirstChildWhichIsA("Texture")!.Texture;
				itemGui.Frame.ImageLabel.ImageTransparency = 0.5;
			} else {
				itemGui.Frame.ImageLabel.Image = "";
			}
		} else if (itemToShow.type === "BoostTrails") {
			const boostTrail = (
				game.GetService("ReplicatedStorage") as unknown as {
					BoostTrails: Record<string, Instance & { Trail: Trail; ParticleEmitter: ParticleEmitter }>;
				}
			).BoostTrails[itemToShow.name];
			const BoostUiFrame = (
				game.GetService("ReplicatedStorage") as unknown as {
					Ui: { DisplayButtons: { BoostTrail: BoostUiFrame } };
				}
			).Ui.DisplayButtons.BoostTrail.Clone();
			BoostUiFrame.Parent = itemGui.Frame;
			BoostUiFrame.Size = new UDim2(1, 0, 1, 0);
			BoostUiFrame.BackgroundTransparency = 1;
			BoostUiFrame.Txt.Visible = false;
			itemGui.Frame.ImageLabel.Visible = false;

			BoostTrailPopulateSpecifics(boostTrail, BoostUiFrame);
		}
	},
};

function BoostTrailPopulateSpecifics(
	trailModel: Instance & { Trail: Trail; ParticleEmitter: ParticleEmitter },
	uiFrame: BoostUiFrame,
) {
	const blancImage = "rbxassetid://5458835735";

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
}

export = module;
