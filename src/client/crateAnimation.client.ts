// Original: StarterPlayer/StarterPlayerScripts/crateAnimation (LocalScript)
//
// Phase 5 (client-side UI migration): the reveal is driven by the
// Ui_CrateResult RemoteEvent (same chosenItem/paddingItems payload the old
// ShowCrateAnimationEvent.InvokeClient carried) instead of a server-blocking
// callback. This script also owns hiding/restoring the client-owned Garage
// around the animation — the server used to toggle Garage.Enabled around its
// InvokeClient.

import populateCrateFrameModule from "shared/PopulateCrateFrame";
import { getUiIntentEvent } from "shared/UiIntents";

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

/** Won a horn: play its preview locally after the reveal (the old server flow
 * played it via itemSelectedFunctions.CarHorn once InvokeClient returned). */
function playHornPreview(item: CrateItemLike) {
	if (item.type !== "CarHorns") {
		return;
	}
	pcall(() => {
		const horns = game.GetService("ReplicatedStorage").WaitForChild("CarHorns", 10);
		const template = horns?.FindFirstChild(item.name);
		if (template && template.IsA("Sound")) {
			const sound = template.Clone();
			sound.Parent = player.WaitForChild("PlayerGui");
			sound.Play();
			sound.Stopped.Connect(() => sound.Destroy());
			sound.Ended.Connect(() => sound.Destroy());
		}
	});
}

// Ui_CrateResult replaces the old ShowCrateAnimationEvent.OnClientInvoke
// callback (the RemoteFunction instance stays in the place file until Phase 8).
getUiIntentEvent("Ui_CrateResult").OnClientEvent.Connect((...args: unknown[]) => {
	const item = args[0] as CrateItemLike;
	const paddingItems = args[1] as CrateItemLike[];
	if (!typeIs(item, "table") || !typeIs(paddingItems, "table")) {
		return;
	}
	// Hide the client-owned Garage for the reveal (the server used to disable
	// it around InvokeClient); restore it only if the player is still in the
	// garage flow when the animation ends.
	const playerGui = player.WaitForChild("PlayerGui");
	const garage = playerGui.FindFirstChild("Garage");
	if (garage && garage.IsA("ScreenGui")) {
		garage.Enabled = false;
	}
	startCrateAnimation(item, paddingItems);
	playHornPreview(item);
	if (garage && garage.IsA("ScreenGui")) {
		garage.Enabled = player.GetAttribute("CB_FlowState") === "garage";
	}
});
