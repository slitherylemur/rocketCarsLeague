// Developer products belonging to the current experience. Purchase prompts,
// receipt grants, and regional price labels all import this catalog.
// Nuke and Low Gravity removed (2026-07): deactivate products 3610880065 and
// 3610879966 in the Creator Dashboard — with no handler here a purchase would
// sit NotProcessedYet.
export const ProductIds = {
	RenameTeam: 3610880119,
	OverdriveCrate: 3610879934,
	Gold280000: 3610879848,
	Gold55000: 3610879807,
	Gold16000: 3610879780,
	Gold6250: 3610879741,
	Gold2000: 3610879698,
} as const;

export const PassIds = {
	Vip: 1917825932,
} as const;
