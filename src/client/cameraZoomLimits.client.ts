// Camera zoom clamps. Roblox's stock limits let the wheel travel from
// first-person (0.5 studs — inside the driver's head) out to 400 studs.
// Both extremes are wrong for a car game, so the player's zoom window is
// pinned here once at boot.

const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;

const MIN_ZOOM = 30; // close enough to read the car, never inside the driver
const MAX_ZOOM = 70; // far enough to see play develop, never a satellite view

LocalPlayer.CameraMinZoomDistance = MIN_ZOOM;
LocalPlayer.CameraMaxZoomDistance = MAX_ZOOM;
