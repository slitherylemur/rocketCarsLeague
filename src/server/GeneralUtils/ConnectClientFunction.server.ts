// Original: ServerScriptService/GeneralUtils/ConnectClientFunction (Script)

import module from "../GeneralUtils";

const ClientFunction = new Instance("RemoteFunction");
ClientFunction.Name = "GeneralUtilFunc";
ClientFunction.Parent = game.GetService("ReplicatedStorage");

ClientFunction.OnServerInvoke = (player, Name, ...args: unknown[]) => {
	return (module as unknown as Record<string, (...fnArgs: unknown[]) => unknown>)[Name as string](...args);
};
