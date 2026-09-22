import { TABS, catalogModules, modulesForTier } from '../desks/catalog.js';
import { fetchFeature } from './featureFeed.js';
import { githubCsvUrl } from './githubCsv.js';
import { collectRowUrls, isHubListingUrl, rowPinKey, rowRecordText, sourceKindHint } from './sourceUrls.js';
import { billDocumentKey } from './deskRows.js';

export const AI_DND = 'application/x-niyantran-ai';

export function openAiResearch(detail = {}) {
  window.dispatchEvent(new CustomEvent('niy-ai-open', { detail }));
}

export function aiDragProps(payload) {
  return {
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      const data = JSON.stringify({ v: 1, ...payload });
      e.dataTransfer.setData(AI_DND, data);
      e.dataTransfer.setData('text/plain', payload.title || payload.feature || 'Niyantran record');
      e.dataTransfer.effectAllowed = 'copy';
    },
  };
}

export function rowDragProps(row, extra = {}) {
  if (!row) return {};
  const title =
    extra.title ||
    row.conflict_name ||
    row.name ||
    row.title ||
    row.bill_name ||
    row.theatre ||
    row.commodity ||
    'Record';
  return aiDragProps({
    kind: 'row',
    title,
    row,
    feature: extra.feature || '',
    tab: extra.tab || '',
  });
}

export function readAiDrag(e) {
  try {
    const raw = e.dataTransfer?.getData(AI_DND) || e.dataTransfer?.getData('text/plain');
    if (!raw) return null;
    if (raw.startsWith('{')) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

function fileKind(url) {
  const k = sourceKindHint(url);
  return k === 'page' ? '' : k || '';
}

function urlsFromRow(row) {
  if (!row || typeof row !== 'object') return [];
  const packed = collectRowUrls(row);
  const gh = githubCsvUrl(row);
  if (gh && !packed.toFetch.includes(gh) && !isHubListingUrl(gh)) packed.toFetch.unshift(gh);
  return packed.toFetch.slice(0, 4);
}

function provenanceUrls(row) {
  const packed = collectRowUrls(row);
  return [...packed.hubs, ...packed.all.filter((u) => !packed.toFetch.includes(u))].slice(0, 4);
}

function rowPreview(row) {
  if (!row || typeof row !== 'object') return {};
  const skip = new Set(['__alId', '__gaId', '__saId', 'members_json', 'agenda_json', 'sources_json']);
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k) || k.startsWith('_')) continue;
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    out[k] = String(v).slice(0, 500);
    n += 1;
    if (n >= 32) break;
  }
  const docs = urlsFromRow(row);
  const hubs = provenanceUrls(row);
  if (docs.length) out.attached_documents = docs;
  if (hubs.length) out.provenance_hubs = hubs;
  out.record_text = rowRecordText(row).slice(0, 4_000);
  return out;
}

function relatedPacket(row, feed) {
  if (!row || !feed) return {};
  const id = row.id;
  const name = String(row.conflict_name || row.name || row.title || row.bill_name || '')
    .trim()
    .toLowerCase();
  const related = [];
  const extraUrls = [];
  for (const r of feed.rows || []) {
    if (!r || r === row || r.status === 'source_status') continue;
    if (id && r.id === id) continue;
    const hay = `${r.conflict_name || ''} ${r.title || ''} ${r.name || ''} ${r.related_to || ''} ${r.theatre || ''}`.toLowerCase();
    if (name && name.length > 3 && hay.includes(name)) {
      related.push(rowPreview(r));
      extraUrls.push(...urlsFromRow(r));
    }
    if (related.length >= 8) break;
  }
  const timeline = (feed.timeline || [])
    .filter((t) => {
      const h = `${t.conflict || t.name || t.text || t.title || ''}`.toLowerCase();
      return (id && t.id === id) || (name && name.length > 3 && h.includes(name));
    })
    .slice(0, 10)
    .map((t) => ({
      date: t.date || t.when || '',
      text: String(t.hook || t.text || t.headline || t.title || t.latest || '').slice(0, 400),
    }));
  return {
    related_records: related,
    timeline,
    extraUrls: [...new Set(extraUrls)],
  };
}

function slimRows(rows, cap = 28) {
  return (rows || []).filter((r) => r && r.status !== 'source_status').slice(0, cap).map(rowPreview);
}

async function hydrateDocumentFiles(urls, title) {
  const files = [];
  for (const url of (urls || []).slice(0, 2)) {
    const kind = fileKind(url) || 'link';
    try {
      const q = new URLSearchParams({ url });
      if (title) q.set('title', title);
      const res = await fetch(`/api/ai/source-extract?${q}`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok && String(body.text || '').replace(/\s/g, '').length >= 40) {
        files.push({
          url: body.url || url,
          kind: body.kind || kind,
          name: title || url,
          text: String(body.text).slice(0, 80_000),
        });
      } else {
        files.push({
          url,
          kind,
          name: title || url,
          error: body?.error || 'Could not extract document text',
        });
      }
    } catch (err) {
      files.push({ url, kind, name: title || url, error: err.message || String(err) });
    }
  }
  return files;
}

/**
 * Stable identity for an attachment, used to keep the same drop from being
 * attached twice. Both chat stores previously keyed existing attachments on
 * `a.id` and incoming ones on their content. Every stored attachment is given a
 * generated id on insert, so the two sides could never match and dedupe worked
 * only within a single drop - four separate drops of one feature produced four
 * copies, each paid for in the prompt on every turn.
 *
 * Identity is content, not the generated id. `tab` and `feature` separate two
 * rows that share a title, which the title and url alone would collide.
 */
export function attachmentIdentity(a) {
  if (!a || typeof a !== 'object') return '';
  const text = typeof a.text === 'string' ? a.text.length : 0;
  return [a.kind || '', a.title || '', a.tab || '', a.feature || '', a.url || '', text].join('\u0000');
}

export async function materializeAiDrop(payload, extras = {}) {
  if (!payload) return [];
  const kind = payload.kind || 'feature';
  const attachments = [];

  if (kind === 'row' && payload.row) {
    const related = relatedPacket(payload.row, extras.feed);
    const docs = [...new Set([...urlsFromRow(payload.row), ...(related.extraUrls || [])])].slice(0, 3);
    const hubs = provenanceUrls(payload.row);
    const title =
      payload.title ||
      payload.row.conflict_name ||
      payload.row.title ||
      payload.row.name ||
      payload.row.bill_name ||
      'Record';
    const files = docs.length
      ? await hydrateDocumentFiles(docs, title)
      : [
          {
            kind: 'record',
            name: title,
            text: rowRecordText(payload.row, { title }),
          },
        ];
    if (docs.length) {
      files.unshift({
        kind: 'record',
        name: `${title} (terminal columns)`,
        text: rowRecordText(payload.row, { title }),
      });
    }
    attachments.push({
      kind: 'row',
      title,
      tab: payload.tab || '',
      feature: payload.feature || extras.feature || extras.feed?.feature || '',
      // The corpus key for this record, computed here from the whole row rather
      // than later from `preview`, which keeps only its first 32 scalar fields.
      // research-chat scopes document search to the keys a turn carries
      // (validate.ts documentKeysOf) and the selection was sending one while
      // attachments were not - so a bill dropped into the chat could not be
      // scoped to its own text even when that text was indexed.
      ...(billDocumentKey(payload.row) ? { document_key: billDocumentKey(payload.row) } : {}),
      preview: {
        ...rowPreview(payload.row),
        related_records: related.related_records,
        timeline: related.timeline,
        document_status: docs.length
          ? 'Source document URL(s) attached — extracted when reachable.'
          : hubs.length
            ? 'No document body on file — registry hub URL is provenance only. Answer from terminal columns.'
            : 'No source URL on file — answer from terminal columns.',
      },
      urls: docs.length ? docs : hubs.slice(0, 1),
      files,
    });
    return attachments;
  }

  if (kind === 'tab') {
    const tab = TABS.find((t) => t.id === payload.tab) || TABS.find((t) => t.tier === payload.tier);
    const mods = tab ? modulesForTier(tab.tier) : [];
    attachments.push({
      kind: 'tab',
      title: tab?.label || payload.title || 'Desk',
      tab: tab?.id || payload.tab,
      feature: '',
      preview: { modules: mods.slice(0, 40).map((m) => m.htmlFeature).join(' · ') },
      urls: [],
      files: [],
    });
    return attachments;
  }

  if (kind === 'feed' && extras.feed?.rows?.length) {
    // Prefer the selected row on this desk so Ask AI is never "feed URLs only".
    if (extras.selected) {
      return materializeAiDrop(
        {
          kind: 'row',
          row: extras.selected,
          feature: extras.feed.feature || payload.feature,
          tab: payload.tab || '',
          title:
            extras.selected.bill_name ||
            extras.selected.title ||
            extras.selected.name ||
            extras.selected.subject ||
            extras.selected.conflict_name ||
            'Selected record',
        },
        extras,
      );
    }
    const sample = slimRows(extras.feed.rows, 6);
    const docs = [...new Set((extras.feed.rows || []).flatMap(urlsFromRow))].slice(0, 3);
    const columnPack = sample
      .map((r) => r.record_text || rowRecordText(r))
      .filter(Boolean)
      .join('\n\n---\n\n')
      .slice(0, 24_000);
    attachments.push({
      kind: 'feed',
      title: extras.feed.feature || payload.feature || 'Current feed',
      tab: payload.tab || '',
      feature: extras.feed.feature || payload.feature,
      preview: {
        rows: sample,
        note: extras.feed.source?.note || '',
        document_status: docs.length
          ? 'Sample desk rows + extractable documents.'
          : 'Sample desk rows (terminal columns). Hub URLs are provenance only.',
        record_text: columnPack,
      },
      urls: docs,
      files: [
        { kind: 'record', name: `${extras.feed.feature || 'Desk'} sample columns`, text: columnPack },
        ...(await hydrateDocumentFiles(docs, extras.feed.feature || 'Desk document')),
      ],
    });
    return attachments;
  }

  const feature = payload.feature || payload.title;
  const tier = payload.tier || extras.tier || '';
  if (feature) {
    let rows = [];
    let note = '';
    try {
      const body = await fetchFeature({ tier, feature });
      rows = slimRows(body?.rows);
      note = body?.source?.note || '';
    } catch (err) {
      note = err.message || 'Feed unavailable';
    }
    const urls = [
      ...new Set((payload.urls || []).concat(rows.flatMap((r) => r.attached_documents || []).flat()).filter(Boolean)),
    ].slice(0, 4);
    attachments.push({
      kind: 'feature',
      title: feature,
      tab: payload.tab || '',
      feature,
      preview: { rows, note },
      urls,
      files: urls.map((url) => ({ url, kind: fileKind(String(url)) || 'link' })),
    });
    return attachments;
  }

  if (kind === 'desk') {
    return materializeAiDrop({ kind: 'tab', tab: payload.tab, title: payload.title });
  }

  return [
    {
      kind: kind || 'note',
      title: payload.title || 'Context',
      tab: payload.tab || '',
      feature: payload.feature || '',
      preview: payload.preview || {},
      urls: payload.urls || [],
      files: (payload.urls || []).map((url) => ({ url, kind: fileKind(url) || 'link' })),
    },
  ];
}

export function catalogHint(tabId) {
  const tab = TABS.find((t) => t.id === tabId);
  if (!tab) return '';
  return modulesForTier(tab.tier)
    .slice(0, 8)
    .map((m) => m.htmlFeature)
    .join(', ');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function filesFromDrop(e) {
  const list = [...(e.dataTransfer?.files || [])];
  const out = [];
  for (const file of list) {
    const kind =
      fileKind(file.name) ||
      (file.type.includes('pdf')
        ? 'pdf'
        : file.type.startsWith('image/')
          ? 'image'
          : file.type.includes('csv')
            ? 'csv'
            : /sheet|excel|spreadsheet/i.test(file.type)
              ? 'sheet'
              : 'text');
    const rec = { kind: 'file', title: file.name, urls: [], files: [] };
    try {
      if (kind === 'pdf' || kind === 'image' || kind === 'sheet') {
        rec.files.push({
          name: file.name,
          kind,
          mime:
            file.type ||
            (kind === 'pdf'
              ? 'application/pdf'
              : kind === 'sheet'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'image/png'),
          base64: await fileToBase64(file),
        });
      } else {
        rec.files.push({
          name: file.name,
          kind: kind || 'text',
          mime: file.type,
          text: (await file.text()).slice(0, 180000),
        });
      }
    } catch {
      rec.files.push({ name: file.name, kind, error: 'Could not read file' });
    }
    out.push(rec);
  }
  return out;
}

export { catalogModules };
