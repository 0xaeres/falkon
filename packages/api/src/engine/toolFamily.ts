/** A tool family is on unless its variable is the text `off`, in any case, ignoring surrounding spaces; unset, empty, `0`, `false` and every other value leave it on (cycle 19c). Shared by MCP and the Ask agent. */
export const familyOn = (name: "MCP_HISTORY_TOOLS" | "MCP_GIT_TOOLS") => process.env[name]?.trim().toLowerCase() !== "off";
