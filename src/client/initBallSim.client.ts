// Client bootstrap for the shared custom ball physics: the ball is
// PredictionMode.On (server marks it at spawn; ballRenderer re-asserts), so
// running the same sim here under BindToSimulation is what lets the engine
// predict and rollback-correct the ball — local car touches resolve
// instantly with no server round-trip.

import * as BallSim from "shared/ballSim/BallSim";

BallSim.initialize();
