// Original: ServerScriptService/loggerScript (Script)
// ServerScriptService

import LoggerModule from "./Logger";

const Logger = LoggerModule.Register("a1E6ruXk5AcV8qLxgaaF6sot");

const LogService = game.GetService("LogService");
const RunService = game.GetService("RunService");

// Studio output is local development noise and can be extremely chatty. It
// must not consume the live HTTP budget (or make offline Studio sessions
// repeatedly attempt remote requests).
const REMOTE_LOGGING_ENABLED = !RunService.IsStudio();

const commomMessages = [
	"Failed to load sound",
	"Cloud instance must exist under Terrain node in workspace to be visible.",
	"TeleportService:TeleportPartyAsync",
	"BoostEffectPart",
	"Garage",
	"ServerStorage.Classes.VehicleClass",
	"PlayerGui",
	"Base",
	"ServerScriptService.tutorial",
	"The Parent property of",
];

function checkNotACommonMessage(message: string): boolean {
	for (const commonMessages of commomMessages) {
		if (string.find(message, commonMessages)[0] !== undefined) {
			return false;
		}
	}

	return true;
}

const pending: string[] = [];
const MAX_PENDING_MESSAGES = 100;

if (REMOTE_LOGGING_ENABLED) {
	LogService.MessageOut.Connect((message) => {
		if (checkNotACommonMessage(message)) {
			if (pending.size() >= MAX_PENDING_MESSAGES) {
				pending.shift();
			}
			pending.push(message);
		}
	});

	// Send one batched request per interval instead of one HTTP request for
	// every print/warn.
	task.spawn(() => {
		while (true) {
			task.wait(5);
			if (pending.size() > 0) {
				const batch = pending.join("\n");
				pending.clear();
				Logger.Ingest(batch);
			}
		}
	});
}
