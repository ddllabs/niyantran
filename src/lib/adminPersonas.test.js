import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./userStore.js', () => ({ verifiedLocalIdentity: vi.fn(), localIdentityIsCurrent: vi.fn() }));
vi.mock('./supabaseClient.js', () => ({ functionsUrl: name => `https://test/${name}` }));
import { verifiedLocalIdentity, localIdentityIsCurrent } from './userStore.js';
import { adminPersonas, personaEditorState } from './adminPersonas.js';
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const saved = { draft_text: '  Exact\nπ ', draft_id: 'v2', active_id: 'v1' };
describe('server persona editor', () => {
  it('distinguishes unsaved, saved and active versions by identity rather than text trimming', () => {
    expect(personaEditorState(saved, saved.draft_text)).toBe('Saved draft · not published');
    expect(personaEditorState(saved, saved.draft_text.trim())).toBe('Unsaved changes');
    expect(personaEditorState({ ...saved, active_id:'v2' }, saved.draft_text)).toBe('Published version');
  });
  it('sends exact text through the authenticated endpoint and preserves conflicts', async () => {
    verifiedLocalIdentity.mockResolvedValue({id:'pilot',token:'fixture'});
    localIdentityIsCurrent.mockResolvedValue(true);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error:'Version conflict' }),{status:409}));
    vi.stubGlobal('fetch',fetch);
    await expect(adminPersonas({action:'save',text:saved.draft_text,expected:1})).rejects.toMatchObject({status:409});
    expect(JSON.parse(fetch.mock.calls[0][1].body).text).toBe(saved.draft_text);
  });
  it('does not expose previous-account data after identity changes during a request', async () => {
    verifiedLocalIdentity.mockResolvedValue({id:'pilot',token:'fixture'});
    localIdentityIsCurrent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({states:[{draft_text:'private'}]}))));
    await expect(adminPersonas()).rejects.toThrow('Account changed');
  });
});

it('turns a transport failure into an actionable message without losing editor text', async () => {
  verifiedLocalIdentity.mockResolvedValue({id:'pilot',token:'fixture'});
  localIdentityIsCurrent.mockResolvedValue(true);
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch');}));
  await expect(adminPersonas()).rejects.toThrow('Your editor text is retained; reload server versions before retrying.');
});
