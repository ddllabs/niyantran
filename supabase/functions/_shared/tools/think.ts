// The think tool. Not retrieval: it returns nothing and reads nothing. It exists
// so the model has somewhere to stand between searches.
//
// Why it is needed. The research loop offers tools on every pass and allows ten
// searches, and the prompt asks for repeated, differently phrased queries. In
// practice a small model reads one set of results and answers, because after the
// results come back its only moves are "call another tool" or "answer", and
// answering is always available. Three production turns each ran exactly one
// search while nine remained in budget.
//
// A no-op tool changes that: planning the next query is itself a move the model
// can make, and making it keeps the turn in the research phase, where tools are
// still offered. This is the pattern the DDL Labs tender orchestrator uses
// alongside its search and calculator tools.
//
// The thought is never shown to the reader and never reaches the answer. It is
// the model's working note, in the same category as `internalReasoning`, which
// the handler already drops.

export const THINK_TOOL = {
  type: 'function',
  function: {
    name: 'think',
    description:
      'Think before searching again. Use it to name what the last results did and did not answer, and to decide the next query. It retrieves nothing; it is a place to plan. Prefer it over answering when the record plainly holds more than you have read.',
    parameters: {
      type: 'object',
      properties: {
        thought: {
          type: 'string',
          description:
            'What the evidence so far establishes, what is still missing, and the next query you will run and why.',
        },
      },
      required: ['thought'],
      additionalProperties: false,
    },
  },
} as const;

/** The model's own note back to it. Nothing is retrieved and nothing is stored. */
export function executeThink(args: { thought?: unknown }): string {
  const thought = typeof args?.thought === 'string' ? args.thought.trim() : '';
  if (!thought) return 'NOTED: no thought was given. Search again or answer.';
  return 'NOTED. Now run the search you described, or answer if the record holds nothing further.';
}
