/** Hard caps that keep a scan bounded. They are backstops, not content targets. */
export const MAX_SYSTEMS = 24;
export const MAX_DOCS_PER_SYSTEM = 6;
export const MAX_CREATES = 120;
/** How many existing docs one work item may fold into itself. */
export const MAX_ABSORBS = 6;
export const MAX_DOC_CHARS = 20_000;
/** A document shorter than this cannot carry a concept; it is almost certainly a stub or a mistake. */
export const MIN_DOC_CHARS = 400;
export const MAX_README_CHARS = 24_000;
export const README_NARRATIVE_WORDS = 250;

/** Defaults for delta scans (when to give up on an incremental update and redo everything). */
export const DELTA_MAX_CHANGED_FILES = 500;
export const DELTA_MAX_CITED_SHARE = 0.5;
export const DELTA_MAX_FULL_SCAN_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Territory sizing: a file counts for at most this many bytes so one huge file cannot dominate. */
export const FILE_WEIGHT_CAP = 32_768;
export const TERRITORY_WEIGHT = 2_000_000;
export const MAX_SCOUTS = 16;

export const MAX_STEPS_PER_AGENT = 30;
export const SUBMIT_NUDGES = 2;
