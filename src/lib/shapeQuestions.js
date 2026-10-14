/**
 * Parliamentary questions — display shaping for the 8k archive sample.
 * Does not invent answer text; Has answer stays Not reported when the pack has no answer field.
 */

function empty(v) {
  return v == null || String(v).trim() === '' || String(v).trim() === '—';
}

function answerState(row) {
  const blob = [row.answer, row.answer_text, row.answer_status, row.status]
    .filter((v) => !empty(v))
    .map((v) => String(v))
    .join(' ');
  if (!blob) return { has_answer: 'Not reported', has_answer_key: 'unknown' };
  if (/unanswered|pending|no answer|awaiting/i.test(blob)) {
    return { has_answer: 'No', has_answer_key: 'no' };
  }
  if (/answer|replied|responded|laid on the table|answered/i.test(blob)) {
    return { has_answer: 'Yes', has_answer_key: 'yes' };
  }
  return { has_answer: 'Not reported', has_answer_key: 'unknown' };
}

export function shapeParliamentaryQuestionRows(rows) {
  return (rows || []).map((r) => {
    if (r?.status === 'source_status') return r;
    const ans = answerState(r);
    return {
      ...r,
      title: r.title || r.subject || '',
      subject: r.subject || r.title || '',
      mp_name: r.mp_name || r.member || 'Not reported',
      ministry: r.ministry || 'Not reported',
      house: r.house || 'Not reported',
      session: empty(r.session) ? (empty(r.ls_session) ? 'Not reported' : r.ls_session) : r.session,
      question_type: r.question_type || 'Not reported',
      ...ans,
    };
  });
}

export function applyParliamentaryQuestionShapingToFeed(feed) {
  if (!feed?.feature || !/parliamentary question/i.test(feed.feature)) return feed;
  if (!Array.isArray(feed.rows)) return feed;
  const rows = shapeParliamentaryQuestionRows(feed.rows);
  const known = rows.filter((r) => r.has_answer_key === 'yes' || r.has_answer_key === 'no').length;
  return {
    ...feed,
    rows,
    meta: {
      ...(feed.meta || {}),
      boardNote:
        known > 0
          ? `Search covers all ${rows.length.toLocaleString('en-IN')} questions. Has-answer is filled only when the archive carries an answer status.`
          : `Search covers all ${rows.length.toLocaleString('en-IN')} questions. Answer text is missing on every row in this archive — Has answer stays Not reported until Sansad answer fields are wired.`,
    },
  };
}
