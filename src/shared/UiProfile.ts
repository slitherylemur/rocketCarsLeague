// UiProfile — shape of the Ui_GetProfile RemoteFunction payload (client-side
// UI migration, Phase 5). One JSON-safe table with everything the client-owned
// garage needs to render inventory/shop state. The server builds it in
// src/server/ui/profileSnapshot.ts; the client refetches whenever the
// CB_ProfileVersion player attribute bumps (any owned/equipped dataset write).
//
// Live counters (money/trophies) are NOT versioned through this — they render
// directly from the CB_Money / CB_Trophies player attributes.

export interface UiProfileSnapshot {
	money: number;
	trophies: number;
	renameCredits: number;
	vip: boolean;
	equippedVehicle: string;
	equippedColor?: string;
	equippedHorn?: string;
	equippedTrail?: string;
	ownedVehicles: string[];
	ownedColors: string[];
	ownedHorns: string[];
	ownedTrails: string[];
}
