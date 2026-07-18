// Server bootstrap for the shared custom ball physics: the server runs the
// authoritative simulation; every client runs the same module predicted
// (initBallSim.client.ts).

import * as BallSim from "shared/ballSim/BallSim";

BallSim.initialize();
