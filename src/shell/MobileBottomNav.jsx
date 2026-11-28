import { Folder, Home, LayoutGrid, Sparkles, User } from 'lucide-react';

export default function MobileBottomNav({
  activeTab = 'home',
  aiOpen = false,
  filesOpen = false,
  accountOpen = false,
  onDesk,
  onOpenDesks,
  onOpenAi,
  onOpenFiles,
  onOpenAccount,
  lang = 'en',
}) {
  const hi = lang === 'hi';

  return (
    <nav className="mobile-bottom-nav" aria-label={hi ? 'मोबाइल नेविगेशन' : 'Mobile Navigation'}>
      <button
        type="button"
        className={`mob-nav-item${activeTab === 'home' && !aiOpen && !filesOpen && !accountOpen ? ' active' : ''}`}
        onClick={() => onDesk?.('home')}
        aria-label={hi ? 'मुख्य पृष्ठ' : 'Home'}
      >
        <Home size={20} aria-hidden="true" />
        <span>{hi ? 'होम' : 'Home'}</span>
      </button>

      <button
        type="button"
        className="mob-nav-item"
        onClick={() => onOpenDesks?.()}
        aria-label={hi ? 'डेस्क नेविगेशन' : 'Browse desks'}
      >
        <LayoutGrid size={20} aria-hidden="true" />
        <span>{hi ? 'डेस्क' : 'Desks'}</span>
      </button>

      <div className="mob-nav-fab-wrap">
        <button
          type="button"
          className={`mob-nav-fab${aiOpen ? ' active' : ''}`}
          onClick={() => onOpenAi?.()}
          aria-label={hi ? 'एआई शोध' : 'Ask AI'}
          title={hi ? 'एआई अनुसंधान सहायक' : 'Ask AI Research Assistant'}
        >
          <Sparkles size={22} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className={`mob-nav-item${filesOpen ? ' active' : ''}`}
        onClick={() => onOpenFiles?.()}
        aria-label={hi ? 'निजी फ़ाइलें' : 'Files'}
      >
        <Folder size={20} aria-hidden="true" />
        <span>{hi ? 'फ़ाइलें' : 'Files'}</span>
      </button>

      <button
        type="button"
        className={`mob-nav-item${accountOpen ? ' active' : ''}`}
        onClick={() => onOpenAccount?.()}
        aria-label={hi ? 'खाता एवं क्रेडिट' : 'Account'}
      >
        <User size={20} aria-hidden="true" />
        <span>{hi ? 'खाता' : 'Account'}</span>
      </button>
    </nav>
  );
}
