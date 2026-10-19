/** Questions about what a change would affect: change, rename, remove, break, impact, who uses, which callers, depend on. */
const IMPACT_QUERY = /\b(chang(?:e|es|ed|ing)|renam(?:e|es|ed|ing)|remov(?:e|es|ed|ing|al)|break(?:s|ing)?|broke|affect(?:s|ed|ing)?|impact(?:s|ed|ing)?|who uses|which callers|depend(?:s|ed|ing)? on)\b/i;

export const isImpactQuery = (query: string) => IMPACT_QUERY.test(query);

/** The recipe itself: one text, three framings (brief steps, UI Ask section, static MCP instructions). */
const RECIPE = [
  "Name the exact declaration that changes: locate it with find_symbol_definitions (or grep with sym:Name) and read it with read_file. If several declarations share the name, list them and say which one you analysed.",
  "Find uses in every repository in scope with find_symbol_references, then grep the bare name and its string forms (configuration keys, route paths, serialized field names, SQL columns, i18n keys). A use that belongs to a different declaration is a name clash: read it and leave it out.",
  "For each real use, read the surrounding code and say how it depends on the changed behaviour (called, overridden, implemented, subclassed, deserialized, rendered). Follow one hop outward from each public or exported use: who calls that function?",
  "Check tests, generated code and other languages in scope; a Java service's REST contract may be consumed by TypeScript, so search its paths and field names there too.",
  "In the answer give the confirmed affected locations with citations, then the likely but unverified ones marked as such, then what you could not check (repositories out of scope, dynamic dispatch, reflection). Never present an empty search as \"no effect\".",
];

/** Appended to the research brief (steps 6 to 10) for an impact question when the recipe is enabled. */
export const IMPACT_BRIEF_STEPS = `This question is about the effect of a change, so also do the following before you stop:\n${RECIPE.map((s, i) => `${i + 6}. ${s}`).join("\n")}`;

/** A section of the UI Ask system prompt, added after the per-chat context only for an impact question. */
export const IMPACT_PROMPT = `<impact_and_change_instructions>\nThe question is about the effect of a change. In the research phase:\n${RECIPE.map((s) => `- ${s}`).join("\n")}\n</impact_and_change_instructions>`;

/**
 * Appended to the MCP server instructions when MCP_IMPACT_RECIPE=on. Instructions are sent at initialize,
 * before any question exists, so the recipe is a conditional paragraph the client's model applies itself.
 */
export const IMPACT_INSTRUCTIONS = `When a question asks what a change would affect (changing, renaming, removing or breaking something, who uses it, which callers or dependants):\n${RECIPE.map((s) => `- ${s}`).join("\n")}`;
