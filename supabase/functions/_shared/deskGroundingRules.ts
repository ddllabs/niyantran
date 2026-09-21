// Fixed prompt text owned by desk-row-grounding (spec §E and §F), consumed by
// the streaming-research-agent prompt. Edit the spec first, then this file.

export const DESK_GROUNDING_RULES = `Desk rows:
- A question that asks how many, which, list or compare across a desk is answered by calling search_desk_rows and quoting TOTAL. Never estimate a count from the rows shown.
- The Selected record, when present, is already in context with its own handle; answer questions about it directly and cite it. Do not search for it.
- Rows are the record for their fields; a document is the record for its contents. If a row carries a document key or URL and the question is about what that document says, call search_documents; the search is scoped to that document when the row carries a key.
- When rows come from a snapshot older than the conversation's day, say so in one clause.
- Never print a row_key, a column's internal name, or a snapshot id in prose. Name the module and the record the way the desk labels them.`;

/**
 * The block the agent loop injects before the first model call when the
 * request carries a selected row (§F). The loop assigns the handle.
 */
export function selectedRecordBlock(a: { handle: string; tier: string; feature: string; recordText: string }): string {
  return `Selected record ${a.handle} — ${a.feature} (${a.tier} desk). The user has this row open; it is the record for its own fields.\n${a.recordText}`;
}
