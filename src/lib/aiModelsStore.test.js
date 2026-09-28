import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  AI_ROLES,
  activeAiProvider,
  getAiProvider,
  liveAiProviders,
  loadAiModels,
  pickAiRole,
  shortModelLabel,
} from './aiModelsStore.js';

// Live role models on 2026-09-28 (spec 2026-09-28-ai-path-fixes, Task B).
const LIVE_ROLE_MODELS = {
  DEFAULT_ANALYST: 'google/gemini-3.5-flash-lite',
  EXPERT_ESCALATION: 'openai/gpt-6-astra',
  PDF_PARSER: 'google/gemini-3.5-flash-lite',
  VISUAL_RESEARCH: 'google/gemini-3.7-flash',
};
const RETIRED = /gemini-2\.0-flash|gemini-flash-1\.5|gpt-4o/;

describe('aiModelsStore static fallback carries the live role models', () => {
  it('each role names its live model', () => {
    expect(Object.fromEntries(AI_ROLES.map((r) => [r.id, r.model]))).toEqual(LIVE_ROLE_MODELS);
  });

  it('each legacy provider alias names the live model of its role', () => {
    const byId = Object.fromEntries(AI_PROVIDERS.map((p) => [p.id, p.model]));
    expect(byId['gemini-lite']).toBe(LIVE_ROLE_MODELS.DEFAULT_ANALYST);
    expect(byId['gemini-flash']).toBe(LIVE_ROLE_MODELS.VISUAL_RESEARCH);
    expect(byId['gpt-astra']).toBe(LIVE_ROLE_MODELS.EXPERT_ESCALATION);
  });

  it('carries no retired model ID anywhere', () => {
    expect(JSON.stringify({ AI_PROVIDERS, AI_ROLES })).not.toMatch(RETIRED);
  });

  it('keeps the short labels the admin picker shows', () => {
    const label = Object.fromEntries(AI_ROLES.map((r) => [r.id, shortModelLabel(r)]));
    expect(label).toEqual({
      DEFAULT_ANALYST: 'Gemini - Lite',
      EXPERT_ESCALATION: 'GPT - Astra',
      PDF_PARSER: 'Gemini - Lite',
      VISUAL_RESEARCH: 'Gemini - Flash',
    });
  });

  it('keeps the exported helpers working without browser storage', () => {
    const roles = loadAiModels();
    expect(roles.map((r) => r.model)).toEqual(AI_ROLES.map((r) => r.model));
    expect(pickAiRole([], 'AUTO').id).toBe('DEFAULT_ANALYST');
    expect(pickAiRole([{ kind: 'pdf' }]).id).toBe('PDF_PARSER');
    expect(pickAiRole([{ kind: 'image' }]).id).toBe('VISUAL_RESEARCH');
    expect(pickAiRole([], 'EXPERT_ESCALATION').model).toBe(LIVE_ROLE_MODELS.EXPERT_ESCALATION);
    expect(activeAiProvider().model).toBe(LIVE_ROLE_MODELS.DEFAULT_ANALYST);
    expect(getAiProvider('gpt-astra').model).toBe(LIVE_ROLE_MODELS.EXPERT_ESCALATION);
    expect(liveAiProviders()).toHaveLength(AI_PROVIDERS.length);
  });
});
