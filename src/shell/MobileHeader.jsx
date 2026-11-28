import { useId } from 'react';

/**
 * MobileHeader (Phase 2 / Step 1)
 *
 * Implements the shared mobile application header and navigation architecture
 * required by the approved NTER Lawyer mobile journey, matching Reference Images A, B, C, and D:
 * - Left: Hamburger menu trigger (opens navigation drawer/desks).
 * - Center: Centered segmented pill control [ Chat | Work ].
 * - Right: NTER brand mark / Pi logo in Chat mode, or Document action icon in Work mode.
 * - Responsive safe-area padding and zero horizontal overflow.
 */
export default function MobileHeader({
  activeMode = 'chat', // 'chat' | 'work'
  onModeChange,
  onOpenNav,
  lang = 'en',
}) {
  const isWork = activeMode === 'work';
  const hi = lang === 'hi';
  const tabListId = useId();

  const handleMode = (nextMode) => {
    if (nextMode !== activeMode) {
      onModeChange?.(nextMode);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('niy-ai-mode', { detail: { mode: nextMode } }));
      }
    }
  };

  return (
    <header className="nter-mobile-header" role="banner" aria-label={hi ? 'मोबाइल हेडर' : 'Mobile Header'}>
      {/* Left: Hamburger menu trigger */}
      <button
        type="button"
        className="nter-mob-hamburger"
        onClick={onOpenNav}
        aria-label={hi ? 'नेविगेशन मेनू खोलें' : 'Open navigation menu'}
        title={hi ? 'नेविगेशन मेनू' : 'Navigation menu'}
        data-testid="mob-hamburger-btn"
      >
        <span className="nter-mob-hamburger-bar" />
        <span className="nter-mob-hamburger-bar" />
        <span className="nter-mob-hamburger-bar" />
      </button>

      {/* Center: Segmented Chat / Work Control */}
      <div
        className="nter-mob-segmented"
        role="tablist"
        id={tabListId}
        aria-label={hi ? 'चैट और वर्क मोड' : 'Chat and Work mode switcher'}
      >
        <button
          type="button"
          role="tab"
          id="nter-mob-tab-chat"
          data-testid="mob-tab-chat"
          aria-selected={!isWork}
          aria-controls="nter-mob-panel-chat"
          className={`nter-mob-segmented-btn${!isWork ? ' active' : ''}`}
          onClick={() => handleMode('chat')}
        >
          {hi ? 'चैट' : 'Chat'}
        </button>
        <button
          type="button"
          role="tab"
          id="nter-mob-tab-work"
          data-testid="mob-tab-work"
          aria-selected={isWork}
          aria-controls="nter-mob-panel-work"
          className={`nter-mob-segmented-btn${isWork ? ' active' : ''}`}
          onClick={() => handleMode('work')}
        >
          {hi ? 'वर्क' : 'Work'}
        </button>
      </div>

      {/* Right: NTER Identity or Document Action */}
      <div className="nter-mob-header-right">
        {isWork ? (
          <button
            type="button"
            className="nter-mob-doc-icon"
            onClick={() => handleMode('work')}
            aria-label={hi ? 'दस्तावेज़ ड्राफ्ट' : 'Draft document'}
            title={hi ? 'ड्राफ्टिंग' : 'Drafting'}
            data-testid="mob-doc-icon-btn"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </button>
        ) : (
          <div className="nter-mob-brand-mark" title="Niyantran Terminal" data-testid="mob-brand-logo">
            <img src="/brand/logo-128.webp" alt="NTER" width="28" height="28" />
          </div>
        )}
      </div>
    </header>
  );
}
