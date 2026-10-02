/**
 * The page-level controls (docs/specs/2026-10-02-viewer-toolbar.md): paging, the page box, the
 * cited chip and zoom. One component draws both the side pane's page toolbar and the full view's
 * floating pill, so no control is written twice.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { citedChip, fitItems, parsePageInput } from './chromeModel.js';
import { IconButton } from './IconButton.jsx';
import { ChevronDown, ChevronLeft, ChevronRight, ICON_PROPS, Maximize2, Minus, Plus, Quote, Undo2 } from './icons.js';
import Menu from './Menu.jsx';

/**
 * The page box: shows the current page and takes a typed one. Enter or leaving the box commits a
 * valid page; anything else shows the current page again. Escape with an edit restores the page
 * and goes no further, on a native listener, because the full view's own Escape (which closes it)
 * is a native listener on the dialog and runs before React's.
 */
export function PageField({ page, total, onPage, fieldRef = null }) {
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const dirtyRef = useRef(false);
  const setInput = useCallback((node) => {
    inputRef.current = node;
    if (fieldRef) fieldRef.current = node;
  }, [fieldRef]);
  const edit = (value) => {
    dirtyRef.current = value !== null;
    setDraft(value);
  };
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || !dirtyRef.current) return;
      event.stopPropagation();
      event.preventDefault();
      edit(null);
    };
    input.addEventListener('keydown', onKeyDown);
    return () => input.removeEventListener('keydown', onKeyDown);
  }, []);

  const commit = () => {
    if (draft === null) return;
    const next = parsePageInput(draft, total);
    edit(null);
    if (next !== null && next !== page) onPage(next);
  };

  return (
    <label className="pv-page-field">
      <input
        ref={setInput}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        size={String(total).length}
        aria-label={`Page, 1 to ${total}`}
        value={draft ?? String(page)}
        onChange={event => edit(event.target.value)}
        onFocus={event => event.target.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commit();
        }}
      />
      <span className="pv-page-total" aria-hidden="true">/ {total}</span>
    </label>
  );
}

/**
 * "Cited p. 4" on the cited page; elsewhere, the button back to it (the Home key). Reaching the
 * cited page removes the button; `onFocusChange` lets the toolbar keep the focus it held.
 */
export function CitedChip({ page, cited, onPage, onFocusChange }) {
  const chip = citedChip({ page, cited });
  if (chip.kind === 'status') {
    return (
      <span className="pv-cite">
        <Quote {...ICON_PROPS} />
        {chip.label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="pv-cite pv-cite-back"
      aria-keyshortcuts="Home"
      onClick={() => onPage(chip.target)}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
    >
      <Undo2 {...ICON_PROPS} />
      {chip.label}
    </button>
  );
}

/**
 * −, the readout that opens the fit menu, and +.
 * @param {{zoom: {fit: string, manual: boolean, readout: string, canZoomIn: boolean,
 *   canZoomOut: boolean, onZoomStep: (direction: number) => void, onFit: (fit: string) => void},
 *   tipSide: 'below' | 'above'}} props
 */
export function ZoomControls({ zoom, tipSide }) {
  const items = fitItems(zoom).map(item => ({ id: item.value, label: item.label, checked: item.checked, onSelect: () => zoom.onFit(item.value) }));
  return (
    <div className="pv-zoom" role="group" aria-label="Zoom">
      <IconButton icon={Minus} label="Zoom out" tipSide={tipSide} unavailable={!zoom.canZoomOut} onClick={() => zoom.onZoomStep(-1)} />
      <Menu
        label="Fit"
        items={items}
        side={tipSide}
        align="end"
        renderTrigger={props => (
          <button type="button" className="pv-readout" aria-label={`Zoom ${zoom.readout}, choose a fit`} {...props}>
            {zoom.readout}
            <ChevronDown {...ICON_PROPS} size={12} />
          </button>
        )}
      />
      <IconButton icon={Plus} label="Zoom in" tipSide={tipSide} unavailable={!zoom.canZoomIn} onClick={() => zoom.onZoomStep(1)} />
    </div>
  );
}

/**
 * The page controls, as the side pane's toolbar or the full view's pill. `zoom` is null in the
 * Text view and when the toolbar is compact (zoom then lives in the More menu). `onExpand` null
 * hides Full view (phones, and the pill inside the full view).
 *
 * @param {{variant: 'toolbar' | 'pill', page: number, total: number, cited: number,
 *   onPage: (page: number) => void, zoom: object | null, onExpand?: (() => void) | null,
 *   expandRef?: import('react').Ref<HTMLButtonElement>, onKeyDown?: (event: KeyboardEvent) => void}} props
 */
export default function PageControls({ variant, page, total, cited, onPage, zoom, onExpand = null, expandRef = null, onKeyDown }) {
  const tipSide = variant === 'pill' ? 'above' : 'below';
  // "Back to p. N" unmounts once the reader is back on the cited page, by its click or the Home
  // key; a removed button fires no blur, so focus would fall to the page body, where the paging
  // keys and the full view's Escape no longer reach. The page box, which shows the page, takes it.
  const fieldRef = useRef(null);
  const backFocused = useRef(false);
  const onCited = page === cited;
  useLayoutEffect(() => {
    if (!onCited || !backFocused.current) return;
    backFocused.current = false;
    fieldRef.current?.focus({ preventScroll: true });
  }, [onCited]);
  return (
    <div className={`pv-pages pv-pages-${variant}`} role="group" aria-label="Pages" onKeyDown={onKeyDown}>
      <IconButton icon={ChevronLeft} label="Previous page" shortcut="←" keys="ArrowLeft [" tipSide={tipSide} tipAlign="start" unavailable={page <= 1} onClick={() => onPage(page - 1)} />
      <PageField page={page} total={total} onPage={onPage} fieldRef={fieldRef} />
      <IconButton icon={ChevronRight} label="Next page" shortcut="→" keys="ArrowRight ]" tipSide={tipSide} unavailable={page >= total} onClick={() => onPage(page + 1)} />
      <CitedChip page={page} cited={cited} onPage={onPage} onFocusChange={(focused) => { backFocused.current = focused; }} />
      {zoom || onExpand ? (
        <div className="pv-pages-end">
          {zoom ? <ZoomControls zoom={zoom} tipSide={tipSide} /> : null}
          {onExpand ? (
            <IconButton icon={Maximize2} label="Full view" tipAlign="end" ref={expandRef} aria-haspopup="dialog" onClick={onExpand} />
          ) : null}
        </div>
      ) : null}
      <span className="pv-sr" aria-live="polite">{`Page ${page} of ${total}`}</span>
    </div>
  );
}
