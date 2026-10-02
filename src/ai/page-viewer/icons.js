/**
 * The viewer chrome's icons (docs/specs/2026-10-02-viewer-toolbar.md, "Design system"). Named
 * imports only, so the bundler keeps just these; and only the lazy page-viewer chunk imports this
 * module, so the main bundle does not grow. Drawn at 16 px with a 1.75 stroke, close to the app's
 * own set (src/shell/Icons.jsx, 1.7), so the viewer sits quietly beside the shell.
 */
export {
  Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, Ellipsis, ExternalLink, Maximize2, Minimize2,
  Minus, Plus, Quote, Undo2,
} from 'lucide-react';

/** The props every chrome icon is drawn with. Decorative: the control carries the label. */
export const ICON_PROPS = Object.freeze({ size: 16, strokeWidth: 1.75, 'aria-hidden': true, focusable: false });
