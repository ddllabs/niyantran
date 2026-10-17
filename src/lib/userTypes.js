import { TABS } from '../desks/tabs.js';

export const DEFAULT_USER_TYPE = 'analyst';

/**
 * Desk-access types. Labels align with the initial signup personas:
 * Policy Analyst, Journalist, UPSC Aspirant, Corporate Affairs,
 * Legal Researcher, Academic.
 * Legacy id `analyst` = Corporate Affairs (full terminal).
 */
export const USER_TYPES = [
  {
    id: 'policy',
    label: 'Policy Analyst',
    short: 'Policy',
    hint: 'Legislation, government operations, and briefs.',
    desks: ['home', 'national', 'state', 'global', 'law', 'carbon', 'economics'],
    startTab: 'national',
  },
  {
    id: 'journalist',
    label: 'Journalist',
    short: 'Journalist',
    hint: 'Newsroom coverage across every desk.',
    desks: 'all',
    startTab: 'home',
  },
  {
    id: 'student',
    label: 'UPSC Aspirant',
    short: 'UPSC',
    hint: 'Polity, current affairs, and exam-facing desks.',
    desks: ['home', 'national', 'state', 'law', 'economics', 'global', 'carbon'],
    startTab: 'national',
  },
  {
    id: 'analyst',
    label: 'Corporate Affairs',
    short: 'Corporate',
    hint: 'Full terminal — regulatory, legislative, and sector desks.',
    desks: 'all',
    startTab: 'home',
  },
  {
    id: 'lawyer',
    label: 'Legal Researcher',
    short: 'Legal',
    hint: 'Judgements, statute, and parliamentary record.',
    desks: ['home', 'law', 'national', 'state', 'global'],
    startTab: 'law',
  },
  {
    id: 'academic',
    label: 'Academic',
    short: 'Academic',
    hint: 'Longitudinal public records with labelled sources.',
    desks: ['home', 'national', 'state', 'law', 'economics', 'global', 'carbon'],
    startTab: 'national',
  },
];

const ALL_DESK_IDS = TABS.map((t) => t.id);

export function userTypeOf(id) {
  return USER_TYPES.find((t) => t.id === id) || USER_TYPES.find((t) => t.id === DEFAULT_USER_TYPE);
}

export function desksForType(typeId) {
  const spec = userTypeOf(typeId).desks;
  if (!spec || spec === 'all') return ALL_DESK_IDS;
  const allow = new Set(spec);
  allow.add('home');
  return ALL_DESK_IDS.filter((id) => allow.has(id));
}

export function tabsForType(typeId) {
  const allow = new Set(desksForType(typeId));
  return TABS.filter((t) => allow.has(t.id));
}

export function canOpenDesk(typeId, tabId) {
  return desksForType(typeId).includes(tabId);
}
