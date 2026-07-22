// menuCameraBus — CLIENT-local signal for aiming the menu camera without a
// server round-trip (client-side UI migration, Phase 5).
//
// menuCamera.client.ts owns the camera and historically only listened to the
// server's SetMenuCameraCFrame remote. With the Garage client-owned, tab
// switches (Body/Colors/CarHorn/BoostTrail) aim the camera locally: the garage
// script fires this bus, and menuCamera.client.ts treats it exactly like a
// SetMenuCameraCFrame push. Server-authoritative shots (landing offset, crate
// camera via Intent_ViewCrate) still travel over the remote.
//
// The BindableEvent is created on first require — both subscribers are client
// scripts inside the same Lua VM, so they share this one instance. The server
// never requires this module.

const bus = new Instance("BindableEvent");
bus.Name = "MenuCameraBus";

/** Aim the menu camera at a CFrame (optionally with a field of view — omitted
 * restores the default menu FOV, mirroring the remote's contract). */
export function aimMenuCamera(cframe: CFrame, fov?: number) {
	bus.Fire(cframe, fov);
}

/** Subscribe to local menu-camera aims (menuCamera.client.ts). */
export function onAimMenuCamera(callback: (cframe: CFrame, fov?: number) => void): RBXScriptConnection {
	return bus.Event.Connect(callback as never);
}
