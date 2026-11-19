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

function haystack(c) {
  const lang = normalizeText(c.lang);
  const aliases = Object.entries(LANGUAGE_ALIASES).filter(([en]) => lang.includes(en)).flatMap(([, words]) => words);
  return normalizeText([c.name, c.officialName, c.lang, ...aliases].filter(Boolean).join(' '));
}

/** The channels whose name, official name or language contains every word of the query. A blank query keeps all. */
export function matchChannels(channels, query) {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (!words.length) return [...channels];
  return channels.filter((c) => {
    const text = haystack(c);
    return words.every((w) => text.includes(w));
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
