import { parseINR, tenderCloseBand } from '../lib/nationalKpi.js';
import BillRecordPane from './BillRecordPane.jsx';
import { AffidavitRecord, DelimitationRecord, ManifestoRecord } from './ElectoralRecords.jsx';
import { briefPlainLines, mergeBriefText, useEntryBrief } from '../shell/EntryBriefInline.jsx';

function field(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function Tile({ k, v, tone }) {
  return (
    <article className={`nat-tile${tone ? ` ${tone}` : ''}`}>
      <h4>{k}</h4>
      <strong>{v || '—'}</strong>
    </article>
  );
}

function SourceBtn({ href, label }) {
  if (!href) return null;
  return (
    <a className="nat-rec-btn" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function BillRecord({ row, onClear, onAskAi, liveCount, desk, feature, feed, loading }) {
  return (
    <BillRecordPane
      row={row}
      onClear={onClear}
      onAskAi={onAskAi}
      liveCount={liveCount}
      desk={desk}
      feature={feature}
      feed={feed}
      loading={loading}
    />
  );
}

function MpRecord({ row, onClear }) {
  const committees = field(row, ['committees']);
  const attendance = field(row, ['attendance_pct', 'attendance']);
  const questions = field(row, ['questions_asked', 'questions']);
  const debates = field(row, ['debates', 'debate_count']);
  const mplads = field(row, ['mplads', 'mplads_utilization', 'fund_utilization']);
  const coverage = field(row, ['coverage_through', 'as_of']) || '2024 election register';
  return (
    <div className="nat-rec">
      <header>
        <h2>{field(row, ['mp_name', 'name', 'title'])}</h2>
        <button type="button" onClick={onClear}>
          All records
        </button>
      </header>
      <p className="muted">
        {[field(row, ['party']), field(row, ['constituency']), field(row, ['state'])].filter(Boolean).join(' · ')}
      </p>
      <div className="nat-tiles">
        <Tile k="Attendance" v={attendance || 'Not reported'} />
        <Tile k="Questions" v={questions || 'Not reported'} />
        <Tile k="Debates" v={debates || 'Not reported'} />
        <Tile k="MPLADS utilization" v={mplads || 'Not reported'} />
        <Tile k="Committee work" v={committees || 'Not reported'} />
        <Tile k="Coverage through" v={coverage} />
      </div>
      <p className="desk-note">
        Missing metrics say Not reported, not zero. This card is not a ranking. Trends and statements need richer sources than
        this register.
      </p>
      <div className="nat-rec-actions">
        <SourceBtn href={row.source_url} label="↗ Source" />
      </div>
    </div>
  );
}

function BudgetRecord({ row, onClear }) {
  const title = field(row, ['scheme', 'measure', 'title']);
  const isKey = row.type === 'key_number';
  return (
    <div className="nat-rec">
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={onClear}>
          All measures
        </button>
      </header>
      <p className="muted">{field(row, ['fy']) || 'FY'} · curated Budget Estimate view</p>
      <div className="nat-tiles">
        {isKey ? (
          <>
            <Tile k="Value" v={field(row, ['value'])} />
            <Tile k="Note" v={field(row, ['note'])} />
          </>
        ) : (
          <>
            <Tile k="BE (₹ cr)" v={row.be_cr != null ? `~${Number(row.be_cr).toLocaleString('en-IN')}` : 'Not reported'} />
            <Tile k="RE" v="Not reported" />
            <Tile k="Actual" v="Not reported" />
            <Tile k="Utilization %" v="Not reported" />
          </>
        )}
        <Tile k="Source" v={field(row, ['source']) || 'indiabudget.gov.in'} />
      </div>
      <p className="desk-note">
        Value and Note live here in the side panel. BE is not compared to Actuals — those series are not in this dataset.
      </p>
    </div>
  );
}

function TenderRecord({ row, onClear }) {
  const value = parseINR(row.value_inr);
  const band = tenderCloseBand(row);
  const buyer = field(row, ['ministry_department', 'buyer']);
  return (
    <div className="nat-rec">
      <header>
        <h2>{field(row, ['tender_title', 'title'])}</h2>
        <button type="button" onClick={onClear}>
          All tenders
        </button>
      </header>
      <p className={`nat-close-lab ${band.tone}`}>{band.label}</p>
      <div className="nat-tiles">
        <Tile k="Tender scale" v={value ? `₹${(value / 1e7).toFixed(2)} Cr` : 'Unscored · no value'} />
        <Tile k="Bids close" v={field(row, ['deadline'])} />
        <Tile k="Buyer" v={buyer || 'Not published'} />
        <Tile k="Sector" v={field(row, ['sector']) || 'Not published — no sector column'} />
      </div>
      <p className="desk-note">
        Statutory ladder (only when a value is published): Routine ≤ ₹50L (GFR Rule 162) / Standard ₹50L–2Cr / Substantial ₹2Cr–200Cr /
        Major &gt; ₹200Cr. Below ₹2 Cr, or with no value, naming companies would overstate the contract.
      </p>
      <div className="nat-src-cards">
        <article>
          <h4>CPPP</h4>
          <p>Live notices. No value on these rows.</p>
        </article>
        <article>
          <h4>GeM BidPlus</h4>
          <p>Would add value. robots.txt bars automated retrieval — not wired.</p>
        </article>
        <article>
          <h4>BidAssist</h4>
          <p>Licensed, paid. Not in this build.</p>
        </article>
      </div>
      <div className="nat-rec-actions">
        <SourceBtn href={row.source_url} label="↗ Source" />
      </div>
    </div>
  );
}

function TransferRecord({ row, onClear }) {
  return (
    <div className="nat-rec">
      <header>
        <h2>{field(row, ['officer_name', 'title'])}</h2>
        <button type="button" onClick={onClear}>
          All postings
        </button>
      </header>
      <div className="nat-tiles">
        <Tile k="Cadre" v={field(row, ['cadre'])} />
        <Tile k="Batch year" v={field(row, ['batch_year'])} />
        <Tile k="Order date" v={field(row, ['order_date', 'date'])} />
        <Tile k="State / UT" v={field(row, ['jurisdiction'])} />
      </div>
      <p>
        <strong>From</strong> {field(row, ['previous_posting']) || '—'}
      </p>
      <p>
        <strong>To</strong> {field(row, ['new_posting']) || '—'}
      </p>
      <p className="desk-note">Awards are not a field on these 29 rows. No award list was invented.</p>
      <div className="nat-rec-actions">
        <SourceBtn href={row.source_url} label="↓ Source document" />
      </div>
    </div>
  );
}

function QuestionRecord({ row, onClear }) {
  return (
    <div className="nat-rec">
      <header>
        <h2>{field(row, ['subject', 'title'])}</h2>
        <button type="button" onClick={onClear}>
          All questions
        </button>
      </header>
      <div className="nat-tiles">
        <Tile k="Ministry" v={field(row, ['ministry'])} />
        <Tile k="Asked by" v={[field(row, ['mp_name']), field(row, ['party']), field(row, ['house'])].filter(Boolean).join(' · ')} />
        <Tile k="Type" v={field(row, ['question_type'])} />
        <Tile k="Tabled" v={field(row, ['date'])} />
        <Tile k="House" v={field(row, ['house'])} />
        <Tile k="Session" v={field(row, ['session'])} />
        <Tile k="Has answer" v={field(row, ['has_answer']) || 'Not reported'} />
      </div>
      <p className="desk-note">
        Answer text is not on this archive row. The Has-answer field stays Not reported until Sansad answer status is wired — that is a
        source gap, not missing volume.
      </p>
      <div className="nat-rec-actions">
        <SourceBtn href={row.source_url} label="↗ Source" />
      </div>
    </div>
  );
}

function RegulatoryRecord({ row, onClear }) {
  return (
    <div className="nat-rec">
      <header>
        <h2>{field(row, ['title'])}</h2>
        <button type="button" onClick={onClear}>
          All notices
        </button>
      </header>
      <div className="nat-tiles">
        <Tile k="Regulator" v={field(row, ['regulator'])} />
        <Tile k="Action type" v={field(row, ['action_type']) || '—'} />
        <Tile k="Reported" v={field(row, ['date'])} />
        <Tile k="Tags" v="—" />
      </div>
      <div className="nat-rec-actions">
        <SourceBtn href={row.pdf_url} label="↓ Download PDF" />
        <SourceBtn href={row.detail_url || row.source_url} label="↗ Source" />
      </div>
    </div>
  );
}

function GenericRecord({ row, onClear, noun, feed, loading }) {
  const title = field(row, ['policy_name', 'topic', 'title', 'name', 'promise', 'programme']);
  const skip = new Set(['source_url', 'status', 'pdf_url', 'id']);
  const tiles = Object.entries(row || {}).filter(([k, v]) => !skip.has(k) && v && String(v).length < 80);
  const { brief: intel } = useEntryBrief({ feed, selected: row, loading });
  const intelLines = briefPlainLines(intel);
  const note = mergeBriefText('', intelLines, { maxExtra: 4 });
  return (
    <div className="nat-rec">
      <header>
        <h2>{title || 'Record'}</h2>
        <button type="button" onClick={onClear}>
          All {noun}
        </button>
      </header>
      <div className="nat-tiles">
        {tiles.slice(0, 6).map(([k, v]) => (
          <Tile key={k} k={k.replace(/_/g, ' ')} v={String(v)} />
        ))}
      </div>
      {note ? <p className="desk-note">{note}</p> : null}
      {/news\.google\.com/i.test(row.source_url || '') ? (
        <p className="desk-note">
          This row’s source_url is news.google.com. Google News ToS restricts commercial use — the link is shown as provenance, not as a
          feed to extend.
        </p>
      ) : null}
      <div className="nat-rec-actions">
        <SourceBtn href={row.pdf_url} label="↓ View PDF" />
        <SourceBtn href={row.source_url} label="↗ Source" />
      </div>
    </div>
  );
}

export default function NationalRecord({ row, feature, onClear, onAskAi, liveCount, rows, meta, feed, loading }) {
  const f = String(feature || '');
  if (/bill passage/i.test(f)) return <BillRecord row={row} onClear={onClear} onAskAi={onAskAi} liveCount={liveCount} desk="bill" feature={feature} feed={feed} loading={loading} />;
  if (/candidate affidavit/i.test(f)) return <AffidavitRecord row={row} onClear={onClear} onAskAi={onAskAi} />;
  if (/delimitation/i.test(f)) return <DelimitationRecord row={row} rows={rows} meta={meta} onClear={onClear} onAskAi={onAskAi} />;
  if (/mp profiles|mp report/i.test(f)) return <MpRecord row={row} onClear={onClear} />;
  if (/central tender/i.test(f)) return <TenderRecord row={row} onClear={onClear} />;
  if (/agmut|bureaucratic transfers/i.test(f)) return <TransferRecord row={row} onClear={onClear} />;
  if (/parliamentary question/i.test(f)) return <BillRecord row={row} onClear={onClear} onAskAi={onAskAi} liveCount={liveCount} desk="question" feature={feature} feed={feed} loading={loading} />;
  if (/regulatory body watch/i.test(f)) return <BillRecord row={row} onClear={onClear} onAskAi={onAskAi} liveCount={liveCount} desk="regulatory" feature={feature} feed={feed} loading={loading} />;
  if (/statement/i.test(f)) {
    return (
      <div className="nat-rec">
        <header>
          <h2>{field(row, ['title'])}</h2>
          <button type="button" onClick={onClear}>
            All coverage
          </button>
        </header>
        <div className="nat-tiles">
          <Tile k="Seen" v={field(row, ['date'])} />
          <Tile k="Source" v={field(row, ['source']) || 'GDELT'} />
        </div>
        <p className="desk-note">
          This is a news-search hit, not a statement. Document-diff (two dated primary documents side by side) is not built. No
          contradiction verdict.
        </p>
        <div className="nat-rec-actions">
          <SourceBtn href={row.source_url} label="↗ Source" />
        </div>
      </div>
    );
  }
  if (/policy pipeline/i.test(f)) return <BillRecord row={row} onClear={onClear} onAskAi={onAskAi} liveCount={liveCount} desk="pipeline" feature={feature} feed={feed} loading={loading} />;
  if (/cabinet/i.test(f)) return <GenericRecord row={row} onClear={onClear} noun="decisions" feed={feed} loading={loading} />;
  if (/manifestos/i.test(f)) return <ManifestoRecord row={row} onClear={onClear} onAskAi={onAskAi} />;
  if (/budget/i.test(f)) return <BudgetRecord row={row} onClear={onClear} />;
  return <GenericRecord row={row} onClear={onClear} noun="records" feed={feed} loading={loading} />;
}
