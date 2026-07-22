import type { Pitch } from "./PitchManager";

/**
 * Neutral waiting arena. It deliberately contains no competitive side map,
 * score, result or opponent concept. Red/Blue authored spawn folders are
 * treated only as neutral physical spawn sources.
 */
export default class MuckaboutRuntime {
	readonly pitch: Pitch;
	private teamId?: string;
	private readonly slotByPlayer = new Map<Player, number>();

	constructor(pitch: Pitch) {
		this.pitch = pitch;
		pitch.folder.SetAttribute("FB_Phase", "FreePlay");
		pitch.folder.SetAttribute("FB_BlueScore", undefined);
		pitch.folder.SetAttribute("FB_RedScore", undefined);
		pitch.folder.SetAttribute("FB_BlueName", "");
		pitch.folder.SetAttribute("FB_RedName", "");
		pitch.folder.SetAttribute("FB_Announce", "FREE PLAY — WAITING FOR AN OPPONENT");
	}

	getTeamId(): string | undefined {
		return this.teamId;
	}

	assignTeam(teamId: string): boolean {
		if (this.teamId !== undefined && this.teamId !== teamId) return false;
		this.teamId = teamId;
		return true;
	}

	clearTeam(teamId: string) {
		if (this.teamId === teamId) this.teamId = undefined;
	}

	addPlayer(player: Player): number {
		const existing = this.slotByPlayer.get(player);
		if (existing !== undefined) return existing;
		const used = new Set<number>();
		for (const [, slot] of this.slotByPlayer) used.add(slot);
		let slot = 0;
		while (used.has(slot)) slot += 1;
		this.slotByPlayer.set(player, slot);
		player.SetAttribute("CB_Side", undefined);
		player.SetAttribute("CB_ArenaKind", "Muckabout");
		player.SetAttribute("CB_MatchId", undefined);
		player.SetAttribute("CB_PitchId", this.pitch.folder.Name);
		return slot;
	}

	removePlayer(player: Player) {
		this.slotByPlayer.delete(player);
	}

	hasPlayer(player: Player): boolean {
		return this.slotByPlayer.has(player);
	}

	getPlayers(): Player[] {
		const out: Player[] = [];
		for (const [player] of this.slotByPlayer) out.push(player);
		return out;
	}

	isEmpty(): boolean {
		return this.slotByPlayer.size() === 0;
	}

	private spawnParts(): BasePart[] {
		const root = this.pitch.folder.FindFirstChild("SpawnPoints") ?? this.pitch.folder;
		const parts: BasePart[] = [];
		for (const descendant of root.GetDescendants()) {
			if (descendant.IsA("BasePart")) parts.push(descendant);
		}
		parts.sort((a, b) => a.GetFullName() < b.GetFullName());
		return parts;
	}

	spawnCFrameFor(player: Player): CFrame | undefined {
		const parts = this.spawnParts();
		if (parts.size() === 0) return undefined;
		const slot = this.addPlayer(player);
		const part = parts[slot % parts.size()];
		const ball = this.pitch.folder.FindFirstChild("Ball", true);
		const target = ball && ball.IsA("BasePart") ? ball.Position : this.pitch.folder.FindFirstChild("BallSpawn", true);
		if (typeIs(target, "Vector3")) return CFrame.lookAt(part.Position, new Vector3(target.X, part.Position.Y, target.Z));
		if (target && target.IsA("BasePart")) return CFrame.lookAt(part.Position, new Vector3(target.Position.X, part.Position.Y, target.Position.Z));
		return part.CFrame;
	}
}
