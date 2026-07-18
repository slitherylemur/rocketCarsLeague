// Goal-part discovery, shared by the match layer (footballMatch) and
// PitchManager's variant fallback. Lives in its own module so PitchManager no
// longer requires footballMatch — footballMatch now value-imports PitchManager
// (mid-round addPitch), and a PitchManager → footballMatch require would be a
// runtime cycle (Luau errors on recursive require).

export function findGoalPart(map: Instance, colorWord: string): BasePart | undefined {
	for (const descendant of map.GetDescendants()) {
		if (!descendant.IsA("BasePart")) {
			continue;
		}
		const name = descendant.Name.lower();
		if (name.find("goal")[0] !== undefined && name.find(colorWord)[0] !== undefined) {
			return descendant;
		}
	}
	return undefined;
}

export function mapHasGoalParts(map: Instance): boolean {
	return findGoalPart(map, "blue") !== undefined && findGoalPart(map, "red") !== undefined;
}
