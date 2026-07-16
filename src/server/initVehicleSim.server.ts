// Bootstraps the shared vehicle simulation on the server
// (SERVER_AUTHORITY_PLAN.md Phase 2). In Phase 4 a client-side counterpart
// initializes the same module under RunService:BindToSimulation() so the
// local car can be predicted.

import * as VehicleSim from "shared/vehicleSim/VehicleSim";

VehicleSim.initialize();
