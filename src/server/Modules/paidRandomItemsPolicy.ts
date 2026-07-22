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
		// Phase 5: the Garage is client-owned — publish the restriction as a
		// player attribute so the client blocks crate UI locally (modal in
		// src/client/ui/garage.client.ts replaces the old server-built popup).
		if (restricted) {
			pcall(() => player.SetAttribute("CB_LootboxRestricted", true));
		}
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

	// (The old showRestrictedPopup server-built modal is gone — the Garage is
	// client-owned since Phase 5, and garage.client.ts renders the restricted
	// modal locally from the CB_LootboxRestricted attribute published above.)
};

export = paidRandomItemsPolicy;
