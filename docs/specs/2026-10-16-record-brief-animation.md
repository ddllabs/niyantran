# The client's record animation on the brief card (F211)

> **Status: Living.** Owner 2026-10-16: the client's "NTER-Record-Animation-Final" package, for the
> desk brief generation only. Built on `task/brief-animation`, after F209.

## The package

`~/Downloads/NTER-Record-Animation-Final`: a dependency-free web component, `nter-record-loader`
(Shadow DOM styles, no network, no remote assets), and the NTER logo SVG (no scripts), plus a preview
and an integration example. As shipped it replaces the whole record panel and holds every record for
at least 2.5 s, which would undo F209 (stored briefs show at once) and the client's own brief.

## Integration

- `public/animation/nter-record-loader.js` and `public/animation/logo.svg`: unchanged copies.
- `recordAnimation.js` loads the script once, on the first brief that is really being written
  (state `writing`, F209); a visit that only reads stored briefs never downloads it. A failed load
  resolves false and the card keeps its own writing look.
- The brief card's `writing` state mounts `<nter-record-loader logo-src="/animation/logo.svg">` and
  calls its `load()` with a task that only ends on cancel (the brief arrives through the hook); the
  card's own writing look is its light-DOM content, shown before the component is defined and hidden
  in its result slot while it runs. Unmounting cancels it.
- Size: the 470 px component is scaled with `zoom: 0.62` to about 470 x 337 px inside the card. Dark
  theme keeps the component's white ground (its text is dark).
- A brief written in under 2.5 s waits for the animation to finish (`RECORD_BRIEF_ANIMATION_MS`); a
  stored brief never waits, and a revisit still shows at once.

## Evidence

Vitest: the loader (one script, already-defined, failure, no document), the card (component only in
`writing`, fallback inside), the hook (a quick write waits for 2.5 s; a slow one lands at once).
Browser (local page, component mounted as the card mounts it): fallback 23 px before definition; once
defined the stage plays at 468 x 337 px, its logo loaded, phases advancing, the fallback hidden. Full
suite, lint, build (the files ship in `dist/animation`), bundle check (+9 B).
