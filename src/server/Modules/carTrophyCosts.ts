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
	ToyVan: 0,
	TokyoDrift: 1,
	MyFirstCar: 3,
	MacaiylaCurve: 5,
	FamilyRoadTrip: 9,
	Continental: 13,
	BumperCar: 17,
	MobBoss: 21,
	HippieVan: 21,
	Taxi: 21,
	AvonSkyline65: 26,
	CandyVan: 26,
	TroopTransport: 26,
	MarketTruck: 32,
	BmvV8: 40,
	LandRover: 40,
	Police: 40,
	DogeChallenger: 48,
	Wambulance: 56,
	APC: 65,
	Horse911: 65,
	["Horse911-95"]: 75,
	ArmouredTruck: 85,
	ArmouredTransport: 95,
	Bugati: 110,
	MillitaryTransport: 125,
	Lambo: 140,
	FireTruck: 160,
	Abrams: 250,
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
