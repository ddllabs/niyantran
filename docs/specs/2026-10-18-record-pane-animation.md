# Full selected-record loading animation

> **Status: Living.** Owner requested2026-10-18; local implementation authorized.

Current animation is confined to BriefCard in adapted, generic National and
fallback record views. Expand the same animation to occupy the selected-record
content pane while brief state is loading/writing/pending. Hide record details
until ready/unavailable/error, keeping an accessible Close record action.
Preserve hook timing/cache/polling/abort and all provider/billing behavior.
Keep outer side-panel tabs available. Citation views with generation disabled
remain unaffected; records with no AI brief retain their existing rendering.
Use the approved component at native size rather than its current0.62 zoom.
Allow vertical scrolling in short panes and shrink safely in narrow panes.
Accept: three renderer paths covered; waiting state hides detail content,
ready/error/unavailable/no-brief retain normal content; close still works;
local browser preview, focused tests, full app suite, lint and build pass.
No production auth, paid calls, backend, public/data, corpus, payment or publish.
