// Fixed views for the "nothing changes when the re-check price is unknown" pin (test support only).
const base = {
  status: 'idle', sessionId: null, minutesBought: 0, creditsPerMinute: null, creditsHeld: null, secondsLeft: 0,
  transcript: [], claims: [], silentFor: 0, skippedPieces: 0, droppedTurns: 0, budgetReached: false,
  final: null, endReason: null, error: null,
};
const claims = [
  { id: 'a', quote: 'q', claim_en: 'The rate is 18 percent', claimant: 'Minister', reported_by: 'Anchor', kind: 'claim', status: 'checked', verdict: 'supported', reason: 'The schedule agrees.', sources: [{ url: 'https://example.org/x', title: 'Schedule' }], checked_at: null },
  { id: 'b', quote: 'q', claim_en: 'Prices fell', claimant: null, reported_by: null, kind: 'claim', status: 'error', verdict: null, reason: null, sources: [], checked_at: null },
  { id: 'c', quote: 'q', claim_en: 'It will rain', claimant: null, reported_by: null, kind: 'prediction', status: 'not_checkable', verdict: null, reason: null, sources: [], checked_at: null },
];
const flag = { available: true, creditsPerMinute: 500, userId: 'u' };
const mk = (session) => ({ flag, supported: true, ready: true, session: { ...base, ...session }, announcement: '', balance: 5000 });
export const PIN_VIEWS = () => ({
  running: mk({ status: 'running', secondsLeft: 100, transcript: [{ seq: 0, text: 'hello', startMs: 0 }], claims }),
  ended: mk({ status: 'ended', endReason: 'time', final: { minutes_used: 1, credits_charged: 500, balance: 4500 }, claims }),
});
