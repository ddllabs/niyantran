# ADR 0015: Live TV fact-check captures audio by browser tab sharing

> **Status: Normative.** The owner's decision of 2026-11-15, recorded the same day. It governs the
> [Live TV fact-check spec](../specs/2026-11-15-live-tv-fact-check.md) (F344). In this record "the owner" is the
> client and "the developer" is DDL Labs.
>
> Amended 2026-11-15 (version 1 audio path).

## Context

Live TV plays YouTube videos in an embedded player. The fact-check feature needs the audio of what is playing so it
can be transcribed. A web page cannot read the audio of an embedded player from another site. Three routes exist:

1. The user shares the browser tab with audio, and the browser sends that audio to a transcription provider.
2. A server pulls the stream's audio. YouTube's developer policies name separating a video's audio as a restricted
   practice, and neither Vercel nor Supabase Edge Functions can host the long-running process it needs.
3. Broadcasters' own official streams, where they exist. Not researched.

YouTube offers no transcript we can use: caption download is for the video's owner, and there is no API for live
captions.

Route 1 sends YouTube audio from the user's browser to a third party. YouTube's terms do not clearly allow or forbid
this.

## Decision

1. Version 1 uses route 1, browser tab sharing. It works on Chromium desktop browsers only; other browsers and
   phones are told so.
2. The owner accepts the policy risk of route 1 for version 1.
3. Conditions of that acceptance:
   - capture starts only on the user's own action and the browser's own sharing prompt;
   - in version 1 audio goes from the browser to our Edge Function and through OpenRouter to the transcription model
     (ElevenLabs Scribe v2); it is held only for the length of each request and is not stored by us;
   - the full transcript is shown live and not stored; only claims, verdicts, sources and short quotes are saved;
   - route 2 is not built.

## Consequences

- The feature is unavailable on phones, Safari and Firefox until another route is decided.
- Gate G1 in the spec (tab sharing captures audio from our embed) passed on Chrome by automation on 2026-11-15; a
  manual run in ordinary Chrome is still owed.
- If YouTube or a broadcaster objects, or legal advice says otherwise, the feature is switched off by its flag and
  this record is revisited.
- Version 1 adds no new provider account; a direct streaming provider may be added later under the ADR 0002 exception.
