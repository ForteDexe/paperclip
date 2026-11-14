/**
 * Replaceable presentation vocabulary for Outpost.
 *
 * These labels are for human-facing copy only. Canonical domain identifiers,
 * API routes, database columns, event codes, and protocol values must continue
 * to use their stable names (for example `spaceId`, `defaultAgentId`, and
 * `/spaces`).
 */
export type ProductVocabularyTerm = Readonly<{
  singular: string;
  plural: string;
  lowerSingular: string;
  lowerPlural: string;
}>;

const term = (singular: string, plural: string): ProductVocabularyTerm => ({
  singular,
  plural,
  lowerSingular: singular.toLocaleLowerCase("en-US"),
  lowerPlural: plural.toLocaleLowerCase("en-US"),
});

export const PRODUCT_VOCABULARY = Object.freeze({
  product: term("Outpost", "Outposts"),
  space: term("Space", "Spaces"),
  agent: term("Agent", "Agents"),
  defaultAgent: term("Default agent", "Default agents"),
  coordinationLead: term("Coordination lead", "Coordination leads"),
  agentHierarchy: term("Agent hierarchy", "Agent hierarchies"),
  northStar: term("North Star", "North Stars"),
  campfire: term("Campfire", "Campfires"),
  room: term("Room", "Rooms"),
  human: term("Human", "Humans"),
  user: term("User", "Users"),
  operator: term("Operator", "Operators"),
  task: term("Task", "Tasks"),
  decision: term("Decision", "Decisions"),
  artifact: term("Artifact", "Artifacts"),
  case: term("Case", "Cases"),
} as const);

export type ProductVocabularyKey = keyof typeof PRODUCT_VOCABULARY;
export type ProductVocabularyCasing = "title" | "lower";

export function productLabel(
  key: ProductVocabularyKey,
  options: Readonly<{ count?: number; casing?: ProductVocabularyCasing }> = {},
): string {
  const selected = PRODUCT_VOCABULARY[key];
  const plural = options.count !== undefined && options.count !== 1;
  if (options.casing === "lower") {
    return plural ? selected.lowerPlural : selected.lowerSingular;
  }
  return plural ? selected.plural : selected.singular;
}

export function countedProductLabel(
  key: ProductVocabularyKey,
  count: number,
  casing: ProductVocabularyCasing = "lower",
): string {
  return `${count} ${productLabel(key, { count, casing })}`;
}
