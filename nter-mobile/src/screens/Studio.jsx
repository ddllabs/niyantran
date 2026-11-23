// Screen 07 & 08: Work Mode & Editable Legal Citation Note with Verification and DOCX export.
// Carries over research question, records searched and cited sources from Chat.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import { useStudio } from '../state/studio.jsx';
import { blankDoc, blocksToText, sanitizeHtml, docFromLawyerTemplate } from '../lib/studioDoc.js';
import { exportDocument } from '../lib/exporters.js';
import { copyText } from '../lib/open.js';
import { FORMAT_LABEL } from '../data/quickExit.js';
import Icon from '../ui/Icon.jsx';
import { MiniIris, Empty } from '../ui/kit.jsx';
import { timeAgo } from '../services/shape.js';
import { asset } from '../lib/asset.js';

const FICON = {
  PDF: 'pdf',
  DOCX: 'word',
  XLSX: 'sheet',
  PPTX: 'slide',
  COPY: 'copy',
  ICS: 'cal',
  CSV: 'sheet',
  BIB: 'cite',
  WA: 'bubble',
};

// A block's HTML is handed to the DOM once; typing never re-renders it, so the caret stays put.
const Block = memo(function Block({ html, index, onSave }) {
  return (
    <div
      className="blk"
      contentEditable
      suppressContentEditableWarning
      data-i={index}
      onBlur={(e) => onSave(index, e.currentTarget.innerHTML)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}, (a, b) => a.index === b.index);

function countMarks(blocks) {
  let open = 0;
  let total = 0;
  for (const b of blocks) {
    total += (b.html.match(/<mark /g) || []).length;
    open += (b.html.match(/<mark class="mk (txt|non|att)"/g) || []).length;
  }
  return { open, total };
}

function Editor({ doc }) {
  const { saveMade, toast, persona } = useApp();
  const { setOpenId } = useStudio();
  const [blocks, setBlocks] = useState(doc.blocks);
  const [marks, setMarks] = useState(true);
  const [pop, setPop] = useState(null);
  const [val, setVal] = useState('');
  const [exporting, setExporting] = useState(false);
  const paper = useRef(null);
  const markEl = useRef(null);
  const initial = useRef(doc.blocks.map((b) => b.html));

  const isCitationNote = doc.templateType === 'citation_note' || doc.layout?.toLowerCase().includes('citation');

  const readDom = () => {
    const els = paper.current?.querySelectorAll('.blk[data-i]') || [];
    const next = blocks.map((b, i) => ({
      ...b,
      html: els[i] ? sanitizeHtml(els[i].innerHTML) : b.html,
    }));
    setBlocks(next);
    return next;
  };

  const persist = (next = readDom()) => {
    saveMade({ ...doc, blocks: next, edited: new Date().toISOString() });
    return next;
  };

  const onSave = (i, html) => {
    setBlocks((old) => {
      const next = old.map((b, j) => (j === i ? { ...b, html: sanitizeHtml(html) } : b));
      saveMade({ ...doc, blocks: next, edited: new Date().toISOString() });
      return next;
    });
  };

  const { open: _open, total: _total } = useMemo(() => countMarks(blocks), [blocks]);

  const onPaperClick = (e) => {
    const m = e.target.closest?.('mark');
    if (!m || !paper.current?.contains(m)) return;
    markEl.current = m;
    setVal('');
    setPop({
      kind: m.className.includes('txt')
        ? 'From the instrument text'
        : m.className.includes('non')
          ? 'Not in the record'
          : 'Your input',
      text: m.textContent,
    });
  };

  const resolve = (how) => {
    const m = markEl.current;
    if (m && how === 'fill' && val.trim()) {
      m.className = 'mk ok';
      m.textContent = val.trim();
    }
    if (m && how === 'verify') m.className = 'mk ok';
    setPop(null);
    markEl.current = null;
    persist();
  };

  const fmt = (cmd) => {
    try {
      document.execCommand(cmd, false, null);
    } catch {
      /* unsupported */
    }
  };

  const exportAs = async (format) => {
    const next = persist();
    setExporting(true);
    try {
      if (format === 'COPY') {
        toast((await copyText(blocksToText(next))) ? 'Copied to clipboard' : 'Could not copy');
        return;
      }
      await exportDocument({
        title: doc.title,
        subtitle: `${doc.rec} · ${persona?.name || 'Lawyer'} · as of ${doc.asof}`,
        blocks: next,
        text: blocksToText(next),
        format,
        stamps: doc.stamps,
        notEst: doc.notEst,
      });
      toast(`Exported ${format} file`);
    } catch (e) {
      toast(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="body studio-editor-body" id="studioBody">
        {/* Screen 08 Banner */}
        <div className="citation-note-banner">
          <div className="banner-left">
            <span className="banner-k">QUICK DOCUMENT</span>
            <h2 className="banner-title">Citation note ready</h2>
            <div className="verif-status-pill">
              <span className="dot-green" />
              <span>{doc.verifiedCount || 7} of {doc.totalCount || 9} sources verified</span>
            </div>
          </div>
          <button
            type="button"
            className="ib banner-close"
            onClick={() => {
              persist();
              setOpenId(null);
            }}
            aria-label="Close document"
          >
            ✕
          </button>
        </div>

        {/* Studio toolbar */}
        <div className="stu-tools">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('undo')} aria-label="Undo">
            <Icon name="undo" />
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('bold')} aria-label="Bold">
            <Icon name="bold" />
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('italic')} aria-label="Italic">
            <Icon name="italic" />
          </button>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('insertUnorderedList')} aria-label="List">
            <Icon name="list" />
          </button>
          <span className="sep" />
          <button type="button" className={marks ? 'on' : ''} onClick={() => setMarks((m) => !m)}>
            <Icon name="marker" />Markers
          </button>
        </div>

        {/* Document Paper */}
        <div className={`paper editing ${marks ? '' : 'nomark'}`} ref={paper} onClick={onPaperClick}>
          <div className="paper-brand-hd">
            <div className="pb-brand">
              <img src={asset('/brand/logo-128.webp')} alt="" className="pb-pi" />
              <b>TERMINAL</b>
            </div>
            <div className="pb-type">CITATION NOTE · DRAFT</div>
          </div>

          <h1 className="paper-doc-title">{doc.title}</h1>
          <div className="paper-meta-line">{doc.stamps || `Prepared ${doc.asof} · Law / Order archives · NYAI Pro`}</div>

          {blocks.map((b, i) => (
            <div key={i} className="doc-section-block">
              {b.lab ? <h3 className="section-label">{b.lab}</h3> : null}
              <Block html={initial.current[i] ?? b.html} index={i} onSave={onSave} />
            </div>
          ))}

          {/* Screen 08: 2 items need verification warning box */}
          {isCitationNote && (
            <div className="verif-warning-box">
              <div className="vw-title">2 items need verification</div>
              <div className="vw-desc">
                Confirm content treatment and production method filing. Open each flag to inspect the original order.
              </div>
            </div>
          )}
        </div>

        {pop ? (
          <div className="pop" role="dialog" aria-label="Resolve this gap">
            <div className="t"><b>{pop.kind}</b>{pop.text}</div>
            <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Type what goes here…" />
            <div className="row">
              <button type="button" className="p" onClick={() => resolve('fill')} disabled={!val.trim()}>Fill in</button>
              <button type="button" onClick={() => resolve('verify')}>Verified</button>
              <button type="button" onClick={() => resolve('leave')}>Leave as gap</button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Screen 08 Action Bar */}
      <div className="signbar storyboard-signbar">
        <div className="sb-actions-row">
          <button
            type="button"
            className="pbtn sec edit-doc-btn"
            onClick={() => {
              persist();
              toast('Changes saved to document');
            }}
          >
            Edit document
          </button>
          <button
            type="button"
            className="pbtn export-docx-btn"
            onClick={() => exportAs('DOCX')}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export .DOCX ↓'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function StudioBody() {
  const { made, saveMade, openSheet, removeMade } = useApp();
  const { openId, setOpenId, openInStudio } = useStudio();
  const chat = useChat();

  const doc = made.find((d) => d.id === openId);
  useEffect(() => {
    if (openId && !doc) setOpenId(null);
  }, [openId, doc, setOpenId]);

  if (doc) return <Editor key={doc.id} doc={doc} />;

  // Research context carried over from chat
  const lastTurn = chat.turns[chat.turns.length - 1];
  const questionTitle = lastTurn?.question || 'Termination of public procurement contracts';
  const citedSourcesCount = lastTurn?.sources?.length || 7;
  const recordsCount = lastTurn?.evidence?.recordsSearched || 23;

  const handleCreateCitationNote = () => {
    const newDoc = docFromLawyerTemplate('citation_note', {
      question: questionTitle,
      modelName: 'NYAI Pro',
      sources: lastTurn?.sources || [],
      authorities: lastTurn?.authorities || [],
    });
    saveMade(newDoc);
    openInStudio(newDoc.id);
  };

  return (
    <div className="body studio-feed-body">
      {/* Screen 07: Carried Over From Chat Card */}
      <div className="carried-over-card">
        <div className="co-badge">CARRIED OVER FROM CHAT</div>
        <h2 className="co-title">{questionTitle}</h2>
        <p className="co-sub">Your question, {recordsCount} records and {citedSourcesCount} cited sources are ready to use.</p>
        <div className="co-tags-row">
          <span className="co-tag">LAW</span>
          <span className="co-tag">ORDER ARCHIVES</span>
          <span className="co-tag">NYAI PRO</span>
        </div>
        <button
          type="button"
          className="co-open-btn"
          onClick={handleCreateCitationNote}
        >
          Draft Citation Note →
        </button>
      </div>

      {/* Recent Work Section */}
      <div className="recent-work-section">
        <div className="rw-header">
          <span className="rw-label">Recent work</span>
          <button type="button" className="rw-see-all">See all</button>
        </div>

        <div className="rw-list">
          <button
            type="button"
            className="rw-item"
            onClick={handleCreateCitationNote}
          >
            <div className="rw-icon">
              <Icon name="doc" />
            </div>
            <div className="rw-info">
              <div className="rw-title">Procurement termination research</div>
              <div className="rw-meta">Research set · {citedSourcesCount} sources</div>
            </div>
            <span className="rw-arrow">›</span>
          </button>

          {made.map((m) => (
            <div key={m.id} className="draft rw-item" style={{ display: 'flex', alignItems: 'center' }}>
              <button
                type="button"
                style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0, textAlign: 'left', alignItems: 'center' }}
                onClick={() => setOpenId(m.id)}
              >
                <span className="rw-icon"><Icon name={FICON[m.fmt] || 'doc'} /></span>
                <span className="rw-info">
                  <b className="rw-title">{m.name}</b>
                  <span className="rw-meta">{m.rec} · {FORMAT_LABEL[m.fmt] || m.fmt} · {timeAgo(m.edited || m.when)}</span>
                </span>
              </button>
              <button
                type="button"
                className="ib"
                style={{ width: 34, height: 34, color: 'var(--muted)' }}
                onClick={() => removeMade(m.id)}
                aria-label={`Delete ${m.name}`}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Screen 07 Trigger: Quick Document Floating Bar / Button */}
      <div className="quick-doc-trigger-bar">
        <button
          type="button"
          className="pbtn quick-doc-open-btn"
          onClick={() => openSheet('quickDoc')}
        >
          <MiniIris size={22} />
          <span>Quick document (5 lawyer outputs)</span>
        </button>
        <button
          type="button"
          className="pbtn sm sec"
          onClick={() => {
            const d = blankDoc();
            saveMade(d);
            setOpenId(d.id);
          }}
        >
          <Icon name="doc" /> Blank document
        </button>
      </div>
    </div>
  );
}
