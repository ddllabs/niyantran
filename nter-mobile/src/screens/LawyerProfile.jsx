// Screen 03: Lawyer work profile onboarding step.
// Tunes legal prompts, terminology and document structure while keeping conversation focus separate.
import { useState } from 'react';
import { useApp } from '../state/app.jsx';
import Icon from '../ui/Icon.jsx';
import { asset } from '../lib/asset.js';

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

const PRACTICE_TAGS = [
  'Litigation',
  'Advisory',
  'Arbitration',
  'Corporate',
];

export default function LawyerProfile({ onDone, onSave, step = 3, total = 3 }) {
  const app = useApp() || {};
  const {
    lawyerProfile = {},
    updateLawyerProfile = () => {},
    setStage = () => {},
    setTab = () => {},
    profile = null,
    session = null,
  } = app;
  const userName = profile?.name || session?.user?.user_metadata?.name || lawyerProfile.name || 'Arjun Kapoor';
  const userInitials = userName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'AK';

  const [practice, setPractice] = useState(lawyerProfile.practiceArea || 'Civil & commercial');
  const [jurisdiction, setJurisdiction] = useState(lawyerProfile.jurisdiction || 'India');
  const [tags, setTags] = useState(lawyerProfile.practiceTags || ['Litigation', 'Advisory']);
  const [lang] = useState(lawyerProfile.language || 'English');

  const toggleTag = (tag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleContinue = () => {
    const updated = {
      name: userName,
      practiceArea: practice,
      jurisdiction,
      practiceTags: tags,
      language: lang,
    };
    updateLawyerProfile(updated);
    if (onSave) onSave(updated);
    if (onDone) onDone();
    if (!onDone && !onSave) {
      setTab('ask');
      setStage('app');
    }
  };

  return (
    <div className="view lawyer-profile-view">
      <div className="profile-hdr">
        <button type="button" className="ib" onClick={() => setStage('persona')} aria-label="Back to persona selection">
          <Icon name="back" />
        </button>
        <div className="brand-center">
          <img src={asset('/brand/logo-128.webp')} alt="" className="pi-logo" />
          <span className="brand-text">TERMINAL</span>
        </div>
        <div className="hdr-spacer" />
      </div>

      <div className="body profile-body">
        <div className="stepper-k">YOUR WORKING PROFILE · {step} OF {total}</div>

        {/* Visual profile badge card */}
        <div className="lawyer-badge-card">
          <div className="lawyer-avatar">{userInitials}</div>
          <div className="lawyer-info">
            <h3 className="lawyer-name">{userName}</h3>
            <p className="lawyer-desc">Lawyer · {practice} practice · {jurisdiction}</p>
          </div>
          <div className="watermark-symbol" aria-hidden="true">§</div>
        </div>

        {/* Profile Form */}
        <div className="profile-form-wrap">
          <h2 className="form-title">Finish your profile</h2>
          <p className="form-sub">This tunes legal prompts and document structure. Each chat gets its own focus.</p>

          <div className="form-group">
            <label htmlFor="primary-practice-select" className="input-label">Primary practice</label>
            <div className="select-pill">
              <span className="pill-icon">§</span>
              <select
                id="primary-practice-select"
                value={practice}
                onChange={(e) => setPractice(e.target.value)}
                aria-label="Primary practice"
              >
                {PRACTICE_AREAS.map((pa) => (
                  <option key={pa} value={pa}>{pa}</option>
                ))}
              </select>
              <Icon name="down" />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="jurisdiction-select" className="input-label">Jurisdiction</label>
            <div className="select-pill">
              <span className="pill-flag">IN</span>
              <select
                id="jurisdiction-select"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                aria-label="Jurisdiction"
              >
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
              <Icon name="down" />
            </div>
          </div>

          <div className="form-group">
            <div className="input-label">Practice focus &amp; mode</div>
            <div className="tags-row">
              {PRACTICE_TAGS.map((tag) => {
                const active = tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`tag-pill ${active ? 'on' : ''}`}
                    onClick={() => toggleTag(tag)}
                    aria-pressed={active}
                  >
                    {tag}
                  </button>
                );
              })}
              <span className="tag-pill locked">English</span>
            </div>
          </div>
        </div>

        <div className="profile-foot">
          <button type="button" className="pbtn continue-chat-btn" onClick={handleContinue}>
            Continue to Chat →
          </button>
        </div>
      </div>
    </div>
  );
}
