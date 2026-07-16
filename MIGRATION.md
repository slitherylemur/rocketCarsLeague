# MIGRATION.md — Luau → roblox-ts ledger

Status values: Not Started / In Progress / Complete / Verified

Conventions: see CONVENTIONS.md. UI React structure notes at the bottom.

## ServerScriptService

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| ServerScriptService/initializePlayer | Script | 834 | src/server/initializePlayer.server.ts | Not Started | |
| ServerScriptService/purchaseHandler | Script | 198 | src/server/purchaseHandler.server.ts | Not Started | |
| ServerScriptService/SoftShutdown | Script | 5 | src/server/SoftShutdown.server.ts | Not Started | |
| ServerScriptService/tutorial | Script | 70 | src/server/tutorial.server.ts | Not Started | |
| ServerScriptService/GeneralUtils/ConnectClientFunction | Script | 9 | src/server/GeneralUtils/ConnectClientFunction.server.ts | Not Started | |
| ServerScriptService/GeneralUtils | ModuleScript | 160 | src/server/GeneralUtils/init.ts | Not Started | |
| ServerScriptService/loggerScript | Script | 25 | src/server/loggerScript.server.ts | Not Started | |
| ServerScriptService/killNotowned | Script | 10 | src/server/killNotowned.server.ts | Not Started | |
| ServerScriptService/physFixPlease | Script | 7 | src/server/physFixPlease.server.ts | Not Started | |

## ServerStorage

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| ServerStorage/Logger | ModuleScript | 34 | src/server/Logger.ts | Not Started | |
| ServerStorage/Classes/VehicleClass | ModuleScript | 1189 | src/server/Classes/VehicleClass.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/BumperCar | ModuleScript | 57 | src/server/Classes/VehicleSubClass/BumperCar.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/DogeChallenger | ModuleScript | 118 | src/server/Classes/VehicleSubClass/DogeChallenger.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/AvonSkyline65 | ModuleScript | 59 | src/server/Classes/VehicleSubClass/AvonSkyline65.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/Horse911-95 | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Horse911-95.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/ToyCorolla | ModuleScript | 59 | src/server/Classes/VehicleSubClass/ToyCorolla.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/MarketTruck | ModuleScript | 61 | src/server/Classes/VehicleSubClass/MarketTruck.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/TestVehicle | ModuleScript | 61 | src/server/Classes/VehicleSubClass/TestVehicle.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/Abrams | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Abrams.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/TokyoDrift | ModuleScript | 61 | src/server/Classes/VehicleSubClass/TokyoDrift.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/ArmouredTransport | ModuleScript | 61 | src/server/Classes/VehicleSubClass/ArmouredTransport.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/Continental | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Continental.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/LandRover | ModuleScript | 61 | src/server/Classes/VehicleSubClass/LandRover.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/APC | ModuleScript | 61 | src/server/Classes/VehicleSubClass/APC.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/HippieVan | ModuleScript | 61 | src/server/Classes/VehicleSubClass/HippieVan.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/ToyVan | ModuleScript | 61 | src/server/Classes/VehicleSubClass/ToyVan.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/CandyVan | ModuleScript | 61 | src/server/Classes/VehicleSubClass/CandyVan.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/TroopTransport | ModuleScript | 61 | src/server/Classes/VehicleSubClass/TroopTransport.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/MillitaryTransport | ModuleScript | 61 | src/server/Classes/VehicleSubClass/MillitaryTransport.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/MobBoss | ModuleScript | 59 | src/server/Classes/VehicleSubClass/MobBoss.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/MacaiylaCurve | ModuleScript | 59 | src/server/Classes/VehicleSubClass/MacaiylaCurve.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/MyFirstCar | ModuleScript | 59 | src/server/Classes/VehicleSubClass/MyFirstCar.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/FamilyRoadTrip | ModuleScript | 59 | src/server/Classes/VehicleSubClass/FamilyRoadTrip.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/Police | ModuleScript | 59 | src/server/Classes/VehicleSubClass/Police.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/Taxi | ModuleScript | 59 | src/server/Classes/VehicleSubClass/Taxi.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/Wambulance | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Wambulance.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/ArmouredTruck | ModuleScript | 61 | src/server/Classes/VehicleSubClass/ArmouredTruck.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/FireTruck | ModuleScript | 61 | src/server/Classes/VehicleSubClass/FireTruck.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/Lambo | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Lambo.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/Bugati | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Bugati.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/BmvV8 | ModuleScript | 61 | src/server/Classes/VehicleSubClass/BmvV8.ts | Not Started | |
| ServerStorage/Classes/VehicleSubClass/Horse911 | ModuleScript | 61 | src/server/Classes/VehicleSubClass/Horse911.ts | Not Started | |
| ServerStorage/VehicleModels/TestVehicle/Seats/VehicleSeat/Script | Script | 6 | src/server/EmbeddedScripts/VehicleModels_TestVehicle_Seats_VehicleSeat_Script.ts | Not Started | |
| ServerStorage/Modules/DataStoreDefaults | ModuleScript | 83 | src/server/Modules/DataStoreDefaults.ts | Not Started | |
| ServerStorage/Modules/spawnVehicle | ModuleScript | 245 | src/server/Modules/spawnVehicle.ts | Not Started | |
| ServerStorage/Modules/UiModules/setTab | ModuleScript | 291 | src/server/Modules/UiModules/setTab.ts | Not Started | |
| ServerStorage/Modules/UiModules/itemPopulateSpecifics | ModuleScript | 117 | src/server/Modules/UiModules/itemPopulateSpecifics.ts | Not Started | |
| ServerStorage/Modules/UiModules/itemSelectedFunctions | ModuleScript | 274 | src/server/Modules/UiModules/itemSelectedFunctions.ts | Not Started | |
| ServerStorage/Modules/DataUtilities | ModuleScript | 173 | src/server/Modules/DataUtilities.ts | Not Started | |
| ServerStorage/Modules/roundHandler | ModuleScript | 669 | src/server/Modules/roundHandler.ts | Not Started | |
| ServerStorage/Modules/CrateModule | ModuleScript | 124 | src/server/Modules/CrateModule.ts | Not Started | |
| ServerStorage/Modules/LootManager | ModuleScript | 69 | src/server/Modules/LootManager.ts | Not Started | |
| ServerStorage/Modules/getRandomPieceFromBox | ModuleScript | 36 | src/server/Modules/getRandomPieceFromBox.ts | Not Started | |
| ServerStorage/Modules/Content | ModuleScript | 125 | src/server/Modules/Content.ts | Not Started | |
| ServerStorage/Modules/CodesModule | ModuleScript | 208 | src/server/Modules/CodesModule.ts | Not Started | |
| ServerStorage/Modules/DataStore2/Constants | ModuleScript | 16 | src/server/Modules/DataStore2/Constants.ts | Not Started | |
| ServerStorage/Modules/DataStore2/DataStoreServiceRetriever | ModuleScript | 11 | src/server/Modules/DataStore2/DataStoreServiceRetriever.ts | Not Started | |
| ServerStorage/Modules/DataStore2/IsPlayer | ModuleScript | 9 | src/server/Modules/DataStore2/IsPlayer.ts | Not Started | |
| ServerStorage/Modules/DataStore2/Promise | ModuleScript | 1391 | src/server/Modules/DataStore2/Promise.ts | Not Started | |
| ServerStorage/Modules/DataStore2/SavingMethods/OrderedBackups | ModuleScript | 74 | src/server/Modules/DataStore2/SavingMethods/OrderedBackups.ts | Not Started | |
| ServerStorage/Modules/DataStore2/SavingMethods/Standard | ModuleScript | 34 | src/server/Modules/DataStore2/SavingMethods/Standard.ts | Not Started | |
| ServerStorage/Modules/DataStore2/SavingMethods | ModuleScript | 5 | src/server/Modules/DataStore2/SavingMethods.ts | Not Started | |
| ServerStorage/Modules/DataStore2/Settings | ModuleScript | 8 | src/server/Modules/DataStore2/Settings.ts | Not Started | |
| ServerStorage/Modules/DataStore2/TableUtil | ModuleScript | 18 | src/server/Modules/DataStore2/TableUtil.ts | Not Started | |
| ServerStorage/Modules/DataStore2/Verifier | ModuleScript | 81 | src/server/Modules/DataStore2/Verifier.ts | Not Started | |
| ServerStorage/Modules/DataStore2 | ModuleScript | 614 | src/server/Modules/DataStore2.ts | Not Started | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/Second Level of Water./Script | Script | 6 | src/server/EmbeddedScripts/Maps_ShipIsland_water_sea_ocean_Second Level of Water._Script.ts | Not Started | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Not Started | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Not Started | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Not Started | |
| ServerStorage/Maps/ShipIsland/water/sea/ocean/hits/Hit/Script | Script | 12 | src/server/EmbeddedScripts/Maps_ShipIsland_water_sea_ocean_hits_Hit_Script.ts | Not Started | |
| ServerStorage/MapLightings/MudDerby | ModuleScript | 1 | src/server/MapLightings/MudDerby.ts | Not Started | |
| ServerStorage/MapLightings/DesertIsland | ModuleScript | 1 | src/server/MapLightings/DesertIsland.ts | Not Started | |
| ServerStorage/MapLightings/BaseplateMap | ModuleScript | 1 | src/server/MapLightings/BaseplateMap.ts | Not Started | |
| ServerStorage/MapLightings/StadiumMap | ModuleScript | 1 | src/server/MapLightings/StadiumMap.ts | Not Started | |
| ServerStorage/MapLightings/ApocalypticCity | ModuleScript | 1 | src/server/MapLightings/ApocalypticCity.ts | Not Started | |
| ServerStorage/MapLightings/ShipIsland | ModuleScript | 1 | src/server/MapLightings/ShipIsland.ts | Not Started | |
| ServerStorage/Nuke/Light/Script | Script | 5 | src/server/EmbeddedScripts/Nuke_Light_Script.ts | Not Started | |

## ReplicatedStorage

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| ReplicatedStorage/PopulateCrateFrame | ModuleScript | 95 | src/shared/PopulateCrateFrame.ts | Not Started | |
| ReplicatedStorage/KeyCodeImages | ModuleScript | 88 | src/shared/KeyCodeImages.ts | Not Started | |
| ReplicatedStorage/EffectComposerPro/RuntimeEngine | ModuleScript | 464 | src/shared/EffectComposerPro/RuntimeEngine.ts | Not Started | |

## StarterPlayer

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| StarterPlayer/StarterPlayerScripts/cameraScript (Disabled) | LocalScript | 30 | src/client/cameraScript.client.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/menuCamera | LocalScript | 237 | src/client/menuCamera.client.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/gameUi | LocalScript | 258 | src/client/gameUi.client.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/crateAnimation | LocalScript | 107 | src/client/crateAnimation.client.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/TerrainReset | LocalScript | 13 | src/client/TerrainReset.client.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/HideVehicles | LocalScript | 57 | src/client/HideVehicles.client.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/VehicleKeyHandler | LocalScript | 186 | src/client/VehicleKeyHandler.client.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/music | LocalScript | 53 | src/client/music.client.ts | Not Started | |
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
| StarterPlayer/StarterPlayerScripts/PlayerModule | ModuleScript | 33 | src/playerModule/init.ts | Not Started | |
| StarterPlayer/StarterPlayerScripts/vehicle | LocalScript | 621 | src/client/vehicle.client.ts | Not Started | |

## StarterGui

| Original path | Class | Lines | New path | Status | Notes |
|---|---|---|---|---|---|
| StarterGui/Game/Spectate/Information/Respawn/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Game/Controls/Boost/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Game/Controls/Drift/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Game/Controls/Horn/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Game/Controls/Jump/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Game/Controls/RollLeft/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Game/Controls/RollRight/ImageLabel/consoleIcon/EnableWithConsole | LocalScript | 15 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/Inventory/SpawnButton/Button/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/Inventory/BuyButton/Button/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/Inventory/Buttons/Buttons/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/Inventory/Buttons/Buttons/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/Inventory/ShopButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/Inventory/Codes/TextBox/DetectInput | LocalScript | 5 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/Shop/InventoryButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/cashPurchace/cash/buyOptions/coinFrame/ImageLabel/LocalScript | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/cashPurchace/closeButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/CrateMenu/BackButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/CrateMenu/OpenButton/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/Money/Currency/Add/consoleIcon/EnableWithConsole | LocalScript | 11 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |
| StarterGui/Garage/hover/LocalScript | LocalScript | 14 | src/server/ui + src/client/uiClientBehaviors.client.ts (see notes) | Not Started | |

## UI (StarterGui → React) structure

| ScreenGui | React component root | Status | Notes |
|---|---|---|---|
| StarterGui/Game | src/server/ui/GameGui.tsx | Not Started | |
| StarterGui/MobileInterface | src/server/ui/MobileInterface.tsx | Not Started | |
| StarterGui/Garage | src/server/ui/GarageGui.tsx | Not Started | |
| StarterGui/CrateMenu | src/server/ui/CrateMenuGui.tsx | Not Started | |
| StarterGui/Multipliers | src/server/ui/MultipliersGui.tsx | Not Started | |
| StarterGui/TimerGui | src/server/ui/TimerGui.tsx | Not Started | |
| StarterGui/PlayerMoneyGainedPopups | src/server/ui/PlayerMoneyGainedPopups.tsx | Not Started | |
| StarterGui/DataLoss | src/server/ui/DataLossGui.tsx | Not Started | |
| StarterGui/Steer (NumberValue) | part of PlayerGuiManager mount | Not Started | non-UI child of StarterGui, cloned to PlayerGui like the rest |

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

