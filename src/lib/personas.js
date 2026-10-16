/**
 * Initial signup / marketing personas (locked set until CR revises).
 * Policy Analyst · Journalist · UPSC Aspirant · Corporate Affairs ·
 * Legal Researcher · Academic. Ids map onto USER_TYPES for desk access.
 */

export const PERSONA_KEY = 'niyPersona';
export const PERSONA_ANSWERS_KEY = 'niyPersonaAnswers';

/** @typedef {{ id: string, label: string, blurb: string, gets: string[], useCase: string, startHint: string, tone: string, d: string, img: string }} Persona */

/** @type {Persona[]} */
export const PERSONAS = [
  {
    id: 'policy',
    label: 'Policy Analyst',
    blurb: 'Bills, ministries and implementation stages in one desk.',
    gets: ['Bill passage & committee stage', 'Cabinet / PIB decisions', 'Sector-linked institutional record'],
    useCase: 'Trace a ministry notice to the bill, the sector, and the evidence trail.',
    startHint: 'National · Legislative',
    tone: 'blue',
    d: 'M4 21h16M4 10h16M12 3l8 7H4z',
    img: 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=640&q=70',
  },
  {
    id: 'journalist',
    label: 'Journalist',
    blurb: 'Claim → public record, with provenance on every row.',
    gets: ['Full desk access', 'Statement & wire registers', 'Drop a record into Ask AI'],
    useCase: 'Check a headline against the bill text, the order, or the official brief.',
    startHint: 'Home brief',
    tone: 'red',
    d: 'M21 15a4 4 0 01-4 4H7l-4 3V7a4 4 0 014-4h10a4 4 0 014 4z',
    img: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=640&q=70',
  },
  {
    id: 'student',
    label: 'UPSC Aspirant',
    blurb: 'Polity and current affairs as linked records, not flashcards.',
    gets: ['National + Law desks', 'Question & bill corpus', 'Geography / carbon context'],
    useCase: 'Build a topic note from statutes, questions and sourced events.',
    startHint: 'National desk',
    tone: 'sand',
    d: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
    img: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=640&q=70',
  },
  {
    id: 'analyst',
    label: 'Corporate Affairs',
    blurb: 'Regulatory, legislative and sector signals for board prep.',
    gets: ['Full terminal', 'Regulatory watch', 'Economy & carbon desks'],
    useCase: 'See which public actions touch your sector before the meeting.',
    startHint: 'Home · Economics',
    tone: 'navy',
    d: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6',
    img: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=640&q=70',
  },
  {
    id: 'lawyer',
    label: 'Legal Researcher',
    blurb: 'Statute, judgments and parliamentary record side by side.',
    gets: ['Law desk first', 'SC / HC order feeds', 'Bill text as evidence'],
    useCase: 'Move from a case caption to the statute and the legislative history.',
    startHint: 'Law desk',
    tone: 'purple',
    d: 'M12 3l8 18H4zM12 8v5M12 16h.01',
    img: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=640&q=70',
  },
  {
    id: 'academic',
    label: 'Academic',
    blurb: 'Longitudinal public records with labelled sources.',
    gets: ['National + Law + Global', 'Archive-depth coverage', 'Export with provenance'],
    useCase: 'Cite the record, not a summary — and keep the source path visible.',
    startHint: 'National desk',
    tone: 'teal',
    d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18',
    img: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=640&q=70',
  },
];

/**
 * F212 (owner 2026-10-16): the homepage hero's persona column and popover, in the words of the client's
 * reference (NTER-Final-Developer-Kit top section v5), keyed by our persona ids in PERSONAS order.
 */
export const PERSONA_PERSPECTIVES = {
  policy: {
    name: 'Policy Analysts',
    tagline: 'Policy into perspective',
    description: 'Put legislation and implementation in the same frame.',
    points: ['Bill passage & committee stages', 'Cabinet and PIB decisions'],
  },
  journalist: {
    name: 'Journalists',
    tagline: 'Follow the public record',
    description: 'Follow a claim back to the public record, with its source in view.',
    points: ['Statement and wire registers', 'Connected records across desks'],
  },
  student: {
    name: 'UPSC Aspirants',
    tagline: 'Connect your current affairs',
    description: 'Connect polity and current affairs through the underlying records.',
    points: ['National and Law desk coverage', 'Questions and parliamentary bills'],
  },
  analyst: {
    name: 'Corporate Affairs',
    tagline: 'See the regulatory picture',
    description: 'Bring regulatory and legislative context into your next briefing.',
    points: ['Regulatory body watch', 'Economic and sector signals'],
  },
  lawyer: {
    name: 'Legal Researchers',
    tagline: 'Find the source behind a case',
    description: 'See judgments, statutes and parliamentary records side by side.',
    points: ['Supreme Court and High Court orders', 'Source-linked legal registers'],
  },
  academic: {
    name: 'Academics',
    tagline: 'Research across time',
    description: 'Trace institutions and public decisions across time.',
    points: ['Longitudinal public records', 'Archive depth and labelled sources'],
  },
};

export const PERSONA_FOLLOWUPS = [
  {
    id: 'focus',
    q: 'What do you usually work on first?',
    options: [
      { id: 'legislation', label: 'Legislation & policy' },
      { id: 'courts', label: 'Courts & orders' },
      { id: 'security', label: 'Security & fronts' },
      { id: 'economy', label: 'Economy & industry' },
    ],
  },
  {
    id: 'start',
    q: 'Where should the terminal open?',
    options: [
      { id: 'home', label: 'Home brief' },
      { id: 'desk', label: 'My persona’s start desk' },
    ],
  },
];

export function personaOf(id) {
  return PERSONAS.find((p) => p.id === id) || null;
}

export function readPersonaId() {
  try {
    const v = localStorage.getItem(PERSONA_KEY);
    if (v && personaOf(v)) return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function writePersonaId(id) {
  const p = personaOf(id);
  if (!p) return null;
  try {
    localStorage.setItem(PERSONA_KEY, p.id);
  } catch {
    /* ignore */
  }
  return p.id;
}

export function readPersonaAnswers() {
  try {
    const raw = localStorage.getItem(PERSONA_ANSWERS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') return o;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function writePersonaAnswers(answers) {
  try {
    localStorage.setItem(PERSONA_ANSWERS_KEY, JSON.stringify(answers || {}));
  } catch {
    /* ignore */
  }
}

export function clearPersonaPrefs() {
  try {
    localStorage.removeItem(PERSONA_KEY);
    localStorage.removeItem(PERSONA_ANSWERS_KEY);
  } catch {
    /* ignore */
  }
}

/** Apply the account's saved working-as role (personaId or type). Used on login/signup. */
export function applyPersonaForUser(user, answers) {
  const id = user?.personaId || user?.type;
  const written = writePersonaId(id);
  if (answers && typeof answers === 'object') writePersonaAnswers(answers);
  return written || writePersonaId('analyst');
}
