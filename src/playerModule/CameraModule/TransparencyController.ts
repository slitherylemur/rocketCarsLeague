// Original: StarterPlayer/StarterPlayerScripts/PlayerModule/CameraModule/TransparencyController (ModuleScript)
//
// TransparencyController - Manages transparency of player character at close camera-to-subject distances
// 2018 Camera Update - AllYourBlox

import Util from "./CameraUtils";
import { legacyWait } from "shared/LegacyTiming";

let FFlagUserTransparencyControllerDeltaTime: boolean;
{
	const [success, result] = pcall(() => UserSettings().IsUserFeatureEnabled("UserTransparencyControllerDeltaTime"));
	FFlagUserTransparencyControllerDeltaTime = success && (result as boolean);
}

const MAX_TWEEN_RATE = 2.8; // per second

// Anything TransparencyController can drive LocalTransparencyModifier on.
type Fadeable = BasePart | Decal;

/* [ The Module ] */
class TransparencyController {
	lastUpdate: number; // remove with FFlagUserTransparencyControllerDeltaTime
	transparencyDirty: boolean;
	enabled: boolean;
	lastTransparency: number | undefined;

	descendantAddedConn: RBXScriptConnection | undefined;
	descendantRemovingConn: RBXScriptConnection | undefined;
	toolDescendantAddedConns: Map<Tool, RBXScriptConnection>;
	toolDescendantRemovingConns: Map<Tool, RBXScriptConnection>;
	cachedParts: Set<Fadeable>;

	constructor() {
		this.lastUpdate = tick(); // remove with FFlagUserTransparencyControllerDeltaTime
		this.transparencyDirty = false;
		this.enabled = false;
		this.lastTransparency = undefined;

		this.descendantAddedConn = undefined;
		this.descendantRemovingConn = undefined;
		this.toolDescendantAddedConns = new Map<Tool, RBXScriptConnection>();
		this.toolDescendantRemovingConns = new Map<Tool, RBXScriptConnection>();
		this.cachedParts = new Set<Fadeable>();
	}

	HasToolAncestor(object: Instance): boolean {
		if (object.Parent === undefined) return false;
		return object.Parent.IsA("Tool") || this.HasToolAncestor(object.Parent);
	}

	IsValidPartToModify(part: Instance): part is Fadeable {
		if (part.IsA("BasePart") || part.IsA("Decal")) {
			return !this.HasToolAncestor(part);
		}
		return false;
	}

	CachePartsRecursive(object: Instance | undefined): void {
		if (object) {
			if (this.IsValidPartToModify(object)) {
				this.cachedParts.add(object);
				this.transparencyDirty = true;
			}
			for (const child of object.GetChildren()) {
				this.CachePartsRecursive(child);
			}
		}
	}

	TeardownTransparency(): void {
		for (const child of this.cachedParts) {
			child.LocalTransparencyModifier = 0;
		}
		this.cachedParts = new Set<Fadeable>();
		this.transparencyDirty = true;
		this.lastTransparency = undefined;

		if (this.descendantAddedConn) {
			this.descendantAddedConn.Disconnect();
			this.descendantAddedConn = undefined;
		}
		if (this.descendantRemovingConn) {
			this.descendantRemovingConn.Disconnect();
			this.descendantRemovingConn = undefined;
		}
		for (const [, conn] of this.toolDescendantAddedConns) {
			conn.Disconnect();
		}
		this.toolDescendantAddedConns = new Map<Tool, RBXScriptConnection>();
		for (const [, conn] of this.toolDescendantRemovingConns) {
			conn.Disconnect();
		}
		this.toolDescendantRemovingConns = new Map<Tool, RBXScriptConnection>();
	}

	SetupTransparency(character: Model): void {
		this.TeardownTransparency();

		if (this.descendantAddedConn) this.descendantAddedConn.Disconnect();
		this.descendantAddedConn = character.DescendantAdded.Connect((object) => {
			// This is a part we want to invisify
			if (this.IsValidPartToModify(object)) {
				this.cachedParts.add(object);
				this.transparencyDirty = true;
				// There is now a tool under the character
			} else if (object.IsA("Tool")) {
				const tool = object;
				if (this.toolDescendantAddedConns.has(tool)) this.toolDescendantAddedConns.get(tool)!.Disconnect();
				this.toolDescendantAddedConns.set(
					tool,
					tool.DescendantAdded.Connect((toolChild) => {
						this.cachedParts.delete(toolChild as Fadeable);
						if (toolChild.IsA("BasePart") || toolChild.IsA("Decal")) {
							// Reset the transparency
							toolChild.LocalTransparencyModifier = 0;
						}
					}),
				);
				if (this.toolDescendantRemovingConns.has(tool)) this.toolDescendantRemovingConns.get(tool)!.Disconnect();
				this.toolDescendantRemovingConns.set(
					tool,
					tool.DescendantRemoving.Connect((formerToolChild) => {
						legacyWait(); // wait for new parent
						if (character && formerToolChild && formerToolChild.IsDescendantOf(character)) {
							if (this.IsValidPartToModify(formerToolChild)) {
								this.cachedParts.add(formerToolChild);
								this.transparencyDirty = true;
							}
						}
					}),
				);
			}
		});
		if (this.descendantRemovingConn) this.descendantRemovingConn.Disconnect();
		this.descendantRemovingConn = character.DescendantRemoving.Connect((object) => {
			if (this.cachedParts.has(object as Fadeable)) {
				this.cachedParts.delete(object as Fadeable);
				// Reset the transparency
				(object as Fadeable).LocalTransparencyModifier = 0;
			}
		});
		this.CachePartsRecursive(character);
	}

	Enable(enable: boolean): void {
		if (this.enabled !== enable) {
			this.enabled = enable;
			if (!FFlagUserTransparencyControllerDeltaTime) {
				this.Update();
			}
		}
	}

	SetSubject(subject: Humanoid | BasePart | undefined): void {
		let character: Model | undefined = undefined;
		if (subject && subject.IsA("Humanoid")) {
			character = subject.Parent as Model | undefined;
		}
		if (subject && subject.IsA("VehicleSeat") && subject.Occupant) {
			character = subject.Occupant.Parent as Model | undefined;
		}
		if (character) {
			this.SetupTransparency(character);
		} else {
			this.TeardownTransparency();
		}
	}

	Update(dt?: number): void {
		if (FFlagUserTransparencyControllerDeltaTime) {
			const currentCamera = game.Workspace.CurrentCamera;

			if (currentCamera && this.enabled) {
				// calculate goal transparency based on distance
				const distance = currentCamera.Focus.Position.sub(currentCamera.CoordinateFrame.Position).Magnitude;
				let transparency = distance < 2 ? 1.0 - (distance - 0.5) / 1.5 : 0; // (7 - distance) / 5
				if (transparency < 0.5) {
					// too far, don't control transparency
					transparency = 0;
				}

				// tween transparency if the goal is not fully transparent and the subject was not fully transparent last frame
				if (this.lastTransparency !== undefined && transparency < 1 && this.lastTransparency < 0.95) {
					let deltaTransparency = transparency - this.lastTransparency;
					const maxDelta = MAX_TWEEN_RATE * dt!;
					deltaTransparency = math.clamp(deltaTransparency, -maxDelta, maxDelta);
					transparency = this.lastTransparency + deltaTransparency;
				} else {
					this.transparencyDirty = true;
				}

				transparency = math.clamp(Util.Round(transparency, 2), 0, 1);

				// update transparencies
				if (this.transparencyDirty || this.lastTransparency !== transparency) {
					for (const child of this.cachedParts) {
						child.LocalTransparencyModifier = transparency;
					}
					this.transparencyDirty = false;
					this.lastTransparency = transparency;
				}
			}
		} else {
			let instant = false;
			const now = tick();
			const currentCamera = game.Workspace.CurrentCamera;

			if (currentCamera) {
				let transparency = 0;
				if (!this.enabled) {
					instant = true;
				} else {
					const distance = currentCamera.Focus.Position.sub(currentCamera.CoordinateFrame.Position).Magnitude;
					transparency = distance < 2 ? 1.0 - (distance - 0.5) / 1.5 : 0; // (7 - distance) / 5
					if (transparency < 0.5) {
						transparency = 0;
					}

					if (this.lastTransparency !== undefined) {
						let deltaTransparency = transparency - this.lastTransparency;

						// Don't tween transparency if it is instant or your character was fully invisible last frame
						if (!instant && transparency < 1 && this.lastTransparency < 0.95) {
							let maxDelta: number;
							if (FFlagUserTransparencyControllerDeltaTime) {
								maxDelta = MAX_TWEEN_RATE * dt!;
							} else {
								maxDelta = MAX_TWEEN_RATE * (now - this.lastUpdate);
							}
							deltaTransparency = math.clamp(deltaTransparency, -maxDelta, maxDelta);
						}
						transparency = this.lastTransparency + deltaTransparency;
					} else {
						this.transparencyDirty = true;
					}

					transparency = math.clamp(Util.Round(transparency, 2), 0, 1);
				}

				if (this.transparencyDirty || this.lastTransparency !== transparency) {
					for (const child of this.cachedParts) {
						child.LocalTransparencyModifier = transparency;
					}
					this.transparencyDirty = false;
					this.lastTransparency = transparency;
				}
			}
			this.lastUpdate = now;
		}
	}
}

export = TransparencyController;
