/**
 * The canonical persona map (foundation spec §E). The edge-function twin is
 * supabase/functions/_shared/personaMap.ts; keep the rows identical.
 * personas.js and userTypes.js are not edited; this is a lookup beside them.
 */
export const PERSONA_MAP = Object.freeze([
  { db: 'policy_analyst', frontend: 'policy', prompt: 'policy.md' },
  { db: 'journalist', frontend: 'journalist', prompt: 'journalist.md' },
  { db: 'upsc_aspirant', frontend: 'student', prompt: 'student.md' },
  { db: 'corporate_affairs', frontend: 'analyst', prompt: 'analyst.md' },
  { db: 'legal_researcher', frontend: 'lawyer', prompt: 'lawyer.md' },
  { db: 'academic', frontend: 'academic', prompt: 'student.md' },
]);

/** Frontend persona id → app_persona enum value, or null. */
export function dbPersona(frontendId) {
  return PERSONA_MAP.find((p) => p.frontend === frontendId)?.db ?? null;
}

/** app_persona enum value → frontend persona id, or null. */
export function frontendPersona(db) {
  return PERSONA_MAP.find((p) => p.db === db)?.frontend ?? null;
}
