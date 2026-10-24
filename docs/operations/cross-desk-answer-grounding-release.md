# Cross-desk answer grounding release

**Status: Living.** Production evidence for F253–F256, 25 October 2026 IST.
Scope and acceptance contract: [spec](../specs/2026-10-24-cross-desk-answer-grounding.md).
The [plan](../plans/2026-10-24-cross-desk-answer-grounding.md) retains failed
attempts and repairs. The sole open-work tracker controls closure.

## What changed

- A selected or attached record known to lack indexed text no longer widens
  automatically into unrelated document retrieval. Server-resolved mapping,
  including an explicit null mapping, controls scope and web eligibility.
  Indexed, mixed and broad research retain document search. Explicit web-off,
  provider capability and lookup-failure privacy gates remain.
- National bill provision questions use bounded synthesis from the matching
  original document version, with server-owned citations. A quotation scanner
  defect that rejected valid short quoted substitutions was repaired.
- Web synthesis discards intermediate research drafts, preserves returned
  evidence, distinguishes actual publishers from aggregators, and avoids the
  redundant missing-document nudge after a successful web search.
- Economic Simulator observation answers retain the supplied year label and
  qualify unknown period conventions and revision relationships. Provisional
  drafts are withheld; one correction fits the existing budget. V102 replaces
  lexical prose checks with exact whole-sentence/excerpt extraction and server
  rendering. The server owns record provenance and source URLs; valid sections
  survive a failed correction, while unsupported sections receive an explicit
  unavailable/omitted-evidence notice. First-answer timing records validated server release, not browser
  receipt.

These are shared research-agent boundaries, not separate autonomous desk agents.
The provision and observation checks are deliberately scoped; they are not a
universal semantic verifier. Web annotation excerpts are not independently
fetched originals. Search absence cannot prove latest status or no revisions.

## Release chain

| PR | Main commit | Function | Exact-main CI |
| --- | --- | --- | --- |
| [45](https://github.com/ddllabs/niyantran/pull/45) | `3c430a02` | research-chat v96 | `40119218095` passed |
| [46](https://github.com/ddllabs/niyantran/pull/46) | `b9ed0503` | research-chat v97 | `40121547216` passed |
| [47](https://github.com/ddllabs/niyantran/pull/47) | `af8b0cb7` | research-chat v98 | `40123909448` passed |
| [48](https://github.com/ddllabs/niyantran/pull/48) | `bc5b750e` | research-chat v99 | `40125846137` passed |
| [49](https://github.com/ddllabs/niyantran/pull/49) | `0b6609f8` | research-chat v100 | `40127591222` passed |
| [50](https://github.com/ddllabs/niyantran/pull/50) | `46ed371f` | research-chat v101 | `40129113789` passed |
| [51](https://github.com/ddllabs/niyantran/pull/51) | `bf7bf1ee` | not separately deployed | `40131065022` passed |
| [52](https://github.com/ddllabs/niyantran/pull/52) | `275c1077` | research-chat v102 | `40132050892` passed |
| [53](https://github.com/ddllabs/niyantran/pull/53) | `e4a2cf5a` | research-chat v103 | `40134772582` passed |

Both required jobs passed before each merge. Production deployment also waits
for the exact main commit's jobs. The v98 bundle matches all 42 submitted files;
its hash is `0e46945423602ce8bd5d4af48b065a317d6ccf41140d48a29c2bbbc3f97a2de4`.
The v102 bundle matches all 43 files, hash
`64e5a41845ff96f524a36807202faed7eded6c83dbdd2d6440b3e7f61160aeb8`.
An unauthenticated POST returns 401. Vercel production is READY at
`e4a2cf5a`, deployment `dpl_5hqcTytCkDTKo3MXoXRtzTLSAHBX`.
V103 matches all 43 submitted files, hash
`ddc9a6d1add66d589ec4dc408e410a02c37d3fb9461e7a8f3a64f0aaf5631dd6`;
the post-deploy unauthenticated probe returns 401.
Desk-brief remains v19; no other function was deployed in this task.

## Live NTER acceptance

All questions were submitted through the signed-in website with DeepSeek Flash,
High reasoning. Automatic web policy was left in control.

| Case | Saved assistant message | Evidence and result |
| --- | --- | --- |
| National Anti-Doping Bill, section 12 | `0cd46050-34d5-4c55-bf60-052e99c7c5fd` | v98, 64.619s; one document search, no web. Correct 2022 principal Act and clause 9 substitutions. Two citations match the introduced version's document, ranges and hashes. PDF reader opens clause 9. Passed. |
| State MLA, Satyanarayana Pithani | `df94c61e-da56-454e-877d-085512ab2178` | v98, 22.381s; three web searches, 12 pages, zero document searches. Correctly identifies aggregator/Wikipedia provenance and explicitly states no official original was returned. Directory fields checked in Record tab. Passed scoped check. |
| Law, Globiz Exim | `ef269d9c-6ffa-494a-8202-69dea5ff5a23` | v98 repeat, 72.250s; two document searches, no web. Distinguishes debtor submissions from tribunal findings and rejection with no costs. All eight source hashes/ranges match; reader opens paragraphs 7.33–7.35. Passed. |
| Economics, India GDP growth 2025 | `5dfb5a76-0ba5-4ac4-80ec-22271a6eacdc`, `7321403d-3517-4701-b31b-c6d4cf62f6e4` | v103 original question and fresh-chat repeat: 36.387s / 17.373s, three/two web searches, 13/10 pages, zero document searches. Both retain supplied 7.57 and correctly cite the World Bank definition, without period/revision inference. Both explicitly omit additional observations. Targeted follow-up `0f548fac-322a-4e71-a778-eaa1c10f2e1c` (40.487s, one search/five pages) separately cites FY27 projected 6.6%, preserves forecast status, and retains the unestablished-comparability note. Provenance/qualification checks pass; full F256 acceptance remains open. |

The State record and Economics observation were browser-supplied context,
not verified `desk_rows` citations. Do not present them as independently
confirmed database facts. The original National and Law text was checked
against retrieved chunks; no OCR or re-ingestion was performed.

## Verification and limits

Full application CI passed (423 files / 6,575 tests). The final local rerun reached 6,546 passing tests but three files encountered ENOSPC; two passed on retry and the third again encountered ENOSPC. Earlier full local application runs passed. Do not describe the final local run as wholly successful. Final runtime local checks:
`deno test -A --config supabase/functions/deno.json supabase/functions`
(1,407 tests; superseded lexical cases replaced by extraction/renderer cases), `npm run lint`, `npm run build`, router import and
`git diff --check` all pass. No standalone type-check exists or is claimed.
Regression guards were demonstrated failing before their fixes. Independent
review found no remaining code blockers. Five-desk selected/attached tests
cover missing-text scope; live acceptance is the four-case sample above.

Shared OpenRouter cache configuration remains enabled. v98 research calls
reported 7,680 cached prompt tokens for Economics and 39,424 for State.
National and the repeated Globiz turn reported zero. A configured cache is
not a guaranteed hit or speedup; routing and matching prefixes matter.
Globiz's 72.250s repeat included a 62.896s provider call; National's three
provider calls accounted for most of its 64.619s. F252 remains open for
provider-tail latency. No routing or reasoning downgrade was introduced.

Read-only corpus fingerprint comparison after the v98 repeats matched the
pre-task baseline exactly: 4,569 documents / 150,204 chunks globally;
Law 1,110 documents / 49,488 chunks / 1,439 listings. This task performs no
ingestion, re-ingestion, larger batches, listing correction or schema change.
Existing corpus growth predates this task's baseline.

Previous Economics failures are retained: v99 messages `45c8816f-cd56-44c2-8b92-dff6d69ae646` / `0e59c3be-ff13-4083-b4b4-cab00013bdd3` failed closed in 41.420s / 49.803s. Local uncertainty/URL false positives were reproduced, but discarded live text is unavailable; the exact live trigger is unknown.

V101 message `0b0ef388-c698-4762-9a50-c1480d51465d` failed closed in 42.512s after three web searches/15 pages. Exact discarded output is unavailable. Provider logs still showed cache hits (19,968 research tokens and 9,984 correction tokens); caching was not disabled. PR #51 replaces this unreliable lexical boundary rather than extending its phrase list.

V102 GDP message `1425f845-b175-4eb3-a5ce-4cd9093ef550` completed in 15.136s but omitted the requested definition; acceptance remains open. The owner-approved four-call public replay ($0.0159362) proved the definition was copied exactly from a `Long definition` table cell and rejected by the boundary check. Offline replay passes after the scoped table-format repair. No claim about the discarded v102 extraction itself is made; the diagnostic is an independent reproduction.


## Deployment and incomplete Economics acceptance — 25 October 2026 IST

F254 and F255 retain the accepted National/State/Law checks above; the later
runtime changes were limited to Economics observation handling. F256 now passes
its provenance/period-qualification contract across the original question,
fresh-chat repeat and explicit newer-information follow-up. This is not a claim
that every requested subanswer is returned: both original-question runs omitted
updates, and the follow-up omitted a definition and one unverifiable observation.
The contract permits labelled partial answers, but this does not close the requested
end-to-end acceptance. Independent review requires F256 to remain open. No single
captured v103 turn supplied both the definition and a newer observation. Do not
present these results as proof of complete extraction or universal answer quality.
The visible World Bank definition link points to the expected metadata URL;
ordinary parentheses no longer display escape characters. The follow-up link
identifies the April report, preserving its FY27 forecast rather than claiming a
revision of the selected 2025 observation.

Actual cache hits persist: the first v103 research call reports 19,968 cached
prompt tokens; its two subsequent calls report zero. F252 provider-tail latency
remains open. The final read-only counts remain 4,569 documents / 150,204 chunks,
including 1,110 Law documents / 49,488 Law chunks / 1,439 NCLT listings. No corpus,
listing, ingestion or schema writes occurred; normal chat/accounting writes did.
