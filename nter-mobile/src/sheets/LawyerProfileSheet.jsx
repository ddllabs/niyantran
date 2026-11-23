// Sheet: Lawyer Profile Editor (accessed from Settings / Me).
import { useState } from 'react';
import { useApp } from '../state/app.jsx';
import { SheetShell, SheetHead } from '../ui/kit.jsx';

const PRACTICE_AREAS = [
  'Civil & commercial',
  'Corporate & M&A',
  'Constitutional & Criminal',
  'Regulatory & Taxation',
  'Dispute Resolution & Arbitration',
  'Intellectual Property',
];

const JURISDICTIONS = [
  'India',
  'Supreme Court of India',
  'High Courts of India',
  'NCLT / NCLAT (Insolvency)',
  'Commercial Courts & Tribunals',
];

const PRACTICE_TAGS = ['Litigation', 'Advisory', 'Arbitration', 'Corporate'];

export default function LawyerProfileSheet() {
  const { lawyerProfile, updateLawyerProfile, closeSheet, toast } = useApp();
  const [practice, setPractice] = useState(lawyerProfile.practiceArea || 'Civil & commercial');
  const [jurisdiction, setJurisdiction] = useState(lawyerProfile.jurisdiction || 'India');
  const [tags, setTags] = useState(lawyerProfile.practiceTags || ['Litigation', 'Advisory']);
  const [lang] = useState(lawyerProfile.language || 'English');

  const toggleTag = (tag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleSave = () => {
    updateLawyerProfile({
      practiceArea: practice,
      jurisdiction,
      practiceTags: tags,
      language: lang,
    });
    toast('Lawyer profile updated');
    closeSheet();
  };

  return (
    <SheetShell size="tall" label="Lawyer work profile">
      <SheetHead title="Lawyer work profile" sub="Tunes legal prompts, citations and document formats" />
      <div className="sh-body" style={{ padding: '16px' }}>
        <label className="input-label" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Primary practice</label>
        <div className="select-pill" style={{ marginBottom: 16 }}>
          <select value={practice} onChange={(e) => setPractice(e.target.value)}>
            {PRACTICE_AREAS.map((pa) => (
              <option key={pa} value={pa}>{pa}</option>
            ))}
          </select>
        </div>

        <label className="input-label" style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Jurisdiction</label>
        <div className="select-pill" style={{ marginBottom: 16 }}>
          <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
            {JURISDICTIONS.map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
        </div>

        <div className="input-label" style={{ marginBottom: 8, fontWeight: 600 }}>Practice tags</div>
        <div className="tags-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {PRACTICE_TAGS.map((tag) => {
            const active = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`tag-pill ${active ? 'on' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>
      <div className="sh-foot">
        <button type="button" className="pbtn" onClick={handleSave}>
          Save profile
        </button>
      </div>
    </SheetShell>
  );
}
