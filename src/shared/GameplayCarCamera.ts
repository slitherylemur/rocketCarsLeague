// Client-only camera ownership for the locally controlled match car.
//
// Camera writes come from several independent systems (menu, spectate,
// face-off, victory, and the two vehicle renderers). Remote-event ordering is
// not guaranteed relative to vehicle replication, so a one-time camera handoff
// is not sufficient: a late writer can otherwise strand the player at an old
// shot for the rest of the match.
//
// The car renderer calls maintainGameplayCarCamera every render frame while it
// is driving. This module is shared by the legacy and V2 renderers so an old
// car being removed cannot release a newer car's camera claim.

import { isGameplayUiActive } from "shared/ui/gameplayUiState";

const Players = game.GetService("Players");
const LocalPlayer = Players.LocalPlayer;

const PITCH_ID_ATTR = "CB_PitchId";
const PHASE_ATTR = "FB_Phase";

let ownedTarget: BasePart | undefined;

function currentPitch(): Instance | undefined {
	const pitchId = LocalPlayer.GetAttribute(PITCH_ID_ATTR);
	if (!typeIs(pitchId, "string")) {
		return undefined;
	}
	return game.Workspace.FindFirstChild("Map")?.FindFirstChild(pitchId);
}

/** These phases deliberately own a Scriptable presentation camera. */
function cinematicCameraActive(): boolean {
	const phase = currentPitch()?.GetAttribute(PHASE_ATTR);
	return phase === "FaceOff" || phase === "Ended";
}

function localHumanoid(): Humanoid | undefined {
	return LocalPlayer.Character?.FindFirstChildOfClass("Humanoid");
}

/**
 * Enforce the core gameplay invariant on every frame: a locally controlled,
 * driven car uses the normal Roblox camera and follows its rendered target.
 *
 * This intentionally reclaims the camera from any stale subject. Spectating,
 * menu, and showcase subjects are not valid while this car is being controlled;
 * the two explicit match cinematics above are the only exceptions.
 */
export function maintainGameplayCarCamera(target: BasePart, driving: boolean) {
	if (!driving || !isGameplayUiActive(LocalPlayer)) {
		releaseGameplayCarCamera(target);
		return;
	}

	// Face-off/victory re-assert their authored CFrame independently. Leaving
	// the subject alone here makes their handoff back to gameplay seamless.
	if (cinematicCameraActive()) {
		return;
	}

	const camera = game.Workspace.CurrentCamera;
	if (!camera || target.Parent === undefined) {
		return;
	}

	ownedTarget = target;
	if (camera.CameraType !== Enum.CameraType.Custom) {
		camera.CameraType = Enum.CameraType.Custom;
	}
	if (camera.CameraSubject !== target) {
		camera.CameraSubject = target;
	}
}

/** Release only this target's claim; stale/remote teardown cannot steal it. */
export function releaseGameplayCarCamera(target: BasePart) {
	if (ownedTarget !== target) {
		return;
	}
	ownedTarget = undefined;

	const camera = game.Workspace.CurrentCamera;
	if (camera && camera.CameraSubject === target) {
		camera.CameraSubject = localHumanoid();
	}
}
