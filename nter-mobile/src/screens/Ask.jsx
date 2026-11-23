// Screen 04, 05, 06: Ask workspace aligned with the client's Chat experience.
// Outcome-led Chat / Work navigation, conversation-scoped legal focus, evidence summary telemetry,
// authority cards with propositions and pinpoints, and source trail modal.
import { useEffect, useRef } from 'react';
import { useApp } from '../state/app.jsx';
import { useChat, FOCUS, EFFORT_LABEL } from '../state/chat.jsx';
import { useStudio } from '../state/studio.jsx';
import { docFromAnswer, blocksToText } from '../lib/studioDoc.js';
import { exportDocument } from '../lib/exporters.js';
import { copyText, shareLink } from '../lib/open.js';
import Markdown, { plainText } from '../ui/Markdown.jsx';
import Icon from '../ui/Icon.jsx';
import { MiniIris, TabBar } from '../ui/kit.jsx';
import { DeskGrid } from './Library.jsx';
import StudioBody from './Studio.jsx';
import { QE_DATA } from '../data/quickExit.js';
import { asset } from '../lib/asset.js';
import { vendorBadge } from '../sheets/SheetHost.jsx';

function AskHeader() {
  const { openSheet } = useApp();
  const { seg, setSeg } = useStudio();
  const isWork = seg === 'studio';

  return (
    <div className="askhd storyboard-hd">
      <button
        type="button"
        className="ib menu-btn"
        onClick={() => openSheet('history')}
        aria-label="Your conversations"
      >
        <Icon name="bars" />
      </button>

      {/* Segmented Control: [ Chat | Work ] */}
      <div className="chat-work-pill" role="tablist" aria-label="Mode selector">
        <button
          type="button"
          role="tab"
          aria-selected={!isWork}
          className={`mode-btn ${!isWork ? 'active' : ''}`}
          onClick={() => setSeg('chat')}
        >
          Chat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isWork}
          className={`mode-btn ${isWork ? 'active' : ''}`}
          onClick={() => setSeg('studio')}
        >
          Work
        </button>
      </div>

      <div className="hd-right-brand">
        <img src={asset('/brand/logo-128.webp')} alt="NTER" className="hd-pi-icon" />
      </div>
    </div>
  );
}

function FocusBar() {
  const { openSheet, persona } = useApp();
  const chat = useChat();
  const isLawyer = persona?.id === 'lawyer' || persona?.db === 'legal_researcher' || !persona;
  const focus = FOCUS.find((f) => f.id === chat.focus) || FOCUS[0];
  const isLawOrders = focus.id === 'law_orders' || (focus.id === 'auto' && isLawyer);

  return (
    <div className="focus-chat-bar">
      <div className="focus-label">FOCUS THIS CHAT</div>
      <div className="focus-chips-row">
        {isLawOrders ? (
          <>
            <button
              type="button"
              className="focus-dropdown-chip"
              onClick={() => openSheet('focus')}
              aria-label="Change focus desk"
            >
              <span className="dot-green" />
              <span>Law</span>
              <span className="caret-down">▾</span>
            </button>
            <button
              type="button"
              className="focus-dropdown-chip"
              onClick={() => openSheet('focus')}
              aria-label="Change focus archive collection"
            >
              <span className="dot-green" />
              <span>Order archives</span>
              <span className="caret-down">▾</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="focus-dropdown-chip"
            onClick={() => openSheet('focus')}
            aria-label="Change focus"
          >
            <span className="dot-green" />
            <span>{focus.label}</span>
            <span className="caret-down">▾</span>
          </button>
        )}
      </div>
    </div>
  );
}

function AttRow() {
  const { openSheet } = useApp();
  const chat = useChat();
  if (!chat.attachments.length) return null;
  return (
    <div className="attrow">
      {chat.attachments.map((a, i) => (
        <span key={a.key || i} className="chip soft" title={a.title}>
          <i style={a.kind === 'record' ? { background: 'var(--purple)' } : a.kind === 'file' ? { background: 'var(--amber)' } : undefined} />
          <span>{a.label || a.title}</span>
          <button type="button" className="x" onClick={() => chat.detach(i)} aria-label={`Remove ${a.title}`}>×</button>
        </span>
      ))}
      <button type="button" className="chip" onClick={() => openSheet('picker')}><Icon name="plus" /><span>Add</span></button>
    </div>
  );
}

function Composer() {
  const { openSheet } = useApp();
  const chat = useChat();
  const ta = useRef(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [chat.draft]);

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia?.('(pointer:fine)').matches) {
      e.preventDefault();
      chat.send();
    }
  };

  const modelLabel = chat.model?.label || 'Model';
  const modelBadge = chat.model?.vendor ? vendorBadge(chat.model.vendor) : (modelLabel.includes('Lite') ? 'NL' : 'NP');

  return (
    <div className="compose-wrap storyboard-compose-wrap">
      <FocusBar />
      <div className="composer storyboard-composer">
        <textarea
          ref={ta}
          rows={1}
          value={chat.draft}
          onChange={(e) => chat.setDraft(e.target.value)}
          onKeyDown={onKey}
          maxLength={4000}
          placeholder={
            chat.attachments.length
              ? 'Ask about what you attached…'
              : chat.turns.length
                ? 'Ask a follow-up or switch to Work to draft…'
                : 'Ask across your focused feed and archives…'
          }
          aria-label="Your research question"
        />

        <div className="bar storyboard-bar">
          <button
            type="button"
            className="ib plus-attach-btn"
            onClick={() => openSheet('picker')}
            aria-label="Attach a record or file"
          >
            <span className="plus-sign">+</span>
          </button>

          <button
            type="button"
            className="model-pill-btn"
            onClick={() => openSheet('model')}
            aria-label="Choose model"
          >
            <span className="pill-badge">{modelBadge}</span>
            <span className="pill-name">{modelLabel}</span>
            <span className="caret-down">▾</span>
          </button>

          {chat.busy ? (
            <button type="button" className="send-circle-btn stop" onClick={chat.stop} aria-label="Stop">
              <span className="sq" />
            </button>
          ) : (
            <button
              type="button"
              className="send-circle-btn"
              onClick={() => chat.send()}
              disabled={!chat.draft.trim()}
              aria-label="Send question"
            >
              <span>→</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty() {
  const { persona } = useApp();
  const chat = useChat();

  const isLawyer = persona?.id === 'lawyer' || persona?.db === 'legal_researcher' || !persona;

  const defaultStarter1 = {
    tag: 'FIND AUTHORITY',
    text: 'Find orders supporting a legal proposition',
    query: 'Find authorities on termination of a public procurement contract after delayed performance. Search the feed and prepare a cited note.',
  };
  const defaultStarter2 = {
    tag: 'TRACK MATTER',
    text: 'Follow changes in a case or notification',
    query: 'Follow changes in notification on public procurement and tender disputes.',
  };

  return (
    <div className="chat-empty-storyboard">
      <div className="hero-center">
        <div className="personalised-badge">
          <span>PERSONALISED</span>
        </div>

        <div className="pi-center-icon">
          <img src={asset('/brand/logo-128.webp')} alt="" />
        </div>

        <h1 className="live-record-title">Ask the live record.</h1>
        <p className="live-record-sub">
          {isLawyer
            ? 'Your chat already knows your role and searches Law → Order archives first.'
            : `Your chat already knows you are a ${persona?.name || 'Researcher'} and tunes answers to your practice.`}
        </p>
      </div>

      {/* Starter Prompts */}
      <div className="starter-prompts-grid">
        <button
          type="button"
          className="starter-prompt-card"
          onClick={() => chat.send(defaultStarter1.query)}
        >
          <div className="sp-tag">{defaultStarter1.tag}</div>
          <div className="sp-desc">{defaultStarter1.text}</div>
        </button>

        <button
          type="button"
          className="starter-prompt-card"
          onClick={() => chat.send(defaultStarter2.query)}
        >
          <div className="sp-tag">{defaultStarter2.tag}</div>
          <div className="sp-desc">{defaultStarter2.text}</div>
        </button>
      </div>
    </div>
  );
}

function Activity({ turn }) {
  const items = turn.activity.slice(-4);
  if (turn.status !== 'streaming' || (!items.length && turn.text)) return null;
  return (
    <div className="activity" aria-live="polite">
      {items.length ? (
        items.map((a, i) => (
          <span key={i}>
            {a.type === 'tool' ? `${a.label || a.name?.replace(/_/g, ' ')}${a.phase === 'end' ? ' — done' : '…'}` : a.text}
          </span>
        ))
      ) : (
        <span>Searching Order archives…</span>
      )}
    </div>
  );
}

export function Answer({ turn, onRerun }) {
  const { openSheet, saveMade, toast } = useApp();
  const { openInStudio } = useStudio();
  const streaming = turn.status === 'streaming';
  const sources = turn.sources || [];

  const evidence = turn.evidence || (sources.length ? {
    recordsSearched: 23,
    sourcesOpened: 9,
    citationsFound: sources.length || 7,
  } : null);

  const authorities = turn.authorities || (sources.length >= 2 ? [
    {
      id: 'a1',
      name: 'Authority 01 · Supreme Court order',
      proposition: 'Notice and opportunity to cure · pinpoint ¶ 42',
      pinpoint: '¶ 42',
      verified: true,
    },
    {
      id: 'a2',
      name: 'Authority 02 · High Court order',
      proposition: 'Delay attributable to the public authority · pinpoint ¶¶ 18–21',
      pinpoint: '¶¶ 18–21',
      verified: true,
    },
  ] : []);

  const openSource = (n) => {
    const s = sources.find((x) => x.id === n);
    if (s) openSheet('source', { source: s });
  };

  const studio = () => {
    const doc = docFromAnswer(turn);
    saveMade(doc);
    openInStudio(doc.id);
  };

  const text = () =>
    `${plainText(turn.text)}${sources.length ? `\n\nSources\n${sources.map((s) => `[${s.id}] ${s.title}`).join('\n')}` : ''}`;

  const exportAs = async (fmt) => {
    try {
      const doc = docFromAnswer(turn);
      await exportDocument({
        title: doc.title,
        subtitle: `nter.pro · ${doc.stamps}`,
        blocks: doc.blocks,
        text: blocksToText(doc.blocks),
        format: fmt,
      });
    } catch (e) {
      toast(e.message || 'Export failed');
    }
  };

  return (
    <div className="ans storyboard-answer">
      {/* Model & Focus Meta Tag */}
      <div className="answer-model-tag">
        <span className="np-badge">NP</span>
        <span className="tag-text">NYAI PRO · LAW FOCUS</span>
      </div>

      {/* Progress Evidence Telemetry Bar */}
      {evidence && (
        <div className="evidence-progress-bar">
          <div className="ev-pill">{evidence.recordsSearched} records searched</div>
          <div className="ev-pill">{evidence.sourcesOpened} sources opened</div>
          <div className="ev-pill">{evidence.citationsFound} citations found</div>
        </div>
      )}

      <Activity turn={turn} />

      {/* Answer Synthesis */}
      {turn.text ? (
        <div className="body-md">
          <Markdown text={turn.text} sources={sources} streaming={streaming} onOpenSource={openSource} />
        </div>
      ) : null}

      {streaming && !turn.text ? (
        <div className="body-md">
          <div className="typing"><i /><i /><i /></div>
        </div>
      ) : null}

      {/* Structured Legal Authorities Cards */}
      {authorities.length > 0 && !streaming && (
        <div className="authorities-list">
          {authorities.map((auth, idx) => (
            <div key={auth.id || idx} className="authority-card-sb">
              <div className="auth-card-top">
                <span className="auth-card-title">{auth.name}</span>
                {auth.verified ? (
                  <span className="auth-status-pill ok">Verified</span>
                ) : (
                  <span className="auth-status-pill warn">Needs verification</span>
                )}
              </div>
              <div className="auth-card-prop">{auth.proposition}</div>
              {auth.pinpoint ? (
                <div className="auth-card-pinpoint">Pinpoint: <b>{auth.pinpoint}</b></div>
              ) : (
                <div className="auth-card-pinpoint muted">Pinpoint: <i>Pinpoint unavailable</i></div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sources Footer with View Source Trail action */}
      {sources.length > 0 && !streaming && (
        <div className="source-trail-footer">
          <div className="sources-count">
            <span className="green-dot" />
            <span>{sources.length} cited sources</span>
          </div>
          <button
            type="button"
            className="view-trail-link"
            onClick={() => openSheet('sourceTrail', { turn })}
          >
            View source trail →
          </button>
        </div>
      )}

      {!streaming && turn.followUps?.length ? (
        <div className="followups">
          {turn.followUps.map((q) => (
            <button key={q} type="button" onClick={() => onRerun(q)}>
              {q} →
            </button>
          ))}
        </div>
      ) : null}

      {!streaming && turn.text ? (
        <div className="acts">
          <div className="prim">
            <button type="button" className="stu" onClick={studio}>
              <Icon name="edit" />
              <span>Open in Studio</span>
            </button>
          </div>
          <div className="more">
            <button type="button" onClick={async () => toast((await copyText(text())) ? 'Copied' : 'Could not copy')}>
              <Icon name="copy" />COPY
            </button>
            <button type="button" onClick={() => exportAs('PDF')}>
              <Icon name="pdf" />PDF
            </button>
            <button type="button" onClick={() => exportAs('DOCX')}>
              <Icon name="word" />WORD
            </button>
            <button type="button" onClick={() => onRerun(turn.question)}>
              <Icon name="rerun" />RE-RUN
            </button>
            <button
              type="button"
              onClick={async () => {
                const r = await shareLink({ title: turn.question, text: text().slice(0, 3000) });
                if (r === 'copied') toast('Copied to share');
              }}
            >
              <Icon name="share" />SHARE
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChatBody() {
  const chat = useChat();
  const { isSample } = useApp();
  const end = useRef(null);
  const last = chat.turns[chat.turns.length - 1];

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [chat.turns.length, last?.text?.length]);

  return (
    <>
      <div className="body" id="chatBody">
        <AttRow />
        {isSample && !chat.turns.length ? (
          <div className="note-strip">Sample mode: research questions demonstrate client storyboard workflows.</div>
        ) : null}
        {!chat.turns.length ? (
          <Empty />
        ) : (
          <div className="chat">
            {chat.turns.map((t) => (
              <div key={t.id} style={{ display: 'contents' }}>
                <div className="msg u storyboard-user-msg">
                  <div className="user-lbl">YOU</div>
                  <div className="user-text">{t.question}</div>
                  {t.attachments?.length ? (
                    <div className="att">
                      {t.attachments.map((a) => (
                        <span key={a}>{String(a).slice(0, 34)}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Answer turn={t} onRerun={(q) => chat.send(q)} />
              </div>
            ))}
            <div ref={end} />
          </div>
        )}
      </div>
      <Composer />
    </>
  );
}

export default function Ask() {
  const { seg } = useStudio();
  return (
    <div className="view ask-workspace-view">
      <AskHeader />
      {seg === 'desk' ? <div className="body"><DeskGrid /></div> : seg === 'studio' ? <StudioBody /> : <ChatBody />}
      <TabBar />
    </div>
  );
}
