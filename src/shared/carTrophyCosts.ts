// Trophy unlock thresholds for every car (progression rework, 2026-07).
//
// SINGLE SOURCE OF TRUTH for car pricing: cars are gated by LIFETIME trophy
// count (🏆 earned per round win, never spent), not cash. The old `cost` /
// `category` attributes on ServerStorage.VehicleModels.* and the subclass
// Params are vestigial — nothing reads them for the shop any more.
//
// Ordering in the shop grid comes from these values (LayoutOrder = cost),
// ascending. 0 = starter car (owned by default or unlockable immediately).

// Curve: ~15% geometric growth per car, all values distinct so LayoutOrder
// is a strict total order. Calibrated against the earn rate in
// footballMatch.ts (🏆+1 per round win, 🏆+2 champions round; 6 rounds of
// ~3.5 min per session → an average player banks ~3-4 🏆 per ~22 min
// session). Early cars land every win or two, mid cars every session or
// two, and the endgame cars are multi-hour goals.
export const CAR_TROPHY_COSTS: { readonly [name: string]: number } = {
	ToyCorolla: 0,
	ToyVan: 1,
	TokyoDrift: 2,
	MyFirstCar: 4,
	MacaiylaCurve: 6,
	FamilyRoadTrip: 9,
	Continental: 12,
	BumperCar: 16,
	MobBoss: 20,
	HippieVan: 25,
	Taxi: 30,
	AvonSkyline65: 36,
	CandyVan: 42,
	TroopTransport: 50,
	MarketTruck: 58,
	BmvV8: 68,
	LandRover: 78,
	Police: 90,
	DogeChallenger: 105,
	Wambulance: 120,
	APC: 140,
	Horse911: 160,
	["Horse911-95"]: 185,
	ArmouredTruck: 210,
	ArmouredTransport: 240,
	Bugati: 275,
	MillitaryTransport: 310,
	Lambo: 350,
	FireTruck: 400,
	Abrams: 450,
	TestVehicle: 999999,
};

export function getCarTrophyCost(name: string): number {
	const cost = CAR_TROPHY_COSTS[name];
	if (cost === undefined) {
		warn(`[carTrophyCosts] no trophy cost for car "${name}" — defaulting to 999999`);
		return 999999;
	}
	return cost;
}
