// Original: StarterPlayer/StarterPlayerScripts/crateAnimation (LocalScript)
//
// Phase 5 (client-side UI migration): the reveal is driven by the
// Ui_CrateResult RemoteEvent (same chosenItem/paddingItems payload the old
// ShowCrateAnimationEvent.InvokeClient carried) instead of a server-blocking
// callback. The Garage controller remains the sole owner of Garage.Enabled;
// this script publishes local reveal state and cancels itself if gameplay wins
// while the animation is yielding.

import populateCrateFrameModule from "shared/PopulateCrateFrame";
import { getUiIntentEvent } from "shared/UiIntents";
import { isGarageFlowActive, LOCAL_CRATE_REVEAL_ATTR } from "shared/ui/gameplayUiState";

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
let animationGeneration = 0;
let activeTweens: Tween[] = [];

function crateGui(): CrateGuiShape | undefined {
	const gui = player.FindFirstChild("PlayerGui");
	const candidate = gui?.FindFirstChild("CrateMenu");
	return candidate?.IsA("ScreenGui") ? (candidate as CrateGuiShape) : undefined;
}

function stopActiveAnimation() {
	animationGeneration += 1;
	for (const tween of activeTweens) {
		tween.Cancel();
	}
	activeTweens = [];
	pcall(() => runService.UnbindFromRenderStep("CrateAnimation"));
	const gui = crateGui();
	if (gui) {
		gui.Enabled = false;
	}
	player.SetAttribute(LOCAL_CRATE_REVEAL_ATTR, undefined);
}

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

function startCrateAnimation(item: CrateItemLike, paddingItems: CrateItemLike[], generation: number) {
	const gui = player.WaitForChild("PlayerGui");
	const crateGui = gui.FindFirstChild("CrateMenu") as CrateGuiShape; //this is the crate gui
	if (!crateGui || generation !== animationGeneration || !isGarageFlowActive(player)) {
		return;
	}
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
	activeTweens = [animatedFrameTween];
	animatedFrameTween.Play();
	task.wait(6.2);
	if (generation !== animationGeneration || !isGarageFlowActive(player)) {
		return;
	}

	const tweenInfo2 = new TweenInfo(
		4, // Time
		Enum.EasingStyle.Quad, // EasingStyle
		Enum.EasingDirection.Out, // EasingDirection
	);
	const animatedFrameTween2 = TweenService.Create(animatedFrame, tweenInfo2, {
		Position: new UDim2(0.5, 0, 9.88, 0),
	});
	activeTweens.push(animatedFrameTween2);
	animatedFrameTween2.Play();
	animatedFrameTween2.Completed.Wait();
	if (generation !== animationGeneration || !isGarageFlowActive(player)) {
		return;
	}
	crateGui.CompletionSound.Play();
	runService.UnbindFromRenderStep("CrateAnimation");
	//crateGui.Enabled = false
	task.wait(2);
	if (generation === animationGeneration) {
		crateGui.Enabled = false;
		activeTweens = [];
	}
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
// callback (Phase 8 pruned that remote's typed accessor; the place-file
// RemoteFunction instance remains, unused).
getUiIntentEvent("Ui_CrateResult").OnClientEvent.Connect((...args: unknown[]) => {
	const item = args[0] as CrateItemLike;
	const paddingItems = args[1] as CrateItemLike[];
	if (!typeIs(item, "table") || !typeIs(paddingItems, "table")) {
		return;
	}
	// A result can arrive after the shop-end spawn transition. It is no longer
	// authorized to open any menu UI once the player has left the garage.
	if (!isGarageFlowActive(player)) {
		return;
	}

	stopActiveAnimation();
	const generation = animationGeneration;
	player.SetAttribute(LOCAL_CRATE_REVEAL_ATTR, true);
	const [ok, err] = pcall(() => startCrateAnimation(item, paddingItems, generation));
	if (!ok) {
		warn(`[CrateAnimation] reveal failed: ${err}`);
		if (generation === animationGeneration) {
			stopActiveAnimation();
		}
		return;
	}
	if (generation === animationGeneration) {
		if (isGarageFlowActive(player)) {
			playHornPreview(item);
		}
		player.SetAttribute(LOCAL_CRATE_REVEAL_ATTR, undefined);
	}
});

function cancelIfGarageLost() {
	if (!isGarageFlowActive(player)) {
		stopActiveAnimation();
	}
}

player.GetAttributeChangedSignal("CB_FlowState").Connect(cancelIfGarageLost);
player.GetAttributeChangedSignal("CB_PitchId").Connect(cancelIfGarageLost);
