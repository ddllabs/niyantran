import { useEffect, useState } from 'react';
import { createAiChat } from '../lib/aiChatStore.js';
import AiPanel from './AiPanel.jsx';

export default function AiDock({ feed, selected, tab, featureName, lang, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState(null);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    function onOpen(e) {
      const detail = e.detail && typeof e.detail === 'object' ? e.detail : {};
      const intentional =
        detail.row ||
        detail.drop ||
        detail.prompt ||
        detail.attachFeed ||
        detail.droppedFiles?.length;

      setOpen((wasOpen) => {
        // New empty thread when opening research with a card — not when merely focusing the dock after a drop.
        if (!wasOpen && intentional) createAiChat({ roleId: 'AUTO' });
        return true;
      });

      if (Object.keys(detail).length) {
        setSeed({
          ...detail,
          row: detail.row || selected || undefined,
          attachFeed: detail.attachFeed || Boolean(detail.row || selected),
        });
      } else if (intentional && selected) {
        setSeed({ row: selected, attachFeed: true });
      }
    }
    window.addEventListener('niy-ai-open', onOpen);
    return () => window.removeEventListener('niy-ai-open', onOpen);
  }, [selected]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <aside className="ai-dock ai-dock-v2" role="complementary" aria-label="AI research">
      <AiPanel
        feed={feed}
        selected={selected}
        tab={tab}
        featureName={featureName}
        lang={lang}
        seed={seed}
        onSeedConsumed={() => setSeed(null)}
        onClose={() => setOpen(false)}
      />
    </aside>
  );
}
