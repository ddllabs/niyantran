// The canonical persona map (foundation spec §E). Mirrors src/lib/personaMap.js
// by hand in this cut; the streaming module adds the generator and parity test.

export interface PersonaEntry {
  db: string; // app_persona enum value
  frontend: string; // id used by src/lib/personas.js and userTypes.js
  prompt: string; // prompt file under _shared/personas/
}

export const PERSONA_MAP: readonly PersonaEntry[] = [
  { db: 'policy_analyst', frontend: 'policy', prompt: 'policy.md' },
  { db: 'journalist', frontend: 'journalist', prompt: 'journalist.md' },
  { db: 'upsc_aspirant', frontend: 'student', prompt: 'student.md' },
  { db: 'corporate_affairs', frontend: 'analyst', prompt: 'analyst.md' },
  { db: 'legal_researcher', frontend: 'lawyer', prompt: 'lawyer.md' },
  { db: 'academic', frontend: 'academic', prompt: 'student.md' },
];

export function dbPersona(frontendId: string | null | undefined): string | null {
  return PERSONA_MAP.find((p) => p.frontend === frontendId)?.db ?? null;
}

export function frontendPersona(db: string | null | undefined): string | null {
  return PERSONA_MAP.find((p) => p.db === db)?.frontend ?? null;
}

export function promptFile(db: string | null | undefined): string | null {
  return PERSONA_MAP.find((p) => p.db === db)?.prompt ?? null;
}
