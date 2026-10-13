/**
 * Strict feed-date reading shared by the record adapters (F127). `new Date(text)` would guess at
 * shapes it does not know and would read the machine's local zone; this reads only the shapes below
 * and returns null for anything else.
 */

/** RFC 822 zone names, in minutes east of UTC. A zone not listed (BST, CET) is ambiguous and is not guessed. */
const ZONES = { GMT: 0, UT: 0, UTC: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
const IST_MINUTES = 330;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const GDELT_DATE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/i;
const RFC_DATE = /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})(\.?,?)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s+([A-Za-z]{1,3}|[+-]\d{4}))?)?$/;

/** A real instant from calendar parts and a UTC offset in minutes, or null. Reads no local zone. */
function instant(year, month, day, hour, minute, second, offset) {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(ms);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return new Date(ms - offset * 60000);
}

function offsetOf(zone, ist) {
  if (/^[+-]\d{4}$/.test(zone)) {
    if (Number(zone.slice(3, 5)) > 59) return null;
    const minutes = Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3, 5));
    return zone[0] === '-' ? -minutes : minutes;
  }
  const key = zone.toUpperCase();
  if (ist && key === 'IST') return IST_MINUTES;
  return Object.hasOwn(ZONES, key) ? ZONES[key] : null;
}

/** The month a name gives: the three-letter abbreviation, or with `monthNames` also the full name or "Sept"; else 0. */
function monthOf(name, monthNames) {
  const n = name.toLowerCase();
  if (!monthNames) return MONTHS.indexOf(n) + 1;
  return MONTH_NAMES.findIndex((full) => full === n || (n.length === 3 && full.startsWith(n)) || (n === 'sept' && full === 'september')) + 1;
}

/**
 * The instant a feed date names, or null. Three shapes, each strictly:
 *  - GDELT seendate "20261012T143000Z" (UTC);
 *  - ISO 8601 "2026-10-12" (that calendar date) or with a time and a required zone;
 *  - RFC 822 as feeds write it, "Mon, 12 Oct 2026 14:30:00 GMT" (a listed zone name or ±hhmm; the
 *    weekday and the time are optional).
 * Options, for the feeds that need them:
 *  - `ist`: read the zone name IST as India Standard Time (an Indian publisher's feed; elsewhere IST
 *    is ambiguous);
 *  - `monthNames`: also read full month names and "Sept", with a trailing "." or "," ("12 October,
 *    2026");
 *  - `zonelessDay`: an RFC 822 time with no zone (RBI's feed) gives the calendar day as written, the
 *    time checked only for validity; otherwise a time with no zone is not a date.
 * An impossible date or any other text is not a date.
 */
export function parseFeedDate(value, { ist = false, monthNames = false, zonelessDay = false } = {}) {
  const t = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!t) return null;
  let m = GDELT_DATE.exec(t);
  if (m) return instant(...m.slice(1, 7).map(Number), 0);
  m = ISO_DATE.exec(t);
  if (m) {
    const [year, month, day] = m.slice(1, 4).map(Number);
    if (m[4] == null) return instant(year, month, day, 0, 0, 0, 0);
    const zone = m[7].toUpperCase();
    if (zone !== 'Z' && Number(zone.slice(-2)) > 59) return null;
    const offset = zone === 'Z' ? 0 : (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2))) * (zone[0] === '-' ? -1 : 1);
    return instant(year, month, day, Number(m[4]), Number(m[5]), Number(m[6] || 0), offset);
  }
  m = RFC_DATE.exec(t);
  if (m) {
    const [, day, name, punct, year, hour, minute, second, zone] = m;
    if (punct && !monthNames) return null;
    const month = monthOf(name, monthNames);
    if (!month) return null;
    if (hour == null) return instant(Number(year), month, Number(day), 0, 0, 0, 0);
    if (zone == null) {
      if (!zonelessDay || Number(hour) > 23 || Number(minute) > 59 || Number(second || 0) > 59) return null;
      return instant(Number(year), month, Number(day), 0, 0, 0, 0);
    }
    const offset = offsetOf(zone, ist);
    return offset == null ? null : instant(Number(year), month, Number(day), Number(hour), Number(minute), Number(second || 0), offset);
  }
  return null;
}
