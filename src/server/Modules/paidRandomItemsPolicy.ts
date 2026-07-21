// Regional lootbox compliance (PolicyService). Crates are paid random items —
// they cost Robux directly (Overdrive) or gold that is sold for Robux, so
// every crate entry point must respect ArePaidRandomItemsRestricted.

const PolicyService = game.GetService("PolicyService");
const Players = game.GetService("Players");

// userId -> ArePaidRandomItemsRestricted. Only successful lookups are cached;
// a failed lookup is retried on the next query.
const restrictedCache = new Map<number, boolean>();

function fetchRestricted(player: Player): boolean | undefined {
	const [success, result] = pcall(() => PolicyService.GetPolicyInfoForPlayerAsync(player));
	if (success) {
		const restricted = result.ArePaidRandomItemsRestricted;
		restrictedCache.set(player.UserId, restricted);
		return restricted;
	}
	warn("GetPolicyInfoForPlayerAsync failed for", player.Name, result);
	return undefined;
}

// Prefetch on join so later queries answer from cache without yielding.
Players.PlayerAdded.Connect((player) => task.spawn(fetchRestricted, player));
for (const player of Players.GetPlayers()) {
	task.spawn(fetchRestricted, player);
}
Players.PlayerRemoving.Connect((player) => restrictedCache.delete(player.UserId));

const paidRandomItemsPolicy = {
	/** Whether paid random items (lootboxes) are restricted for this player's
	 * country. Yields on cache miss; fails closed (restricted) if the policy
	 * lookup errors, since granting is the non-compliant direction. */
	isRestricted: (player: Player): boolean => {
		const cached = restrictedCache.get(player.UserId);
		if (cached !== undefined) {
			return cached;
		}
		const fetched = fetchRestricted(player);
		return fetched === undefined ? true : fetched;
	},

	/** Modal popup telling the player lootboxes are unavailable in their
	 * country. Server-built and server-connected, like the rest of the UI. */
	showRestrictedPopup: (player: Player) => {
		const playerGui = player.FindFirstChildOfClass("PlayerGui");
		if (!playerGui) {
			return;
		}

		playerGui.FindFirstChild("LootboxRestrictedPopup")?.Destroy();

		const screenGui = new Instance("ScreenGui");
		screenGui.Name = "LootboxRestrictedPopup";
		screenGui.DisplayOrder = 100;
		screenGui.ResetOnSpawn = false;
		screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling;

		const frame = new Instance("Frame");
		frame.AnchorPoint = new Vector2(0.5, 0.5);
		frame.Position = new UDim2(0.5, 0, 0.5, 0);
		frame.Size = new UDim2(0.35, 0, 0.25, 0);
		frame.BackgroundColor3 = Color3.fromRGB(30, 30, 30);
		frame.Parent = screenGui;

		const corner = new Instance("UICorner");
		corner.CornerRadius = new UDim(0.05, 0);
		corner.Parent = frame;

		const stroke = new Instance("UIStroke");
		stroke.Color = Color3.fromRGB(255, 179, 0);
		stroke.Thickness = 3;
		stroke.Parent = frame;

		const title = new Instance("TextLabel");
		title.BackgroundTransparency = 1;
		title.Position = new UDim2(0.05, 0, 0.05, 0);
		title.Size = new UDim2(0.9, 0, 0.2, 0);
		title.FontFace = new Font("rbxasset://fonts/families/FredokaOne.json");
		title.Text = "NOT AVAILABLE";
		title.TextColor3 = Color3.fromRGB(255, 179, 0);
		title.TextScaled = true;
		title.Parent = frame;

		const message = new Instance("TextLabel");
		message.BackgroundTransparency = 1;
		message.Position = new UDim2(0.05, 0, 0.3, 0);
		message.Size = new UDim2(0.9, 0, 0.35, 0);
		message.FontFace = new Font("rbxasset://fonts/families/FredokaOne.json");
		message.Text = "Sorry, your country does not allow lootboxes.";
		message.TextColor3 = new Color3(1, 1, 1);
		message.TextScaled = true;
		message.TextWrapped = true;
		message.Parent = frame;

		const okButton = new Instance("TextButton");
		okButton.AnchorPoint = new Vector2(0.5, 1);
		okButton.Position = new UDim2(0.5, 0, 0.92, 0);
		okButton.Size = new UDim2(0.3, 0, 0.2, 0);
		okButton.BackgroundColor3 = Color3.fromRGB(255, 179, 0);
		okButton.FontFace = new Font("rbxasset://fonts/families/FredokaOne.json");
		okButton.Text = "OK";
		okButton.TextColor3 = Color3.fromRGB(30, 30, 30);
		okButton.TextScaled = true;
		okButton.Parent = frame;

		const okCorner = new Instance("UICorner");
		okCorner.CornerRadius = new UDim(0.2, 0);
		okCorner.Parent = okButton;

		okButton.MouseButton1Click.Connect(() => screenGui.Destroy());

		screenGui.Parent = playerGui;
	},
};

export = paidRandomItemsPolicy;
