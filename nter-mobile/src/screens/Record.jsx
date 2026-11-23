// One record, as nter.pro's desk card. Tapping a bill, notice, order or any row opens this view from
// the right, as the website opens its side panel: the NTER animation plays while the AI brief is
// read (or written, the first time anyone opens the record), then the card shows — the website's
// own card for the modules it has one for (src/shell/record/adapters), and the same design built from
// the record's fields for the rest. Below it: Quick Exit, PDF, pin and watch.
import { useMemo } from 'react';
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import { useStudio } from '../state/studio.jsx';
import { isSample } from '../services/index.js';
import { normalizeBrief, recordAttachment } from '../services/shape.js';
import { ALL_MODULES } from '../data/desks.js';
import { exportRecordPdf } from '../lib/exporters.js';
import { openUrl } from '../lib/open.js';
import { adapterFor } from '../shell/record/registry.js';
import { useRecordPacks } from '../shell/record/packs.js';
import { todayInIndia } from '../shell/record/adapters/common.js';
import DeskCard from '../deskcard/DeskCard.jsx';
import genericModel, { titleOf } from '../deskcard/genericModel.js';
import { useDeskBrief } from '../deskcard/useDeskBrief.js';
import Icon from '../ui/Icon.jsx';
import { Header, MiniIris, TabBar } from '../ui/kit.jsx';
import { rowKeyOf } from './Module.jsx';

/** The card's model: the website's adapter for this module when it has one, else the generic card. */
export function deskCardModel(module, row, { rows = [], feed = null, packs = null } = {}) {
  const adapter = row?.status === 'source_status' ? null : adapterFor(module.feature, module.tier);
  const siteFeed = { ...(feed || {}), tier: module.tier, feature: module.feature, rows: feed?.rows || rows };
  if (adapter) {
    try {
      const model = adapter(row, { rows, feed: siteFeed, packs, today: todayInIndia() });
      if (model?.title) return { model, source: 'website' };
    } catch { /* an unexpected row: the generic card still shows every field */ }
  }
  return { model: genericModel(row, { rows, feed: siteFeed, module }), source: 'generic' };
}

/** The app's module entry for a website link {tab, feature}. */
export const moduleFor = (to) => ALL_MODULES.find((m) => m.feature === to?.feature && (m.desk === to.tab || m.tier === to.tab))
  || ALL_MODULES.find((m) => m.feature === to?.feature) || null;

export default function RecordScreen({ module, row, rows = [], feed = null }) {
  const { openSheet, pins, togglePin, watchlist, toggleWatch, toast, signedIn, requireSignIn, push, pop, theme } = useApp();
  const chat = useChat();
  const { openChat } = useStudio();
  const packs = useRecordPacks(isSample ? '' : module.feature);
  const { model } = useMemo(() => deskCardModel(module, row, { rows, feed, packs }), [module, row, rows, feed, packs]);
  const brief = useDeskBrief({ module, row, signedIn });
  const title = model?.title || titleOf(row, module.title);
  const key = rowKeyOf(module, row);
  const pinned = pins.some((p) => p.key === key);
  const watched = watchlist.some((w) => w.tab === module.desk && w.feature === module.feature);
  const dark = theme === 'dark' || (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark');

  const asAttachment = () => ({ ...recordAttachment({ row, module }), key, label: title, icon: 'doc', record: { module, row, title, key } });
  const ask = (prompt) => {
    chat.attach(asAttachment());
    chat.setDeskContext({ tier: module.desk, feature: module.feature });
    if (prompt) chat.setDraft(prompt);
    openChat();
  };
  const quickExit = () => openSheet('qe', { record: { module, row, title, key } });
  const download = async () => {
    try {
      await exportRecordPdf({ module, row, title, brief: brief.state === 'ready' ? normalizeBrief(brief) : null });
    } catch (e) { toast(e.message || 'Could not make the PDF'); }
  };
  const openModule = (to) => {
    const m = moduleFor(to);
    if (m) push({ v: 'module', module: m });
    else toast('That module is not in the app yet');
  };

  return (
    <div className="view push deskcard-view">
      <Header back line title={module.title} sub={`DESK CARD · ${(module.deskName || module.desk || '').toUpperCase()}`}
        right={<button type="button" className="qxb" onClick={quickExit} aria-label="Quick Exit documents"><MiniIris /></button>} />
      <div className="body">
        <DeskCard
          model={model}
          brief={brief}
          dark={dark}
          onClose={pop}
          onAsk={() => ask()}
          onQuick={(prompt) => ask(prompt)}
          onSelect={(r) => push({ v: 'record', module, row: r, rows, feed })}
          onOpenModule={openModule}
          onOpenLink={openUrl}
          onSignIn={() => requireSignIn('Sign in to read AI briefs and ask the AI.')}
        />
      </div>
      <div className="actbar">
        <button type="button" className="pbtn dark" onClick={quickExit}><MiniIris size={22} />Quick Exit</button>
        <button type="button" className="ib" onClick={download} aria-label="Download as PDF"><Icon name="download" /></button>
        <button type="button" className={`ib ${pinned ? 'on' : ''}`} aria-pressed={pinned} onClick={() => { togglePin({ key, title, module, row }); toast(pinned ? 'Unpinned' : 'Pinned to your library'); }} aria-label="Pin"><Icon name="pin" /></button>
        <button type="button" className={`ib ${watched ? 'on' : ''}`} aria-pressed={watched} onClick={() => toggleWatch({ tab: module.desk, feature: module.feature, label: module.title })} aria-label="Watch this module"><Icon name="bell" /></button>
      </div>
      <TabBar />
    </div>
  );
}
