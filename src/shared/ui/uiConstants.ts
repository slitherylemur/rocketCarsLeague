// UI constants extracted from the original StarterGui templates in the place
// file. The templates themselves are replaced by the server-rendered React UI,
// so code that read template properties (game.StarterGui.…) reads these
// constants instead. Adjust here if a template value changes.

// PlayerGui.Garage.cashPurchace open Size — the cash-menu open-tween target
// (originally read from game.StarterGui.Garage.cashPurchace.Size; the opener
// lives client-side in src/client/ui/garage.client.ts since Phase 5). Must
// match the cashPurchace frame Size in GarageGui.tsx (shrunk when the
// multiplier tiles were removed).
export const CASH_PURCHACE_MENU_OPEN_SIZE = new UDim2(0.660000026, 0, 0.449999988, 0);
