# Compact chat footer (F72)

> **Status: Historical (2026-10-04).** Owner approved proposed spacing and tint on 2026-10-04.

Current footer uses 12/16px outer vertical padding, 8px section gaps, 6px
attachment-strip padding plus 3px row padding and 8px composer padding.
Reduce these vertical gaps without horizontal or behavioral changes. Follow-up
pills use subtle theme-blue fill/border and foreground text, stronger on hover.
Keep full filenames wrapping, attached composer geometry, control sizes,
keyboard focus and horizontal question scrolling. Aim for 20–30px saved at a
representative width; measure rather than promise a universal height.
Scope: chat-presentation.css and task/docs records only. No provider, data,
backend, JavaScript behavior or production publication changes.
Acceptance: smaller footer, unchanged controls, full names visible; light/dark
readable pills, hover/focus and narrow scrolling verified in browser.
