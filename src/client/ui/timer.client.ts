// Client-owned TimerGui renderer (client-side UI migration, Phase 2).
//
// The server no longer touches TimerGui instances — it publishes state via
// src/server/ui/UiState.ts and this script derives the label text locally
// each ~0.25s. Sources, in priority order:
//
//   (a) "You can drive in N" — CB_LockUntil player attribute, a
//       GetServerTimeNow-anchored deadline written by footballMatch's TIMED
//       lockPlayer (kickoff/respawn locks). Hidden once the deadline passes
//       (the untimed lock never writes it — it showed no text before either).
//   (b) "NEXT ROUND STARTING…" — CB_InterludeHold player attribute, set by
//       initializePlayer.spawnIntoMatch while a PLAY press waits out the
//       round-end interlude for the rebuilt round.
//   (c) "NEXT ROUND Ns" — CB_ShopPhase / CB_ShopEndsAt ReplicatedStorage
//       attributes written by MatchDirector.startShopPhase. Mirrors the old
//       server loop's audience rules: players already spawned into the match
//       (CB_PitchId set — they drive, leave their HUD alone) and menu-flow
//       players (Landing / CreateTeam enabled, unless CB_PendingLaunch) are
//       exempt.
//
// TimerGui itself is mounted by src/client/ui/bootstrap.client.ts;
// Enabled=true only while there is text to show.

const Players = game.GetService("Players");
const ReplicatedStorage = game.GetService("ReplicatedStorage");
const RunService = game.GetService("RunService");
const Workspace = game.GetService("Workspace");

const LocalPlayer = Players.LocalPlayer;
const playerGui = LocalPlayer.WaitForChild("PlayerGui") as Instance;

const UPDATE_INTERVAL = 0.25;

/** Client mirror of MatchDirector.isInMenuFlow: landing page / Friends Team
 * mini lobby players sit outside the play loop, so the shop countdown must
 * not show for them — UNLESS the lobby vote completed while no round was
 * spawnable (CB_PendingLaunch), in which case they ride the countdown. The
 * Landing/CreateTeam ScreenGuis are still server-mounted, but their Enabled
 * state replicates and can be read here fine. */
function isInMenuFlow(): boolean {
	if (LocalPlayer.GetAttribute("CB_PendingLaunch") === true) {
		return false;
	}
	for (const screenName of ["CreateTeam", "Landing"]) {
		const screen = playerGui.FindFirstChild(screenName);
		if (screen !== undefined && screen.IsA("ScreenGui") && screen.Enabled) {
			return true;
		}
	}
	return false;
}

function deriveText(): string | undefined {
	const now = Workspace.GetServerTimeNow();

	// (a) timed control lock (kickoff / respawn).
	const lockUntil = LocalPlayer.GetAttribute("CB_LockUntil");
	if (typeIs(lockUntil, "number")) {
		const remaining = lockUntil - now;
		if (remaining > 0) {
			return `You can drive in ${math.ceil(remaining)}`;
		}
	}

	// (b) waiting out the round-end interlude after pressing PLAY.
	if (LocalPlayer.GetAttribute("CB_InterludeHold") === true) {
		return "NEXT ROUND STARTING…";
	}

	// (c) between-rounds shop window countdown.
	if (ReplicatedStorage.GetAttribute("CB_ShopPhase") === true) {
		// Already spawned into the match (early landing-button spawns drive
		// during the shop) — the countdown never showed for them.
		if (LocalPlayer.GetAttribute("CB_PitchId") !== undefined) {
			return undefined;
		}
		if (isInMenuFlow()) {
			return undefined;
		}
		const endsAt = ReplicatedStorage.GetAttribute("CB_ShopEndsAt");
		if (typeIs(endsAt, "number")) {
			const remaining = math.ceil(endsAt - now);
			if (remaining >= 1) {
				return `NEXT ROUND ${remaining}S`;
			}
		}
	}

	return undefined;
}

let accumulated = 0;
RunService.Heartbeat.Connect((deltaTime) => {
	accumulated += deltaTime;
	if (accumulated < UPDATE_INTERVAL) {
		return;
	}
	accumulated = 0;

	const timerGui = playerGui.FindFirstChild("TimerGui");
	if (!timerGui || !timerGui.IsA("ScreenGui")) {
		return;
	}
	const text = deriveText();
	const label = timerGui.FindFirstChild("TextLabel");
	if (text !== undefined && label !== undefined && label.IsA("TextLabel")) {
		label.Text = text;
		timerGui.Enabled = true;
	} else {
		timerGui.Enabled = false;
	}
});
