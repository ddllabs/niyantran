# F77 live dictation waveform

> **Status: Historical (dated 2026-10-04).** Owner approved the recording-strip proposal on 2026-10-04.

## Spec
Current shared microphone shows a stop square/status popover and spinner. Add genuine microphone waveform and elapsed time, explicit Cancel/Stop, and cancellable transcription within existing composer toolbar space. Preserve typed draft, no auto-send. Shared compact variant in command search. Blue accent, neutral controls, stable composer height; reduced-motion mode shows restrained audio level. Keep API, authentication, provider, billing and production untouched.
Acceptance: real stream analyser samples reflect silence/sound (no fake bars), all animation/audio resources stop on cancel/stop/context change; cancel never calls provider/inserts late text; elapsed time and accessible controls; responsive toolbar fits without height growth; transcript remains editable. Engine unit guards and actual-component browser fixture with audio samples verify states; full relevant suite/lint/build. No push/deploy without new exact authorization.

## Plan and scopes
1. src/components/dictationWaveform.js and tests: own AudioContext/analyser/rAF and timer samples; safe optional visualisation fallback.
2. src/components/dictation.js and tests: on-audio attachment and visual cleanup, cancel state notification.
3. DictationButton.jsx and dictation.css: shared inline recording/transcribing strip, canvas waveform, reduced-motion level, cancel/stop; parent-scoped toolbar replacement.
4. Focused red/green, full Vitest, lint/build; browser states/layout verification; record evidence and integrate locally. No backend changes.

## Completion evidence
Code bd37d43; reviewed actual engine/component/CSS integration and resource ownership. Waveform motion is feedback derived from signal samples; Canvas paints microphone-level history without decorative keyframes or new dependencies. Reduced-motion mode uses a level indicator; existing spinner respects reduced motion.
- New cancellation guard failed before onAudio/cleanup integration. Deliberately replacing measured energy with zero failed the signal guard; removing analyser-context cleanup failed resource guard. All mutations restored; focused 7 guards passed.
- `npm test`: 133 files / 2,103 tests passed.
- `npm run lint`: zero errors/warnings. `npm run build`: passed with existing mixed-import/large-chunk warnings. `git diff --check`: passed. No standalone typecheck exists. Backend/Deno tests not rerun: no backend/shared-library edits.
- Actual-component Chrome fixture: real browser oscillator/MediaStream/Web Audio energy sampling responds to silence and sound; rendering/cancel/elapsed/transcription/error/late-response/context switch states pass with mocked microphone/provider. No auto-send; draft preserved; original composer height retained; strip stays in viewport at 320,375,768,1440px. Reduced-motion bar verified. No page errors. Initial context-switch assertion ran before React effect cleanup; waiting for the effect passed.
- Screenshots inspected at /private/tmp/f77-recording.png. Actual user microphone and Safari remain unverified; existing F76 tracks that check. Local implementation only; F78 publication requires owner instruction. Existing backend unchanged.

## Publication (F78)
Owner instruction “pushed”: main pushed from 74e542a to 9b159f0. Vercel production dpl_BnzKVUC38fHqSxftdX2RuAjWSB9G READY, with niyantran-six.vercel.app alias, verified via deployment connector. No backend redeployment. F76 remains actual signed-in microphone acceptance.
