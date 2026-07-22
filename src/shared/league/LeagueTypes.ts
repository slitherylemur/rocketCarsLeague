export type PlayerLifecycle =
	| "Menu"
	| "FriendsLobby"
	| "Intermission"
	| "Queued"
	| "Spawning"
	| "Muckabout"
	| "Competitive"
	| "Respawning"
	| "Transitioning"
	| "Leaving";

export type TeamLifecycle = "Forming" | "Queued" | "Muckabout" | "Reserved" | "Active" | "Intermission" | "Disbanded";
export type TeamOrigin = "Random" | "Friends";
export type TeamProtection = "Recombinable" | "Protected";
export type TeamNameSource = "Generated" | "Custom";
export type ArenaKind = "Muckabout" | "Competitive";
export type MatchSide = "Blue" | "Red";
export type RoundPhase = "Idle" | "Live" | "Intermission" | "Preparing" | "Ended";

export interface PlayerSnapshot {
	id: string;
	teamId?: string;
	lifecycle: PlayerLifecycle;
	connected: boolean;
	joinOrder: number;
	assignmentGeneration: number;
}

export interface TeamSnapshot {
	id: string;
	name: string;
	origin: TeamOrigin;
	protection: TeamProtection;
	nameSource: TeamNameSource;
	memberIds: string[];
	openToRandoms: boolean;
	position?: number;
	lifecycle: TeamLifecycle;
	revision: number;
	creationOrder: number;
	waitingSince: number;
}

export type TeamAssignmentSnapshot =
	| { teamId: string; kind: "Unassigned" }
	| { teamId: string; kind: "Muckabout"; arenaId: string }
	| { teamId: string; kind: "Match"; matchId: string; pitchId: string; side: MatchSide };

export type MatchPhase = "Reserved" | "FaceOff" | "Kickoff" | "Playing" | "Goal" | "Ended" | "Voided";

export interface MatchSnapshot {
	id: string;
	generation: number;
	pitchId: string;
	blueTeamId: string;
	redTeamId: string;
	phase: MatchPhase;
	startedAtRoundTime: number;
	score: { blue: number; red: number };
}

export type ReconcileReason =
	| "ServerBoot"
	| "RandomPlay"
	| "FriendsReady"
	| "RoundPreparing"
	| "PlayerJoined"
	| "PlayerLeft"
	| "VoluntaryLeave"
	| "InviteAccepted"
	| "SpawnFailed"
	| "TeamDisbanded"
	| "TeamOpenChanged"
	| "TeamProtected"
	| "IdlePopulationChanged"
	| "LiveVacancy"
	| "MatchEnded";

export interface ReconcileInput {
	epoch: number;
	reason: ReconcileReason;
	roundPhase: RoundPhase;
	timeRemaining: number;
	teams: TeamSnapshot[];
	players: PlayerSnapshot[];
	assignments: TeamAssignmentSnapshot[];
	matches: MatchSnapshot[];
}

export type TeamMutation =
	| { kind: "CreateRandomTeam"; team: TeamSnapshot }
	| { kind: "UpdateTeam"; beforeId: string; team: TeamSnapshot }
	| { kind: "DisbandTeam"; teamId: string }
	| { kind: "MovePlayer"; playerId: string; fromTeamId?: string; toTeamId: string };

export type MatchMutation =
	| { kind: "CreateMatch"; match: MatchSnapshot }
	| { kind: "VoidMatch"; matchId: string }
	| { kind: "KeepMatch"; matchId: string };

export type AssignmentMutation =
	| { kind: "AssignMuckabout"; teamId: string; arenaId: string }
	| { kind: "AssignMatch"; teamId: string; matchId: string; pitchId: string; side: MatchSide }
	| { kind: "Unassign"; teamId: string };

export type PlayerMove = {
	playerId: string;
	fromArenaId?: string;
	toArenaId: string;
	arenaKind: ArenaKind;
	matchId?: string;
	side?: MatchSide;
};

export type PitchOperation =
	| { kind: "PrepareCompetitive"; pitchId: string; matchId: string }
	| { kind: "PrepareMuckabout"; arenaId: string }
	| { kind: "Destroy"; arenaId: string };

export interface ReconcileDiagnostic {
	code: string;
	detail: string;
}

export interface ReconcilePlan {
	sourceEpoch: number;
	teams: TeamSnapshot[];
	teamMutations: TeamMutation[];
	matchMutations: MatchMutation[];
	assignmentMutations: AssignmentMutation[];
	playerMoves: PlayerMove[];
	pitchOperations: PitchOperation[];
	resultsToVoid: string[];
	diagnostics: ReconcileDiagnostic[];
}

export interface LadderResultSnapshot {
	teamId: string;
	startPosition: number;
	outcome: "Win" | "Loss" | "Draw" | "Muck" | "Idle";
}

export interface LadderPositionMutation {
	teamId: string;
	fromPosition: number;
	toPosition: number;
}
