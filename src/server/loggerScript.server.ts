// Original: ServerScriptService/loggerScript (Script)
// ServerScriptService

import LoggerModule from "./Logger";

const Logger = LoggerModule.Register("a1E6ruXk5AcV8qLxgaaF6sot");

const LogService = game.GetService("LogService");

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

LogService.MessageOut.Connect((message) => {
	if (checkNotACommonMessage(message)) {
		Logger.Ingest(message);
	}
});
