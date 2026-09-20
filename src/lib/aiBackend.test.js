import { describe, expect, it } from 'vitest';
import { aiBackend } from './aiBackend.js';

describe('aiBackend', () => {
  it('is legacy unless the flag is exactly "supabase"', () => {
    expect(aiBackend({})).toBe('legacy');
    expect(aiBackend({ VITE_AI_BACKEND: '' })).toBe('legacy');
    expect(aiBackend({ VITE_AI_BACKEND: 'Supabase' })).toBe('legacy');
    expect(aiBackend({ VITE_AI_BACKEND: 'true' })).toBe('legacy');
    // null bypasses the default parameter, so this does not read the ambient env
    expect(aiBackend(null)).toBe('legacy');
  });

  it('is supabase when the flag says so', () => {
    expect(aiBackend({ VITE_AI_BACKEND: 'supabase' })).toBe('supabase');
  });
});
