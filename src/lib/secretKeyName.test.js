// F3: one name for the Supabase server secret. SUPABASE_SECRET_KEY (an
// sb_secret_… key) is what Vercel and the scripts use; the legacy
// SUPABASE_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY names named the service_role JWT
// that was disabled on 2026-09-21, and reading them only hid misconfiguration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEGACY = /process\.env\.(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)\b|env\.(SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)\b/;

function sources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...sources(rel)); }
    else if (/\.(mjs|js|ts)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(rel);
  }
  return out;
}

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('Supabase secret key name', () => {
  it('no server, api, script or backend file reads a legacy secret-key name', () => {
    const offenders = ['server', 'api', 'scripts', 'backend/src']
      .flatMap(sources)
      .filter((file) => LEGACY.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the admin client needs SUPABASE_SECRET_KEY and ignores the legacy name', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_legacy_name');
    const { getSupabaseAdminClient } = await import('../../server/authEmailProvider.mjs');
    expect(() => getSupabaseAdminClient()).toThrow(/SUPABASE_SECRET_KEY is required/);
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_fixture');
    expect(getSupabaseAdminClient()).toBeTruthy();
  });

  it('Resend mode checks SUPABASE_SECRET_KEY at startup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('AUTH_EMAIL_PROVIDER', 'RESEND_API');
    vi.stubEnv('SUPABASE_URL', 'https://project.example.test');
    vi.stubEnv('RESEND_API_KEY', 're_fixture');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_fixture');
    const { validateEmailProviderStartup } = await import('../../server/authEmailProvider.mjs');
    validateEmailProviderStartup();
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/SECRET_KEY|SERVICE_ROLE_KEY/);
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    validateEmailProviderStartup();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/SUPABASE_SECRET_KEY is required for RESEND_API mode/);
    warn.mockRestore();
  });
});
