# Why hybrid search round 1 did not beat vector-only on the held-out NCLT questions

> **Status: Historical (2026-11-04).** Task T3 of the
> [hybrid round 2 and contextual headers plan](../plans/2026-11-04-hybrid-and-contextual-retrieval.md). A read-only
> failure analysis of round 1 (`public.match_documents_hybrid` and `retrieval_internal.hybrid_keyword_ids`,
> `supabase/migrations/20261102120000_chunk_hybrid_search.sql`) on the local copy `niyantran_rehearsal_c1hybrid`.
> Round 1 is described in [the round 1 research note](2026-11-02-hybrid-search.md).
>
> **Evidence labels.** *Executed* means a query ran on the copy; the query is in the appendix as Q1 to Q6 and cited
> as [Q#]. *Offline simulation* means the fusion was recomputed in Python from lists those queries returned; the
> simulation reproduces round 1's recorded ranks first (check below), then changes one thing. *Inference* is
> reasoning from those numbers and is marked as such. Nothing here was run against NTER or a paid API.
>
> **Results files used:** `eval/retrieval/results/2026-11-03T19-34-28-271Z-c1-vector-holdout.json` (vector-only) and
> `2026-11-03T19-38-56-889Z-c1-hybrid-holdout.json` (round 1), `modes.feature.outcomes[id].docRank` and `.ranked`
> (the 40 chunk ids returned). **Question set:** `eval/retrieval/developer-questions.holdout-2026-11.jsonl` with its
> frozen vectors `developer-questions.holdout-2026-11.vectors.json`. Questions are quoted to their first ten words.

## Summary

Round 1 gained two questions in the top 10 (q-0003, q-0023) and lost two (q-0025, q-0030), so doc@10 stayed at
19 of 30. The 17 questions examined here (12 whose rank changed, 5 missed by both arms) fall into five causes:

1. **The keyword side cannot tell a name from a stray rare word, and treats both as strong evidence.** A one-word
   keyword hit that is not in the gold document still gets a fusion score equal to a vector hit of the same rank, so
   it displaces real vector hits (q-0007, q-0021, q-0024).
2. **When the name is right, the keyword order inside the company's orders is arbitrary.** `ts_rank_cd` gives a
   chunk a score by how often the word occurs, so only 1 to 7 distinct scores exist in a keyword top 100, and ties are
   broken by chunk id. Other orders of the same company (and its sister companies) take the top keyword ranks and
   outscore gold chunks the vector side had at rank 2 to 5 (q-0025, q-0027, q-0030).
3. **For 10 of the 17 the question names no party**, so there is no name for a keyword side to find; it either stays
   silent (q-0005, q-0015) or matches stray words (q-0006, q-0007, q-0009, q-0021, q-0022, q-0024 are not in the gold
   document; q-0014 and q-0017 happen to be).
4. **Round 1's gains that rest on a name** are q-0003, q-0023 and q-0028; the other two gains (q-0014, q-0017) come
   from a stray word that happens to be in the gold document.
5. **Two gold chunks are missed by the vector index itself** (q-0003, q-0022): an exact scan puts them at chunk rank
   35 and 28, but the served top 100 does not contain them.

Offline, with the same inputs: ordering the keyword candidates by similarity to the question instead of by
`ts_rank_cd` gives doc@10 **22** (round 1: 19); adding a name gate removes the stray-word damage at 21; adding a
month-and-year list for the 7 questions that state one gives **23 to 24**; none of these loses a question from the
top 10 that vector-only had there. Weights, `k`, and a smaller candidate count did not help, or helped only by accident.
This is one development set of 30 questions; differences of one to three questions are not a verdict (see Caveats).

## What was run, and how it was checked

- **Q1** called, as role `authenticated` inside `begin ... rollback`, `match_documents(vector, 100, ...)`,
  `match_documents_hybrid(vector, text, 40, ...)` and `retrieval_internal.hybrid_keyword_ids(text, null, feature)`
  for each of the 30 NCLT questions, with `desk_feature = 'NCLT / NCLAT (Insolvency)'`, `desk_tier = null`, exactly as
  `src/lib/retrievalEval.js` `rpcParams` and `scripts/eval-retrieval.mjs` do on the replica (`set role authenticated`;
  the harness sets no JWT claims either).
- **Check 1.** The 40 chunk ids from `match_documents_hybrid` equal the recorded `ranked` list of the hybrid result
  file for **30 of 30** questions.
- **Check 2.** The first 40 of `match_documents(.., 100)` equal the recorded vector-only list for 23 of 30; the other
  seven differ in one or two positions of the 40 (q-0001, q-0005, q-0010, q-0012, q-0015, q-0027, q-0028). No
  document rank differs. The recorded vector-only call asked for 40 rows, mine for 100, which is also what the hybrid
  function asks for.
- **Q2 and Q3** reproduce the helper's word selection in SQL (probe each of the first 64 words for its readable
  chunk count, apply the digit-first, rarest-first, 2,000 budget rule, then match and rank). The resulting
  chunk order equals `hybrid_keyword_ids`'s output for the first 100 rows for **30 of 30** questions.
- **Check 3.** The offline fusion (RRF, weight 1, k = 60, vector 100 rows plus keyword up to 100 rows, tie-break as
  in the function) reproduces both recorded arms' document ranks for **30 of 30** questions, so changes below are
  measured against a faithful model of round 1.
- The result files' fingerprint says 392,876 chunks and 17,603 indexed documents. Those are the counts `authenticated`
  sees; as the owner the copy holds 392,945 chunks, and 69 chunks of unpublished documents are hidden from the role
  (executed: `select count(*)` as owner and as `authenticated`, appendix Q1 note). Nothing is inconsistent.

## Per-question analysis

For every NCLT question whose rank changed or that both arms missed (17). Counts of readable chunks are from [Q2];
keyword ranks are positions in the full match list ordered as the helper orders it (`ts_rank_cd` descending, then
chunk id) from [Q3], and the helper returns only the first 100 of them; vector ranks are chunk ranks in the served
top 100 from [Q1], with the exact rank from [Q4] (`exact` counts the readable NCLT chunks nearer to the question than
the document's best chunk, plus one); the fused rank is the best gold chunk's position in the 200-row fused list,
offline from Q1 to Q3. Cause letters are explained in the table after this one.

| Question | Starts | Doc rank vector → hybrid | Kept words (readable chunks) | Gold chunks with a kept word | Best keyword rank (of matches) | Best vector chunk rank | Best fused chunk rank | Cause |
|---|---|---|---|---|---|---|---|---|
| q-0003 | Once Punjab National Bank's petition against Dhir Global Industria was ... | none → 6 | industria (19), dhir (74) | 2 of 4 | 3 of 72 | >100 (exact 35) | 6 | F |
| q-0007 | Has the NCLT Kochi bench thrown out personal guarantors' own ... | 14 → 27 | escaping (16), thrown (44) | 0 of 38 | no match | 14 | 27 | A |
| q-0013 | Why was an operational creditor's Section 9 petition against Simplex ... | none → 25 | simplex (74) | 2 of 12 | 8 of 74 | >100 (exact 176) | 25 | E |
| q-0014 | Does a creditor have a right to send a lawyer ... | 2 → 1 | lawyer (99) | 8 of 19 | 1 of 86 | 2 | 1 | G |
| q-0017 | Has the NCLT Hyderabad bench imposed costs on an operational ... | none → 12 | hiding (25), inflating (30) | 3 of 33 | 6 of 43 | >100 (exact 889) | 12 | G |
| q-0021 | Has the NCLT Hyderabad bench declined contempt proceedings because the ... | 3 → 5 | disobeyed (16) | 0 of 23 | no match | 3 | 5 | A |
| q-0023 | Why did the NCLT Chandigarh bench not let the resolution ... | none → 2 | konstruction (3), kuvam (3) | 3 of 43 | 1 of 3 | >100 (exact 209) | 2 | F |
| q-0024 | Has the NCLT Hyderabad bench halted the liquidation of a ... | 23 → none | halted (49) | 0 of 20 | no match | 23 | 45 | A |
| q-0025 | Would the NCLT Allahabad bench decide an allottee's dispute over ... | 2 → 13 | jaiprakash (96), sub-lease (99) | 10 of 33 | 24 of 169 | 2 | 13 | D |
| q-0027 | Did the NCLT Mumbai bench set aside Satra Property Developers' ... | 1 → 4 | satra (138) | 4 of 19 | 34 of 138 | 1 | 4 | D |
| q-0028 | Did the NCLT Hyderabad bench set aside the provident fund ... | 5 → 1 | sathavahana (3) | 3 of 26 | 1 of 3 | 5 | 1 | F |
| q-0030 | When was the free trade warehousing zone developer Arshiya Limited ... | 2 → 13 | arshiya (109) | 5 of 36 | 61 of 109 | 2 | 13 | D |
| q-0005 | Has the NCLT Ahmedabad bench refused to restore an operational ... | none → none | none | 0 of 9 | no matches | 96 (exact 100) | 96 | B |
| q-0006 | Why did the NCLT Ahmedabad bench reject a batch of ... | none → none | batch (163) | 0 of 117 | no match | 61 (exact 63) | 121 | C |
| q-0009 | Has the NCLT Mumbai bench dismissed a state tax department's ... | none → none | begun (78) | 0 of 14 | no match | >100 (exact 562) | none | C |
| q-0015 | In 2026, did the NCLT Mumbai bench find that a ... | none → none | none | 0 of 26 | no matches | 91 (exact 100) | 91 | B |
| q-0022 | Has the NCLT Jaipur bench allowed a resolution professional to ... | none → none | uncooperative (7) | 0 of 15 | no match | >100 (exact 28) | none | C |

"None" in a rank column means outside the 40 returned (document rank) or outside the list (chunk rank). q-0006 has
five gold documents (117 chunks in all); the others one or two.

### Causes, one line each

| Cause | Questions | Count | One-line explanation |
|---|---|---|---|
| A. Stray rare word, absent from the gold document; its matches displace vector hits | q-0007, q-0021, q-0024 | 3 | The kept words ("thrown", "disobeyed", "halted" and the like) are not in any gold chunk. Their 27, 12 and 45 matches share one or two scores; 13 of the 26, 2 of the 4 and 22 of the 44 chunks above the gold chunk in the fused list are keyword-only rows. |
| B. No rare word in the question | q-0005, q-0015 | 2 | Every word of q-0005 is in more than 300 readable chunks, so the helper keeps nothing and the arm equals vector-only. q-0015's only rare token is the hyphenated compound `leave-and-licence` (0 chunks); the gold order spells it "Leave & License" and the `simple` configuration does not stem. |
| C. Stray rare word, absent from the gold document, and the vector side itself misses | q-0006, q-0009, q-0022 | 3 | The keyword side adds nothing useful ("batch", "begun", "uncooperative"); the gold's best chunk is at exact vector rank 63, 562 and 28. q-0006's best chunk drops from 61 to 121 in the fused list. |
| D. Party named, but the company has many orders and the keyword order inside them is arbitrary | q-0025, q-0027, q-0030 | 3 | One or two scores separate the matches (3 to 4 distinct values in the top 100), and 116, 111 and 42 chunks share the score of the 100th row, so chunk id decides. Other orders of the same company or group take the top keyword ranks and outscore gold chunks that the vector side had at rank 1 to 5. In q-0030 the top 100 keyword rows come from 9 documents, gold's five matching chunks at ranks 61 to 94. |
| E. Party named and matched, but the answer-bearing content is not near the question in vector space | q-0013 | 1 | Gold's best chunk is at exact vector rank 176. The name is in 2 of its 12 chunks; the hybrid lifts the document to 25, because 7 keyword-only rows from other Simplex orders sit above it. |
| F. Party named, name in the gold chunks: the intended gain | q-0003, q-0023, q-0028 | 3 | Two of the three are in no vector top 100 (exact rank 35 and 209); the name puts them at fused rank 6 and 2. q-0028 goes from 5 to 1. |
| G. A stray rare or semantic word that happens to be in the gold document | q-0014, q-0017 | 2 | "lawyer" (8 of 19 chunks) and "inflating" (3 of 33) match the gold. q-0017 goes from none to 12 although its best chunk is at exact vector rank 889. This is a coincidence of vocabulary, not a name. |

Total 3 + 2 + 3 + 3 + 1 + 3 + 2 = 17.

Across all 30 NCLT questions [Q2, Q3]: 5 keep no word (q-0005, q-0011, q-0015, q-0016, q-0020), so round 1 equals
vector-only on them; 14 keep at least one word that is a party name (the capitalisation test below selects these 14; the title test
selects 14 too, differing on q-0004 and q-0019); 11 keep only stray words. Doc@10 is 11 of 14 in both arms for the 14 name questions and 8 of 16 in
both arms for the 16 questions that name no party: the gains and losses cancel inside each group.

## Why the fusion fails, in three mechanisms

**1. A keyword-only row counts as much as a vector row of the same rank.** Reciprocal rank fusion with weight 1 and
k = 60 gives keyword rank r the score 1/(60 + r), the same as vector rank r. A chunk found only by the keyword side
therefore ranks level with the vector side's chunk of the same rank. When the keyword matches are noise, they push
the vector's good rows down: q-0007 14 → 27, q-0024 23 → beyond 40. [Q1, Q3, offline.]

**2. The keyword rank carries almost no information beyond "contains the word".** In every question with matches,
the top 100 keyword rows hold between 1 and 7 distinct `ts_rank_cd` values, in steps of 0.1 (Q3). With the default
normalisation, one occurrence scoring 0.1 per occurrence is consistent with all of them (inference). Everything with
the same score is ordered by chunk id, a random uuid. For a name that occurs in many orders this decides which orders
reach the fusion, and the vector side's own preference between orders (gold at rank 1 to 5 in q-0025, q-0027,
q-0030) is overruled, apparently, by chunks that appear in both lists (inference: the chunks above gold's best are in the vector
top 100, and 4 of the keyword top 10 are, in q-0025; gold's own fused rank is 13, 4, 13).

**3. The rare-word test has no notion of a name.** Names pass it because they are rare, but so do ordinary words
the user happened to use: df 7 to 99 for "disobeyed", "thrown", "halted", "lawyer", "uncooperative", against 3 to 138
for the names that were kept ([Q2]; the lists in the table). No df threshold separates the two groups.

A fourth, separate finding: **the vector index misses gold chunks that an exact scan would return** in q-0003 and
q-0022 (exact rank 35 and 28, not in the served top 100; of the exact top 40, five and two chunks are not served).
[Q4 for the exact ranks; a second exact scan ordered by distance for the lists.] Hybrid cannot fix this, but a keyword
side that injects the right chunks hides it for q-0003.

## Candidate changes for round 2, with predicted effect

All numbers are **offline simulations** over the 30 NCLT development questions, from the lists of Q1 to Q6; the
vector-only arm has doc@5/10/40 of 19/19/21 and round 1 18/19/24. "Fixes" and "breaks" are questions that enter or
leave the top 10 relative to vector-only. No latency was measured: any candidate that computes a distance per keyword
match adds a read of up to 2,000 embeddings per call, which has to be timed on the copy.

| Variant | doc@5 | doc@10 | doc@40 | Fixes | Breaks |
|---|---|---|---|---|---|
| Vector-only | 19 | 19 | 21 | - | - |
| Round 1 as built | 18 | 19 | 24 | q-0003, q-0023 | q-0025, q-0030 |
| Round 1, keyword weight 0.5 | 17 | 19 | 21 | none | none |
| Round 1, keyword weight 0.25 | 19 | 19 | 21 | none | none |
| Round 1, keyword candidates cut to 50 | 18 | 19 | 24 | q-0003, q-0023 | q-0025, q-0030 |
| Round 1, keyword candidates cut to 20 | 18 | 20 | 24 | q-0003, q-0023 | q-0030 |
| Round 1, keyword candidates cut to 10 | 18 | 21 | 25 | q-0003, q-0023 | none |
| **A.** Keyword candidates ordered by similarity to the question | 22 | 22 | 24 | q-0003, q-0017, q-0023 | none |
| **A+B.** A, but only name words (capitalised in the question) | 21 | 21 | 24 | q-0003, q-0023 | none |
| **A+B'.** A, but only words that occur in 1 to 50 NCLT titles | 21 | 21 | 24 | q-0003, q-0023 | none |
| A+B, name phrase ("Satra Property Developers") instead of OR | 21 | 21 | 24 | q-0003, q-0023 | none |
| Name-gated, `ts_rank_cd` order (B without A) | 18 | 20 | 24 | q-0003, q-0023 | q-0030 |
| Name document expansion (every chunk of a document that has the name, by similarity) | 20 to 21 | 21 | 23 to 24 | q-0003, q-0023 | none |
| **C.** Vector plus month-and-year list alone | 20 | 22 | 25 | q-0003, q-0006, q-0013 | none |
| C + A+B' | 22 | 23 | 25 | q-0003, q-0006, q-0013, q-0023 | none |
| C + A (all kept words) | 23 | 24 | 25 | q-0003, q-0006, q-0013, q-0017, q-0023 | none |

(The weight rows show why weight alone cannot help: with weight below 1 a keyword-only row cannot reach the top,
so q-0003 and q-0023, which are in no vector top 100, stay missed. The constant `k` was varied only for variant A and
for the name-phrase variant, at k = 20, 60 and 100: doc@10 was 22 and 21 at every value, so `k` is not the lever.
`k` was not varied for round 1 itself.)

### Candidate A: order the keyword candidates by similarity to the question (predicted: the largest single effect)

*Change.* In `hybrid_keyword_ids`, keep the same word selection and the same match set (at most 2,000 chunks), but
rank the matches by cosine similarity to the query vector instead of `ts_rank_cd`, and return the best 100. The word
matches then decide *which* chunks are candidates and the vector decides *their order*. (The helper would need the
query vector; the invoker function already has it.)

*Predicted effect, offline.* doc@10 19 → 22, doc@5 19 → 22. Fixes q-0003 (6 → 3), q-0023, and q-0017 (none → 2).
Restores q-0025, q-0027 and q-0030 to vector ranks 2, 1 and 2 (they were 13, 4, 13). Breaks nothing at the top 10.
Does not repair the stray-word damage of cause A: q-0007 stays 27, q-0021 stays 5, q-0024 stays beyond 40. *Risk:*
q-0017's gain is cause G, a vocabulary coincidence ("inflating"), so one of the three fixes would not generalise; the
honest estimate is +2 on this set. Also q-0013 gets worse than in round 1 (25 → 30), still a miss in both.

### Candidate B: let only name words inject keyword-only rows (predicted: removes the losses, keeps the gains)

*Change.* Count a rare word only if it is probably part of a name. Two tests were simulated and agree on 13 of the
14 name questions: (i) the word is capitalised in the question away from its start, or contains a digit; (ii) the word
occurs in the titles of 1 to 50 readable NCLT documents ([Q6]: every kept name has a title count of 1 to 16 except
"palguntech" in q-0004 (0); every stray word has 0 except "anchor" in q-0019 (1), which test (i) drops). Test (ii) does not depend on how the
user types and costs one count over 7,546 titles; test (i) fails for an all-lower-case question.

*Predicted effect, offline, together with A:* doc@10 21 (A alone 22). The three stray-word questions return to
their vector ranks (q-0007 14, q-0021 3, q-0024 23); q-0003 and q-0023 stay fixed; q-0017 is no longer fixed. Net
−1 against A alone on this set, but B is the part that protects the 16 questions that name no party, and A alone
leaves three questions worse than vector-only at ranks beyond the top 5. B without A is not enough (doc@10 20, breaks
q-0030, because of the arbitrary order).

*Caveat.* Both tests were chosen after looking at these 30 questions; three questions (q-0007, q-0021, q-0024) carry
the difference. They must be checked on the sealed set before they count.

### Candidate C: a third list from the month and year the question states (predicted: the largest gain for no-party questions)

*Change.* When a question contains "<Month> <Year>", rank the chunks of NCLT documents whose `citation.order_date`
is in that month by similarity to the question and add the top 100 as a third list to the fusion (not as a filter).

*Evidence.* 7 of the 30 questions state a month and year (q-0001, q-0003, q-0006, q-0012, q-0013, q-0023, q-0026);
in all 7 the gold order's `order_date` is in that month ([Q5]). Searching only that month's documents (15 to 310
documents, 303 to 6,799 chunks) puts the gold document at document rank 1, 2, 6, 1, 3, 6, 1. Four of those are in
the 17 analysed: q-0003 (none → 2), q-0006 (none → 6, a no-party question), q-0013 (none → 3) and q-0023
(none → 6), so every currently missed one that states a month would be found. Fused as a third list with the vector
list alone: doc@10 22, fixes q-0003, q-0006, q-0013, breaks nothing; with A+B' as well: 23 (q-0023 also fixed,
q-0013 at 5); with A on all kept words: 24.

*Caveats.* It helps only questions that state a month and year (7 of 30, and 4 of the 17). It assumes that the date
in the question is the order date; a question about a petition filed in a month decided later would put the wrong
documents in the list (hence a third list, not a filter). Extracting the date needs a small parser or a model call,
and the facet exists on every NCLT chunk (plan: "Every NCLT chunk has a date facet"), which was not re-verified here.
This is a facet filter rather than a lexical match; it belongs with plan T6 only if the developer wants it in scope.

### Candidate D: the cheapest change, if A is not wanted (predicted: small, fragile)

*Change.* Cut the keyword list from 100 to 10 candidates (`c_candidates` for the keyword side only).
*Predicted effect:* doc@10 21, doc@40 25, breaks nothing here; q-0025 13 → 6, q-0030 13 → 8, q-0027 4 → 2. It works
because fewer arbitrary-order same-company chunks enter. At 20 it already breaks q-0030 and at 50 it equals round 1,
so the result depends on the size of the cut and on a tie order that is random. Not recommended over A.

### What does not help

- Fusion weight below 1 and a different `k`: no effect on the questions that matter (above).
- Phrase matching of adjacent words (the "name phrase" row) gives nothing over A+B on doc@10, but it moves two
  names: q-0013 (30 → 11, still a miss) and q-0030 (2 → 1). It also needs the same plural: the question says
  "Simplex Infrastructures", the order's title says "Simplex Infrastructure Limited", and the `simple` configuration
  does not stem; the phrase happened to match 23 chunks here.

## Which failures only contextual headers could fix

Judged from the 17 and the data above. **These are predictions, not measurements**: no header exists on the copy.

- **Cannot be fixed by a header built from the document's title, case number, date, forum, section and order type,
  unless the question states one of those**: the 10 of 17 that name no party (q-0005, q-0006, q-0007, q-0009,
  q-0014, q-0015, q-0017, q-0021, q-0022, q-0024). Of these, the header carries something the question states in
  q-0006 (March 2024), q-0015 ("In 2026") and perhaps q-0007 ("Section 94"). A date in the header helps a keyword
  match only as a token, and Candidate C already reaches the same documents from the metadata with measured results.
  q-0005, q-0009, q-0022 and q-0021 state only a bench city, which is in the case number, and the plan's header would
  carry it; whether that is enough to separate 7,546 orders is not shown.
- **What a header does change is the share of the gold document's chunks that carry the name.** In 9 of the 14 name
  questions the name is in at most a quarter of the gold document's chunks (for example 3 of 43 in q-0023, 3 of 33 in
  q-0025, 3 of 26 in q-0028, 5 of 36 in q-0030; [Q3] restricted to gold documents). In three (q-0023, q-0025, q-0028)
  the gold document's most question-like chunk does not contain the name. Round 1's gains and the offline variants
  above reach the right document through its introduction chunks; the eval scores documents, not chunks (these
  developer questions carry no gold chunk), so a header's benefit is the right *passage* of that document, which this
  set cannot show.
- **The offline emulation of a header on the keyword side only** (every chunk of a document that contains the name
  counts as a keyword match, ordered by similarity) gives doc@10 21 and doc@40 23 to 24, no better than A+B. On this
  set a header on the keyword side adds nothing at document level that A+B does not. Headers in the *embedding* are not
  simulated and could move q-0013 (name in 2 of 12 chunks, best chunk at exact rank 176); that is the one failure here
  I would call header-dependent.
- **Not a header problem:** the ANN misses (q-0003, q-0022), the arbitrary tie order (cause D) and the stray-word
  noise (cause A) are all independent of what is in the chunk text.

## Caveats and uncertainties

- **One development set, 30 NCLT questions, differences of one to three questions.** The gates and the facet list
  were chosen after seeing it. The verdict needs the sealed set (plan T2).
- The simulations take the vector list from the served top 100 (approximate index) and assume that a similarity-ordered
  keyword list can be computed in the function; neither the cost of 2,000 distance computations per call nor the effect
  on the 8 s limit was measured.
- `ts_rank_cd` giving 0.1 per occurrence is an inference from the observed values (0.1 to 0.8 in steps of 0.1), not
  checked against the PostgreSQL source.
- Exact vector ranks count readable NCLT chunks nearer than the best gold chunk. They are off by a few places from the
  served ranks where the index orders by half-precision distance (96 against 100, 91 against 100, 61 against 63).
- The cause assignment gives one primary cause per question; q-0003 and q-0022 also have the index miss.

## Out-of-scope findings (not fixed)

- **Vector index recall.** For q-0003 and q-0022 the exact top 40 contains chunks the served list lacks, including the
  gold chunk (exact rank 35 and 28). `match_documents_feature_hnsw` uses `ef_search = 400` with iterative relaxed-order
  scanning for a feature of more than 15,000 chunks. Whether this also shows on production, and whether it is worth a
  separate task, is for the supervisor.
- **Statement discipline.** The throwaway scripts created one transaction-local temporary table (`on commit drop`,
  rolled back) in the word-probe step before this was noticed; no persistent object was created, and later queries use
  inline CTEs. Reported because the task's rule said no tables.

## Appendix: the queries

All run with `docker exec -i niyantran-corpus-test-db psql -U postgres -d niyantran_rehearsal_c1hybrid -At`, each in
`begin; ...; rollback;` with `set local statement_timeout = 0` and, where noted, `set local role authenticated`.
`:text` is the question, `:vec` its frozen vector as `extensions.vector`, `:feature` is
`'NCLT / NCLAT (Insolvency)'`, `:hidden` is the owner's list of documents the publication rule does not admit
(the helper's own query):

```sql
-- :hidden
select coalesce(array_agg(d.id), '{}') from public.documents d
 where (not starts_with(d.source_key,'law:trib:IBBI_NCLT:')
        or not exists (select 1 from public.law_listing_settings where active)
        or d.id in (select public.law_published_document_ids())
        or not (d.metadata->>'origin' = 'supplied-text')) is not true;
```

**Q1. The three lists as `authenticated`** (also the check against the result files; the counts of readable chunks
are `select count(*) from public.document_chunks` as owner and after `set local role authenticated`: 392,945 and
392,876).

```sql
set local role authenticated;
select json_build_object(
  'vec', (select json_agg(json_build_array(m.id, m.document_id, m.ordinality) order by m.ordinality)
            from public.match_documents(:vec, 100, null, null, :feature) with ordinality m),
  'hyb', (select json_agg(json_build_array(m.id, m.document_id, m.ordinality) order by m.ordinality)
            from public.match_documents_hybrid(:vec, :text, 40, null, null, :feature) with ordinality m),
  'kw',  (select json_agg(json_build_array(h.id, h.keyword_rank) order by h.keyword_rank)
            from retrieval_internal.hybrid_keyword_ids(:text, null, :feature) h));
```

**Q2. The word probe** (readable chunks per word, over all features and tiers; the first 64 words of the question,
digit words first then longest, as the helper; a word is rare at 1 to 300). The budget rule is then applied to those
counts in Python exactly as the helper's loop does.

```sql
select l.lex, (select count(*) from (select 1 from public.document_chunks c
        where to_tsvector('simple'::regconfig, c.content) @@ (''''||replace(replace(l.lex,'\','\\'),'''','''''')||'''')::tsquery
          and c.document_id is not null and c.document_id not in (select unnest(:hidden))
        limit 301) z) as df
from (select x.lex from (select distinct unnest(tsvector_to_array(to_tsvector('simple'::regconfig, left(:text,4000)))) as lex) x
       order by (x.lex ~ '[0-9]') desc, length(x.lex) desc, x.lex limit 64) l;
```

**Q3. The match list for the kept words** (`:q` is the kept words joined by ` | `; the words of each chunk are
tested separately; gold chunks and their ranks are read from the result):

```sql
with m as materialized (
  select c.id, c.document_id, c.chunk_index from public.document_chunks c
   where to_tsvector('simple'::regconfig, c.content) @@ :q::tsquery and c.embedding is not null
     and c.desk_feature = :feature and c.document_id not in (select unnest(:hidden))),
adm as (select m.* from m join public.documents d on d.id = m.document_id where d.indexed_at is not null)
select a.id, a.document_id, ts_rank_cd(to_tsvector('simple'::regconfig, c.content), :q::tsquery) as rk, a.chunk_index
  from adm a join public.document_chunks c on c.id = a.id and c.desk_feature = :feature
 order by rk desc, a.id;
```

**Q4. Gold chunks and the exact vector rank** (`:gold` the gold document ids; cosine similarity per gold chunk, the
number of readable NCLT chunks nearer than the best one):

```sql
set local search_path = public, extensions;
select c.id, c.document_id, c.chunk_index, 1 - (c.embedding <=> :vec) as sim
  from public.document_chunks c where c.document_id = any(:gold) and c.desk_feature = :feature;
select 1 + count(*) from public.document_chunks c
 where c.desk_feature = :feature and c.embedding is not null and c.document_id not in (select unnest(:hidden))
   and (c.embedding <=> :vec) < 1 - :best_sim;
-- the exact top 40 and 100 lists (q-0003, q-0022, q-0014, q-0007):
select c.id, c.document_id from public.document_chunks c join public.documents d on d.id = c.document_id
 where c.desk_feature = :feature and c.embedding is not null and d.indexed_at is not null
 order by c.embedding <=> :vec, c.id limit 200;
```

**Q5. The month-and-year list** (`:ym` such as `'2024-03%'`; used for the document ranks within the month and as the
third list):

```sql
select c.id, c.document_id from public.document_chunks c
 where c.desk_feature = :feature and c.embedding is not null
   and c.document_id in (select d.id from public.documents d
         where d.desk_feature = :feature and d.indexed_at is not null and d.id not in (select unnest(:hidden))
           and d.metadata->'citation'->>'order_date' like :ym)
 order by c.embedding <=> :vec, c.id limit 100;
```

**Q6. Title counts** (for each lexeme of the question, the number of readable, indexed NCLT documents whose title
contains it):

```sql
select qw.lex, (select count(*) from public.documents d
                 where d.desk_feature = :feature and d.indexed_at is not null and d.id not in (select unnest(:hidden))
                   and to_tsvector('simple'::regconfig, d.title) @@ (''''||replace(replace(qw.lex,'\','\\'),'''','''''')||'''')::tsquery)
  from (select distinct unnest(tsvector_to_array(to_tsvector('simple'::regconfig, :text))) lex) qw;
```

Phrase queries used `phraseto_tsquery('simple', '<capitalised run containing a kept name word>')` with the Q3 shape.
The leave-and-licence check for q-0015 listed the gold document's lexemes containing `licen` (it has `license`,
`licensee`, not `licence`) and counted `phraseto_tsquery('simple','leave and licence')` (15 NCLT chunks) against
`'leave and license'` (170 NCLT chunks, 9 of them in the gold document).

**Offline simulation.** Reciprocal rank fusion of the lists as Q1 to Q6 returned them: score = sum over lists of
weight / (k + rank), ties broken by vector rank, then keyword rank, then chunk id as in `match_documents_hybrid`;
document rank = first fused chunk whose document is gold, in the first 40. The script and its intermediate JSON are
throwaway files outside the repository.
