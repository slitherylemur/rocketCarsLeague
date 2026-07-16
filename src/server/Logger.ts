// Original: ServerStorage/Logger (ModuleScript)

const HTTPService = game.GetService("HttpService");

interface LogClient {
	token: string;
	Ingest(this: LogClient, message: unknown): void;
}

const Logger = {
	Register(this: void, token: string): LogClient {
		const logClient: LogClient = {
			token: token,
			Ingest: Ingest,
		};

		return logClient;
	},
};

function Ingest(this: LogClient, message: unknown) {
	const log = {
		dt: DateTime.now(),
		message: tostring(message),
	};

	const response = HTTPService.RequestAsync({
		Url: "https://in.logtail.com",
		Method: "POST",
		Headers: {
			["Content-Type"]: "application/json",
			["Authorization"]: "Bearer " + this.token,
		},
		Body: HTTPService.JSONEncode(log),
	});
}

export = Logger;
