// Which persona prompt a turn runs under.
//
// Normally the caller's own saved persona (user_profiles.persona), with
// analyst.md as the fallback. The admin persona probe may name another
// persona to test it; that is honoured only for a verified platform admin.
// Anyone else's probe, an unknown name, or a failed admin check all fall back
// to the caller's own persona, so the probe can never widen what a normal
// account gets.
import { promptFile } from '../_shared/personaMap.ts';

export interface PersonaSources {
  profilePersona(): Promise<string | null | undefined>;
  isAdmin(): Promise<boolean>;
  readPersona(file: string): Promise<string>;
}

export async function resolvePersona(probe: string | undefined, s: PersonaSources): Promise<string> {
  const probeFile = probe ? promptFile(probe) : null;
  if (probeFile && await s.isAdmin().catch(() => false)) return await s.readPersona(probeFile);
  return await s.readPersona(promptFile(await s.profilePersona()) ?? 'analyst.md');
}
