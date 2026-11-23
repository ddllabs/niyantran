import { describe, expect, it } from 'vitest';
import { applyFrame, finishTurn, newTurn, turnsFromMessages } from './chatState.js';

describe('a research-chat turn', () => {
  it('builds the answer frame by frame', () => {
    let t = newTurn({ question: 'Q' });
    for (const f of [
      { conversation: { id: 'c1' } },
      { reasoning: 'Reading' },
      { tool: { name: 'search_desk_rows', phase: 'start', step: 1 } },
      { tool: { name: 'search_desk_rows', phase: 'end', step: 1, count: 3 } },
      { chunk: 'Hello wor' }, { chunk: 'ld [1]' },
      { patch: { from: 6, text: 'World [1]' } },
      { sources: [{ id: 1, kind: 'row', title: 'R' }] },
      { followUpQuestions: ['Next?', 3] },
      { done: { message_id: 'm1' } },
      { credits: 212 },
    ]) t = applyFrame(t, f);
    expect(t.conversationId).toBe('c1');
    expect(t.text).toBe('Hello World [1]');
    expect(t.activity).toHaveLength(2);
    expect(t.activity[1]).toMatchObject({ phase: 'end', count: 3 });
    expect(t.followUps).toEqual(['Next?']);
    expect(t.status).toBe('complete');
    expect(t.messageId).toBe('m1');
    expect(t.credits).toBe(212);
  });
  it('marks errors, truncation and cancellation', () => {
    expect(applyFrame(applyFrame(newTurn(), { truncated: { reason: 'length' } }), { done: { message_id: 'm' } }).status).toBe('truncated');
    expect(applyFrame(newTurn(), { error: 'Stopped', code: 'cancelled' }).status).toBe('cancelled');
    expect(finishTurn(newTurn(), { error: 'No credits', code: 'no_credits' })).toMatchObject({ status: 'error', errorCode: 'no_credits' });
    expect(finishTurn(newTurn()).status).toBe('unknown');
  });
  it('rebuilds saved conversations, and shows an expired run as interrupted', () => {
    const turns = turnsFromMessages([
      { id: 'u1', role: 'user', content: 'Q1', created_at: '2026-10-01' },
      { id: 'a1', role: 'assistant', content: 'A1', sources: [{ id: 1 }], status: 'complete' },
      { id: 'u2', role: 'user', content: 'Q2' },
      { id: 'a2', role: 'assistant', content: '', status: 'running', execution_expires_at: '2020-01-01T00:00:00Z' },
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ question: 'Q1', text: 'A1', status: 'complete' });
    expect(turns[1].status).toBe('interrupted');
  });
});
