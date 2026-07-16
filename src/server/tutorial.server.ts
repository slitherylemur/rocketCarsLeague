// Original: ServerScriptService/tutorial (Script)

import DataStore2 from "./Modules/DataStore2";
import DataUtilities from "./Modules/DataUtilities";
import { Globals } from "./Globals";

const playersService = game.GetService("Players");

interface TutorialGuiShape extends Instance {
	Garage: ScreenGui & {
		Tutorial: Frame & { PopUp: Frame & { TextLabel: TextLabel } };
		Inventory: Frame & { BuyButton: Frame & { Button: TextButton } };
	};
}

function CarTutorial(player: Player) {
	const playersVehicles = DataUtilities.GetPlayersItems(player, "vehicles") as string[];
	if (playersVehicles.indexOf("ToyVan") !== -1) {
		return;
	}
	const gui = (player as unknown as { PlayerGui: TutorialGuiShape }).PlayerGui;
	gui.Garage.Tutorial.PopUp.Visible = true;
	gui.Garage.Tutorial.PopUp.TextLabel.Text = "Welcome to Bumper Cars!";
	task.wait(5);
	gui.Garage.Tutorial.PopUp.TextLabel.Text = "Buy your first Car!";
	task.wait(1);
	gui.Garage.Tutorial.PopUp.TextLabel.Text = "Click on the highlighted car and press the BUY button.";
	const toyVanModel = gui.FindFirstChild("ToyVan", true)!;
	const ui = toyVanModel.Parent!.Parent as GuiButton;
	ui.BackgroundColor3 = new Color3(0, 1, 0);
	ui.MouseButton1Click.Wait();
	gui.Garage.Tutorial.PopUp.TextLabel.Text = "Press the BUY button.";
	gui.Garage.Inventory.BuyButton.Button.MouseButton1Click.Wait();
	gui.Garage.Tutorial.PopUp.TextLabel.Text = "Congratulations you have a Toy Van!!";
	task.wait(1.5);
	gui.Garage.Tutorial.PopUp.TextLabel.Text =
		"To pitch up and down in the air, release controls and then press W or S.";
	task.wait(2);
	gui.Garage.Tutorial.PopUp.TextLabel.Text = "Play the game";
}

Globals.CrateTutorial = (player: Player) => {
	return;
	//local hasDone = DataUtilities.GetPlayersItems(player, "crateTutorial")
	//if hasDone then
	//    return
	//end

	//if not DataUtilities.PlayerCanAfford(player, 3500) then
	//    return
	//end

	//player.PlayerGui.Garage.Tutorial.Arrow.Visible = true
	//player.PlayerGui.Garage.Inventory.ShopButton.MouseButton1Click:wait()
	//player.PlayerGui.Garage.Tutorial.Arrow.Visible = false

	//player.PlayerGui.Garage.Tutorial.PopUp.TextLabel.Text = "Click on the highlighted crate."
	//player.PlayerGui.Garage.Tutorial.PopUp.Visible = true
	//local crate = player.PlayerGui.Garage.Shop.Crates.Normal["1"]
	//crate.BackgroundColor3 = Color3.new(0,1,0)
	//crate.MouseButton1Click:wait()

	//player.PlayerGui.Garage.Tutorial.PopUp.TextLabel.Text = "Open the crate"
	//local open = player.PlayerGui.Garage.CrateMenu.OpenButton.MouseButton1Click:wait()
	//player.PlayerGui.Garage.Tutorial.PopUp.Visible = false
	//task.wait(13)

	//player.PlayerGui.Garage.Tutorial.PopUp.TextLabel.Text = "Go back to your inventory to equip your item."
	//player.PlayerGui.Garage.Tutorial.PopUp.Visible = true
	//task.wait(5)
	//player.PlayerGui.Garage.Tutorial.PopUp.Visible = false

	//local hasDoneDS = DataStore2("crateTutorial", player)
	//hasDoneDS:Set(true)
};

playersService.PlayerAdded.Connect((player) => {
	CarTutorial(player);
});
