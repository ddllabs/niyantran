# Homepage globe 5% larger; the brief animation every time (F214)

> **Status: Living.** Owner request 2026-10-16, UI only. Built on `task/F214-globe-and-brief-animation`.

## Requests

1. "The globe and text associated to the globe on the home page needs to be 5% larger than current."
2. The animation in the "Niyantran analysis" box plays with every record that opens, "no matter
   whether the analysis and the desk brief have already been generated or whether it is being
   generated for the first time … across the entire website", as a UI change only.

## Current state

- The hero globe is F177's 105% of its column in each F212 layout. Its orbit labels have fixed pixel
  sizes, so a wider box would not make their text larger.
- The brief card (`BriefCard`, used by the record panels, `RecordDetail` and `NationalRecord`) shows
  F211's animation only while a brief is written. A stored brief shows a plain skeleton (F205) and
  lands as soon as it is read (F209); a brief seen this session shows at once.

## Outcome

1. `scale: 1.05` on the homepage globe scene (Earth, orbits, labels and pause control) from 701 px up.
   A scale takes no layout room, so the coverage box stays where it was: at 1280 x 720 its bottom is
   still at 703 px. Phones keep their size: the globe already spans the screen, and 5% more put its
   labels 6 px past a 375 px screen's edge (measured 371 -> 381 px).
2. The card plays the animation for 2.5 s each time a record's brief is shown, whether it is read,
   written now or seen earlier this session; the brief (or the unavailable/error line) appears when it
   ends, or when a slower write lands. Switching records restarts it. The fallback text says "Loading"
   for a read and "Writing" for a write. Unchanged: what is fetched and when (read first, write only
   when missing, polling, the session cache), and the brief itself.

## Evidence

- Vitest: the hook holds every answer until 2.5 s after the record opened, replays for a revisited
  record (also one reopened mid-animation), and names each state's record; the card mounts the
  animation for reading and writing, keyed by record; the globe scale and its phone reset. Each new
  test was shown failing with its change removed.
- Browser: the globe scene measured 655 -> 688 px at 1440 x 900; no horizontal scroll at 375, 768,
  1280 and 1440 px; labels clear of the persona cards at 768 px. The real hook and card on a local
  page: the animation plays during the read and the answer shows at 2.6 s; a record switch replaces
  the animation element, which starts again from its first phase.
- `npm run lint`, `npm test`, `npm run build`, `node scripts/check-bundle.mjs`.
