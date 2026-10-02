/**
 * The search row (docs/specs/2026-10-02-viewer-continuous.md, section 4): the field, "3 of 9",
 * previous and next match, and close. Enter and Shift+Enter step; Escape closes search and goes
 * no further, on a native listener, because the full view's own Escape (which closes it) is a
 * native listener on the dialog and runs before React's.
 */
import { useEffect, useRef } from 'react';
import { IconButton } from './IconButton.jsx';
import { ChevronDown, ChevronUp, X } from './icons.js';

/**
 * @param {{query: string, label: string, total: number, onQuery: (query: string) => void,
 *   onStep: (direction: 1 | -1) => void, onClose: () => void, onTextView?: (() => void) | null,
 *   inputRef?: import('react').Ref<HTMLInputElement>}} props
 *   `onTextView` shows the note that the current match is only in the page's recognised text.
 */
export default function SearchBar({ query, label, total, onQuery, onStep, onClose, onTextView = null, inputRef = null }) {
  const rootRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      closeRef.current?.();
    };
    root.addEventListener('keydown', onKeyDown);
    return () => root.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="pv-searchrow" ref={rootRef}>
      <div className="pv-search" role="search">
        <input
          ref={inputRef}
          type="search"
          className="pv-search-field"
          aria-label="Search in document"
          placeholder="Search in document"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          value={query}
          onChange={event => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          }}
        />
        <span className="pv-search-count" role="status">{label}</span>
        <IconButton icon={ChevronUp} label="Previous match" shortcut="⇧↵" keys="Shift+Enter" unavailable={!total} onClick={() => onStep(-1)} />
        <IconButton icon={ChevronDown} label="Next match" shortcut="↵" keys="Enter" unavailable={!total} onClick={() => onStep(1)} />
        <IconButton icon={X} label="Close search" shortcut="Esc" keys="Escape" tipAlign="end" onClick={onClose} />
      </div>
      {onTextView ? (
        <p className="pv-search-note">
          This page&apos;s matches are in its recognised text.{' '}
          <button type="button" className="pv-retry" onClick={onTextView}>Show in Text view</button>
        </p>
      ) : null}
    </div>
  );
}
