// B6: pure helpers for finding a channel. Plain substring matching on normalised text, so pattern characters in
// the query mean nothing and Devanagari works like any other script.

// A language written in Devanagari finds the channels of that language.
const LANGUAGE_ALIASES = {
  hindi: ['हिन्दी', 'हिंदी'],
  english: ['अंग्रेज़ी', 'अंग्रेजी', 'इंग्लिश'],
  marathi: ['मराठी'],
  bengali: ['बांग्ला', 'बंगाली'],
  tamil: ['तमिल'],
  telugu: ['तेलुगु', 'तेलुगू'],
  malayalam: ['मलयालम'],
  kannada: ['कन्नड़', 'कन्नड'],
  gujarati: ['गुजराती'],
  odia: ['ओड़िया', 'उड़िया', 'ओडिया'],
  punjabi: ['पंजाबी'],
};

export const normalizeText = (s) => String(s ?? '').normalize('NFC').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

/** "Hindi · English" and "Hindi (UP/UK)" are Hindi; '' when there is no language. */
export function primaryLanguage(lang) {
  return typeof lang === 'string' ? lang.split(/[·(]/)[0].trim() : '';
}

// The words of a channel's language line that name a language, for matching a word of the query exactly.
function languageWords(c) {
  const lang = normalizeText(c.lang);
  return new Set(Object.entries(LANGUAGE_ALIASES).filter(([en]) => lang.includes(en)).flatMap(([, words]) => words.map(normalizeText)));
}

/**
 * The channels whose name, official name, language or list name contains every word of the query. A blank query
 * keeps all. A language written in Devanagari is matched as a whole word, so it cannot match inside another word.
 */
export function matchChannels(channels, query, lists = []) {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (!words.length) return [...channels];
  const listText = new Map(lists.map((l) => [l.id, normalizeText(`${l.name} ${l.short || ''}`)]));
  return channels.filter((c) => {
    const text = normalizeText([c.name, c.officialName, c.lang, ...(c.lists || []).map((id) => listText.get(id) || '')].filter(Boolean).join(' '));
    const aliases = languageWords(c);
    return words.every((w) => text.includes(w) || aliases.has(w));
  });
}

/** The language chips of the Regional overlay: each primary language once, alphabetical, with its count. */
export function regionChips(channels) {
  const counts = new Map();
  for (const c of channels) {
    const label = primaryLanguage(c.lang);
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([label, count]) => ({ label, count }));
}
