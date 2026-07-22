// Client-owned DataLoss banner (client-side UI migration, Phase 3).
//
// The server no longer touches the DataLoss ScreenGui — on a DataStore/
// MemoryStore mismatch at join it publishes the CB_DataLoss player attribute
// (initializePlayer.server.ts via UiState.setPlayerAttr) and this script
// derives Enabled from it. The gui itself is mounted by
// src/client/ui/bootstrap.client.ts.

const Players = game.GetService("Players");

const LocalPlayer = Players.LocalPlayer;
const playerGui = LocalPlayer.WaitForChild("PlayerGui") as Instance;

function refresh() {
	const gui = playerGui.FindFirstChild("DataLoss");
	if (gui && gui.IsA("ScreenGui")) {
		gui.Enabled = LocalPlayer.GetAttribute("CB_DataLoss") === true;
	}
}

LocalPlayer.GetAttributeChangedSignal("CB_DataLoss").Connect(refresh);
// Bootstrap and this script race at client start; re-run once the gui exists
// in case the attribute replicated before the mount.
playerGui.ChildAdded.Connect((child) => {
	if (child.Name === "DataLoss") {
		task.defer(refresh);
	}
});
refresh();
