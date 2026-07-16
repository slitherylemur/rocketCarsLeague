# MIGRATION.md — Luau → roblox-ts ledger

Status values: Not Started / In Progress / Complete / Verified

Conventions: see CONVENTIONS.md. UI React structure notes at the bottom.

## ServerScriptService

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| ServerScriptService/initializePlayer | Script | 834 | src/server/initializePlayer.server.ts | Verified | |
| ServerScriptService/purchaseHandler | Script | 198 | src/server/purchaseHandler.server.ts | Verified | |
| ServerScriptService/SoftShutdown | Script | 5 | src/server/SoftShutdown.server.ts | Verified | |
| ServerScriptService/tutorial | Script | 70 | src/server/tutorial.server.ts | Verified | |
| ServerScriptService/GeneralUtils/ConnectClientFunction | Script | 9 | src/server/GeneralUtils/ConnectClientFunction.server.ts | Verified | |
| ServerScriptService/GeneralUtils | ModuleScript | 160 | src/server/GeneralUtils/index.ts | Verified | |
| ServerScriptService/loggerScript | Script | 25 | src/server/loggerScript.server.ts | Verified | |
| ServerScriptService/killNotowned | Script | 10 | src/server/killNotowned.server.ts | Verified | |
| ServerScriptService/physFixPlease | Script | 7 | src/server/physFixPlease.server.ts | Verified | |

## ServerStorage

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| ServerStorage/Logger | ModuleScript | 34 | src/server/Logger.ts | Verified | |
| ServerStorage/Classes/VehicleClass | ModuleScript | 1189 | src/server/Classes/VehicleClass.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/BumperCar | ModuleScript | 57 | src/server/Classes/VehicleSubClass/BumperCar.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/DogeChallenger | ModuleScript | 118 | src/server/Classes/VehicleSubClass/DogeChallenger.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/AvonSkyline65 | ModuleScript | 59 | src/server/Classes/VehicleSubClass/AvonSkyline65.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/Horse911-95 | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Horse911-95.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/ToyCorolla | ModuleScript | 59 | src/server/Classes/VehicleSubClass/ToyCorolla.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/MarketTruck | ModuleScript | 61 | src/server/Classes/VehicleSubClass/MarketTruck.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/TestVehicle | ModuleScript | 61 | src/server/Classes/VehicleSubClass/TestVehicle.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/Abrams | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Abrams.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/TokyoDrift | ModuleScript | 61 | src/server/Classes/VehicleSubClass/TokyoDrift.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/ArmouredTransport | ModuleScript | 61 | src/server/Classes/VehicleSubClass/ArmouredTransport.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/Continental | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Continental.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/LandRover | ModuleScript | 61 | src/server/Classes/VehicleSubClass/LandRover.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/APC | ModuleScript | 61 | src/server/Classes/VehicleSubClass/APC.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/HippieVan | ModuleScript | 61 | src/server/Classes/VehicleSubClass/HippieVan.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/ToyVan | ModuleScript | 61 | src/server/Classes/VehicleSubClass/ToyVan.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/CandyVan | ModuleScript | 61 | src/server/Classes/VehicleSubClass/CandyVan.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/TroopTransport | ModuleScript | 61 | src/server/Classes/VehicleSubClass/TroopTransport.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/MillitaryTransport | ModuleScript | 61 | src/server/Classes/VehicleSubClass/MillitaryTransport.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/MobBoss | ModuleScript | 59 | src/server/Classes/VehicleSubClass/MobBoss.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/MacaiylaCurve | ModuleScript | 59 | src/server/Classes/VehicleSubClass/MacaiylaCurve.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/MyFirstCar | ModuleScript | 59 | src/server/Classes/VehicleSubClass/MyFirstCar.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/FamilyRoadTrip | ModuleScript | 59 | src/server/Classes/VehicleSubClass/FamilyRoadTrip.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/Police | ModuleScript | 59 | src/server/Classes/VehicleSubClass/Police.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/Taxi | ModuleScript | 59 | src/server/Classes/VehicleSubClass/Taxi.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/Wambulance | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Wambulance.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/ArmouredTruck | ModuleScript | 61 | src/server/Classes/VehicleSubClass/ArmouredTruck.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/FireTruck | ModuleScript | 61 | src/server/Classes/VehicleSubClass/FireTruck.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/Lambo | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Lambo.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/Bugati | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Bugati.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/BmvV8 | ModuleScript | 61 | src/server/Classes/VehicleSubClass/BmvV8.ts | Verified | |
| ServerStorage/Classes/VehicleSubClass/Horse911 | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Horse911.ts | Verified | |
| ServerStorage/VehicleModels/TestVehicle/Seats/VehicleSeat/Script | Script | 6 | src/server/EmbeddedScripts/attach.server.ts | Verified | |
| ServerStorage/Modules/DataStoreDefaults | ModuleScript | 83 | src/server/Modules/DataStoreDefaults.ts | Verified | |
| ServerStorage/Modules/spawnVehicle | ModuleScript | 245 | src/server/Modules/spawnVehicle.ts | Verified | |
| ServerStorage/Modules/UiModules/setTab | ModuleScript | 291 | src/server/Modules/UiModules/setTab.ts | Verified | |
| ServerStorage/Modules/UiModules/itemPopulateSpecifics | ModuleScript | 117 | src/server/Modules/UiModules/itemPopulateSpecifics.ts | Verified | |
| ServerStorage/Modules/UiModules/itemSelectedFunctions | ModuleScript | 274 | src/server/Modules/UiModules/itemSelectedFunctions.ts | Verified | |
| ServerStorage/Modules/DataUtilities | ModuleScript | 173 | src/server/Modules/DataUtilities.ts | Verified | |
| ServerStorage/Modules/roundHandler | ModuleScript | 669 | src/server/Modules/roundHandler.ts | Verified | |
| ServerStorage/Modules/CrateModule | ModuleScript | 124 | src/server/Modules/CrateModule.ts | Verified | |
| ServerStorage/Modules/LootManager | ModuleScript | 69 | src/server/Modules/LootManager.ts | Verified | |
| ServerStorage/Modules/getRandomPieceFromBox | ModuleScript | 36 | src/server/Modules/getRandomPieceFromBox.ts | Verified | |
| ServerStorage/Modules/Content | ModuleScript | 125 | src/server/Modules/Content.ts | Verified | |
| ServerStorage/Modules/CodesModule | ModuleScript | 208 | src/server/Modules/CodesModule.ts | Verified | |
| ServerStorage/Modules/DataStore2/Constants | ModuleScript | 16 | src/server/Modules/DataStore2/Constants.ts | Verified | |
| ServerStorage/Modules/DataStore2/DataStoreServiceRetriever | ModuleScript | 11 | src/server/Modules/DataStore2/DataStoreServiceRetriever.ts | Verified | |
| ServerStorage/Modules/DataStore2/IsPlayer | ModuleScript | 9 | src/server/Modules/DataStore2/IsPlayer.ts | Verified | |
| ServerStorage/Modules/DataStore2/Promise | ModuleScript | 1391 | src/server/Modules/DataStore2/Promise.ts | Verified | |
| ServerStorage/Modules/DataStore2/SavingMethods/OrderedBackups | ModuleScript | 74 | src/server/Modules/DataStore2/SavingMethods/OrderedBackups.ts | Verified | |
| ServerStorage/Modules/DataStore2/SavingMethods/Standard | ModuleScript | 34 | src/server/Modules/DataStore2/SavingMethods/Standard.ts | Verified | |
| ServerStorage/Modules/DataStore2/SavingMethods | ModuleScript | 5 | src/server/Modules/DataStore2/SavingMethods/index.ts | Verified | |
| ServerStorage/Modules/DataStore2/Settings | ModuleScript | 8 | src/server/Modules/DataStore2/Settings.ts | Verified | |
| ServerStorage/Modules/DataStore2/TableUtil | ModuleScript | 18 | src/server/Modules/DataStore2/TableUtil.ts | Verified | |
| ServerStorage/Modules/DataStore2/Verifier | ModuleScript | 81 | src/server/Modules/DataStore2/Verifier.ts | Verified | |
| ServerStorage/Modules/DataStore2 | ModuleScript | 614 | src/server/Modules/DataStore2/index.ts | Verified | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/Second Level of Water./Script | Script | 6 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_Second Level of Water._Script.ts | Verified | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Verified | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Verified | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Verified | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Verified | |
| ServerStorage/MapLightings/MudDerby | ModuleScript | 1 | src/server/MapLightings/MudDerby.ts | Verified | |
| ServerStorage/MapLightings/DesertIsland | ModuleScript | 1 | src/server/MapLightings/DesertIsland.ts | Verified | |
| ServerStorage/MapLightings/BaseplateMap | ModuleScript | 1 | src/server/MapLightings/BaseplateMap.ts | Verified | |
| ServerStorage/MapLightings/StadiumMap | ModuleScript | 1 | src/server/MapLightings/StadiumMap.ts | Verified | |
| ServerStorage/MapLightings/ApocalypticCity | ModuleScript | 1 | src/server/MapLightings/ApocalypticCity.ts | Verified | |
| ServerStorage/MapLightings/ShipIsland | ModuleScript | 1 | src/server/MapLightings/ShipIsland.ts | Verified | |
| ServerStorage/Nuke/Light/Script | Script | 5 | src/server/EmbeddedScripts/attach.server.ts | Verified | |

## ReplicatedStorage

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| ReplicatedStorage/PopulateCrateFrame | ModuleScript | 95 | src/shared/PopulateCrateFrame.ts | Verified | |
| ReplicatedStorage/KeyCodeImages | ModuleScript | 88 | src/shared/KeyCodeImages.ts | Verified | |
| ReplicatedStorage/EffectComposerPro/** | Plugin content | — | *(not migrated — leave in place file)* | Skipped | Effect Composer Pro plugin owns RuntimeEngine + Effects/Defaults |

## StarterPlayer

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| StarterPlayer/StarterPlayerScripts/cameraScript (Disabled) | LocalScript | 30 | src/client/cameraScript.client.ts | Verified | |
| StarterPlayer/StarterPlayerScripts/menuCamera | LocalScript | 237 | src/client/menuCamera.client.ts | Verified | |
| StarterPlayer/StarterPlayerScripts/gameUi | LocalScript | 258 | src/client/gameUi.client.ts | Verified | |
| StarterPlayer/StarterPlayerScripts/crateAnimation | LocalScript | 107 | src/client/crateAnimation.client.ts | Verified | |
| StarterPlayer/StarterPlayerScripts/TerrainReset | LocalScript | 13 | src/client/TerrainReset.client.ts | Verified | |
| StarterPlayer/StarterPlayerScripts/HideVehicles | LocalScript | 57 | src/client/HideVehicles.client.ts | Verified | |
| StarterPlayer/StarterPlayerScripts/VehicleKeyHandler | LocalScript | 186 | src/client/VehicleKeyHandler.client.ts | Verified | Rebuilt to the a5318d46 server-authoritative input model (see "Vehicle architecture restoration" below) |
| StarterPlayer/StarterPlayerScripts/music | LocalScript | 53 | src/client/music.client.ts | Verified | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/** | ModuleScript tree | — | *(not shipped — engine default)* | Dropped | Old fork only set `onlyTriggersForThrottle`; gamepad R2/L2 throttle is in VehicleKeyHandler.client.ts |
| StarterPlayer/StarterPlayerScripts/vehicle | LocalScript | 621 | *(deleted)* | Removed | Client-sided physics script removed; drive loop restored server-side in VehicleClass.ts (a5318d46 architecture) |

## StarterGui

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| StarterGui/Game/Spectate/Information/Respawn/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Game/Controls/Boost/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Game/Controls/Drift/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Game/Controls/Horn/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Game/Controls/Jump/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Game/Controls/RollLeft/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Game/Controls/RollRight/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/Inventory/SpawnButton/Button/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/Inventory/BuyButton/Button/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/Inventory/Buttons/Buttons/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/Inventory/Buttons/Buttons/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/Inventory/ShopButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/Inventory/Codes/TextBox/DetectInput | LocalScript | 5 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/Shop/InventoryButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/cashPurchace/closeButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/CrateMenu/BackButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/CrateMenu/OpenButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/Money/Currency/Add/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |
| StarterGui/Garage/hover/LocalScript | LocalScript | 14 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Verified | |

## UI (StarterGui → React) structure

| ScreenGui | React component root | Status | Notes |
|---|---|---|---|
| StarterGui/Game | src/server/ui/GameGui.tsx | Verified | |
| StarterGui/MobileInterface | src/server/ui/MobileInterface.tsx | Verified | |
| StarterGui/Garage | src/server/ui/GarageGui.tsx | Verified | |
| StarterGui/CrateMenu | src/server/ui/CrateMenuGui.tsx | Verified | |
| StarterGui/Multipliers | src/server/ui/MultipliersGui.tsx | Verified | |
| StarterGui/TimerGui | src/server/ui/TimerGui.tsx | Verified | |
| StarterGui/PlayerMoneyGainedPopups | src/server/ui/PlayerMoneyGainedPopups.tsx | Verified | |
| StarterGui/DataLoss | src/server/ui/DataLossGui.tsx | Verified | |
| StarterGui/Steer (NumberValue) | part of PlayerGuiManager mount | Verified | non-UI child of StarterGui, cloned to PlayerGui like the rest |

## Global architecture notes

- **PlayerGuiManager** (src/server/ui/PlayerGuiManager.ts): reproduces the
  original UI lifecycle — engine ResetOnSpawn re-clone on LoadCharacter, manual
  clone on join, destroy-all + re-clone on menu reset. React roots are unmounted
  instead of Destroy()ed; leftover non-React children (e.g. sounds parented to
  PlayerGui) are destroyed like the original destroy-all did.
- **Globals** (src/server/Globals.ts): replaces server-side `_G` (roblox-ts has no
  `_G`); same fields, same assignment timing.
- **LegacyTiming** (src/shared/LegacyTiming.ts): implements legacy `wait`/`delay`
  semantics used by a handful of scripts (30 Hz resume, returns elapsed time).
- **StarterGui template state**: roundHandler mutated StarterGui templates
  (Gamemode text, TeamScore text/visibility) so future clones inherited them.
  Replaced by StarterGuiState (src/server/ui/StarterGuiState.ts) read at mount.
- **Dynamic requires** (vehicle subclasses by name, map lightings by name) →
  static registries with identical name keys:
  src/server/Classes/VehicleSubClass/registry.ts, src/server/MapLightings/registry.ts.
- **MapLightings data**: original modules read values from child ValueObjects and
  roundHandler cloned their non-Value children (Clouds, etc.) into
  Lighting/Terrain. Values are hardcoded (extracted from the place file);
  non-Value children are recreated programmatically per map from extracted data
  (src/server/MapLightings/instanceData.ts).
- **Embedded model scripts** (ShipIsland water ×5, Nuke light, TestVehicle seat
  prompt): behavior attaches when clones enter Workspace, driven from
  src/server/EmbeddedScripts/attach.server.ts (original scripts executed on clone
  into Workspace; equivalent trigger points documented in that file).
- **DataStore2** is a locally MODIFIED fork of Kampfkarren's library (saves even
  when not updated + logging w/ _G.PlayerJoinedTimes). Fully translated to TS
  including its bundled Promise implementation (older evaera version — NOT
  interchangeable with roblox-ts's built-in Promise).


## Applying the migration in Roblox Studio

1. `npm install && npx rbxtsc` — compiles to `out/` (zero TypeScript errors expected).
2. Sync/build with Rojo using `default.project.json` (e.g. `rojo serve` + the Rojo
   plugin against the opened RocketCars place). This creates:
   - ServerScriptService/TS (server scripts + former ServerStorage modules)
   - ReplicatedStorage/TS + ReplicatedStorage/rbxts_include (shared modules + runtime)
   - StarterPlayer/StarterPlayerScripts/TS (client scripts)
   - Do NOT place a custom PlayerModule under StarterPlayerScripts — leave that
     absent so Roblox injects the engine default. (The old place fork only changed
     `onlyTriggersForThrottle`; gamepad throttle is already handled in
     `src/client/VehicleKeyHandler.client.ts` via R2/L2.)
3. Delete the original Luau implementations (every Script/LocalScript/ModuleScript
   listed in this ledger, including the place-file PlayerModule tree) and the original StarterGui ScreenGuis (Game,
   MobileInterface, Garage, CrateMenu, Multipliers, TimerGui, PlayerMoneyGainedPopups,
   DataLoss) plus the StarterGui "Steer" NumberValue — all are recreated by the
   server-rendered React UI. Do NOT delete:
   - non-script instances referenced by path (ServerStorage: VehicleModels, Colors,
     BoostTrails, CarHorns, Skins, Maps, MapTerrains, Events, Sounds, Effects, Nuke,
     HealthBar, TeamHighlight, CarCategory, CarTitle, SaveInStudio;
     ReplicatedStorage: FunctionsAndEvents, Ui, Colors, BoostTrails,
     EffectComposerPro (entire plugin folder — do not translate or delete);
     Workspace: everything;
     StarterPlayerScripts: the gameMusic Sound)
   - ServerStorage/MapLightings ModuleScripts CAN be deleted (values + children are
     reproduced in src/server/MapLightings), and the scripts embedded in
     ServerStorage models (ShipIsland water, Nuke light, TestVehicle seat) are
     replaced by src/server/EmbeddedScripts/attach.server.ts.

## Vehicle architecture restoration (2026-07-16)

The migration originally reproduced the bumperCars HEAD architecture, which was the
**client-sided** refactor (commit 8cbfdf1c, 2022-07-03): the drive loop, drift, boost
and aerial control all ran in `vehicle.client.ts` on the driver's machine, syncing
effects and the boost meter back to the server through the DriveVehicle /
UpdateBoostEffect / UpdateDriftEffect remotes. That architecture is the source of the
observed desyncs, boost-meter glitches and input drop-outs.

Restored to the **server-authoritative** architecture of bumperCars commit a5318d46
("SERVER SIDE", 2022-07-03):

- `src/server/Classes/VehicleClass.ts` — full drive loop (gears, slope compensation,
  aerial correction), `turnWheels`/anti-Ackerman steering, `drift`/`undrift`, `Boost`/
  `boostIncrement`/`setBoostMeter`, `Jump`, `Flip`, aerial roll/yaw/pitch, and the
  `onGround`/`closeGround`/`GetTotalMass` physics queries all run on the server again.
  The car's `Base` keeps client network ownership (set in spawnVehicle.ts), so the
  driver's machine still simulates the BodyMover forces smoothly — same as a5318d46.
- `src/client/vehicle.client.ts` — **deleted**. The client no longer runs physics.
- `src/client/VehicleKeyHandler.client.ts` — rebuilt: W/S/A/D + gamepad + mobile send
  throttle/steer floats over the per-vehicle `inputChangedEvent`; Drift/Boost/Jump/
  Horn/Rolls go through the KeyHandler remote to the server vehicle methods.
- DriveVehicle / UpdateBoostEffect / UpdateDriftEffect remotes are no longer used by
  code (instances may remain in the place file harmlessly).

Deliberate fixes on top of the a5318d46 behavior (feel/constants unchanged):

1. Throttle/steer are derived from per-key **held state**, not the original +1/-1
   accumulators — a missed End or a `UserInputState.Cancel` can no longer permanently
   desync movement (stuck throttle / weird simultaneous-key behavior).
2. Server clamps incoming throttle/steer to [-1, 1] and rejects non-number/NaN values
   (also caps the drift side force at its designed maximum).
3. `setBoostMeter` only tweens when `boostAmount` actually changes — the original
   re-created a 0.2 s tween every Heartbeat, which made the bar jitter.
4. Movement actions are unbound and input floats zeroed on unseat; drift/boost state
   and input floats are reset when a drive session starts.
5. Mobile ability buttons are connected once at startup instead of re-connected on
   every seating (the original stacked duplicate handlers, causing double-fires).

## Known items requiring manual testing in Studio

- Server-side React mounting (PlayerGuiManager, legacy synchronous root) — verify a
  player joining sees all 8 ScreenGuis and the menu flow works end-to-end.
- DataStore2 fork translation — verify data round-trips (money increment, rejoin).
- Promise translation trailing-nil vararg caveat (see DataStore2/Promise row).
- Vehicle physics parity (now the server drive loop — a5318d46) and boost/drift/jump
  timing; verify boost feels punchy (force ×3, target 1.6× max speed) on ground and
  in the air, drift side force, and that multiple simultaneous keys behave.
- Crate open animation timing and the money-gained popups.
- Gamepad navigation (NextSelection wiring is applied post-mount by PlayerGuiManager).
