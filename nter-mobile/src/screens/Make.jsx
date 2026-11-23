// Make one Quick Exit document from one record: pick the format, answer the one question, and
// the AI writes it with every gap marked. The result opens in Studio or exports straight away.
import { useRef, useState } from 'react';
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import { useStudio } from '../state/studio.jsx';
import { api, isSample } from '../services/index.js';
import { applyFrame, newTurn } from '../services/chatState.js';
import { recordAttachment, turnKey } from '../services/shape.js';
import { qeDoc, FORMAT_LABEL } from '../data/quickExit.js';
import { docFromQuickExit, blocksToText } from '../lib/studioDoc.js';
import { exportDocument } from '../lib/exporters.js';
import Icon from '../ui/Icon.jsx';
import { Header } from '../ui/kit.jsx';

const STEPS = ['Reading the record', 'Looking up the sources', 'Writing the blocks', 'Stamping sources'];

// The instruction research-chat receives (its limit is 4,000 characters).
export function makeInstruction({ qe, persona, fmtLabel, answer }) {
  const head = [
    `QUICK EXIT — write the document "${qe.name}" (${persona.name} · ${qe.bucket}) from the attached record, laid out for ${fmtLabel}.`,
    `What it is: ${qe.what}`,
    `Rules that never flex: ${qe.gate || 'descriptive, sourced, no opinion'}. Use only the attached record and documents you retrieve; never invent a fact, date, number or name.`,
    'Where the record does not hold something, write a marker in square brackets instead of guessing: [NOT IN RECORD → where to get it]; for wording that must come from the instrument text use [FROM INSTRUMENT TEXT → source]; for what only the user can supply use [you: what is needed].',
    qe.question ? `The user's answer to "${qe.question}": ${answer?.trim() || '(none given)'}` : '',
    'Write each block as a markdown heading (## LABEL) followed by its content, in this order:',
  ].filter(Boolean).join('\n');
  const tail = '\nEnd with ## STAMPS (source · date · as of) and ## NOT ESTABLISHED (each open gap).';
  const room = 3990 - head.length - tail.length;
  const spec = String(qe.blocks || '').replace(/^IDENTITY[^\n]*\n?/m, '');
  return `${head}\n${spec.length > room ? `${spec.slice(0, room - 1)}…` : spec}${tail}`;
}

// Sample builds have no AI: the document is the catalogue's own block skeleton, gaps and all.
function skeleton(qe) {
  return String(qe.blocks || '').split('\n').filter(Boolean).filter((l) => !/^IDENTITY/.test(l)).map((ln) => {
    const m = ln.match(/^([^—:]+?)\s*[—:]\s*([\s\S]*)$/);
    return m ? `## ${m[1].trim()}\n${m[2]}` : ln;
  }).join('\n\n');
}

export default function Make({ qeId, record }) {
  const { persona, saveMade, toast, requireSignIn, refreshCredits, push } = useApp();
  const chat = useChat();
  const { openInStudio } = useStudio();
  const found = qeDoc(qeId);
  const qe = found?.doc;
  const qp = found?.persona;
  const formats = qe ? [...(qe.trade ? ['TRADE'] : []), ...qe.formats] : [];
  const [fmt, setFmt] = useState(qe?.trade ? 'TRADE' : qe?.default || formats[0]);
  const [answer, setAnswer] = useState('');
  const [phase, setPhase] = useState('form'); // form | run | made | error
  const [step, setStep] = useState(0);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const ctrl = useRef(null);
  const docRef = useRef(null);
  if (!qe) return null;
  const fmtLabel = (f) => (f === 'TRADE' ? `Ready format — ${qe.trade.name}` : FORMAT_LABEL[f] || f);
  const p = persona || { name: qp.name };

  const run = async () => {
    if (!record) return;
    if (!isSample && !requireSignIn('Sign in to make documents with Quick Exit. Each document uses AI credits like a question.')) return;
    setPhase('run'); setStep(0); setError('');
    try {
      let text;
      if (isSample) {
        for (let i = 0; i < STEPS.length; i++) { setStep(i); await new Promise((r) => setTimeout(r, 380)); }
        text = skeleton(qe);
      } else {
        const body = {
          message: makeInstruction({ qe, persona: p, fmtLabel: fmtLabel(fmt), answer }),
          turn_key: turnKey(),
          ...(chat.model?.model_id ? { model: chat.model.model_id } : {}),
          reasoning: chat.effort,
          focus: 'attached',
          attachments: [(({ key: _k, ...a }) => a)(recordAttachment({ row: record.row, module: record.module }))],
          desk_context: { tier: record.module.desk, feature: record.module.feature },
        };
        let turn = newTurn({ question: qe.name });
        ctrl.current = new AbortController();
        await api.sendTurn(body, {
          signal: ctrl.current.signal,
          onFrame: (frame) => {
            turn = applyFrame(turn, frame);
            if (frame.tool) setStep(1);
            if (typeof frame.chunk === 'string') setStep(2);
            if (frame.sources) setStep(3);
          },
        });
        if (turn.error && !turn.text) throw new Error(turn.error);
        text = turn.text;
        refreshCredits();
      }
      const made = docFromQuickExit({ qe, persona: p, record, text, answer, fmt, sample: isSample });
      saveMade(made);
      setDoc(made);
      setPhase('made');
      setTimeout(() => docRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    } catch (e) {
      setError(e?.status === 402 ? 'You have no AI credits left to make this document.' : e?.status === 403 ? 'This model needs a paid plan. Pick another model in Ask AI.' : (e.message || 'The document could not be made.'));
      setPhase('error');
    }
  };

  const exportIt = async (f) => {
    try { await exportDocument({ title: doc.title, subtitle: `${doc.rec} · ${p.name} · as of ${doc.asof}`, blocks: doc.blocks, text: blocksToText(doc.blocks), format: f === 'TRADE' ? 'PDF' : f, stamps: doc.stamps, notEst: doc.notEst }); }
    catch (e) { toast(e.message || 'Export failed'); }
  };

  return (
    <div className="view push">
      <Header back line title={qe.name} sub={`${qp.name} · ${qe.bucket}`.toUpperCase()} />
      <div className="body">
        <div className="make">
          <div className="top">
            <div className="k">{qp.name.toUpperCase()} · {qe.bucket.toUpperCase()}</div>
            <h3>{qe.name}</h3>
            <p>{qe.what}</p>
            <div className="nf"><span>needs: {qe.trigger || 'a record'}</span><span>fills today: {qe.fill}</span></div>
          </div>
          <div className="sec">
            <div className="k">RECORD ON SCREEN</div>
            {record
              ? <button type="button" className="chip soft" style={{ height: 'auto', padding: '8px 11px', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => push({ v: 'record', module: record.module, row: record.row })}><i /><span style={{ whiteSpace: 'normal' }}>{record.title} · {record.module.title}</span></button>
              : <p className="muted" style={{ margin: 0 }}>No record attached. Open a record and start Quick Exit from it.</p>}
          </div>

          {phase === 'run' ? (
            <div className="sec"><div className="k">MAKING</div>
              <div className="prog">{STEPS.map((s, i) => <div key={s} className={i < step ? 'done' : i === step ? 'now' : ''}><i>{i < step ? '✓' : ''}</i>{s}</div>)}</div>
              {!isSample ? <button type="button" className="linkbtn" style={{ marginTop: 10 }} onClick={() => ctrl.current?.abort()}>Stop</button> : null}
            </div>
          ) : (
            <>
              <div className="sec">
                <div className="k">CHOOSE THE FORMAT <small>fills today: {qe.fill}</small></div>
                <div className="fmts">
                  {formats.map((f) => (
                    <button key={f} type="button" className={`${f === fmt ? 'on' : ''} ${f === 'TRADE' ? 'ready' : ''}`} onClick={() => setFmt(f)} aria-pressed={f === fmt}>
                      <b>{fmtLabel(f)}</b>{(f === 'TRADE' ? 'comes out in its submission form' : qe.why?.[f]) ? <span>{f === 'TRADE' ? 'comes out in its submission form' : qe.why[f]}</span> : null}
                    </button>
                  ))}
                </div>
                {qe.trade && fmt === 'TRADE' ? <div className="trade" style={{ marginTop: 8 }}><b>READY FORMAT · {qe.trade.name.toUpperCase()}</b>{qe.trade.layout}</div> : null}
              </div>
              {qe.question ? (
                <div className="sec"><div className="k">THE ONE QUESTION</div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }} htmlFor="makeq">{qe.question}</label>
                  <input id="makeq" className="qinput" placeholder="Optional — a line is enough" value={answer} onChange={(e) => setAnswer(e.target.value)} />
                </div>
              ) : null}
              <div className="makebar">
                <button type="button" className="go" onClick={run} disabled={!record}><Icon name="chev" />{phase === 'made' ? 'Make again' : 'Make'}</button>
                <button type="button" className={`alt ${showPrompt ? 'on' : ''}`} onClick={() => setShowPrompt((s) => !s)}>THE BRIEF</button>
              </div>
              <div className="mstatus">{phase === 'made' ? `made · ${fmtLabel(fmt)}` : isSample ? 'sample build · shows the skeleton' : 'uses AI credits like one question'}</div>
              {showPrompt ? <div className="prompt">{makeInstruction({ qe, persona: p, fmtLabel: fmtLabel(fmt), answer })}</div> : null}
              {phase === 'error' ? <div className="errline" role="alert"><span>{error}</span><button type="button" onClick={run}>Try again</button></div> : null}
            </>
          )}

          {phase === 'made' && doc ? (
            <>
              <div className="sec" ref={docRef}><div className="k">THE DOCUMENT <small>{qe.bucket} · {fmtLabel(fmt)}</small></div>
                <div className="doc">
                  {doc.blocks.map((b, i) => (
                    <div key={i} className="blk" style={{ animationDelay: `${60 + i * 70}ms` }}>
                      {b.lab ? <b className="l">{b.lab}</b> : null}
                      <div dangerouslySetInnerHTML={{ __html: b.html }} />
                    </div>
                  ))}
                  <div className="rerun">RE-RUN WHEN {String(qe.rerun || 'the record changes').toUpperCase()}</div>
                </div>
              </div>
              <div className="legend" style={{ padding: '0 2px' }}>
                <span><i style={{ background: 'var(--amber-soft)', border: '1px solid var(--amber)' }} />from instrument text</span>
                <span><i style={{ background: 'var(--red-soft)', border: '1px solid var(--red)' }} />not in record → where to get it</span>
                <span><i style={{ background: 'transparent', border: '1px solid var(--muted)' }} />your own input</span>
              </div>
              <div className="sec"><div className="k">EXIT</div>
                <div className="exitbar">
                  <button type="button" className="p" onClick={() => openInStudio(doc.id)}><Icon name="edit" />OPEN IN STUDIO</button>
                  <button type="button" onClick={() => exportIt('PDF')}><Icon name="pdf" />PDF</button>
                  <button type="button" onClick={() => exportIt('DOCX')}><Icon name="word" />WORD</button>
                  <button type="button" onClick={() => exportIt('COPY')}><Icon name="copy" />TEXT</button>
                  <button type="button" onClick={run}><Icon name="rerun" />RE-RUN</button>
                </div>
              </div>
              <div className="note-line">Formatted, not filed — you check and sign.{qp.num === '05' ? ' Legal information, not advice.' : ''}{qp.num === '04' ? ' Exposure analysis; no view on any security.' : ''}</div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
