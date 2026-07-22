// Builds each player's vehicle InputContext (SERVER_AUTHORITY_PLAN.md
// Phase 3). InputActions are the only client-authoritative data the server
// authority rollback system replays, so every input that affects the car
// simulation lives here. The context must be a descendant of the Player so
// the engine knows who owns it.
//
// Layout (names from VehicleInput in the shared sim):
//   Player.VehicleControls (InputContext, Enabled toggled by the sim while driving)
//     Throttle     Direction1D  W+1 / S-1 / R2+1 / L2-1
//     Steer        Direction1D  D+1 / A-1
//     SteerStick   Direction2D  Thumbstick1 (X read with deadzone)
//     ThrottleTouch/SteerTouch  Direction1D, no bindings — the client's
//                  mobile joystick code fires these programmatically
//     Drift/Boost/Jump/RollLeft/RollRight  Bool:
//       "Primary" binding — the player's rebindable key (DataStore keyBinds)
//       "Gamepad" binding — fixed controller button
//       "Touch"   binding — empty; the client assigns UIButton locally
//
// The keybindings menu keeps working: SetKeyBinding (initializePlayer) calls
// updateBinding() here to retarget the live Primary binding.

import DataUtils from "./DataUtilities";
import { VehicleInput } from "shared/vehicleSim/VehicleSim";

const DEFAULT_KEYS = new Map<string, Enum.KeyCode>([
	[VehicleInput.Drift, Enum.KeyCode.Space],
	[VehicleInput.Boost, Enum.KeyCode.LeftShift],
	[VehicleInput.Jump, Enum.KeyCode.R],
	[VehicleInput.RollLeft, Enum.KeyCode.Q],
	[VehicleInput.RollRight, Enum.KeyCode.E],
]);

const GAMEPAD_KEYS = new Map<string, Enum.KeyCode>([
	[VehicleInput.Drift, Enum.KeyCode.ButtonL1],
	[VehicleInput.Boost, Enum.KeyCode.ButtonR1],
	// ButtonA is safe here even though it doubles as UI "accept": the whole
	// context is only Enabled while actually driving.
	[VehicleInput.Jump, Enum.KeyCode.ButtonA],
	[VehicleInput.RollLeft, Enum.KeyCode.ButtonL3],
	[VehicleInput.RollRight, Enum.KeyCode.ButtonR3],
]);

// Bool actions that get a client-assigned mobile UIButton.
const TOUCH_ACTIONS = new Set<string>([VehicleInput.Drift, VehicleInput.Boost, VehicleInput.Jump]);

function makeAction(parent: Instance, name: string, actionType: Enum.InputActionType): InputAction {
	const action = new Instance("InputAction");
	action.Name = name;
	action.Type = actionType;
	action.Parent = parent;
	return action;
}

function makeBinding(action: InputAction, name: string, keyCode?: Enum.KeyCode, scale?: number): InputBinding {
	const binding = new Instance("InputBinding");
	binding.Name = name;
	if (keyCode !== undefined) {
		binding.KeyCode = keyCode;
	}
	if (scale !== undefined) {
		binding.Scale = scale;
	}
	binding.Parent = action;
	return binding;
}

function savedKeyFor(player: Player, actionName: string): Enum.KeyCode {
	const fallback = DEFAULT_KEYS.get(actionName)!;
	const [ok, saved] = pcall(() => DataUtils.GetKeyBinding(player, actionName));
	if (ok && saved !== undefined && tostring(saved.EnumType) === "KeyCode") {
		return saved as Enum.KeyCode;
	}
	return fallback;
}

// Players whose context build is in flight: the build yields on DataStore
// reads, during which a second ensureContext call would pass the
// FindFirstChild guard and produce a duplicate context.
const buildingContext = new Set<Player>();

const VehicleInputActions = {
	ensureContext(player: Player) {
		if (player.FindFirstChild(VehicleInput.ContextName) || buildingContext.has(player)) {
			return;
		}
		buildingContext.add(player);
		const [ok, err] = pcall(() => VehicleInputActions.buildContext(player));
		buildingContext.delete(player);
		if (!ok) {
			warn(`[vehicleInputActions] building ${player.Name}'s VehicleControls failed: ${err}`);
		}
	},

	buildContext(player: Player) {
		const context = new Instance("InputContext");
		context.Name = VehicleInput.ContextName;
		context.Enabled = false; // the sim enables it while driving
		context.Sink = false; // never eat inputs from menus/other systems

		// One Bool action per movement key: multiple bindings on one 1D action
		// resolve as "latest event wins", which dropped a held key's direction
		// when the opposite key was released. Per-key state is combined in the
		// sim instead.
		makeBinding(
			makeAction(context, VehicleInput.ThrottleForward, Enum.InputActionType.Bool),
			VehicleInput.PrimaryBinding,
			Enum.KeyCode.W,
		);
		makeBinding(
			makeAction(context, VehicleInput.ThrottleBackward, Enum.InputActionType.Bool),
			VehicleInput.PrimaryBinding,
			Enum.KeyCode.S,
		);
		makeBinding(
			makeAction(context, VehicleInput.SteerRight, Enum.InputActionType.Bool),
			VehicleInput.PrimaryBinding,
			Enum.KeyCode.D,
		);
		makeBinding(
			makeAction(context, VehicleInput.SteerLeft, Enum.InputActionType.Bool),
			VehicleInput.PrimaryBinding,
			Enum.KeyCode.A,
		);

		// Analog throttle for gamepad triggers keeps its own 1D axis.
		const throttleAxis = makeAction(context, VehicleInput.ThrottleAxis, Enum.InputActionType.Direction1D);
		makeBinding(throttleAxis, "TriggerForward", Enum.KeyCode.ButtonR2, 1);
		makeBinding(throttleAxis, "TriggerBackward", Enum.KeyCode.ButtonL2, -1);

		const steerStick = makeAction(context, VehicleInput.SteerStick, Enum.InputActionType.Direction2D);
		makeBinding(steerStick, "Thumbstick", Enum.KeyCode.Thumbstick1);

		makeAction(context, VehicleInput.ThrottleTouch, Enum.InputActionType.Direction1D);
		makeAction(context, VehicleInput.SteerTouch, Enum.InputActionType.Direction1D);

		for (const [actionName] of DEFAULT_KEYS) {
			const action = makeAction(context, actionName, Enum.InputActionType.Bool);
			makeBinding(action, VehicleInput.PrimaryBinding, savedKeyFor(player, actionName));
			makeBinding(action, VehicleInput.GamepadBinding, GAMEPAD_KEYS.get(actionName)!);
			if (TOUCH_ACTIONS.has(actionName)) {
				makeBinding(action, VehicleInput.TouchBinding);
			}
		}

		// The keybind reads above yield — the player may have left meanwhile.
		if (player.Parent === undefined) {
			context.Destroy();
			return;
		}
		context.Parent = player;
	},

	// Live-rebind the Primary key when the keybindings menu changes it. Mouse
	// buttons can't be expressed as an InputBinding.KeyCode — the DataStore
	// still saves them (menu display works), the live binding just keeps its
	// previous key.
	updateBinding(player: Player, actionName: string, key: EnumItem) {
		if (!DEFAULT_KEYS.has(actionName)) {
			return; // Horn (and anything else) stays on the legacy CAS path
		}
		if (tostring(key.EnumType) !== "KeyCode") {
			warn(`[vehicleInputActions] ${actionName}: ${key} is not a KeyCode; live binding unchanged`);
			return;
		}
		const context = player.FindFirstChild(VehicleInput.ContextName);
		const action = context && context.FindFirstChild(actionName);
		const binding = action && action.FindFirstChild(VehicleInput.PrimaryBinding);
		if (binding && binding.IsA("InputBinding")) {
			binding.KeyCode = key as Enum.KeyCode;
		}
	},
};

export = VehicleInputActions;
