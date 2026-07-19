// Restrict normal player chat to the two teams sharing the same pitch.
// Roblox's TextChatService still owns filtering, moderation, permissions and
// the stock chat UI; this callback only decides which recipients receive each
// message.

const Players = game.GetService("Players");
const TextChatService = game.GetService("TextChatService");

const textChannels = TextChatService.WaitForChild("TextChannels");
const generalChannel = textChannels.WaitForChild("RBXGeneral") as TextChannel;

generalChannel.ShouldDeliverCallback = (message, receiverSource) => {
	const senderSource = message.TextSource;
	if (!senderSource) {
		return false;
	}

	const sender = Players.GetPlayerByUserId(senderSource.UserId);
	const receiver = Players.GetPlayerByUserId(receiverSource.UserId);
	if (!sender || !receiver) {
		return false;
	}

	const senderPitchId = sender.GetAttribute("CB_PitchId");
	return (
		typeIs(senderPitchId, "string") &&
		senderPitchId !== "" &&
		receiver.GetAttribute("CB_PitchId") === senderPitchId
	);
};
