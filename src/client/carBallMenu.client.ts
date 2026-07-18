// Client half of the Top Table menus:
//  * PromptGameInvite remote → Roblox's native invite-friends prompt
//    (SocialService is client-only).
//  * Rename popup Confirm → fires the typed name to the server
//    (player-typed TextBox.Text never replicates on its own).

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const SocialService = game.GetService("SocialService");
const LocalPlayer = Players.LocalPlayer;

const carBall = ReplicatedStorage.WaitForChild("CarBall");
const promptGameInvite = carBall.WaitForChild("PromptGameInvite") as RemoteEvent;
const submitTeamName = carBall.WaitForChild("SubmitTeamName") as RemoteEvent;

promptGameInvite.OnClientEvent.Connect(() => {
	pcall(() => {
		let canSend = true;
		pcall(() => {
			canSend = SocialService.CanSendGameInviteAsync(LocalPlayer);
		});
		if (canSend) {
			SocialService.PromptGameInvite(LocalPlayer);
		}
	});
});

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
