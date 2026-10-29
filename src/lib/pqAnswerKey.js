/**
 * The Lok Sabha answer file a question's sansad.in URL names (F266): `pq:ls:<session>:<file stem>`, or
 * null. The same rule as `pq_answer_key` in SQL (migration 20261028130000) and `pqAnswerKey` in
 * supabase/functions/_shared/suppliedText.ts; keep all three identical.
 */
const PQ_URL = /^https:\/\/sansad\.in\/getFile\/loksabhaquestions\/annex\/([0-9]{1,4})\/([A-Za-z0-9_]{1,64})\.pdf(\?source=pqals)?$/;

export function pqAnswerKey(url) {
  const m = typeof url === 'string' ? PQ_URL.exec(url) : null;
  return m ? `pq:ls:${m[1]}:${m[2]}` : null;
}

/** The Lok Sabha session number in a question's answer URL ("187"), or null. */
export function pqSession(url) {
  const key = pqAnswerKey(url);
  return key ? key.split(':')[2] : null;
}
