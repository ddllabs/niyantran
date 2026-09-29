const analysisCache = new Map();
let ontologyP = null;

export const DESKS = {
  bill: {
    key: 'bill',
    match: /bill passage/i,
    noun: 'bill',
    backLabel: 'All bills',
    nameF: 'bill_name',
    stageF: 'current_stage',
    dateF: 'date_introduced',
    subjectF: 'sector',
    houseF: 'house',
    srcF: 'source_url',
    analysis: 'national_bill_analysis.json',
    changesTitle: 'Key changes in the bill',
    changesF: 'key_changes',
    allowP2: false,
  },
  pipeline: {
    key: 'pipeline',
    match: /policy pipeline/i,
    noun: 'policy',
    backLabel: 'All policies',
    nameF: 'policy_name',
    stageF: 'stage',
    dateF: 'date_reported',
    subjectF: 'ministry',
    srcF: 'source_url',
    analysis: 'national_policy_pipeline_analysis.json',
    changesTitle: 'Why it matters',
    changesF: 'why_it_matters',
    allowP2: true,
  },
  question: {
    key: 'question',
    match: /parliamentary question/i,
    noun: 'question',
    backLabel: 'All questions',
    nameF: 'subject',
    stageF: 'question_type',
    dateF: 'date',
    subjectF: 'ministry',
    houseF: 'house',
    srcF: 'source_url',
    analysis: 'national_question_database_analysis.json',
    changesTitle: 'Why it matters',
    changesF: 'why_it_matters',
    allowP2: false,
    dateDots: true,
  },
  regulatory: {
    key: 'regulatory',
    match: /regulatory (body )?watch/i,
    noun: 'notice',
    backLabel: 'All notices',
    nameF: 'title',
    stageF: 'action_type',
    dateF: 'date',
    subjectF: 'regulator',
    srcF: 'detail_url',
    pdfF: 'pdf_url',
    analysis: 'national_regulatory_watch_analysis.json',
    changesTitle: 'Possible effects',
    changesF: 'possible_effects',
    allowP2: true,
    routineGuard: true,
  },
};

export function deskForFeature(feature) {
  const f = String(feature || '');
  return Object.values(DESKS).find((d) => d.match.test(f)) || null;
}

export function loadAnalysisMap(file) {
  const key = file || DESKS.bill.analysis;
  if (!analysisCache.has(key)) {
    analysisCache.set(
      key,
      fetch(`/data/embedded_json/${key}`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    );
  }
  return analysisCache.get(key);
}

export function loadBillAnalysisMap() {
  return loadAnalysisMap(DESKS.bill.analysis);
}

export function loadOntology() {
  if (!ontologyP) {
    ontologyP = fetch('/data/ontology.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return ontologyP;
}

function catNorm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '');
}

/** Analysis JSON is keyed "1"…"N"; tracker rows use Sansad-style ids. Join by bill_number + category. */
const analysisIndexCache = new WeakMap();

function analysisIndex(map) {
  let ix = analysisIndexCache.get(map);
  if (ix) return ix;
  const byNumCat = new Map();
  const byNum = new Map();
  for (const v of Object.values(map)) {
    if (!v || typeof v !== 'object') continue;
    const n = String(v.enrichment?.bill_number || '').trim();
    if (!n) {
      // numeric string keys remain direct lookups via map[k]
      continue;
    }
    const cat = catNorm(v.enrichment?.bill_category);
    const nc = `${n}|${cat}`;
    if (!byNumCat.has(nc)) byNumCat.set(nc, v);
    const bucket = byNum.get(n) || [];
    bucket.push(v);
    byNum.set(n, bucket);
  }
  ix = { byNumCat, byNum };
  analysisIndexCache.set(map, ix);
  return ix;
}

export function analysisFor(row, map) {
  if (!row || !map) return null;
  if (row.id != null && (map[String(row.id)] || map[row.id])) return map[String(row.id)] || map[row.id];
  if (row.__idx != null && map[String(row.__idx)]) return map[String(row.__idx)];
  const n = String(row.bill_number || '').trim();
  if (!n) return null;
  const ix = analysisIndex(map);
  const cat = catNorm(row.bill_category);
  const byCat = ix.byNumCat.get(`${n}|${cat}`);
  if (byCat) return byCat;
  const bucket = ix.byNum.get(n) || [];
  if (bucket.length === 1) return bucket[0];
  return null;
}

function computeDaysInStage(row, du) {
  if (du?.days_in_current_stage != null && Number.isFinite(Number(du.days_in_current_stage))) {
    return Number(du.days_in_current_stage);
  }
  const raw = row?.date_introduced || row?.occurred_at || row?.source_date_raw || '';
  const d = Date.parse(String(raw).replace(' ', 'T'));
  if (!Number.isFinite(d)) return null;
  return Math.max(0, Math.round((Date.now() - d) / 86400000));
}

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function clip(s, n) {
  const t = String(s || '');
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function arr(v) {
  return Array.isArray(v) ? v.slice() : v ? [String(v)] : [];
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isGoogleNews(url) {
  return /news\.google\.com/i.test(String(url || ''));
}

function pdfUrl(a, row, cfg) {
  if (cfg?.pdfF && row?.[cfg.pdfF]) return String(row[cfg.pdfF]);
  const pl = a?.enrichment?.pdf_links;
  if (pl) {
    for (const k of ['gazetted', 'passed_both', 'passed_rs', 'passed_ls', 'introduced']) {
      if (pl[k]) return String(pl[k]);
    }
  }
  if (a?.pdf_url) return String(a.pdf_url);
  const su = row?.source_url || '';
  if (/\.pdf(\?|$)/i.test(su) && !isGoogleNews(su)) return su;
  return '';
}

function sourceUrl(row, cfg) {
  const u = (cfg?.srcF && row?.[cfg.srcF]) || row?.source_url || '';
  if (!u || isGoogleNews(u)) return '';
  return String(u);
}

function bandOfScore(score) {
  if (score == null || Number.isNaN(Number(score))) return '';
  const n = Number(score);
  return n >= 66 ? 'Strong' : n >= 33 ? 'Moderate' : 'Weak';
}

function matchInstitution(raw, ontology) {
  const q = norm(raw);
  if (!q || !ontology?.institutions) return null;
  let best = null;
  let bestLen = 0;
  for (const ins of ontology.institutions) {
    for (const al of [ins.name, ...(ins.aliases || [])]) {
      const n = norm(al);
      if (!n) continue;
      if (n === q) return ins;
      if (n.length > 4 && (q.includes(n) || n.includes(q)) && n.length > bestLen) {
        best = ins;
        bestLen = n.length;
      }
    }
  }
  return best;
}

function formatDotDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return s.split(' ')[0];
}

function displayDate(raw, cfg) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return cfg?.dateDots ? formatDotDate(s) : s.split(' ')[0];
}

const P2_ROUTINE_RE =
  /\bauction\b|treasury bill|t-?bill\b|variable rate repo|\bvrr+\b|reverse repo|money market operation|open market operation|\bomo\b|government stock|underwriting|liquidity adjustment|\blaf\b|standing deposit facility|marginal standing facility|bulletin|statistical supplement|weekly statistical|sectoral deployment|lending and deposit rates|international investment position|\biip\b|invisibles|international trade in (services|banking)|\bsurvey\b|financial stability report|handbook of statistics|provisional data|premature redemption|redemption price|floating rate savings bond|\bfrsb\b|sovereign gold bond|\bsgb\b|citizen.?s charter|processing of applications|\bappoints\b|appointment of|new executive director|date extension|extension of (the )?(last )?date|corrigendum|statement of position|external debt|money supply|indicative calendar|market borrowings by|meets representatives/;

function isRoutineNotice(row, cfg) {
  if (!cfg?.routineGuard) return false;
  const action = String(row?.action_type || '').toLowerCase();
  if (action === 'routine') return true;
  return P2_ROUTINE_RE.test(norm(row?.title || ''));
}

export function recordFacts(row, a, cfg) {
  if (!cfg || cfg.key === 'bill') return billFacts(row, a);
  return genericFacts(row, a, cfg);
}

function factHasValue(value) {
  if (value == null) return false;
  const s = String(value).trim();
  return s !== '' && s !== '—' && s !== '-' && s !== 'Not reported';
}

export function billFacts(row, a) {
  const pp = a?.passage_probability || {};
  const pr = a?.precedent || {};
  const du = a?.stage_duration || {};
  const score = pp.score == null ? (row.probability_score === '' ? null : Number(row.probability_score)) : pp.score;
  const days = computeDaysInStage(row, du);
  const typical = du.typical_days_for_stage;
  const secs = arr(a?.sectors);
  if (!secs.length && row.sector) secs.push(titleCase(row.sector));
  const terms = arr(a?.key_terms);
  const facts = [
    {
      k: 'prob',
      label: 'Passage probability',
      value: score == null || Number.isNaN(Number(score)) ? null : `${Number(score)}%`,
      tone: bandOfScore(score),
      bar: score == null || Number.isNaN(Number(score)) ? null : Number(score),
      more: {
        body:
          pp.methodology_note ||
          (score == null ? 'No probability has been computed for this bill.' : 'Stored column on the tracker, not a live forecast.'),
        kv: [
          pp.comparison_baseline ? ['Baseline', pp.comparison_baseline] : null,
          pp.confidence ? ['Confidence', titleCase(pp.confidence)] : null,
          ['Stored score', row.probability_score === '' ? '-' : String(row.probability_score)],
        ].filter(Boolean),
      },
    },
    {
      k: 'prec',
      label: 'Precedent',
      value: pr.similar_bill_count ? `${pr.similar_bill_passed_count} of ${pr.similar_bill_count}` : null,
      more: {
        body: pr.similar_bill_count
          ? `${pr.base_rate_label || ''}\nThe base rate comes from this dataset's own historically tracked bills carrying the same tag. It is what usually happened, not a forecast for this one.`
          : 'No comparable resolved bills on record for this tag.',
        kv: [],
      },
    },
    {
      k: 'stage',
      label: 'Days in stage',
      value: days == null ? null : `${days}d`,
      more: {
        body: days == null ? 'Time in the current stage has not been computed for this bill.' : '',
        kv: [
          ['Current stage', row.current_stage || 'Unknown'],
          days != null ? ['Days elapsed', String(days)] : null,
          typical != null ? ['Typical for this stage', `~${typical} days`] : null,
          ['Introduced', String(row.date_introduced || '').split(' ')[0] || '-'],
          ['House', row.house || '-'],
        ].filter(Boolean),
      },
    },
    {
      k: 'sector',
      label: 'Sector it covers',
      value: secs.length ? clip(secs[0], 18) : null,
      sub: secs.length > 1 ? `+${secs.length - 1} more` : '',
      more: {
        body: secs.length ? '' : 'This bill has not been sector-tagged.',
        kv: row.sector ? [['Sponsoring ministry on record', titleCase(row.sector)]] : [],
        pills: secs,
      },
    },
    {
      k: 'terms',
      label: 'Key terms',
      value: terms.length ? clip(terms[0], 13) : null,
      sub: terms.length > 1 ? `+${terms.length - 1}` : '',
      more: {
        body: terms.length ? '' : 'No key terms have been extracted for this bill yet.',
        pills: terms,
        kv: [],
      },
    },
  ];
  return facts.filter((f) => factHasValue(f.value));
}

function genericFacts(row, a, cfg) {
  const tags = arr(a?.tags);
  const subject = row[cfg.subjectF] || '';
  const stage = row[cfg.stageF] || '';
  const reported = displayDate(row[cfg.dateF], cfg);
  const out = [];
  out.push({
    k: 'subject',
    label: cfg.key === 'regulatory' ? 'Regulator' : 'Ministry',
    value: subject ? clip(subject, 15) : '—',
    more: {
      body: '',
      kv: [
        ['On record', titleCase(subject || '—')],
        a?.category ? ['Category', a.category] : null,
      ].filter(Boolean),
    },
  });
  if (cfg.key === 'question' && row.mp_name) {
    out.push({
      k: 'mp',
      label: 'Asked by',
      value: clip(row.mp_name, 15),
      more: {
        body: '',
        kv: [
          ['Member', row.mp_name],
          row.party ? ['Party', row.party] : null,
          row.house ? ['House', row.house] : null,
        ].filter(Boolean),
      },
    });
  }
  out.push({
    k: 'stage',
    label: cfg.key === 'question' ? 'Type' : cfg.key === 'regulatory' ? 'Action type' : 'Stage',
    value: stage ? clip(stage, 15) : '—',
    more: {
      body: '',
      kv: [
        [cfg.key === 'question' ? 'Question type' : 'Stage', stage || '—'],
        row.status ? ['Status', row.status] : null,
      ].filter(Boolean),
    },
  });
  out.push({
    k: 'date',
    label: 'Reported',
    value: reported || '—',
    more: {
      body: '',
      kv: [['Date on record', reported || '—']],
    },
  });
  if (a?.category && cfg.key === 'regulatory') {
    out.push({
      k: 'cat',
      label: 'Category',
      value: clip(a.category, 15),
      more: { body: a.category, kv: [] },
    });
  }
  out.push({
    k: 'tags',
    label: 'Tags',
    value: tags.length ? clip(tags[0], 13) : '—',
    sub: tags.length > 1 ? `+${tags.length - 1}` : '',
    more: {
      body: tags.length ? '' : `No tags were extracted for this ${cfg.noun}.`,
      pills: tags,
      kv: [],
    },
  });
  return out.slice(0, 5);
}

function inHay(phrase, hay) {
  const q = norm(phrase);
  return q.length > 1 && hay.includes(` ${q} `);
}

function hitKw(list, hay) {
  if (!list) return false;
  return list.some((k) => inHay(k, hay));
}

function namedCompanies(ontology, hay) {
  const out = [];
  (ontology?.companies || []).forEach((c) => {
    const aliases = [c.name, c.legalName, ...(c.aliases || [])].filter(Boolean);
    const named = aliases.some((al) => {
      const q = norm(al);
      return q.length >= 3 && hay.includes(` ${q} `);
    });
    if (named) {
      out.push({
        nt: 'company',
        id: `company:${c.id}`,
        name: c.name,
        band: 'Strong',
        path: 'P1',
        viaLabel: '',
        sectorName: c.sector || '',
        score: 3,
      });
    }
  });
  return out;
}

function ontologyLinks(row, a, ontology, cfg) {
  const name = row[cfg.nameF] || row.title || '';
  const brief = String(a?.brief || '').trim();
  const tags = arr(a?.tags).join(' ');
  const subject = String(row[cfg.subjectF] || '');
  const hay = ` ${norm(`${name} ${brief} ${tags} ${subject} ${a?.category || ''}`)} `;
  const inst = matchInstitution(subject, ontology);
  const secMeta = {};
  (ontology?.sectors || []).forEach((s) => {
    secMeta[s.id] = s;
  });
  const secHit = {};
  const secDirect = {};
  (ontology?.sectors || []).forEach((s) => {
    if (inHay(s.name, hay) || hitKw(s.keywords, hay)) {
      secHit[s.id] = s;
      secDirect[s.id] = 1;
    }
  });
  arr(a?.sectors).forEach((label) => {
    const hit = (ontology?.sectors || []).find((s) => norm(s.name) === norm(label));
    if (hit) {
      secHit[hit.id] = hit;
      secDirect[hit.id] = 1;
    } else if (label) {
      secHit[`tag:${norm(label)}`] = { id: `tag:${norm(label)}`, name: label };
      secDirect[`tag:${norm(label)}`] = 1;
    }
  });
  const govBy = {};
  if (inst) {
    (inst.governs || []).forEach((sid) => {
      if (secMeta[sid]) {
        if (!secHit[sid]) secHit[sid] = secMeta[sid];
        govBy[sid] = inst.name;
      }
    });
  }
  const themeHit = {};
  (ontology?.themes || []).forEach((t) => {
    if (inHay(t.name, hay) || hitKw(t.keywords, hay)) themeHit[t.id] = t;
  });
  const commHit = {};
  (ontology?.commodities || []).forEach((c) => {
    if (inHay(c.name, hay) || hitKw(c.keywords, hay)) commHit[c.id] = c;
  });

  const sectors = Object.keys(secHit).map((id) => ({
    nt: 'sector',
    id: `sec:${id}`,
    name: secHit[id].name,
    band: secDirect[id] ? 'Strong' : 'Moderate',
    declared: false,
  }));
  const segments = [];
  if (inst) {
    segments.push({
      nt: 'segment',
      id: `inst:${inst.id}`,
      name: inst.name,
      kind: 'institution',
      band: 'Strong',
    });
  } else if (subject) {
    segments.push({
      nt: 'segment',
      id: `min:${norm(subject)}`,
      name: titleCase(subject),
      kind: 'institution',
      band: 'Strong',
    });
  }
  Object.keys(themeHit).forEach((id) => {
    segments.push({ nt: 'segment', id: `theme:${id}`, name: themeHit[id].name, kind: 'theme', band: 'Moderate' });
  });
  Object.keys(commHit).forEach((id) => {
    segments.push({ nt: 'segment', id: `comm:${id}`, name: commHit[id].name, kind: 'commodity', band: 'Moderate' });
  });

  const companies = namedCompanies(ontology, hay);
  const seen = new Set(companies.map((c) => c.id));
  const allowP2 = cfg.allowP2 && !isRoutineNotice(row, cfg);
  if (allowP2) {
    (ontology?.companies || []).forEach((c) => {
      const id = `company:${c.id}`;
      if (seen.has(id)) return;
      const secName = secMeta[c.sector] ? secMeta[c.sector].name : c.sector;
      if (c.sector && secHit[c.sector]) {
        companies.push({
          nt: 'company',
          id,
          name: c.name,
          band: 'Moderate',
          path: 'P2',
          viaInst: govBy[c.sector] || '',
          viaLabel: `${govBy[c.sector] ? `${govBy[c.sector]} → ` : ''}${secName}`,
          sectorName: secName,
          score: 2,
        });
        seen.add(id);
      }
    });
  }
  companies.sort((x, y) => (y.score || 0) - (x.score || 0));
  return { sectors, segments, companies, inst };
}

export function buildRecordModel(row, a, ontology, cfg) {
  const desk = cfg || DESKS.bill;
  const rawName = row[desk.nameF] || row.title || titleCase(desk.noun);
  const name = desk.key === 'bill' ? titleCase(rawName) : rawName;
  const brief = String(a?.brief || '').trim();
  let sectors = [];
  let segments = [];
  let companies = [];
  if (desk.key === 'bill') {
    const hay = ` ${norm(`${name} ${brief}`)} `;
    sectors = arr(a?.sectors).map((n) => ({
      nt: 'sector',
      id: `sec:${norm(n)}`,
      name: n,
      band: 'Strong',
      declared: false,
    }));
    const inst = matchInstitution(row.sector, ontology);
    if (inst) {
      segments.push({
        nt: 'segment',
        id: `inst:${inst.id}`,
        name: inst.name,
        kind: 'institution',
        band: 'Strong',
      });
    } else if (row.sector) {
      segments.push({
        nt: 'segment',
        id: `min:${norm(row.sector)}`,
        name: titleCase(row.sector),
        kind: 'institution',
        band: 'Strong',
      });
    }
    if (!sectors.length && row.sector && !inst) {
      const raw = titleCase(row.sector);
      sectors.push({ nt: 'sector', id: `raw:${norm(raw)}`, name: raw, band: 'Moderate', declared: true });
    }
    companies = namedCompanies(ontology, hay);
  } else {
    const linked = ontologyLinks(row, a, ontology, desk);
    sectors = linked.sectors;
    segments = linked.segments;
    companies = linked.companies;
  }
  const recSrc = sourceUrl(row, desk);
  return {
    cfg: desk,
    name,
    stage: row[desk.stageF] || '',
    house: row[desk.houseF] || '',
    introduced: displayDate(row[desk.dateF], desk),
    ministry: row[desk.subjectF] || '',
    brief,
    changes: arr(a?.[desk.changesF]),
    watchFor: a?.watch_for ? String(a.watch_for) : '',
    timesRaised: a?.times_raised || row.times_raised || '',
    coverage: Array.isArray(a?.related_coverage) ? a.related_coverage : [],
    pdf: pdfUrl(a, row, desk),
    source: recSrc,
    blockedNews: isGoogleNews(row.source_url || (desk.srcF && row[desk.srcF]) || ''),
    routine: isRoutineNotice(row, desk),
    sectors,
    segments,
    companies,
    analysis: a,
    row,
  };
}

export function buildBillModel(row, a, ontology) {
  return buildRecordModel(row, a, ontology, DESKS.bill);
}

function W(t, noun) {
  if (!t || noun === 'bill') return t;
  return String(t)
    .replace(/\bbill’s\b/g, `${noun}’s`)
    .replace(/\bThe bill\b/g, `The ${noun}`)
    .replace(/\bthe bill\b/g, `the ${noun}`)
    .replace(/\bthis bill\b/g, `this ${noun}`)
    .replace(/\bBill\b/g, titleCase(noun))
    .replace(/\bbill\b/g, noun);
}

export function whatItDoes(model, liveBrief = '') {
  const noun = model.cfg?.noun || 'bill';
  if (model.brief && model.brief.length > 30) return model.brief;
  const live = String(liveBrief || '').trim();
  if (live.length > 40) return live;
  if (model.cfg?.key === 'question') {
    const r = model.row || {};
    const who = r.mp_name || 'A member';
    const type = String(r.question_type || 'question').toLowerCase();
    const house = r.house ? ` in the ${r.house}` : '';
    const when = model.introduced ? ` on ${model.introduced}` : '';
    return `${who} asked a ${type} question${house} on “${model.name}”${when}. No authored brief is on file for this row — opening the source when a readable document is linked.`;
  }
  if (model.changes.length) return model.changes.slice(0, 2).join(' ');
  if (model.sectors.length) return `This ${noun} is tagged to ${model.sectors.map((s) => s.name).join(', ')}.`;
  return `Opening the source for this ${noun}…`;
}

export function whereItLands(model) {
  const noun = model.cfg?.noun || 'bill';
  const nC = model.companies.length;
  const nS = model.sectors.length;
  const nG = model.segments.length;
  if (!nC && !nS && !nG) {
    return W(
      `Nothing in this bill’s text resolves to a sector, company or segment the ontology tracks, so there is no linkage to draw.`,
      noun,
    );
  }
  let s = `The ${noun} is tagged to ${nS} sector${nS === 1 ? '' : 's'}`;
  if (nG) s += ` and ${nG} institution${nG === 1 ? '' : 's'} on its own record`;
  s += '.';
  if (model.routine && !nC) {
    s +=
      ' This notice is classified as routine money-market output, so company fan-out through the regulator is withheld.';
  } else if (nC) {
    const p2 = model.companies.filter((c) => c.path === 'P2').length;
    const p1 = model.companies.filter((c) => c.path === 'P1').length;
    if (p1) s += ` ${p1} compan${p1 === 1 ? 'y is' : 'ies are'} named in the text (path P1).`;
    if (p2) {
      s += ` ${p2} compan${p2 === 1 ? 'y sits' : 'ies sit'} in a sector this ${noun} reaches (path P2) — sector-level, not a mention.`;
    }
  } else {
    s += ` No listed company is named in the ${noun} text, so none are drawn from a mention.`;
  }
  return s;
}

export function howItTravels(model) {
  const noun = model.cfg?.noun || 'bill';
  const p1 = model.companies.filter((c) => c.path === 'P1');
  const p2 = model.companies.filter((c) => c.path === 'P2');
  if (p1.length) {
    return `Named companies sit on path P1 — the ${noun} text itself contains the name. That is the only path that claims the document names the company.`;
  }
  if (p2.length) {
    return `Companies are reached through the institution or sector on record (${p2[0].viaLabel || model.ministry}). The ${noun} does not name them individually.`;
  }
  if (model.routine) {
    return 'Routine auctions, statistical releases and money-market operations are not treated as institutional action, so they do not fan out to companies.';
  }
  if (model.sectors.length) {
    return `The recorded path is this ${noun}’s own sector or ministry tag (${model.sectors.map((s) => s.name).join(', ')}).`;
  }
  return `No derivation path is available for this ${noun}.`;
}

export function footNote(model) {
  const noun = model.cfg?.noun || 'bill';
  if (model.cfg?.key === 'bill') {
    return 'Links come from this bill’s analysis tags and the ministry on its record. A company is drawn only when the bill text names it. Structural research linkage — not investment advice.';
  }
  if (model.cfg?.key === 'question') {
    return 'Questions are inquiries, not actions, so the graph stays sparse. A company is drawn only when the question names it. No answer text is published on these rows. Structural research linkage — not investment advice.';
  }
  if (model.routine) {
    return 'Routine money-market notices do not fan out to companies. Structural research linkage — not investment advice.';
  }
  return `Links come from this ${noun}’s record and the ontology. Sector-level company links are not mentions. Structural research linkage — not investment advice.`;
}

export { titleCase, clip, arr, pdfUrl, displayDate };
