// Trophy unlock thresholds for every car (progression rework, 2026-07).
//
// SINGLE SOURCE OF TRUTH for car pricing: cars are gated by LIFETIME trophy
// count (🏆 earned per round win, never spent), not cash. The old `cost` /
// `category` attributes on ServerStorage.VehicleModels.* and the subclass
// Params are vestigial — nothing reads them for the shop any more.
//
// Ordering in the shop grid comes from these values (LayoutOrder = cost),
// ascending. 0 = starter car (owned by default or unlockable immediately).

export const CAR_TROPHY_COSTS: { readonly [name: string]: number } = {
	ToyCorolla: 0,
	ToyVan: 1,
	TokyoDrift: 3,
	MyFirstCar: 5,
	MacaiylaCurve: 9,
	FamilyRoadTrip: 13,
	Continental: 17,
	BumperCar: 21,
	MobBoss: 21,
	HippieVan: 21,
	Taxi: 26,
	AvonSkyline65: 26,
	CandyVan: 26,
	TroopTransport: 32,
	MarketTruck: 40,
	BmvV8: 40,
	LandRover: 40,
	Police: 48,
	DogeChallenger: 56,
	Wambulance: 65,
	APC: 65,
	Horse911: 75,
	["Horse911-95"]: 85,
	ArmouredTruck: 95,
	ArmouredTransport: 110,
	Bugati: 125,
	MillitaryTransport: 140,
	Lambo: 160,
	FireTruck: 250,
	Abrams: 350,
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
