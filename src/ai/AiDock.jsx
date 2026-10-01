import { useCallback, useEffect, useRef, useState } from 'react';
import AiPanel from './AiPanel.jsx';

/**
 * The dock's next state (panel-loading spec A, D). It mounts on its first open and stays mounted;
 * closing hides it, so a reopen is instant and keeps the thread. Every real change is reported to
 * the shell in the same step it is made, never from an effect after the render, so the desk lays
 * out once.
 */
export function dockNext(state, open, report) {
  if (state.open === open) return state;
  report?.(open);
  return { open, mounted: state.mounted || open };
}

export default function AiDock({ feed, selected, tab, featureName, lang, onOpenChange }) {
  const [dock, setDock] = useState({ open: false, mounted: false });
  const [seed, setSeed] = useState(null);
  const dockRef = useRef(dock);
  const setOpen = useCallback((open) => {
    const next = dockNext(dockRef.current, open, onOpenChange);
    if (next === dockRef.current) return;
    dockRef.current = next;
    setDock(next);
  }, [onOpenChange]);

  useEffect(() => {
    function onOpen(e) {
      const detail = e.detail && typeof e.detail === 'object' ? e.detail : {};
      const intentional =
        detail.row ||
        detail.drop ||
        detail.prompt ||
        detail.attachFeed ||
        detail.droppedFiles?.length;

      setOpen(true);

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
  }, [selected, setOpen]);

  useEffect(() => {
    if (!dock.open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dock.open, setOpen]);

  const close = useCallback(() => setOpen(false), [setOpen]);
  const consumeSeed = useCallback(() => setSeed(null), []);

  if (!dock.mounted) return null;

  return (
    <aside className="ai-dock ai-dock-v2" role="complementary" aria-label="AI research" hidden={!dock.open}>
      <AiPanel
        feed={feed}
        selected={selected}
        tab={tab}
        featureName={featureName}
        lang={lang}
        seed={seed}
        open={dock.open}
        onSeedConsumed={consumeSeed}
        onClose={close}
      />
    </aside>
  );
}
