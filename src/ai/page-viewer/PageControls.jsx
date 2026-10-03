/**
 * The page-level controls (docs/specs/2026-10-02-viewer-toolbar.md): paging, the page box, the
 * cited chip and zoom. One component draws both the side pane's page toolbar and the full view's
 * floating pill, so no control is written twice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { citedChip, fitItems, parsePageInput } from './chromeModel.js';
import { IconButton } from './IconButton.jsx';
import { ChevronDown, ChevronLeft, ChevronRight, ICON_PROPS, Maximize2, Minus, PanelLeft, Plus, Quote, Search, Undo2 } from './icons.js';
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
 * Return to the cited passage even when the reader is elsewhere on the same page.
 */
export function CitedChip({ page, cited, onPage, onFocusChange }) {
  const chip = citedChip({ page, cited });
  return (
    <button
      type="button"
      className="pv-cite pv-cite-back"
      aria-keyshortcuts="Home"
      aria-label={`Back to cited passage on page ${cited}`}
      onClick={() => onPage(cited)}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
    >
      {chip.kind === 'status' ? <Quote {...ICON_PROPS} /> : <Undo2 {...ICON_PROPS} />}
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

/** Opens search (⌘F or Ctrl+F inside the viewer does the same); says whether it is open. */
export function SearchToggle({ open, onSearch, tipSide = 'below', searchRef = null }) {
  return (
    <IconButton
      icon={Search}
      label="Search in document"
      shortcut="⌘F"
      keys="Control+F Meta+F"
      tipSide={tipSide}
      tipAlign="start"
      ref={searchRef}
      aria-expanded={open}
      onClick={onSearch}
    />
  );
}

/**
 * The page controls, as the side pane's toolbar or the full view's pill. `zoom` is null in the
 * Text view and when the toolbar is compact (zoom then lives in the More menu). `onExpand` null
 * hides Full view (phones, and the pill inside the full view). `onSearch` null hides the search
 * control (the full view's lives in its header).
 *
 * @param {{variant: 'toolbar' | 'pill', page: number, total: number, cited: number,
 *   onPage: (page: number) => void, zoom: object | null, onExpand?: (() => void) | null,
 *   expandRef?: import('react').Ref<HTMLButtonElement>, onKeyDown?: (event: KeyboardEvent) => void,
 *   onSearch?: (() => void) | null, searchOpen?: boolean, searchRef?: import('react').Ref<HTMLButtonElement>,
 *   onRail?: (() => void) | null, railOpen?: boolean, railRef?: import('react').Ref<HTMLButtonElement>}} props
 *   `onRail` null hides the thumbnails control (no PDF view).
 */
export default function PageControls({
  variant, page, total, cited, onPage, zoom, onExpand = null, expandRef = null, onKeyDown, onSearch = null, searchOpen = false, searchRef = null,
  onRail = null, railOpen = false, railRef = null,
}) {
  const tipSide = variant === 'pill' ? 'above' : 'below';
  return (
    <div className={`pv-pages pv-pages-${variant}`} role="group" aria-label="Pages" onKeyDown={onKeyDown}>
      {onRail ? (
        <IconButton icon={PanelLeft} label="Thumbnails" tipSide={tipSide} tipAlign="start" ref={railRef} aria-expanded={railOpen} onClick={onRail} />
      ) : null}
      {onSearch ? <SearchToggle open={searchOpen} onSearch={onSearch} tipSide={tipSide} searchRef={searchRef} /> : null}
      <IconButton icon={ChevronLeft} label="Previous page" shortcut="←" keys="ArrowLeft [" tipSide={tipSide} tipAlign="start" unavailable={page <= 1} onClick={() => onPage(page - 1)} />
      <PageField page={page} total={total} onPage={onPage} />
      <IconButton icon={ChevronRight} label="Next page" shortcut="→" keys="ArrowRight ]" tipSide={tipSide} unavailable={page >= total} onClick={() => onPage(page + 1)} />
      <CitedChip page={page} cited={cited} onPage={onPage} />
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
