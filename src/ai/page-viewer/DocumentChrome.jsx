/**
 * The document-level controls (docs/specs/2026-10-02-viewer-toolbar.md): the PDF | Text switch,
 * the original file, and the More menu. The side pane shows them as a slim row under WorkSurface's
 * bar, which already carries the title and the close control; the full view, which has no such
 * bar, shows them in its header with the title.
 */
import { useId, useRef, useState } from 'react';
import { copyText, fitItems } from './chromeModel.js';
import { IconButton, IconLink } from './IconButton.jsx';
import { Check, Copy, Database, Ellipsis, ExternalLink, Minimize2, Minus, Plus } from './icons.js';
import Menu from './Menu.jsx';
import { SearchToggle } from './PageControls.jsx';

const COPY_LABELS = Object.freeze({ idle: 'Copy file name', ok: 'File name copied', fail: "Couldn't copy the file name" });

/** PDF | Text, the current view pressed. */
export function ViewSwitch({ view, onView }) {
  return (
    <div className="pv-switch" role="group" aria-label="View">
      <button type="button" aria-pressed={view === 'pdf'} onClick={() => onView('pdf')}>PDF</button>
      <button type="button" aria-pressed={view === 'text'} onClick={() => onView('text')}>Text</button>
    </div>
  );
}

/** The More menu's items, in order: zoom (compact layout only), the stored copy, the file name. */
export function moreItems({ zoom, storedLabel, onStoredCopy, fileName, fileId, copyState, onCopy }) {
  const items = [];
  if (zoom) {
    if (zoom.canZoomIn) items.push({ id: 'zoom-in', label: 'Zoom in', icon: Plus, onSelect: () => zoom.onZoomStep(1) });
    if (zoom.canZoomOut) items.push({ id: 'zoom-out', label: 'Zoom out', icon: Minus, onSelect: () => zoom.onZoomStep(-1) });
    for (const fit of fitItems(zoom)) items.push({ id: `fit-${fit.value}`, label: fit.label, checked: fit.checked, onSelect: () => zoom.onFit(fit.value) });
  }
  const files = [];
  if (storedLabel) files.push({ id: 'stored', label: storedLabel, icon: Database, onSelect: onStoredCopy });
  if (fileName) {
    files.push({ id: 'copy', label: COPY_LABELS[copyState], icon: copyState === 'ok' ? Check : Copy, keepOpen: true, describedBy: fileId, onSelect: onCopy });
  }
  if (items.length && files.length) items.push({ id: 'sep-files', separator: true });
  return [...items, ...files];
}

/**
 * ⋯, with the stored copy, Copy file name and the file name itself; in the compact layout, zoom
 * too. Nothing is drawn when the menu would be empty.
 */
export function MoreMenu({ zoom = null, storedLabel = null, onStoredCopy, fileName = '', side = 'below' }) {
  const [copyState, setCopyState] = useState('idle');
  // Each copy and each close takes a new number, so a copy that settles after the menu closed
  // cannot show its result on the next open.
  const copyRun = useRef(0);
  const fileId = useId();
  const onCopy = () => {
    const run = ++copyRun.current;
    copyText(fileName).then((ok) => { if (copyRun.current === run) setCopyState(ok ? 'ok' : 'fail'); });
  };
  const onClose = () => {
    copyRun.current += 1;
    setCopyState('idle');
  };
  const items = moreItems({ zoom, storedLabel, onStoredCopy, fileName, fileId, copyState, onCopy });
  if (!items.length) return null;
  const footer = fileName ? (
    <>
      <span id={fileId} className="pv-menu-file">{fileName}</span>
      <span className="pv-sr" role="status">{copyState === 'idle' ? '' : COPY_LABELS[copyState]}</span>
    </>
  ) : null;
  return (
    <Menu
      label="More"
      items={items}
      side={side}
      align="end"
      footer={footer}
      onClose={onClose}
      renderTrigger={props => <IconButton icon={Ellipsis} label="More" tipAlign="end" {...props} />}
    />
  );
}

/**
 * The side pane's document row: the section, then the view switch, the original file and More.
 * `section` is `sectionParts(...)`: the heading gives way before the note when space runs out.
 * `onKeyDown` is the viewer's paging keys, which work from every control, as before.
 */
export function DocumentRow({ section, viewSwitch, fileUrl, more, onKeyDown }) {
  return (
    <div className="pv-docrow" onKeyDown={onKeyDown}>
      <p className="pv-section" title={section.label || undefined}>
        {section.head ? <><span className="pv-section-head">{section.head}</span><span className="pv-section-sep" aria-hidden="true">›</span></> : null}
        <span className="pv-section-note">{section.note}</span>
      </p>
      {viewSwitch}
      {fileUrl ? <IconLink icon={ExternalLink} label="Open original file" href={fileUrl} /> : null}
      {more}
    </div>
  );
}

/**
 * The full view's header: the title and section, search, the view switch, the file, More, and
 * Exit. `onSearch` null hides search (a document without pages).
 */
export function FullHeader({
  title, titleId, section, viewSwitch, fileUrl, more, onExit, exitRef = null, onKeyDown, onSearch = null, searchOpen = false, searchRef = null,
}) {
  return (
    <header className="pv-head" onKeyDown={onKeyDown}>
      <p className="pv-head-title" title={section.label ? `${title} › ${section.label}` : title}>
        <strong id={titleId}>{title}</strong>
        {section.label ? <span className="pv-head-section"> › {section.label}</span> : null}
      </p>
      {onSearch ? <SearchToggle open={searchOpen} onSearch={onSearch} searchRef={searchRef} /> : null}
      {viewSwitch}
      {fileUrl ? <IconLink icon={ExternalLink} label="Open original file" href={fileUrl} /> : null}
      {more}
      <IconButton icon={Minimize2} label="Exit full view" shortcut="Esc" keys="Escape" tipAlign="end" ref={exitRef} onClick={onExit} />
    </header>
  );
}
