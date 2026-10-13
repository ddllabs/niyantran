import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDocumentKeys, resetCoverageCache } from '../lib/corpusCoverage.js';
import WebSearchToggle, { isWebGated, predictWeb, webToggleView } from './WebSearchToggle.jsx';

// AiPanel is rendered below to check where the globe sits and what the panel feeds it; its thread
// controller and store are replaced exactly as AiPanel.test.jsx replaces them.
const fake = vi.hoisted(() => ({ research: null }));
vi.mock('../lib/aiThreads.js', () => ({ activeAiChat: () => null, addChatAttachments() {}, appendAiMessage() {}, createAiChat() {}, deleteAiChat() {},
  ensureAiChat: () => ({ chats: [], activeId: '' }), setActiveAiChat() {}, setChatAttachments() {}, setChatRole() {}, subscribeAiChats: () => () => {},
  hydrateConversations() {}, reconcileTurn() {} }));
vi.mock('./useResearchThread.js', () => ({ default: () => fake.research }));
import AiPanel from './AiPanel.jsx';

// F130 T4a: the composer globe (web-search spec section 6).
const on = (reason) => ({ on: true, reason });
const off = (reason) => ({ on: false, reason });

describe('webToggleView: what the globe shows and why', () => {
  it('follows the predicted default when the reader has not overridden it', () => {
    expect(webToggleView({ predicted: on('record-without-document'), focus: 'attached' }))
      .toEqual({ on: true, disabled: false, label: 'Web search on (automatic): this record has no indexed document' });
    expect(webToggleView({ predicted: on('module-without-documents'), focus: 'desk' }).label)
      .toBe('Web search on (automatic): this module has no indexed documents');
    expect(webToggleView({ predicted: off('documents-in-scope'), focus: 'attached' }))
      .toEqual({ on: false, disabled: false, label: 'Web search off (automatic): this record has indexed documents' });
    expect(webToggleView({ predicted: off('documents-in-scope'), focus: 'desk' }).label)
      .toBe('Web search off (automatic): this module has indexed documents');
    expect(webToggleView({ predicted: off('broad'), focus: 'broad' }).label)
      .toBe('Web search off (automatic): broad questions use the indexed documents');
    expect(webToggleView({ predicted: off('no-record'), focus: 'attached' }).label)
      .toBe('Web search off (automatic): no record is in scope');
  });

  it('an unknown prediction is off and says only that it is automatic', () => {
    expect(webToggleView({ predicted: off(null), focus: 'attached' })).toMatchObject({ on: false, label: 'Web search off (automatic)' });
    expect(webToggleView({ predicted: null, focus: 'attached' })).toMatchObject({ on: false, label: 'Web search off (automatic)' });
  });

  it('the reader\'s override beats the prediction, in both directions', () => {
    expect(webToggleView({ override: false, predicted: on('record-without-document') }))
      .toEqual({ on: false, disabled: false, label: 'Web search off (you turned it off)' });
    expect(webToggleView({ override: true, predicted: off('documents-in-scope') }))
      .toEqual({ on: true, disabled: false, label: 'Web search on (you turned it on)' });
  });

  it('a gated model disables the globe and says why, whatever else is set', () => {
    const view = webToggleView({ override: true, predicted: on('record-without-document'), gated: true });
    expect(view).toEqual({ on: false, disabled: true, label: "This model can't search the web" });
  });

  it('while a turn streams the globe is disabled and keeps showing its state', () => {
    expect(webToggleView({ override: true, streaming: true })).toEqual({ on: true, disabled: true, label: 'Web search on (you turned it on)' });
  });

  it('the server\'s decision for the turn in flight wins when it disagrees with the prediction', () => {
    const view = webToggleView({ predicted: off('documents-in-scope'), focus: 'attached', streaming: true,
      server: { offered: true, mode: 'auto', reason: 'record-without-document' } });
    expect(view).toEqual({ on: true, disabled: true, label: 'Web search on (automatic): this record has no indexed document' });
    expect(webToggleView({ override: true, streaming: true, server: { offered: false, mode: 'on', reason: 'conversational' } }))
      .toMatchObject({ on: false, label: 'Web search off: this message needs no search' });
    expect(webToggleView({ override: true, streaming: true, server: { offered: false, mode: 'on', reason: 'model-unsupported' } }))
      .toMatchObject({ on: false, label: "This model can't search the web" });
    expect(webToggleView({ streaming: true, server: { offered: true, mode: 'on', reason: 'override-on' } }))
      .toMatchObject({ on: true, label: 'Web search on (you turned it on)' });
    expect(webToggleView({ streaming: true, server: { offered: false, mode: 'off', reason: 'override-off' } }))
      .toMatchObject({ on: false, label: 'Web search off (you turned it off)' });
  });

  it('a server decision with an unknown reason still sets the state, and malformed ones are ignored', () => {
    expect(webToggleView({ streaming: true, server: { offered: true, mode: 'auto', reason: 'something-new' } }))
      .toMatchObject({ on: true, label: 'Web search on (automatic)' });
    expect(webToggleView({ override: true, server: 'garbage' })).toMatchObject({ on: true });
  });

  it('after the turn the prediction is shown again, not the finished turn\'s decision', () => {
    expect(webToggleView({ predicted: off('documents-in-scope'), focus: 'attached', streaming: false, server: null }).on).toBe(false);
  });

  it('speaks Hindi', () => {
    expect(webToggleView({ override: true, lang: 'hi' }).label).toBe('वेब खोज चालू (आपने चालू की)');
    expect(webToggleView({ gated: true, lang: 'hi' }).label).toBe('यह मॉडल वेब पर खोज नहीं कर सकता');
  });
});

describe('isWebGated: the models that cannot search', () => {
  it('a :free model, or one whose params switch web search off, is gated', () => {
    expect(isWebGated({ model_id: 'vendor/model:free' })).toBe(true);
    expect(isWebGated({ model_id: 'vendor/model:FREE' })).toBe(true); // as the server's webModelAllowed
    expect(isWebGated({ model_id: 'vendor/model', params: { web_search: false } })).toBe(true);
  });
  it('anything else is allowed, including a model the list does not hold', () => {
    expect(isWebGated({ model_id: 'google/gemini-3.8-flash' })).toBe(false);
    expect(isWebGated({ model_id: 'x/y', params: { web_search: true } })).toBe(false);
    expect(isWebGated({ model_id: 'x/y', params: {} })).toBe(false);
    expect(isWebGated({ model_id: 'x/y', params: null })).toBe(false);
    expect(isWebGated(null)).toBe(false);
    expect(isWebGated(undefined)).toBe(false);
  });
});

describe('WebSearchToggle', () => {
  it('is a button with aria-pressed, a globe, the word Web and the reason as its name and tooltip', () => {
    const html = renderToStaticMarkup(<WebSearchToggle predicted={on('record-without-document')} focus="attached" onChange={() => {}} />);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Web search on (automatic): this record has no indexed document"');
    expect(html).toContain('title="Web search on (automatic): this record has no indexed document"');
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<span[^>]*>Web<\/span>/);
    expect(html).not.toContain('disabled');
  });

  it('is not pressed when off, and says so', () => {
    const html = renderToStaticMarkup(<WebSearchToggle override={false} onChange={() => {}} />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Web search off (you turned it off)"');
  });

  it('a gated model renders disabled with the model message', () => {
    const html = renderToStaticMarkup(<WebSearchToggle gated predicted={on('record-without-document')} onChange={() => {}} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain("This model can&#x27;t search the web");
    expect(html).toContain('aria-pressed="false"');
  });

  it('is disabled while a turn streams', () => {
    expect(renderToStaticMarkup(<WebSearchToggle streaming override onChange={() => {}} />)).toContain('disabled=""');
  });

  it('a click sets the override to the opposite of what is shown', () => {
    const onChange = vi.fn();
    WebSearchToggle({ predicted: on('record-without-document'), onChange }).props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(false);
    WebSearchToggle({ predicted: off('documents-in-scope'), onChange }).props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(true);
    WebSearchToggle({ override: true, predicted: off('documents-in-scope'), onChange }).props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(false);
    WebSearchToggle({ override: false, predicted: on('record-without-document'), onChange }).props.onClick();
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('a disabled globe does not change anything when clicked', () => {
    const onChange = vi.fn();
    WebSearchToggle({ gated: true, onChange }).props.onClick();
    WebSearchToggle({ streaming: true, override: true, onChange }).props.onClick();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// The prediction the panel feeds the globe: the chips on the chat, the selected row that the next
// send will pin, the coverage answers it already holds, and the desk module list.
describe('predictWeb', () => {
  const db = (rows) => ({ from() { const chain = { select: () => chain, in: () => chain, not: () => Promise.resolve({ data: rows, error: null }) }; return chain; } });
  beforeEach(() => resetCoverageCache());
  const row = (document_key) => ({ kind: 'row', title: 'A row', ...(document_key ? { document_key } : {}) });
  const modules = [{ desk_tier: 'National', desk_feature: 'Bills' }];

  it('answers like webDefaultFor for the chips alone', async () => {
    const indexedKeys = await indexedDocumentKeys(['bill:2026:153', 'bill:2026:999'], db([{ document_key: 'bill:2026:153' }]));
    expect(predictWeb({ focus: 'attached', attachments: [row('bill:2026:153')], indexedKeys })).toEqual({ on: false, reason: 'documents-in-scope' });
    expect(predictWeb({ focus: 'attached', attachments: [row('bill:2026:999')], indexedKeys })).toEqual({ on: true, reason: 'record-without-document' });
    expect(predictWeb({ focus: 'attached', attachments: [row()], indexedKeys })).toEqual({ on: true, reason: 'record-without-document' });
    expect(predictWeb({ focus: 'broad', attachments: [row()], indexedKeys })).toEqual({ on: false, reason: 'broad' });
  });

  it('the row about to be pinned counts, so a selected row with no key is on', () => {
    expect(predictWeb({ focus: 'selection', attachments: [], selectedRecord: row() })).toEqual({ on: true, reason: 'record-without-document' });
    expect(predictWeb({ focus: 'attached', attachments: [], selectedRecord: row() })).toEqual({ on: true, reason: 'record-without-document' });
    // Desk and broad focus ignore it.
    expect(predictWeb({ focus: 'broad', attachments: [], selectedRecord: row() })).toEqual({ on: false, reason: 'broad' });
  });

  it('a selected bill with an indexed document stays off once its coverage has answered', async () => {
    const selectedIndexed = await indexedDocumentKeys(['bill:2026:153'], db([{ document_key: 'bill:2026:153' }]));
    expect(predictWeb({ focus: 'selection', attachments: [], selectedRecord: row('bill:2026:153'), selectedIndexed })).toEqual({ on: false, reason: 'documents-in-scope' });
  });

  it('a keyed record whose coverage has not answered is unknown, not "no document"', async () => {
    expect(predictWeb({ focus: 'selection', attachments: [], selectedRecord: row('bill:2026:153') })).toEqual({ on: false, reason: null });
    // The chips' answer is for older keys: a newly attached key is unknown until its lookup lands.
    const indexedKeys = await indexedDocumentKeys(['bill:2026:153'], db([{ document_key: 'bill:2026:153' }]));
    expect(predictWeb({ focus: 'attached', attachments: [row('bill:2026:153'), row('bill:2026:7')], indexedKeys })).toEqual({ on: false, reason: null });
  });

  it('a known "no" past its lifetime still answers no, as the chip badge does', async () => {
    const indexedKeys = await indexedDocumentKeys(['bill:2026:999'], db([]));
    expect(predictWeb({ focus: 'attached', attachments: [row('bill:2026:999')], indexedKeys })).toEqual({ on: true, reason: 'record-without-document' });
  });

  it('desk focus follows the module list', () => {
    expect(predictWeb({ focus: 'desk', attachments: [], deskContext: { tier: 'National', feature: 'Orders' }, modules })).toEqual({ on: true, reason: 'module-without-documents' });
    expect(predictWeb({ focus: 'desk', attachments: [], deskContext: { tier: 'National', feature: 'Bills' }, modules })).toEqual({ on: false, reason: 'documents-in-scope' });
    expect(predictWeb({ focus: 'desk', attachments: [], deskContext: { tier: 'National', feature: 'Bills' }, modules: null })).toEqual({ on: false, reason: null });
  });
});

describe('the globe in the composer', () => {
  const models = [{ model_id: 'google/gemini-3.8-flash', is_default: true, efforts: ['low'] }, { model_id: 'vendor/free-one:free', efforts: ['low'] }, { model_id: 'vendor/no-web', efforts: ['low'], params: { web_search: false } }];
  const research = (patch = {}) => ({ ready: true, loading: false, locked: false, store: { chats: [{ id: 'c', attachments: [{ id: 'a', kind: 'row', title: 'A row' }] }], activeId: 'c' },
    registry: { models, roles: [] }, choice: { modelId: 'google/gemini-3.8-flash', effort: 'low' }, draft: '', error: '', viewer: null, messages: [], sources: [], actions: {}, identityVersion: 0, ...patch });
  const render = (patch) => { fake.research = research(patch); return renderToStaticMarkup(<AiPanel lang="en" />); };

  it('sits between the attach button and the model picker', () => {
    const html = render();
    const clip = html.indexOf('ai-v2-comp-clip'), globe = html.indexOf('ai-v2-web'), model = html.indexOf('ai-v2-model-btn');
    expect(clip).toBeGreaterThan(-1);
    expect(globe).toBeGreaterThan(clip);
    expect(model).toBeGreaterThan(globe);
  });

  it('predicts on for a chip that has no document key', () => {
    const html = render();
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Web search on (automatic): this record has no indexed document');
  });

  it('shows the reader\'s override from the thread over the prediction', () => {
    const html = render({ webSearch: false });
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Web search off (you turned it off)');
  });

  it('is disabled for a :free model and for a model with web search switched off', () => {
    for (const modelId of ['vendor/free-one:free', 'vendor/no-web']) {
      const html = render({ choice: { modelId, effort: 'low' } });
      expect(html).toMatch(/aria-label="This model can&#x27;t search the web"[^>]*disabled=""|disabled=""[^>]*aria-label="This model can&#x27;t search the web"/);
    }
  });

  it('is disabled while the thread is locked, and shows the server decision for the turn in flight', () => {
    const html = render({ locked: true, web: { offered: false, mode: 'auto', reason: 'documents-in-scope' }, stream: { isStreaming: true, isPending: true } });
    expect(html).toMatch(/aria-label="Web search[^"]*"[^>]*disabled=""|disabled=""[^>]*aria-label="Web search/);
  });
});
