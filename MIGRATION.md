# MIGRATION.md — Luau → roblox-ts ledger

Status values: Not Started / In Progress / Complete / Verified

Conventions: see CONVENTIONS.md. UI React structure notes at the bottom.

## ServerScriptService

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| ServerScriptService/initializePlayer | Script | 834 | src/server/initializePlayer.server.ts | Complete | |
| ServerScriptService/purchaseHandler | Script | 198 | src/server/purchaseHandler.server.ts | Complete | |
| ServerScriptService/SoftShutdown | Script | 5 | src/server/SoftShutdown.server.ts | Complete | |
| ServerScriptService/tutorial | Script | 70 | src/server/tutorial.server.ts | Complete | |
| ServerScriptService/GeneralUtils/ConnectClientFunction | Script | 9 | src/server/GeneralUtils/ConnectClientFunction.server.ts | Complete | |
| ServerScriptService/GeneralUtils | ModuleScript | 160 | src/server/GeneralUtils/init.ts | Complete | |
| ServerScriptService/loggerScript | Script | 25 | src/server/loggerScript.server.ts | Complete | |
| ServerScriptService/killNotowned | Script | 10 | src/server/killNotowned.server.ts | Complete | |
| ServerScriptService/physFixPlease | Script | 7 | src/server/physFixPlease.server.ts | Complete | |

## ServerStorage

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| ServerStorage/Logger | ModuleScript | 34 | src/server/Logger.ts | Complete | |
| ServerStorage/Classes/VehicleClass | ModuleScript | 1189 | src/server/Classes/VehicleClass.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/BumperCar | ModuleScript | 57 | src/server/Classes/VehicleSubClass/BumperCar.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/DogeChallenger | ModuleScript | 118 | src/server/Classes/VehicleSubClass/DogeChallenger.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/AvonSkyline65 | ModuleScript | 59 | src/server/Classes/VehicleSubClass/AvonSkyline65.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/Horse911-95 | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Horse911-95.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/ToyCorolla | ModuleScript | 59 | src/server/Classes/VehicleSubClass/ToyCorolla.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/MarketTruck | ModuleScript | 61 | src/server/Classes/VehicleSubClass/MarketTruck.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/TestVehicle | ModuleScript | 61 | src/server/Classes/VehicleSubClass/TestVehicle.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/Abrams | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Abrams.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/TokyoDrift | ModuleScript | 61 | src/server/Classes/VehicleSubClass/TokyoDrift.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/ArmouredTransport | ModuleScript | 61 | src/server/Classes/VehicleSubClass/ArmouredTransport.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/Continental | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Continental.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/LandRover | ModuleScript | 61 | src/server/Classes/VehicleSubClass/LandRover.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/APC | ModuleScript | 61 | src/server/Classes/VehicleSubClass/APC.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/HippieVan | ModuleScript | 61 | src/server/Classes/VehicleSubClass/HippieVan.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/ToyVan | ModuleScript | 61 | src/server/Classes/VehicleSubClass/ToyVan.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/CandyVan | ModuleScript | 61 | src/server/Classes/VehicleSubClass/CandyVan.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/TroopTransport | ModuleScript | 61 | src/server/Classes/VehicleSubClass/TroopTransport.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/MillitaryTransport | ModuleScript | 61 | src/server/Classes/VehicleSubClass/MillitaryTransport.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/MobBoss | ModuleScript | 59 | src/server/Classes/VehicleSubClass/MobBoss.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/MacaiylaCurve | ModuleScript | 59 | src/server/Classes/VehicleSubClass/MacaiylaCurve.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/MyFirstCar | ModuleScript | 59 | src/server/Classes/VehicleSubClass/MyFirstCar.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/FamilyRoadTrip | ModuleScript | 59 | src/server/Classes/VehicleSubClass/FamilyRoadTrip.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/Police | ModuleScript | 59 | src/server/Classes/VehicleSubClass/Police.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/Taxi | ModuleScript | 59 | src/server/Classes/VehicleSubClass/Taxi.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/Wambulance | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Wambulance.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/ArmouredTruck | ModuleScript | 61 | src/server/Classes/VehicleSubClass/ArmouredTruck.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/FireTruck | ModuleScript | 61 | src/server/Classes/VehicleSubClass/FireTruck.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/Lambo | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Lambo.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/Bugati | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Bugati.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/BmvV8 | ModuleScript | 61 | src/server/Classes/VehicleSubClass/BmvV8.ts | Complete | |
| ServerStorage/Classes/VehicleSubClass/Horse911 | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Horse911.ts | Complete | |
| ServerStorage/VehicleModels/TestVehicle/Seats/VehicleSeat/Script | Script | 6 | src/server/EmbeddedScripts/VehicleModels_TestVehicle_Seats_VehicleSeat_Script.ts | Complete | |
| ServerStorage/Modules/DataStoreDefaults | ModuleScript | 83 | src/server/Modules/DataStoreDefaults.ts | Complete | |
| ServerStorage/Modules/spawnVehicle | ModuleScript | 245 | src/server/Modules/spawnVehicle.ts | Complete | |
| ServerStorage/Modules/UiModules/setTab | ModuleScript | 291 | src/server/Modules/UiModules/setTab.ts | Complete | |
| ServerStorage/Modules/UiModules/itemPopulateSpecifics | ModuleScript | 117 | src/server/Modules/UiModules/itemPopulateSpecifics.ts | Complete | |
| ServerStorage/Modules/UiModules/itemSelectedFunctions | ModuleScript | 274 | src/server/Modules/UiModules/itemSelectedFunctions.ts | Complete | |
| ServerStorage/Modules/DataUtilities | ModuleScript | 173 | src/server/Modules/DataUtilities.ts | Complete | |
| ServerStorage/Modules/roundHandler | ModuleScript | 669 | src/server/Modules/roundHandler.ts | Complete | |
| ServerStorage/Modules/CrateModule | ModuleScript | 124 | src/server/Modules/CrateModule.ts | Complete | |
| ServerStorage/Modules/LootManager | ModuleScript | 69 | src/server/Modules/LootManager.ts | Complete | |
| ServerStorage/Modules/getRandomPieceFromBox | ModuleScript | 36 | src/server/Modules/getRandomPieceFromBox.ts | Complete | |
| ServerStorage/Modules/Content | ModuleScript | 125 | src/server/Modules/Content.ts | Complete | |
| ServerStorage/Modules/CodesModule | ModuleScript | 208 | src/server/Modules/CodesModule.ts | Complete | |
| ServerStorage/Modules/DataStore2/Constants | ModuleScript | 16 | src/server/Modules/DataStore2/Constants.ts | Complete | |
| ServerStorage/Modules/DataStore2/DataStoreServiceRetriever | ModuleScript | 11 | src/server/Modules/DataStore2/DataStoreServiceRetriever.ts | Complete | |
| ServerStorage/Modules/DataStore2/IsPlayer | ModuleScript | 9 | src/server/Modules/DataStore2/IsPlayer.ts | Complete | |
| ServerStorage/Modules/DataStore2/Promise | ModuleScript | 1391 | src/server/Modules/DataStore2/Promise.ts | Complete | |
| ServerStorage/Modules/DataStore2/SavingMethods/OrderedBackups | ModuleScript | 74 | src/server/Modules/DataStore2/SavingMethods/OrderedBackups.ts | Complete | |
| ServerStorage/Modules/DataStore2/SavingMethods/Standard | ModuleScript | 34 | src/server/Modules/DataStore2/SavingMethods/Standard.ts | Complete | |
| ServerStorage/Modules/DataStore2/SavingMethods | ModuleScript | 5 | src/server/Modules/DataStore2/SavingMethods.ts | Complete | |
| ServerStorage/Modules/DataStore2/Settings | ModuleScript | 8 | src/server/Modules/DataStore2/Settings.ts | Complete | |
| ServerStorage/Modules/DataStore2/TableUtil | ModuleScript | 18 | src/server/Modules/DataStore2/TableUtil.ts | Complete | |
| ServerStorage/Modules/DataStore2/Verifier | ModuleScript | 81 | src/server/Modules/DataStore2/Verifier.ts | Complete | |
| ServerStorage/Modules/DataStore2 | ModuleScript | 614 | src/server/Modules/DataStore2.ts | Complete | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/Second Level of Water./Script | Script | 6 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_Second Level of Water._Script.ts | Complete | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Complete | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Complete | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Complete | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/attach.server.ts (Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Complete | |
| ServerStorage/MapLightings/MudDerby | ModuleScript | 1 | src/server/MapLightings/MudDerby.ts | Complete | |
| ServerStorage/MapLightings/DesertIsland | ModuleScript | 1 | src/server/MapLightings/DesertIsland.ts | Complete | |
| ServerStorage/MapLightings/BaseplateMap | ModuleScript | 1 | src/server/MapLightings/BaseplateMap.ts | Complete | |
| ServerStorage/MapLightings/StadiumMap | ModuleScript | 1 | src/server/MapLightings/StadiumMap.ts | Complete | |
| ServerStorage/MapLightings/ApocalypticCity | ModuleScript | 1 | src/server/MapLightings/ApocalypticCity.ts | Complete | |
| ServerStorage/MapLightings/ShipIsland | ModuleScript | 1 | src/server/MapLightings/ShipIsland.ts | Complete | |
| ServerStorage/Nuke/Light/Script | Script | 5 | src/server/EmbeddedScripts/Nuke_Light_Script.ts | Complete | |

## ReplicatedStorage

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| ReplicatedStorage/PopulateCrateFrame | ModuleScript | 95 | src/shared/PopulateCrateFrame.ts | Complete | |
| ReplicatedStorage/KeyCodeImages | ModuleScript | 88 | src/shared/KeyCodeImages.ts | Complete | |
| ReplicatedStorage/EffectComposerPro/RuntimeEngine | ModuleScript | 464 | src/shared/EffectComposerPro/RuntimeEngine.ts | Complete | |

## StarterPlayer

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| StarterPlayer/StarterPlayerScripts/cameraScript (Disabled) | LocalScript | 30 | src/client/cameraScript.client.ts | Complete | |
| StarterPlayer/StarterPlayerScripts/menuCamera | LocalScript | 237 | src/client/menuCamera.client.ts | Complete | |
| StarterPlayer/StarterPlayerScripts/gameUi | LocalScript | 258 | src/client/gameUi.client.ts | Complete | |
| StarterPlayer/StarterPlayerScripts/crateAnimation | LocalScript | 107 | src/client/crateAnimation.client.ts | Complete | |
| StarterPlayer/StarterPlayerScripts/TerrainReset | LocalScript | 13 | src/client/TerrainReset.client.ts | Complete | |
| StarterPlayer/StarterPlayerScripts/HideVehicles | LocalScript | 57 | src/client/HideVehicles.client.ts | Complete | |
| StarterPlayer/StarterPlayerScripts/VehicleKeyHandler | LocalScript | 186 | src/client/VehicleKeyHandler.client.ts | Complete | |
| StarterPlayer/StarterPlayerScripts/music | LocalScript | 53 | src/client/music.client.ts | Complete | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/VehicleController | ModuleScript | 189 | src/playerModule/ControlModule/VehicleController.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/TouchThumbstick | ModuleScript | 188 | src/playerModule/ControlModule/TouchThumbstick.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/ClickToMoveController | ModuleScript | 1153 | src/playerModule/ControlModule/ClickToMoveController.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/PathDisplay | ModuleScript | 132 | src/playerModule/ControlModule/PathDisplay.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/ClickToMoveDisplay | ModuleScript | 484 | src/playerModule/ControlModule/ClickToMoveDisplay.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/DynamicThumbstick | ModuleScript | 542 | src/playerModule/ControlModule/DynamicThumbstick.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/Gamepad | ModuleScript | 214 | src/playerModule/ControlModule/Gamepad.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/TouchJump | ModuleScript | 204 | src/playerModule/ControlModule/TouchJump.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/BaseCharacterController | ModuleScript | 47 | src/playerModule/ControlModule/BaseCharacterController.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/Keyboard | ModuleScript | 177 | src/playerModule/ControlModule/Keyboard.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule/VRNavigation | ModuleScript | 458 | src/playerModule/ControlModule/VRNavigation.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/ControlModule | ModuleScript | 680 | src/playerModule/ControlModule.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/BaseCamera | ModuleScript | 1031 | src/playerModule/CameraModule/BaseCamera.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/CameraUtils | ModuleScript | 331 | src/playerModule/CameraModule/CameraUtils.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/CameraToggleStateController | ModuleScript | 153 | src/playerModule/CameraModule/CameraToggleStateController.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/MouseLockController | ModuleScript | 240 | src/playerModule/CameraModule/MouseLockController.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/BaseOcclusion | ModuleScript | 48 | src/playerModule/CameraModule/BaseOcclusion.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/TransparencyController | ModuleScript | 238 | src/playerModule/CameraModule/TransparencyController.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/OrbitalCamera | ModuleScript | 305 | src/playerModule/CameraModule/OrbitalCamera.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/ClassicCamera | ModuleScript | 254 | src/playerModule/CameraModule/ClassicCamera.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/LegacyCamera | ModuleScript | 114 | src/playerModule/CameraModule/LegacyCamera.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VehicleCamera/VehicleCameraConfig | ModuleScript | 61 | src/playerModule/CameraModule/VehicleCamera/VehicleCameraConfig.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VehicleCamera/VehicleCameraCore | ModuleScript | 182 | src/playerModule/CameraModule/VehicleCamera/VehicleCameraCore.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VehicleCamera | ModuleScript | 221 | src/playerModule/CameraModule/VehicleCamera.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/ZoomController/Popper | ModuleScript | 342 | src/playerModule/CameraModule/ZoomController/Popper.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/ZoomController | ModuleScript | 138 | src/playerModule/CameraModule/ZoomController.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/Invisicam | ModuleScript | 553 | src/playerModule/CameraModule/Invisicam.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/Poppercam | ModuleScript | 112 | src/playerModule/CameraModule/Poppercam.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/CameraUI | ModuleScript | 198 | src/playerModule/CameraModule/CameraUI.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VRCamera | ModuleScript | 214 | src/playerModule/CameraModule/VRCamera.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VRBaseCamera | ModuleScript | 363 | src/playerModule/CameraModule/VRBaseCamera.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/CameraInput | ModuleScript | 562 | src/playerModule/CameraModule/CameraInput.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/VRVehicleCamera | ModuleScript | 213 | src/playerModule/CameraModule/VRVehicleCamera.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule | ModuleScript | 641 | src/playerModule/CameraModule.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/PlayerModule | ModuleScript | 33 | src/playerModule/init.ts | Complete | |
| StarterPlayer/StarterPlayerScripts/vehicle | LocalScript | 621 | src/client/vehicle.client.ts | Complete | |

## StarterGui

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| StarterGui/Game/Spectate/Information/Respawn/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Game/Controls/Boost/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Game/Controls/Drift/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Game/Controls/Horn/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Game/Controls/Jump/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Game/Controls/RollLeft/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Game/Controls/RollRight/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/Inventory/SpawnButton/Button/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/Inventory/BuyButton/Button/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/Inventory/Buttons/Buttons/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/Inventory/Buttons/Buttons/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/Inventory/ShopButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/Inventory/Codes/TextBox/DetectInput | LocalScript | 5 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/Shop/InventoryButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/cashPurchace/closeButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/CrateMenu/BackButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/CrateMenu/OpenButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/Money/Currency/Add/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |
| StarterGui/Garage/hover/LocalScript | LocalScript | 14 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Complete | |

## UI (StarterGui → React) structure

| ScreenGui | React component root | Status | Notes |
|---|---|---|---|
| StarterGui/Game | src/server/ui/GameGui.tsx | Complete | |
| StarterGui/MobileInterface | src/server/ui/MobileInterface.tsx | Complete | |
| StarterGui/Garage | src/server/ui/GarageGui.tsx | Complete | |
| StarterGui/CrateMenu | src/server/ui/CrateMenuGui.tsx | Complete | |
| StarterGui/Multipliers | src/server/ui/MultipliersGui.tsx | Complete | |
| StarterGui/TimerGui | src/server/ui/TimerGui.tsx | Complete | |
| StarterGui/PlayerMoneyGainedPopups | src/server/ui/PlayerMoneyGainedPopups.tsx | Complete | |
| StarterGui/DataLoss | src/server/ui/DataLossGui.tsx | Complete | |
| StarterGui/Steer (NumberValue) | part of PlayerGuiManager mount | Complete | non-UI child of StarterGui, cloned to PlayerGui like the rest |

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
   - StarterPlayer/StarterPlayerScripts/PlayerModule (the translated fork — MUST keep
     this exact name so Roblox's PlayerScriptsLoader picks it up instead of injecting
     the default)
3. Delete the original Luau implementations (every Script/LocalScript/ModuleScript
   listed in this ledger) and the original StarterGui ScreenGuis (Game,
   MobileInterface, Garage, CrateMenu, Multipliers, TimerGui, PlayerMoneyGainedPopups,
   DataLoss) plus the StarterGui "Steer" NumberValue — all are recreated by the
   server-rendered React UI. Do NOT delete:
   - non-script instances referenced by path (ServerStorage: VehicleModels, Colors,
     BoostTrails, CarHorns, Skins, Maps, MapTerrains, Events, Sounds, Effects, Nuke,
     HealthBar, TeamHighlight, CarCategory, CarTitle, SaveInStudio;
     ReplicatedStorage: FunctionsAndEvents, Ui, Colors, BoostTrails,
     EffectComposerPro (Effects/Defaults folders); Workspace: everything;
     StarterPlayerScripts: the gameMusic Sound)
   - ServerStorage/MapLightings ModuleScripts CAN be deleted (values + children are
     reproduced in src/server/MapLightings), and the scripts embedded in
     ServerStorage models (ShipIsland water, Nuke light, TestVehicle seat) are
     replaced by src/server/EmbeddedScripts/attach.server.ts.

## Known items requiring manual testing in Studio

- Server-side React mounting (PlayerGuiManager, legacy synchronous root) — verify a
  player joining sees all 8 ScreenGuis and the menu flow works end-to-end.
- DataStore2 fork translation — verify data round-trips (money increment, rejoin).
- Promise translation trailing-nil vararg caveat (see DataStore2/Promise row).
- Vehicle physics parity (client drive loop) and boost/drift/jump timing.
- Crate open animation timing and the money-gained popups.
- Gamepad navigation (NextSelection wiring is applied post-mount by PlayerGuiManager).
