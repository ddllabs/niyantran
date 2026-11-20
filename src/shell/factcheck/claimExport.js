// B1: plain-text builders for copying one claim and exporting a whole session. Pure: no request, no browser.
// A claim is { claim, shown }: `claim` carries the claim text, `shown` is the result the card shows (the newest
// re-check result, else the claim itself), which supplies the verdict, reason, sources and date.
import { FILTER_KEYS } from './claimFilter.js';
import { VERDICTS, claimBadge, safeSourceUrl } from './factCheckText.js';
import { cleanLine, dateStamp, transcriptFileName } from './transcriptTools.js';

export const AUTOMATED_LINE = 'Automated check; read the sources before quoting.';

/** One line of text from untrusted input (see cleanLine): no new lines, no bidi or zero-width tricks. */
const oneLine = cleanLine;

/**
 * "URL (title)" lines for the http(s) sources only. The real address comes first; the title is only a label, so
 * any address written inside it is removed and it can not point somewhere else.
 */
function sourceLines(result) {
  return (Array.isArray(result?.sources) ? result.sources : []).flatMap((src) => {
    const href = safeSourceUrl(src?.url);
    if (!href) return [];
    const title = oneLine(oneLine(src?.title).replace(/https?:\/\/\S*/gi, ' '));
    return [title ? `${href} (${title})` : href];
  });
}

/** The text one card's Copy puts on the clipboard. `source` is the channel or video name when known. */
export function claimCopyText({ claim, shown, source = '', timeZone = undefined }) {
  const result = shown || claim;
  const lines = [`Claim: ${oneLine(claim?.claim_en)}`, `Verdict: ${claimBadge(result).label}`];
  const reason = oneLine(result?.reason);
  if (reason) lines.push(`Reason: ${reason}`);
  const sources = sourceLines(result);
  if (sources.length) lines.push('Sources:', ...sources.map((l) => `- ${l}`));
  const day = dateStamp(result?.checked_at, timeZone);
  if (day) lines.push(`Checked: ${day}`);
  const where = oneLine(source);
  if (where) lines.push(`Channel or video: ${where}`);
  lines.push(AUTOMATED_LINE);
  return `${lines.join('\n')}\n`;
}

/** The text of the exported file: a header, every claim in order, then the automated-check line. */
export function sessionExportText({ title = '', date = '', minutes = null, items, note = '', timeZone = undefined }) {
  const name = oneLine(title);
  const counts = Object.fromEntries(FILTER_KEYS.map((k) => [k, 0]));
  let other = 0;
  for (const { claim, shown } of items) {
    const key = claimBadge(shown || claim).key;
    if (Object.hasOwn(counts, key)) counts[key] += 1; else other += 1;
  }
  const head = [name ? `Fact-check: ${name}` : 'Fact-check'];
  const day = dateStamp(date, timeZone);
  if (day) head.push(`Date: ${day}`);
  if (typeof minutes === 'number' && Number.isFinite(minutes)) head.push(`Minutes used: ${minutes}`);
  const byVerdict = FILTER_KEYS.map((k) => `${VERDICTS[k].label} ${counts[k]}`).join(', ');
  head.push(items.length ? `Claims: ${items.length} (${byVerdict}${other ? `; other ${other}` : ''})` : 'Claims: 0');
  const cut = oneLine(note);
  if (cut) head.push(cut);
  const body = items.length ? items.flatMap(({ claim, shown }, i) => {
    const result = shown || claim;
    const out = [`${i + 1}. ${oneLine(claim?.claim_en)}`, `   Verdict: ${claimBadge(result).label}`];
    const reason = oneLine(result?.reason);
    if (reason) out.push(`   Reason: ${reason}`);
    const sources = sourceLines(result);
    if (sources.length) out.push('   Sources:', ...sources.map((l) => `   - ${l}`));
    const when = dateStamp(result?.checked_at, timeZone);
    if (when) out.push(`   Checked: ${when}`);
    out.push('');
    return out;
  }) : ['No claims.', ''];
  return `${[...head, '', ...body, AUTOMATED_LINE].join('\n')}\n`;
}

export const exportFileName = ({ title = '', date = '', timeZone = undefined } = {}) => transcriptFileName({ title, date, prefix: 'fact-check', timeZone });

/**
 * The time a live session began, as a Date, for the date of an export: the start the session reports when it
 * does, else the earliest time one of its claims was checked; null when neither is known (the caller then uses
 * the day of the export).
 */
export function sessionStartOf(session) {
  const asDate = (v) => { const d = typeof v === 'number' || typeof v === 'string' ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
  const reported = asDate(session?.startedAt);
  if (reported) return reported;
  const times = (Array.isArray(session?.claims) ? session.claims : []).map((c) => asDate(c?.checked_at)).filter(Boolean);
  return times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : null;
}
