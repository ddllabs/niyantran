// B1: plain-text builders for copying one claim and exporting a whole session. Pure: no request, no browser.
// A claim is { claim, shown }: `claim` carries the claim text, `shown` is the result the card shows (the newest
// re-check result, else the claim itself), which supplies the verdict, reason, sources and date.
import { FILTER_KEYS } from './claimFilter.js';
import { VERDICTS, claimBadge, safeSourceUrl, sourceLabel } from './factCheckText.js';
import { dateStamp, transcriptFileName } from './transcriptTools.js';

export const AUTOMATED_LINE = 'Automated check; read the sources before quoting.';

/** One line of text: control characters and new lines become single spaces. */
const oneLine = (value) => String(value ?? '').normalize('NFC').replace(/\p{Cc}+/gu, ' ').replace(/ {2,}/g, ' ').trim();

/** "title — URL" lines for the http(s) sources only. */
function sourceLines(result) {
  return (Array.isArray(result?.sources) ? result.sources : []).flatMap((s) => {
    const href = safeSourceUrl(s?.url);
    return href ? [`${oneLine(sourceLabel({ ...s, url: href }))} — ${href}`] : [];
  });
}

/** The text one card's Copy puts on the clipboard. `source` is the channel or video name when known. */
export function claimCopyText({ claim, shown, source = '' }) {
  const result = shown || claim;
  const lines = [`Claim: ${oneLine(claim?.claim_en)}`, `Verdict: ${claimBadge(result).label}`];
  const reason = oneLine(result?.reason);
  if (reason) lines.push(`Reason: ${reason}`);
  const sources = sourceLines(result);
  if (sources.length) lines.push('Sources:', ...sources.map((l) => `- ${l}`));
  const day = dateStamp(result?.checked_at);
  if (day) lines.push(`Checked: ${day}`);
  const where = oneLine(source);
  if (where) lines.push(`Channel or video: ${where}`);
  lines.push(AUTOMATED_LINE);
  return `${lines.join('\n')}\n`;
}

/** The text of the exported file: a header, every claim in order, then the automated-check line. */
export function sessionExportText({ title = '', date = '', minutes = null, items }) {
  const name = oneLine(title);
  const counts = Object.fromEntries(FILTER_KEYS.map((k) => [k, 0]));
  let other = 0;
  for (const { claim, shown } of items) {
    const key = claimBadge(shown || claim).key;
    if (Object.hasOwn(counts, key)) counts[key] += 1; else other += 1;
  }
  const head = [name ? `Fact-check: ${name}` : 'Fact-check'];
  const day = dateStamp(date);
  if (day) head.push(`Date: ${day}`);
  if (typeof minutes === 'number' && Number.isFinite(minutes)) head.push(`Minutes used: ${minutes}`);
  const byVerdict = FILTER_KEYS.map((k) => `${VERDICTS[k].label} ${counts[k]}`).join(', ');
  head.push(items.length ? `Claims: ${items.length} (${byVerdict}${other ? `; other ${other}` : ''})` : 'Claims: 0');
  const body = items.length ? items.flatMap(({ claim, shown }, i) => {
    const result = shown || claim;
    const out = [`${i + 1}. ${oneLine(claim?.claim_en)}`, `   Verdict: ${claimBadge(result).label}`];
    const reason = oneLine(result?.reason);
    if (reason) out.push(`   Reason: ${reason}`);
    const sources = sourceLines(result);
    if (sources.length) out.push('   Sources:', ...sources.map((l) => `   - ${l}`));
    const when = dateStamp(result?.checked_at);
    if (when) out.push(`   Checked: ${when}`);
    out.push('');
    return out;
  }) : ['No claims.', ''];
  return `${[...head, '', ...body, AUTOMATED_LINE].join('\n')}\n`;
}

export const exportFileName = ({ title = '', date = '' } = {}) => transcriptFileName({ title, date, prefix: 'fact-check' });
