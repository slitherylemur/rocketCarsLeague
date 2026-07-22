// Creates the runtime ReplicatedStorage.UiIntents folder and every UI remote
// at server startup (client-side UI migration, Phase 1 scaffolding). Clients
// access these through the typed accessors in src/shared/UiIntents.ts.
//
// Same runtime-remotes pattern as ReplicatedStorage.CarBall (TeamRegistry):
// nothing place-file-side — everything is created here, then parented to
// ReplicatedStorage in one shot so clients never observe a half-built folder.

import {
	UI_FUNCTION_NAMES,
	UI_INTENT_EVENT_NAMES,
	UI_INTENTS_FOLDER_NAME,
	UI_PUSH_EVENT_NAMES,
	UI_SOUND_NAMES,
	UI_SOUNDS_FOLDER_NAME,
} from "shared/UiIntents";

const ReplicatedStorage = game.GetService("ReplicatedStorage");
const ServerStorage = game.GetService("ServerStorage");

const folder = new Instance("Folder");
folder.Name = UI_INTENTS_FOLDER_NAME;

for (const name of UI_INTENT_EVENT_NAMES) {
	const remote = new Instance("RemoteEvent");
	remote.Name = name;
	remote.Parent = folder;
}

for (const name of UI_PUSH_EVENT_NAMES) {
	const remote = new Instance("RemoteEvent");
	remote.Name = name;
	remote.Parent = folder;
}

for (const name of UI_FUNCTION_NAMES) {
	const remote = new Instance("RemoteFunction");
	remote.Name = name;
	remote.Parent = folder;
}

// Phase 3: the money-popup sounds are place-file assets in ServerStorage.Sounds
// (invisible to clients). Clone them under the folder so the client popups
// (src/client/ui/moneyPopups.client.ts) can play the exact same assets locally.
const soundsFolder = new Instance("Folder");
soundsFolder.Name = UI_SOUNDS_FOLDER_NAME;
const serverSounds = ServerStorage.FindFirstChild("Sounds");
for (const name of UI_SOUND_NAMES) {
	const template = serverSounds ? serverSounds.FindFirstChild(name) : undefined;
	if (template && template.IsA("Sound")) {
		template.Clone().Parent = soundsFolder;
	} else {
		warn(`[UiIntents] ServerStorage.Sounds.${name} missing — client money popups will skip it`);
	}
}
soundsFolder.Parent = folder;

folder.Parent = ReplicatedStorage;
