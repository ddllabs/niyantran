/**
 * Icon-only controls for the viewer chrome (docs/specs/2026-10-02-viewer-toolbar.md,
 * "Accessibility"). The accessible name is `aria-label`; the tooltip repeats it, with its key, for
 * sighted pointer and keyboard users and is hidden from assistive technology. Tooltips are pure
 * CSS (viewer.css, `[data-tip]`), so showing one never re-renders anything.
 */
import { ICON_PROPS } from './icons.js';

/**
 * The tooltip: the label and, when the control has one, its key.
 * @param {{label: string, shortcut?: string}} props
 */
export function Tip({ label, shortcut }) {
  return (
    <span className="pv-tip" aria-hidden="true">
      {label}
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </span>
  );
}

const tipData = (side, align) => ({ 'data-tip': '', 'data-tip-side': side, 'data-tip-align': align });

/**
 * @param {{icon: import('react').ComponentType<object>, label: string, shortcut?: string,
 *   keys?: string, tipSide?: 'below' | 'above', tipAlign?: 'center' | 'start' | 'end',
 *   unavailable?: boolean, onClick?: () => void, className?: string,
 *   ref?: import('react').Ref<HTMLButtonElement>} & object} props
 *   `shortcut` is shown in the tooltip; `keys` is the `aria-keyshortcuts` value. `unavailable`
 *   (a page or zoom limit) keeps the button focusable with `aria-disabled` and ignores presses: a
 *   `disabled` button drops the focus of the very press that reached the limit, and the paging
 *   keys are bound to these controls.
 */
export function IconButton({
  icon: Icon, label, shortcut, keys, tipSide = 'below', tipAlign = 'center', unavailable = false, onClick, className = '', ref, ...rest
}) {
  return (
    <button
      type="button"
      ref={ref}
      className={className ? `pv-icon ${className}` : 'pv-icon'}
      aria-label={label}
      aria-keyshortcuts={keys}
      aria-disabled={unavailable || undefined}
      onClick={unavailable ? undefined : onClick}
      {...tipData(tipSide, tipAlign)}
      {...rest}
    >
      <Icon {...ICON_PROPS} />
      <Tip label={label} shortcut={shortcut} />
    </button>
  );
}

/**
 * An icon-only link that opens another site in a new tab. `href` must already be a safe URL
 * (`safeSourceUrl`); the label says it opens a new tab.
 */
export function IconLink({ icon: Icon, label, href, tipSide = 'below', tipAlign = 'center' }) {
  return (
    <a className="pv-icon" href={href} target="_blank" rel="noreferrer noopener" aria-label={`${label} (opens in a new tab)`} {...tipData(tipSide, tipAlign)}>
      <Icon {...ICON_PROPS} />
      <Tip label={label} />
    </a>
  );
}
