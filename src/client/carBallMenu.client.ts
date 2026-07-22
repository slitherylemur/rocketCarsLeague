// Client half of the Top Table menus:
//  * Rename popup Confirm → fires the typed name to the server
//    (player-typed TextBox.Text never replicates on its own). The popup's
//    open/close/status rendering lives in src/client/ui/menu.client.ts —
//    only the Confirm submit is wired here.
//
// (The PromptGameInvite bounce is retired since Phase 4: the CreateTeam page
// is client-owned and menu.client.ts calls SocialService.PromptGameInvite
// directly on the INVITE ROBLOX FRIENDS press.)

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const LocalPlayer = Players.LocalPlayer;

const carBall = ReplicatedStorage.WaitForChild("CarBall");
const submitTeamName = carBall.WaitForChild("SubmitTeamName") as RemoteEvent;

function wireRenamePopup(popup: Instance) {
	if (!popup.IsA("ScreenGui")) {
		return;
	}
	task.spawn(() => {
		const panel = popup.WaitForChild("Panel");
		const confirm = panel.WaitForChild("Confirm") as TextButton;
		const nameBox = panel.WaitForChild("NameBox") as TextBox;
		confirm.MouseButton1Click.Connect(() => {
			submitTeamName.FireServer(nameBox.Text);
		});
	});
}

const playerGui = LocalPlayer.WaitForChild("PlayerGui");
playerGui.ChildAdded.Connect((child) => {
	if (child.Name === "RenamePopup") {
		wireRenamePopup(child);
	}
});
const existingPopup = playerGui.FindFirstChild("RenamePopup");
if (existingPopup) {
	wireRenamePopup(existingPopup);
}
