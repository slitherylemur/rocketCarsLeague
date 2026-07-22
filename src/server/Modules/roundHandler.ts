// Original: ServerStorage/Modules/roundHandler (ModuleScript)

import DataUtilities from "./DataUtilities";
import DataStore2 from "./DataStore2";
import spawnVehicle from "./spawnVehicle";
import ballSpawner from "./ballSpawner";
import footballMatch from "./footballMatch";
import { PassIds } from "shared/Monetization";
import type { RoundResult } from "./footballMatch";
import PitchManager from "./PitchManager";
import TeamRegistry from "./TeamRegistry";
import MatchDirector from "./MatchDirector";
import type { MovementReport } from "./MatchDirector";
import requireModule from "shared/requireModule";
import { Globals } from "../Globals";
import { FunctionsAndEvents } from "shared/FunctionsAndEvents";
import { StarterGuiState } from "../ui/StarterGuiState";
import LadderMapScreen from "../ui/LadderMapScreen";
import type { VehicleSubClassModule } from "../Classes/VehicleSubClass/subClassTypes";

const ReplicatedStorage = game.GetService("ReplicatedStorage");
const PlayerService = game.GetService("Players");
const MarketplaceService = game.GetService("MarketplaceService");
const ServerStorage = game.GetService("ServerStorage");

// ---- instance shapes used below ----
type PlayerWithStats = Player & {
	kills: NumberValue;
	deaths: NumberValue;
	damageDealt: NumberValue;
	survivalTime: NumberValue;
	spawned: NumberValue;
};

interface MapModel extends Model {
	SpawnPoints: Folder;
}

interface VictoryStageModel extends Model {
	floor: BasePart & { WinningTeam: SurfaceGui & { TextLabel: TextLabel } };
	Cars: Folder;
	Podium: Folder;
	Emitters: Instance;
	Camera: BasePart;
}

interface PodiumUi extends Frame {
	ImageLabel: ImageLabel;
	Frame: Frame & { name: TextLabel; Knockouts: TextLabel };
}

type TeamWithKills = Team & { Kills: NumberValue };

interface GameGuiShape extends ScreenGui {
	Information: Frame & { Gamemode: TextLabel; Clock: TextLabel };
	TeamScore: Frame & { Red: TextLabel; Blue: TextLabel };
	Spectate: Frame & { Information: Frame & { Respawn: TextButton } };
	ResultScreen: Frame & {
		PlayerBanner: Frame & {
			playerIcon: ImageLabel;
			username: TextLabel;
			kills: TextLabel;
			deaths: TextLabel;
			money: TextLabel;
		};
	};
}

const handler = {} as {
	startRound: () => void;
	endRound: () => void;
};


Globals.gamemode = "FFA";
Globals.roundTime = 0;
Globals.FFA_GAME_TIME = 4 * 60 + 30;
Globals.TDM_GAME_TIME = 4 * 60 + 30;
Globals.FFA_MAX_KILLS = 20;
Globals.TDM_MAX_KILLS = 40;
//_G.LMS_SPAWN_TIME = 60
let gameRunning = false;
/** Bumped to cancel any in-flight round timer loop (prevents stacked endRound calls). */
let roundTimerGeneration = 0;

const END_SCREEN_DURATION = 7;

Globals.BASE_MONEY = 300;
Globals.KILL_MONEY = 75;
Globals.DAMAGE_MONEY_MULT = 0.2;
const FIRST_PLACE_MONEY = 1000;
const SECOND_PLACE_MONEY = 400;
const THIRD_PLACE_MONEY = 200;

// Phase 5 sessions: champion payout per gold-table member + an explicit
// session-end shop duration (regular rounds use the same one-minute duration).
const CHAMPION_MONEY = 1500;
const SESSION_END_SHOP_TIME = 60;

const lastKiller = new Map<Player, Player>();
Globals.killstreak = new Map<Player, number>();
let moneyAwarded = new Map<Player, number>();

//A game is 1000 on average
//In an hour u make 10k on average
//Crate prices: 3500, 6250, 10000, 60R$
// base: 25 per R$
// then: 25, 25, 2, 28, 30
//Money prices: 80R$ for 2000, 250R$ for 6250, 600R$ for 16k (+1000), 2000R$ for 55k (+5000), 10000R$ for 280k (+30k)
//Mult prices: 180R$, 180R$, 800R$, __960R$__ 750R$
Globals.VIP_PASS_ID = PassIds.Vip;
const VIP_MULTIPLIER = 1.3;

Globals.calculateMultMoney = (player: Player, amount: number): number => {
	let hasVip = false;

	const [success, message] = pcall(() => {
		hasVip = MarketplaceService.UserOwnsGamePassAsync(
			player.UserId as unknown as never,
			Globals.VIP_PASS_ID,
		);
	});

	if (hasVip) {
		amount = amount * VIP_MULTIPLIER;
	}

	return math.round(amount);
};

function incrementPlayerMoney(player: Player, amount: number) {
	const playerMoneyDS = DataStore2("money", player);

	const calcAmount = Globals.calculateMultMoney(player, amount);

	if (moneyAwarded.get(player) !== undefined) {
		moneyAwarded.set(player, moneyAwarded.get(player)! + calcAmount);
	} else {
		moneyAwarded.set(player, calcAmount);
	}

	playerMoneyDS.Increment(calcAmount, 0);
}

function gamemodeName(mode: string): string | undefined {
	if (mode === "FFA") {
		return "Free For All";
	} else if (mode === "TDM") {
		return "Team Deathmatch";
	} else if (mode === "Football") {
		return "Football";
	}
	return undefined;
}

function gamemodeStat(mode: string): string | undefined {
	if (mode === "FFA") {
		return "Kills";
	} else if (mode === "TDM") {
		return "Kills";
	} else if (mode === "Football") {
		return "Goals";
	}
	return undefined;
}

handler.startRound = () => {
	// Invalidate any previous timer before starting a new round.
	roundTimerGeneration += 1;
	gameRunning = false;

	// Football (Rocket-League style) is now the only rotation entry; the
	// FFA/TDM machinery below is kept intact for a future mode selector.
	Globals.gamemode = "Football";

	// Football: player.Team is the LADDER team (TeamRegistry) and survives
	// across rounds — unassigning belongs to the deathmatch modes only.
	if (Globals.gamemode !== "Football") {
		unassignTeams();
	}

	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			const p = player as PlayerWithStats;
			(p.WaitForChild("kills") as NumberValue).Value = 0;
			(p.WaitForChild("deaths") as NumberValue).Value = 0;
			(p.WaitForChild("damageDealt") as NumberValue).Value = 0;
			(p.WaitForChild("survivalTime") as NumberValue).Value = -1;
			(p.WaitForChild("spawned") as NumberValue).Value = 0;
			((player as unknown as { PlayerGui: Instance }).PlayerGui.WaitForChild("Game") as GameGuiShape).Information.Gamemode.Text =
				gamemodeName(Globals.gamemode)!;
		});
	}

	// Original: game.StarterGui.Game.Information.Gamemode.Text = ... (template
	// mutation so future clones inherit it) — template state module instead.
	StarterGuiState.Game.Information.GamemodeText = gamemodeName(Globals.gamemode)!;
	const pitches = loadMap();
	if (pitches.size() === 0) {
		// ServerStorage.Maps is empty (see loadMap warn) — retry until maps
		// exist rather than crashing the round system.
		task.delay(10, () => handler.startRound());
		return;
	}

	moneyAwarded = new Map();

	if (Globals.gamemode === "FFA") {
		startFFA();
	}

	if (Globals.gamemode === "TDM") {
		startTDM();
	}

	if (Globals.gamemode === "Football") {
		startFootball(pitches);
	}
};

handler.endRound = () => {
	stopRoundTimer();
	if (Globals.gamemode === "Football") {
		// EVERY interlude step is pcall-guarded with its own warn: a broken
		// screen must never stop the round loop — startRound + startShopPhase +
		// sendToMenu MUST always run or the whole server wedges in the menu.
		// Ladder movement first — winners up, losers down, draws coin-flipped
		// — so startRound() pairs the NEW table order onto the rebuilt pitches.
		warn("[Round] ladder movement");
		let movement: MovementReport | undefined;
		let results: RoundResult[] | undefined;
		const [moveOk, moveErr] = pcall(() => {
			results = footballMatch.getRoundResults();
			movement = MatchDirector.applyMovement(results);
		});
		if (!moveOk) {
			warn(`[Round] ladder movement FAILED: ${moveErr}`);
		}
		// Trophies AFTER movement (coin-flipped draws are already resolved to
		// wins in `results`) and BEFORE the summary so it shows fresh gains.
		// isSessionEnd() is already true here on the final round — its winner
		// is the champions round winner and banks the doubled trophies.
		if (results !== undefined) {
			warn("[Round] trophy awards");
			const roundResults = results;
			const [trophyOk, trophyErr] = pcall(() =>
				footballMatch.awardRoundTrophies(roundResults, MatchDirector.isSessionEnd()),
			);
			if (!trophyOk) {
				warn(`[Round] trophy awards FAILED: ${trophyErr}`);
			}
		}
		// Winners posed on the lineup, camera on the goal shot, winner text /
		// coin-flip presentation on drawn pitches (~8 s), then the full-screen
		// stats summary (~6 s), then the ladder map
		// (3D rise off the pitch into the animated table, ~11 s). The legacy
		// podium/EndScreen is NOT used for football.
		warn("[Round] victory scene");
		const [sceneOk, sceneErr] = pcall(() =>
			footballMatch.playVictoryScene(movement !== undefined ? movement.flipWinners : undefined),
		);
		if (!sceneOk) {
			warn(`[Round] victory scene FAILED: ${sceneErr}`);
		}
		warn("[Round] round summary");
		const [summaryOk, summaryErr] = pcall(() => footballMatch.showRoundSummary());
		if (!summaryOk) {
			warn(`[Round] round summary FAILED: ${summaryErr}`);
		}
		// Ladder map LAST (victory -> summary -> ladder): runs BEFORE stop()
		// so CB_PitchId is still set and the 3D camera rise can start over the
		// viewer's own pitch.
		warn("[Round] ladder map");
		if (movement !== undefined) {
			const entries = movement.entries;
			const [mapOk, mapErr] = pcall(() => LadderMapScreen.showLadderMap(entries));
			if (!mapOk) {
				warn(`[Round] ladder map FAILED: ${mapErr}`);
			}
		}
		// Session end (Phase 5, after round SESSION_ROUNDS): champions screen +
		// payout, then shuffle/reset — BEFORE startRound so the new (shuffled)
		// table order pairs onto the rebuilt pitches.
		const sessionEnd = MatchDirector.isSessionEnd();
		if (sessionEnd) {
			warn("[Round] session end — champions screen");
			const [championsOk, championsErr] = pcall(() => runSessionEnd());
			if (!championsOk) {
				warn(`[Round] champions screen FAILED: ${championsErr}`);
			}
		}
		const [stopOk, stopErr] = pcall(() => footballMatch.stop());
		if (!stopOk) {
			warn(`[Round] football stop FAILED: ${stopErr}`);
		}
		warn("[Round] building next round");
		const [startOk, startErr] = pcall(() => handler.startRound());
		if (!startOk) {
			warn(`[Round] startRound FAILED: ${startErr}`);
		}
		// Shop phase flag BEFORE the menu remount so players land on the CARS
		// page with the restart countdown, not the landing page.
		warn(`[Round] shop phase (${SESSION_END_SHOP_TIME}s)`);
		MatchDirector.startShopPhase(sessionEnd ? SESSION_END_SHOP_TIME : undefined);
		sendToMenu();
		return;
	}
	footballMatch.stop();
	EndScreen();

	handler.startRound();
	sendToMenu();
};

/** Phase 5 session end: award the gold-table (position 0) team, show the
 * full-screen CHAMPIONS screen (~8 s), then shuffle + reset via the
 * MatchDirector. Runs BEFORE startRound rebuilds the pitches. */
function runSessionEnd() {
	const champion = TeamRegistry.getTeams()[0];
	if (champion !== undefined && champion.position === 0) {
		// Same payout pipeline as footballMatch.awardRoundMoney.
		for (const member of champion.members) {
			pcall(() => {
				const amount = Globals.calculateMultMoney(member, CHAMPION_MONEY);
				DataStore2("money", member).Increment(amount, 0);
			});
		}
		LadderMapScreen.showChampions(
			champion.name,
			champion.members.map((member) => member.Name),
			CHAMPION_MONEY,
		);
	}
	MatchDirector.endSession();
}

// function updateTimes()
// 	for i, player in pairs(PlayerService:GetPlayers()) do
// 		pcall(function()
// 			if player:WaitForChild("survivalTime").Value == -1 then
// 				player:WaitForChild("survivalTime").Value = _G.LMS_GAME_TIME - _G.roundTime
// 			end
// 		end)
//
// 	end
// end

function loadMap(): import("./PitchManager").Pitch[] {
	// PitchManager owns cloning + placement (Phase 3b): pitch count follows
	// the live team count (min 1 so the first joiners have somewhere to go);
	// odd team counts get the muckabout pitch. SpawnPoints stay INSIDE each
	// pitch folder now — PitchMatch reads its own.
	const teamCount = TeamRegistry.getTeams().size();
	const realPitches = math.max(1, math.floor(teamCount / 2));
	const withMuckabout = teamCount > 1 && teamCount % 2 === 1;
	// 0–1 teams: the single pitch can only host free play — use FreePlayPitch,
	// not gold. (If a second team pairs onto it mid-round the match still runs
	// there; the next round rebuild brings gold back.)
	const built = PitchManager.buildPitches(realPitches, withMuckabout, teamCount <= 1);
	if (built.size() === 0) {
		warn(
			"[loadMap] no pitch could be built — ServerStorage.Maps needs the pitch variant folders " +
				"(GoldPitch/GreenPitch/MudPitch/FreePlayPitch: map parts + SpawnPoints/Red|Blue + Blue/Red goal parts). No map loaded.",
		);
		return [];
	}
	// Balls raycast against their pitch for the floor, so spawn after parenting.
	for (const pitch of built) {
		ballSpawner.SpawnBall(pitch.folder);
	}
	return built;
}

/** Landing page, Friends Team lobby, or the garage reached FROM the landing
 * page — players outside the play loop. The round-end menu remount must skip
 * them: destroying a mid-vote lobby dumped its members onto the shop page,
 * where the auto-spawn would launch the team without a completed vote. */
function isInMenus(player: Player): boolean {
	const playerGui = player.FindFirstChild("PlayerGui");
	if (!playerGui) {
		return false;
	}
	for (const screenName of ["Landing", "CreateTeam", "Garage"]) {
		const screen = playerGui.FindFirstChild(screenName);
		if (screen !== undefined && screen.IsA("ScreenGui") && screen.Enabled) {
			return true;
		}
	}
	return false;
}

function sendToMenu() {
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			if (isInMenus(player)) {
				return;
			}
			(
				ServerStorage as unknown as { Events: { InitialisePlayerMenuUi: BindableEvent } }
			).Events.InitialisePlayerMenuUi.Fire(player);
		});
	}
}

function EndScreen() {
	killAllVehicles();
	disablePlayerUi();
	const winnerTable = getWinnerDetails();
	const rewardsTable = giveRewards(winnerTable);
	setupVictoryStage(winnerTable);
	showPlayerBanner(rewardsTable);
	FunctionsAndEvents.ToggleMenuCamera.FireAllClients(false);
	FunctionsAndEvents.EndScreen.FireAllClients(); //focus player camera's on stage
	fireEmitters();
	task.wait(END_SCREEN_DURATION);
	clearVictoryStage();
}

function giveRewards(winnerTable: Player[]): Map<Player, number> {
	let rewardMoney = 0;
	const rewardsTable = new Map<Player, number>();
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			if (player === winnerTable[0]) {
				rewardMoney = Globals.BASE_MONEY + FIRST_PLACE_MONEY;
			} else if (player === winnerTable[1]) {
				rewardMoney = Globals.BASE_MONEY + SECOND_PLACE_MONEY;
			} else if (player === winnerTable[2]) {
				rewardMoney = Globals.BASE_MONEY + THIRD_PLACE_MONEY;
			} else if ((player as PlayerWithStats).kills.Value > 0) {
				rewardMoney = Globals.BASE_MONEY;
			}

			incrementPlayerMoney(player, rewardMoney);

			rewardsTable.set(player, moneyAwarded.get(player)!);
		});
	}

	return rewardsTable;
}

function disablePlayerUi() {
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			const playerGui = (player as unknown as { PlayerGui: Instance }).PlayerGui;
			for (const v of playerGui.WaitForChild("Game").GetChildren()) {
				if ((v.IsA("Frame") || v.IsA("TextButton")) && v.Name !== "ResultScreen") {
					v.Visible = false;
				}
			}

			for (const v of playerGui.WaitForChild("Garage").GetChildren()) {
				if (v.IsA("Frame") || v.IsA("TextButton")) {
					v.Visible = false;
				}
			}
		});
	}
}

function setupVictoryStage(winnerTable: Player[]) {
	const VictoryStage = (game.Workspace as unknown as { VictoryStage: VictoryStageModel }).VictoryStage;
	VictoryStage.floor.WinningTeam.Enabled = false;

	for (let i = 1; i <= 3; i++) {
		pcall(() => {
			const winner = winnerTable[i - 1];
			const winnerVehicleName = DataUtilities.getPlayerEquippedVehicle(winner);

			//Add car to stage
			// Original: require(game.ServerStorage.Classes.VehicleSubClass:FindFirstChild(winnerVehicleName))
			const subClassFolder = (script.Parent!.Parent as unknown as { Classes: { VehicleSubClass: Folder } })
				.Classes.VehicleSubClass;
			const vehicleClass = requireModule(
				subClassFolder.FindFirstChild(winnerVehicleName) as ModuleScript,
			) as VehicleSubClassModule;
			const [carobject, model] = vehicleClass.new();
			model.SetPrimaryPartCFrame((VictoryStage.Cars.FindFirstChild(tostring(i)) as BasePart).CFrame);
			model.Parent = VictoryStage.Cars.FindFirstChild(tostring(i));

			// --Set humanoid
			// local character = VictoryStage.Players:FindFirstChild(i).Humanoid
			// local humanoidDescriptionForUser = game.Players:GetHumanoidDescriptionFromUserId(winner.UserId)
			// character:ApplyDescription(humanoidDescriptionForUser)

			//Fill ui
			const ui = (
				VictoryStage.Podium.FindFirstChild(tostring(i)) as BasePart & {
					BillboardGui: BillboardGui & { frame: PodiumUi };
				}
			).BillboardGui.frame;
			const icon = Globals.getPlayerIcon(winner);
			ui.ImageLabel.Image = icon;

			ui.Frame.name.Text = winner.Name;

			if (Globals.gamemode === "FFA") {
				ui.Frame.Knockouts.Text = "Kills: " + (winner.WaitForChild("kills") as NumberValue).Value;
			} else if (Globals.gamemode === "TDM") {
				ui.Frame.Knockouts.Text = "Kills: " + (winner.WaitForChild("kills") as NumberValue).Value;
			}
		});
	}

	if (Globals.gamemode === "Football") {
		const { Blue, Red } = footballMatch.getScores();
		if (Blue > Red) {
			VictoryStage.floor.WinningTeam.TextLabel.Text = `Blue wins ${Blue} - ${Red}!`;
			VictoryStage.floor.WinningTeam.TextLabel.TextColor3 = new Color3(0, 0, 1);
		} else if (Red > Blue) {
			VictoryStage.floor.WinningTeam.TextLabel.Text = `Red wins ${Red} - ${Blue}!`;
			VictoryStage.floor.WinningTeam.TextLabel.TextColor3 = new Color3(1, 0, 0);
		} else {
			VictoryStage.floor.WinningTeam.TextLabel.Text = `The game is a ${Blue} - ${Red} tie!`;
			VictoryStage.floor.WinningTeam.TextLabel.TextColor3 = new Color3(0, 1, 0);
		}
		VictoryStage.floor.WinningTeam.Enabled = true;
	}

	if (Globals.gamemode === "TDM") {
		const Teams = game.GetService("Teams") as unknown as { Red: TeamWithKills; Blue: TeamWithKills };
		const winningAmount = Teams.Red.Kills.Value - Teams.Blue.Kills.Value;
		if (winningAmount > 0) {
			VictoryStage.floor.WinningTeam.TextLabel.Text = "Red wins by " + math.abs(winningAmount) + " kills !";
			VictoryStage.floor.WinningTeam.TextLabel.TextColor3 = new Color3(1, 0, 0);
			VictoryStage.floor.WinningTeam.Enabled = true;
		} else if (winningAmount < 0) {
			VictoryStage.floor.WinningTeam.TextLabel.Text = "Blue wins by " + math.abs(winningAmount) + " kills !";
			VictoryStage.floor.WinningTeam.TextLabel.TextColor3 = new Color3(0, 0, 1);
			VictoryStage.floor.WinningTeam.Enabled = true;
		} else {
			VictoryStage.floor.WinningTeam.TextLabel.Text = "The game is a tie!";
			VictoryStage.floor.WinningTeam.TextLabel.TextColor3 = new Color3(0, 1, 0);
			VictoryStage.floor.WinningTeam.Enabled = true;
		}
	}
}

function fireEmitters() {
	const VictoryStage = (game.Workspace as unknown as { VictoryStage: VictoryStageModel }).VictoryStage;

	for (const emitter of VictoryStage.Emitters.GetDescendants()) {
		if (emitter.IsA("ParticleEmitter")) {
			emitter.Enabled = true;

			task.delay(0.3, () => {
				emitter.Enabled = false;
			});
		}
	}
}

function showPlayerBanner(rewardsTable: Map<Player, number>) {
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			const resultScreen = (player as unknown as { PlayerGui: Instance }).PlayerGui.WaitForChild(
				"Game",
			).FindFirstChild("ResultScreen") as GameGuiShape["ResultScreen"];
			resultScreen.Visible = true;

			const ui = resultScreen.WaitForChild("PlayerBanner") as GameGuiShape["ResultScreen"]["PlayerBanner"];

			const icon = Globals.getPlayerIcon(player);
			ui.playerIcon.Image = icon;

			ui.username.Text = player.Name;
			ui.kills.Text = "Kills: " + (player.WaitForChild("kills") as NumberValue).Value;
			ui.deaths.Text = "Deaths: " + (player.WaitForChild("deaths") as NumberValue).Value;
			ui.money.Text = "+" + math.round(rewardsTable.get(player)!) + " $";
		});
	}
}

// function populatePlayerList(winnerTable)
// 	if #winnerTable < 4 then
// 		return
// 	end
//
// 	for i, player in pairs(PlayerService:GetPlayers()) do
// 		pcall(function()
// 			for i=4, #winnerTable do
// 				local winner = winnerTable[i]
//
// 				local scrollFrame = player.PlayerGui:WaitForChild("Game").ResultScreen.List.Names
// 				local winnerEntry = ReplicatedStorage.Ui.playerEntry:Clone()
// 				winnerEntry.name.Text = i .. ". " .. winner.Name
//
// 				if _G.gamemode == "FFA" then
// 					winnerEntry.Knockouts.Text = winner:WaitForChild("kills").Value
// 				elseif _G.gamemode == "LMS" then
// 					winnerEntry.Knockouts.Text = winner:WaitForChild("survivalTime").Value
// 				end
//
// 				winnerEntry.Parent = scrollFrame
// 				winnerEntry.LayoutOrder = i
// 			end
// 			player.PlayerGui.Game.ResultScreen.List.Tabs.Knockouts.Text = gamemodeStat(_G.gamemode)
// 			player.PlayerGui.Game.ResultScreen.Visible = true
// 		end)
//
// 	end
//
// end

function clearVictoryStage() {
	const VictoryStage = (game.Workspace as unknown as { VictoryStage: VictoryStageModel }).VictoryStage;
	for (let i = 1; i <= 3; i++) {
		//clear cars
		VictoryStage.Cars.FindFirstChild(tostring(i))!.ClearAllChildren();

		//clear ui
		const ui = (
			VictoryStage.Podium.FindFirstChild(tostring(i)) as BasePart & {
				BillboardGui: BillboardGui & { frame: PodiumUi };
			}
		).BillboardGui.frame;
		ui.ImageLabel.Image = "";
		ui.Frame.name.Text = "";
		ui.Frame.Knockouts.Text = "";
	}

	//clear and hide leaderboard
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			const playerGui = (player as unknown as { PlayerGui: Instance }).PlayerGui;
			if (playerGui.WaitForChild("Game")) {
				(playerGui as unknown as { Game: GameGuiShape }).Game.ResultScreen.Visible = false;
			}
		});
	}
}

function killAllVehicles() {
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			if (player.Character) {
				(player.Character as unknown as { Humanoid: Humanoid }).Humanoid.Health = 0;
			}

			spawnVehicle.KillVehicle(player);
		});
	}
}

Globals.getPlayerIcon = (player: Player): string => {
	const userId = player.UserId;
	const thumbType = Enum.ThumbnailType.HeadShot;
	const thumbSize = Enum.ThumbnailSize.Size420x420;
	const [content, isReady] = PlayerService.GetUserThumbnailAsync(userId, thumbType, thumbSize);

	return content;
};

function getWinnerDetails(): Player[] {
	const ordered: Player[] = [];
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			ordered.push(player);
		});
	}

	if (Globals.gamemode === "FFA" || Globals.gamemode === "TDM") {
		ordered.sort((a, b) => (a as PlayerWithStats).kills.Value > (b as PlayerWithStats).kills.Value);
	}

	return ordered;
}

function startFFA() {
	// Original: game.StarterGui.Game.TeamScore.Visible = false (template mutation)
	StarterGuiState.Game.TeamScore.Visible = false;
	startRoundTimer(Globals.FFA_GAME_TIME);
}

function startTDM() {
	const Teams = game.GetService("Teams") as unknown as { Red: TeamWithKills; Blue: TeamWithKills };
	Teams.Red.Kills.Value = 0;
	Teams.Blue.Kills.Value = 0;
	assignTeams();
	turnOnTeamUi();
	startRoundTimer(Globals.TDM_GAME_TIME);
}

function startFootball(pitches: import("./PitchManager").Pitch[]) {
	const Teams = game.GetService("Teams") as unknown as { Red: TeamWithKills; Blue: TeamWithKills };
	Teams.Red.Kills.Value = 0;
	Teams.Blue.Kills.Value = 0;
	// MatchHud replaces the deathmatch chrome: the kill-count TeamScore, the
	// kill-icon Leaderboard row and the old Information clock all stay hidden
	// on every fresh mount. Teams are assigned per player as they spawn in
	// (footballMatch.getSpawnCFrame), not up front.
	StarterGuiState.Game.TeamScore.Visible = false;
	StarterGuiState.Game.Information.Visible = false;
	StarterGuiState.Game.Leaderboard.Visible = false;
	// No startRoundTimer: the football layer runs the shared round clock and
	// calls endRound itself when it expires.
	footballMatch.beginRound(pitches, () => {
		handler.endRound();
	});
}

function turnOnTeamUi() {
	const Teams = game.GetService("Teams") as unknown as { Red: TeamWithKills; Blue: TeamWithKills };
	// Original wrote the StarterGui TEMPLATE texts (future clones); live per-player
	// UIs update client-side (gameUi.client.ts listens to the same Changed events).
	StarterGuiState.Game.TeamScore.RedText = "Red: " + 0;
	StarterGuiState.Game.TeamScore.BlueText = "Blue: " + 0;

	Teams.Red.Kills.Changed.Connect((val) => {
		pcall(() => {
			StarterGuiState.Game.TeamScore.RedText = "Red: " + val;
		});
	});

	Teams.Blue.Kills.Changed.Connect((val) => {
		pcall(() => {
			StarterGuiState.Game.TeamScore.BlueText = "Blue: " + val;
		});
	});

	StarterGuiState.Game.TeamScore.Visible = true;
}

function assignTeams() {
	const Teams = game.GetService("Teams") as unknown as { Red: TeamWithKills; Blue: TeamWithKills };
	Teams.Red.AutoAssignable = true;
	Teams.Blue.AutoAssignable = true;
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			const rand = math.random();
			if (rand < 0.5) {
				player.Team = Teams.Red;
			} else {
				player.Team = Teams.Blue;
			}
			player.Neutral = false;
		});
	}
}

function unassignTeams() {
	const Teams = game.GetService("Teams") as unknown as { Red: TeamWithKills; Blue: TeamWithKills };
	Teams.Red.AutoAssignable = false;
	Teams.Blue.AutoAssignable = false;
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			player.Team = undefined!;
			player.Neutral = true;
		});
	}
}

function enableRespawn() {
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			(
				(player as unknown as { PlayerGui: Instance }).PlayerGui.WaitForChild("Game") as GameGuiShape
			).Spectate.Information.Respawn.Visible = true;
		});
	}
}

function disableRespawn() {
	for (const player of PlayerService.GetPlayers()) {
		pcall(() => {
			(
				(player as unknown as { PlayerGui: Instance }).PlayerGui.WaitForChild("Game") as GameGuiShape
			).Spectate.Information.Respawn.Visible = false;
		});
	}
}

function startRoundTimer(gameTime: number) {
	const gen = ++roundTimerGeneration;
	gameRunning = true;
	Globals.roundTime = gameTime;
	toggleUiTimer();

	task.spawn(() => {
		while (Globals.roundTime > 0 && gen === roundTimerGeneration) {
			Globals.roundTime -= 1;

			if (Globals.roundTime === 0 && gen === roundTimerGeneration) {
				gameRunning = false;
				handler.endRound();
			}

			task.wait(1);
		}
	});
}

function stopRoundTimer() {
	roundTimerGeneration += 1;
	Globals.roundTime = -1;
	task.wait(1);
}

function toggleUiTimer() {
	FunctionsAndEvents.UiTimer.FireAllClients(gameRunning, Globals.roundTime);
}

PlayerService.PlayerAdded.Connect((player) => {
	FunctionsAndEvents.UiTimer.FireClient(player, gameRunning, Globals.roundTime);
});

(
	ServerStorage as unknown as { Events: { PlayerDamaged: BindableEvent } }
).Events.PlayerDamaged.Event.Connect((...args: unknown[]) => {
	const [player, attacker, damage, isDeath] = args as [Player, Player | undefined, number, boolean];
	if (attacker) {
		if (isDeath) {
			incrementPlayerMoney(attacker, Globals.KILL_MONEY);
			populateInfoUi(player, attacker);
		}

		incrementPlayerMoney(attacker, damage * Globals.DAMAGE_MONEY_MULT);

		if (Globals.gamemode === "FFA") {
			FFAUpdater(player, attacker, damage, isDeath);
		} else if (Globals.gamemode === "TDM") {
			TDMUpdater(player, attacker, damage, isDeath);
		} else if (Globals.gamemode === "Football") {
			FootballUpdater(player, attacker, damage, isDeath);
		}
	}
});

// Kills/deaths still count in football (leaderstats, end-screen podium) but
// never end the round — only the match clock does.
function FootballUpdater(player: Player, attacker: Player, damage: number, isDeath: boolean) {
	(attacker as PlayerWithStats).damageDealt.Value += damage;

	if (isDeath) {
		(player as PlayerWithStats).deaths.Value += 1;
		(attacker as PlayerWithStats).kills.Value += 1;
	}
}

function FFAUpdater(player: Player, attacker: Player, damage: number, isDeath: boolean) {
	(attacker as PlayerWithStats).damageDealt.Value += damage;

	if (isDeath) {
		(player as PlayerWithStats).deaths.Value += 1;
		(attacker as PlayerWithStats).kills.Value += 1;

		if ((attacker as PlayerWithStats).kills.Value === Globals.FFA_MAX_KILLS) {
			handler.endRound();
		} else if (Globals.FFA_MAX_KILLS - (attacker as PlayerWithStats).kills.Value === 1) {
			FunctionsAndEvents.CloseToWin.FireAllClients(attacker.Name);
		}
	}
}

function TDMUpdater(player: Player, attacker: Player, damage: number, isDeath: boolean) {
	(attacker as PlayerWithStats).damageDealt.Value += damage;

	if (isDeath) {
		(player as PlayerWithStats).deaths.Value += 1;
		(attacker as PlayerWithStats).kills.Value += 1;

		(attacker.Team as TeamWithKills).Kills.Value += 1;

		if ((attacker.Team as TeamWithKills).Kills.Value === Globals.TDM_MAX_KILLS) {
			handler.endRound();
		} else if (Globals.TDM_MAX_KILLS - (attacker.Team as TeamWithKills).Kills.Value === 1) {
			FunctionsAndEvents.CloseToWin.FireAllClients(attacker.Team!.Name);
		}
	}
}

function populateInfoUi(player: Player, attacker: Player) {
	Globals.killstreak.set(player, 0);
	const messages: string[] = [];

	checkKillstreak(attacker, messages);

	if (lastKiller.get(attacker) !== undefined && player === lastKiller.get(attacker)) {
		showRevenge(player, attacker, messages);
	} else {
		deathMessage(player, attacker, messages);
	}
	lastKiller.set(player, attacker);

	if (messages) {
		FunctionsAndEvents.infoUi.FireAllClients(messages);
	}
}

function deathMessage(player: Player, attacker: Player, messages: string[]) {
	const text =
		attacker.Name + '<font face="GothamBlack"><font color="#F11111"> DEMOED </font></font>' + player.Name;
	messages.push(text);
}

function showRevenge(player: Player, attacker: Player, messages: string[]) {
	if (lastKiller.get(attacker) !== undefined) {
		if (player === lastKiller.get(attacker)) {
			const text =
				attacker.Name +
				'<font face="GothamBlack"><font color="#389d59"> got revenge on </font></font>' +
				player.Name;
			messages.push(text);
		}
	}
}

function checkKillstreak(attacker: Player, messages: string[]) {
	if (Globals.killstreak.get(attacker) === undefined) {
		Globals.killstreak.set(attacker, 0);
	}

	Globals.killstreak.set(attacker, Globals.killstreak.get(attacker)! + 1);
	if (Globals.killstreak.get(attacker)! >= 3) {
		const text =
			attacker.Name +
			' is on a <font face="GothamBlack"><font color="#389d59">' +
			Globals.killstreak.get(attacker)! +
			" kill streak!</font></font>";
		messages.push(text);
	}
}

// function checkLMSConditions()
// 	local playersAlive = 0
//
// 	for i, player in pairs(PlayerService:GetPlayers()) do
// 		pcall(function()
// 			if player.survivalTime.Value == -1 then
// 				playersAlive += 1
// 				if playersAlive == 2 then
// 					return
// 				end
// 			end
// 		end)
//
// 	end
//
// 	print("ENDING ROUND")
// 	handler.endRound()
// end

export = handler;
