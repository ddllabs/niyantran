# Scrollable desk module lists

> **Status: Living.**

Replace the released four-module More/Less interaction with a native scrolling module region. Preserve 520px card height, front images/copy, module routes, fixed reverse heading and Back footer. Scope: shared desk frame/CSS/tests only; no billing, API or production changes.

Implementation: render all module links; constrain reverse height and let only the list scroll. Use thin native scrollbars and scroll-edge shadows, keyboard focusable named region, reset scroll on close, and retain background-close behavior.

Verification: focused 245 tests, lint and build passed. Local State keyboard End reaches scrollTop 452 in a 338px viewport/791px list while every card remains 520px; reopening resets to zero. No captured warnings/errors. Local preview is UI-only. Deployment not performed.
