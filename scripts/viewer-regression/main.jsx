import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PageViewer from '../../src/ai/page-viewer/PageViewer.jsx';
import { normalise, sha256Hex } from '../../src/lib/textNormalise.js';
import { foldQuery, lowerAsDatabase } from '../../src/ai/page-viewer/searchModel.js';
import { CITED_PAGE, DOCUMENT_ID, EXTRACT_HASH, INACCURATE_BOX, PAGE_COUNT, PAGE_ROWS, PASSAGE } from './fixture-data.mjs';
import { startProfile } from './profile-metrics.js';
import './fixture.css';

function queryBuilder(rows) {
  let selected = rows;
  let signal;
  const query = {
    select() { return query; },
    eq(key, value) { selected = selected.filter(row => row[key] === value); return query; },
    gte(key, value) { selected = selected.filter(row => row[key] >= value); return query; },
    lte(key, value) { selected = selected.filter(row => row[key] <= value); return query; },
    order() { return query; },
    range(from, to) { selected = selected.slice(from, to + 1); return query; },
    abortSignal(value) { signal = value; return query; },
    result() { return signal?.aborted ? { data: null, error: true } : { data: selected, error: null }; },
    maybeSingle() { const result = query.result(); return Promise.resolve({ ...result, data: result.data?.[0] ?? null }); },
    then(resolve, reject) { return Promise.resolve(query.result()).then(resolve, reject); },
  };
  return query;
}

function createClient({ byteSize, pageRows, pageCount, extractHash, title }) {
  const identity = { document_id: DOCUMENT_ID, extract_hash: extractHash };
  const tables = {
    documents: [{ id: DOCUMENT_ID, title, file_url: null,
      storage_path: 'local/fixture.pdf', extract_hash: extractHash, page_count: pageCount, indexed_at: '2026-01-01T00:00:00Z' }],
    document_files: [{ document_id: DOCUMENT_ID, part_index: 0, page_offset: 0, page_count: pageCount, byte_size: byteSize }],
    document_pages: pageRows.map(row => ({ ...identity, ...row })),
    document_page_blocks: pageRows.map(row => ({ ...identity, page_number: row.page_number,
      type: 'paragraph', x0: 48 / 612, y0: 0.05, x1: 0.93, y1: 0.94 })),
  };
  return {
    from(table) {
      if (!tables[table]) throw new Error(`Unexpected fixture table: ${table}`);
      return queryBuilder(tables[table]);
    },
    rpc(name, args) {
      if (name !== 'search_document_pages') throw new Error(`Unexpected fixture RPC: ${name}`);
      const needle = foldQuery(args.p_query);
      const rows = needle ? pageRows.flatMap(row => {
        const text = lowerAsDatabase(row.text.normalize('NFC').replace(/[\s#*_|`]+/gu, ' ').trim());
        let hits = 0;
        let cursor = 0;
        while ((cursor = text.indexOf(needle, cursor)) !== -1) { hits++; cursor += needle.length; }
        return hits ? [{ page_number: row.page_number, hits, snippets: [row.text.slice(0, 150)] }] : [];
      }) : [];
      return queryBuilder(rows);
    },
  };
}

const rounded = value => Math.round(value * 10) / 10;
const rectData = rect => ({ x: rounded(rect.x), y: rounded(rect.y), width: rounded(rect.width), height: rounded(rect.height) });
function endpoint(node, offset) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return { page: element?.closest('[data-page]')?.dataset.page ?? null,
    node: node.nodeName, text: node.nodeType === Node.TEXT_NODE ? node.textContent : null, offset, connected: node.isConnected };
}
function snapshot() {
  const areas = [...document.querySelectorAll('.pv-pdf')];
  const highlightNames = ['pv-cite', 'pv-match', 'pv-match-current'];
  return {
    highlightAPI: Boolean(globalThis.CSS?.highlights && globalThis.Highlight),
    fullView: Boolean(document.querySelector('.pv-full-root')),
    panes: areas.map(area => ({
      pageDOMOrder: [...area.querySelectorAll('.pv-slot')].map(slot => Number(slot.dataset.page)),
      canvasCount: area.querySelectorAll('.pv-canvas').length,
      drawnCanvasCount: [...area.querySelectorAll('.pv-canvas')].filter(canvas => canvas.width > 0 && !canvas.parentElement.querySelector('.pv-page-loading')).length,
      scrollTop: rounded(area.scrollTop), clientHeight: area.clientHeight, width: area.clientWidth,
      rect: rectData(area.getBoundingClientRect()),
    })),
    highlights: Object.fromEntries(highlightNames.map(name => [name,
      [...(globalThis.CSS?.highlights?.get(name) ?? [])].map(range => ({
        text: range.toString(), start: endpoint(range.startContainer, range.startOffset),
        end: endpoint(range.endContainer, range.endOffset), rect: rectData(range.getBoundingClientRect()),
        lineRects: [...range.getClientRects()].map(rectData),
      })),
    ])),
  };
}

function DomStatus() {
  const [report, setReport] = useState(null);
  useEffect(() => {
    // Read only: never sorts slots, rewrites a text layer, or touches highlights.
    const refresh = () => {
      const next = JSON.stringify(snapshot(), null, 2);
      setReport(previous => previous === next ? previous : next);
    };
    refresh();
    const timer = setInterval(refresh, 250);
    return () => clearInterval(timer);
  }, []);
  return <pre id="viewer-dom-status" aria-label="Observed viewer DOM">{report ?? 'Waiting for DOM…'}</pre>;
}

function ProfileControls({ data }) {
  const stopRef = useRef(null);
  const readyRef = useRef(null);
  const [readyMs, setReadyMs] = useState(null);
  const [startPage, setStartPage] = useState(1);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => {
    let frame;
    const inspect = () => {
      const slot = document.querySelector(`.pv-slot[data-page="${data.citedPage}"]`);
      if (slot?.querySelector('.pv-canvas')?.width > 0 && !slot.querySelector('.pv-page-loading')) {
        readyRef.current = Math.round((performance.now() - data.browserStarted) * 100) / 100;
        setReadyMs(readyRef.current);
      } else frame = requestAnimationFrame(inspect);
    };
    frame = requestAnimationFrame(inspect);
    return () => cancelAnimationFrame(frame);
  }, [data]);
  const begin = scripted => {
    const area = document.querySelector('.pv-full-root .pv-pdf') ?? document.querySelector('.pv-pdf');
    try {
      if (!area) throw new Error('Open PDF view before profiling');
      if (readyRef.current === null) throw new Error('Wait for the cited canvas to finish its first draw');
      stopRef.current = startProfile({ area, scripted, startPage, pageRows: data.pageRows,
        metadata: { byteSize: data.byteSize, pageCount: data.pageCount, extractHash: data.extractHash,
          browserViewerReadyMs: readyRef.current },
        onDone: result => { setReport(result); setRunning(false); stopRef.current = null; } });
      setRunning(true);
    } catch (error) { setReport({ error: error.message }); }
  };
  return <div className="profile-controls">
    <p>{data.pageCount} pages · {data.byteSize} bytes. DOM polling is disabled. Keep Fit width, viewport and pane width fixed across runs.</p>
    <output id="profile-ready">{readyMs === null ? 'Waiting for first canvas…' : `Browser first cited canvas: ${readyMs} ms`}</output>
    <label>Profile start page <input aria-label="Profile start page" type="number" min="1" max={data.pageCount} value={startPage} disabled={running} onChange={event => setStartPage(Number(event.target.value))} /></label>
    <button type="button" disabled={running} onClick={() => begin(true)}>Run 12-second scroll profile</button>{' '}
    <button type="button" disabled={running} onClick={() => begin(false)}>Start manual profile</button>{' '}
    <button type="button" disabled={!running} onClick={() => stopRef.current?.()}>Stop profile</button>
    <output id="profile-state">{running ? 'Profiling…' : 'Ready'}</output>
    <pre id="profile-report" aria-label="PDF profile metrics">{report ? JSON.stringify(report, null, 2) : 'No measurements yet'}</pre>
    <button type="button" disabled={running} onClick={() => setReport(snapshot())}>Inspect citation DOM once</button>
  </div>;
}

function Fixture({ citation, client, documentFile, data }) {
  const [revealRequest, setRevealRequest] = useState({ sequence: 1 });
  const [width, setWidth] = useState(600);
  return <main>
    <header className="fixture-header">
      <h1>{data.profile ? 'Local PDF scrolling profile' : 'Local citation viewer regression'}</h1>
      <button type="button" id="repeat-citation" onClick={() => setRevealRequest(previous => ({ sequence: previous.sequence + 1 }))}>Open the same citation · p{data.citedPage}</button>
      <output id="citation-request-sequence">Request {revealRequest.sequence}</output>
      <label>Split width <input id="split-width" type="range" min="400" max="1000" value={width} onChange={event => setWidth(Number(event.target.value))} /> {width}px</label>
    </header>
    <div className="fixture-layout">
      <aside className="fixture-observations">
        <p>{data.profile ? 'Real local PDF bytes and real pdf.js. Text extraction runs on the local server before measurement.' : '18 local pages, real pdf.js. Citation box is intentionally near the top; the exact passage is lower on page 12.'}</p>
        <blockquote id="expected-passage">{data.passage || 'Image-only PDF: no exact text citation available.'}</blockquote>
        <p>Use the viewer’s Expand control for full view, and its page, zoom, search and thumbnail controls. The panel below reports observations, not pass/fail results.</p>
        {data.profile ? <ProfileControls data={data} /> : <DomStatus />}
      </aside>
      <section id="fixture-viewer" aria-label="Local viewer fixture" style={{ width }}>
        <PageViewer citation={citation} revealRequest={revealRequest} client={client} documentFile={documentFile} storage={null} />
      </section>
    </div>
  </main>;
}

const fixtureRoot = createRoot(document.getElementById('root'));
if (import.meta.hot) import.meta.hot.dispose(() => fixtureRoot.unmount());

async function start() {
  const browserStarted = performance.now();
  const meta = await fetch('/fixture-meta.json').then(response => response.json());
  const data = { pageRows: PAGE_ROWS, pageCount: PAGE_COUNT, citedPage: CITED_PAGE,
    passage: PASSAGE, extractHash: EXTRACT_HASH, title: 'Local citation regression document', ...meta, browserStarted };
  const { byteSize, pageCount, citedPage, extractHash, passage, title } = data;
  const row = data.pageRows[citedPage - 1];
  const from = row.text.indexOf(passage);
  const citation = {
    id: 1, kind: 'text', chunk_id: 'local-chunk-p12', document_id: DOCUMENT_ID,
    title, file_name: 'fixture.pdf', source_kind: 'pdf_page',
    page_number: citedPage, extract_hash: extractHash, char_from: row.char_from + from,
    char_to: row.char_from + from + passage.length, text_hash: await sha256Hex(normalise(passage)),
    boxes: data.profile ? [{ ...INACCURATE_BOX, page: citedPage }] : [INACCURATE_BOX], section: 'Local passage',
  };
  const client = createClient(data);
  const documentFile = {
    async partFor() { return { url: new URL('/fixture.pdf', location.href).href, partIndex: 0, pageOffset: 0, pageCount, byteSize }; },
    invalidate() {},
  };
  fixtureRoot.render(<Fixture citation={citation} client={client} documentFile={documentFile} data={data} />);
}
start().catch(error => { document.getElementById('root').textContent = `Local fixture failed: ${error.message}`; });
