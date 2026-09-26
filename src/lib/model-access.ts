/**
 * Which models a tier lets its users use. Two ways of saying it, for the two
 * things an operator means: `allow` names the only models allowed — a tier
 * kept to a few cheap ones, which a newly added model does not join; `deny`
 * names the only models kept out — a tier open to everything but a few
 * expensive ones, which a newly added model does join. An empty list means
 * every model, whichever way it is read.
 */
export type ModelRestrictionMode = 'allow' | 'deny';

export function allowsModel(
  tier: { modelRestrictionMode: ModelRestrictionMode; modelIds: string[] },
  modelKey: string
): boolean {
  if (tier.modelIds.length === 0) return true;
  const listed = tier.modelIds.includes(modelKey);
  return tier.modelRestrictionMode === 'allow' ? listed : !listed;
}

/** The list as the console sums it up: "All", "3 allowed", "3 blocked". */
export function describeModelList(tier: {
  modelRestrictionMode: ModelRestrictionMode;
  modelIds: string[];
}): string {
  const n = tier.modelIds.length;
  if (n === 0) return 'All';
  return `${n} ${tier.modelRestrictionMode === 'allow' ? 'allowed' : 'blocked'}`;
}
