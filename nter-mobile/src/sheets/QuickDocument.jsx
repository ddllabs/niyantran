// Sheet: Quick Document menu for Lawyer persona (Storyboard Screen 07).
// 5 primary legal outputs: Case-law note, Legal notice, Case brief, Written submissions, Chronology of facts.
import { useApp } from '../state/app.jsx';
import { useChat } from '../state/chat.jsx';
import { useStudio } from '../state/studio.jsx';
import { docFromLawyerTemplate } from '../lib/studioDoc.js';
import Icon from '../ui/Icon.jsx';
import { SheetShell, SheetHead } from '../ui/kit.jsx';

const LAWYER_DOC_TEMPLATES = [
  {
    type: 'citation_note',
    badge: 'CN',
    title: 'Case-law & citation note',
    desc: 'Authoritative propositions and pinpoints',
  },
  {
    type: 'legal_notice',
    badge: 'LN',
    title: 'Legal notice',
    desc: 'Facts, grounds, demand and deadline',
  },
  {
    type: 'case_brief',
    badge: 'CB',
    title: 'Case brief',
    desc: 'Facts, issues, holding and ratio',
  },
  {
    type: 'written_submissions',
    badge: 'WS',
    title: 'Written submissions',
    desc: 'Structured arguments with citations',
  },
  {
    type: 'chronology',
    badge: 'CF',
    title: 'Chronology of facts',
    desc: 'Dated events with source trail',
  },
];

export default function QuickDocumentSheet() {
  const { saveMade, closeSheet, toast } = useApp();
  const chat = useChat();
  const { openInStudio } = useStudio();

  const lastTurn = chat.turns[chat.turns.length - 1];
  const question = lastTurn?.question || 'Termination after delayed performance in public procurement';
  const modelName = lastTurn?.model?.label || chat.model?.label || 'NYAI Pro';

  const handleSelect = (template) => {
    const doc = docFromLawyerTemplate(template.type, {
      question,
      modelName,
      sources: lastTurn?.sources || [],
      authorities: lastTurn?.authorities || [],
    });
    saveMade(doc);
    openInStudio(doc.id);
    closeSheet();
    toast(`Created ${doc.name}`);
  };

  return (
    <SheetShell size="tall" label="Quick document">
      <SheetHead title="Quick document" sub="Built for a lawyer's everyday work." />
      <div className="sh-body qd-sheet-body">
        <div className="qd-list">
          {LAWYER_DOC_TEMPLATES.map((tpl) => (
            <button
              key={tpl.type}
              type="button"
              className="qd-card"
              onClick={() => handleSelect(tpl)}
            >
              <div className="qd-badge">{tpl.badge}</div>
              <div className="qd-text">
                <div className="qd-title">{tpl.title}</div>
                <div className="qd-desc">{tpl.desc}</div>
              </div>
              <span className="qd-arrow">›</span>
            </button>
          ))}
        </div>
      </div>
    </SheetShell>
  );
}
