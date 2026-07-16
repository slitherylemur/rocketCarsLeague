// Original: StarterPlayer/StarterPlayerScripts/crateAnimation (LocalScript)

import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import populateCrateFrameModule from "shared/PopulateCrateFrame";

const ShowCrateAnimationEvent = FunctionsAndEvents.ShowCrateAnimationEvent;
const player = game.GetService("Players").LocalPlayer;
const TweenService = game.GetService("TweenService");
const runService = game.GetService("RunService");

//Types: CarHorns, Colors, BoostTrails

const rarityNames = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"];

interface CrateItemLike {
	name: string;
	type: string;
	rarity: number;
}

interface ItemGui extends Frame {
	Frame: Frame & { BackgroundColor3: Color3; TextLabel: TextLabel };
	Rarity: IntValue;
	Type: StringValue;
	shine: GuiObject;
}

interface CrateGuiShape extends ScreenGui {
	Frame: Frame;
	pickerFrame: ImageLabel;
	ItemText: Folder & { Rarity: TextLabel; NameType: TextLabel };
	click: Sound;
	CompletionSound: Sound;
}

let highlightedUi: ItemGui | undefined = undefined;

function clearItemGuisFromAnimationFrame(animationFrame: Frame) {
	highlightedUi = undefined;

	for (const itemGui of animationFrame.GetChildren()) {
		if (itemGui.IsA("Frame")) {
			itemGui.Destroy();
		}
	}
}

function highlightItemGuiThatIsBelowPickerUi(
	animationFrame: Frame,
	pickerUi: ImageLabel,
	CrateText: CrateGuiShape["ItemText"],
) {
	for (const itemGui of animationFrame.GetChildren()) {
		if (itemGui.IsA("Frame")) {
			const typedGui = itemGui as ItemGui;
			if (math.abs(typedGui.AbsolutePosition.Y - pickerUi.AbsolutePosition.Y) < typedGui.AbsoluteSize.Y / 2) {
				if (highlightedUi !== typedGui) {
					(animationFrame.Parent as CrateGuiShape).click.Play();
				}

				if (highlightedUi) {
					// print(highlightedUi)
					// print(highlightedUi:GetChildren())
					// print(highlightedUi.Parent)
					highlightedUi.shine.Visible = false;
				}
				CrateText.Rarity.Text = rarityNames[typedGui.Rarity.Value + 1 - 1];
				CrateText.Rarity.TextColor3 = typedGui.Frame.BackgroundColor3;
				CrateText.NameType.Text = typedGui.Frame.TextLabel.Text + " - " + typedGui.Type.Value;
				typedGui.shine.Visible = true;
				highlightedUi = typedGui;
			}
		}
	}
}

function startCrateAnimation(item: CrateItemLike, paddingItems: CrateItemLike[]) {
	const gui = player.WaitForChild("PlayerGui");
	const crateGui = gui.FindFirstChild("CrateMenu") as CrateGuiShape; //this is the crate gui
	const animatedFrame = crateGui.Frame;

	clearItemGuisFromAnimationFrame(animatedFrame);

	for (const [i, itemToShowIn] of ipairs(paddingItems)) {
		const itemGui = (
			game.GetService("ReplicatedStorage") as unknown as { Ui: { CrateFrame: Frame } }
		).Ui.CrateFrame.Clone();

		let itemToShow = itemToShowIn;
		if (i === 3) {
			itemToShow = item;
			// itemGui.Frame.BackgroundColor3 = Color3.fromRGB(255, 0, 0)
		}
		populateCrateFrameModule.PopulateFrame(itemGui as never, itemToShow, animatedFrame);
	}
	animatedFrame.Position = new UDim2(0.5, 0, 0, 0);
	crateGui.Enabled = true;

	runService.BindToRenderStep("CrateAnimation", Enum.RenderPriority.First.Value, () => {
		highlightItemGuiThatIsBelowPickerUi(animatedFrame, crateGui.pickerFrame, crateGui.ItemText);
	});

	const tweenInfo = new TweenInfo(
		7, // Time
		Enum.EasingStyle.Circular, // EasingStyle
		Enum.EasingDirection.Out, // EasingDirection
	);
	const animatedFrameTween = TweenService.Create(animatedFrame, tweenInfo, {
		Position: new UDim2(0.5, 0, 9.6, 0),
	});
	animatedFrameTween.Play();
	task.wait(6.2);

	const tweenInfo2 = new TweenInfo(
		4, // Time
		Enum.EasingStyle.Quad, // EasingStyle
		Enum.EasingDirection.Out, // EasingDirection
	);
	const animatedFrameTween2 = TweenService.Create(animatedFrame, tweenInfo2, {
		Position: new UDim2(0.5, 0, 9.88, 0),
	});
	animatedFrameTween2.Play();
	animatedFrameTween2.Completed.Wait();
	crateGui.CompletionSound.Play();
	runService.UnbindFromRenderStep("CrateAnimation");
	//crateGui.Enabled = false
	task.wait(2);
	crateGui.Enabled = false;
}

ShowCrateAnimationEvent.OnClientInvoke = ((item: CrateItemLike, paddingItems: CrateItemLike[]) =>
	startCrateAnimation(item, paddingItems)) as never;
