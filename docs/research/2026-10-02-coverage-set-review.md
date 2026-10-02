# Coverage test set: independent review and its resolution

> **Status: Historical (dated 2026-10-02).** This is the spot-check of
> `eval/agent/coverage.v1.jsonl`, which the owner delegated ("run the tests on my behalf"). A
> review agent with fresh context, not the set's author, read all 15 questions against the bills'
> full text. The review was read only.

## What the review found

**No question was fully clean, and none needed dropping.** All 15 are answerable from the bill
and phrased as a reader would ask.

**Factual misstatements: five, plus two small omissions of "or both".**
- **cov-06 p4** tied the Central Government's prosecution sanction to clause 4 alone; it applies to
  every offence.
- **cov-10 p2** gave "up to one lakh" as a general cap; it applies to sex work, smuggling and
  espionage.
- **cov-14 p2** applied double rent to public undertaking employees; it covers Central Government
  employees in Government accommodation only.
- **cov-14 p4** said "everyone else"; the clause covers any person.
- **cov-15 p1** reduced the mental conditions to "mental capacity".
- **The omissions of "or both":** cov-02 p3 and cov-06 p2.

**About 11 points lacked a passage that also states the fact,** because passages overlap. Answers
citing that passage would have been scored as missing the point.

**Gaps let an incomplete answer score full marks in 12 questions.** The most serious:
- the validity of an unregistered conversion and its effect on benefits (cov-01, clause 9);
- what a protection order does, and the Protection Officer route (cov-09);
- the Government's duties (cov-10);
- the insurer's capped liability, the owner's deposit and the new penalty (cov-11);
- who counts as a bachelor (cov-13);
- the Board's role and what "cultural heritage" means (cov-08);
- the grace period and the exemption for existing families (cov-14).

**Weak spread across the bill:** cov-04, cov-05 and cov-08, with cov-02 borderline.

**A policy question:** the Statement of Objects and Reasons and the Financial Memorandum restate
some facts, and cov-03's memorandum gives the pension as 2,500 rupees against the clause's 2,000.

## Resolution (applied, `scripts/bench-agent/coverage_build.py`)

**Every finding was applied.** The five misstatements and the two omissions were reworded.

**A point now lists several anchor phrases.** Every passage holding any of them counts, so the
overlapping passages are credited.

**New points close the gaps, adding 10 points.** Where a question would pass six points, related
points were merged:
- cov-04 killing and injury;
- cov-08 limitation and cognizability;
- cov-13 the undertaking and marrying after thirty-five.

The review suggested dropping two points to make room: cov-09's appeal and cov-11's injunction.
They were dropped.

**Policy (decided under the owner's delegation): only operative clauses count.** A bill's text
stops at its first closing heading: the Statement of Objects and Reasons, the Memorandum regarding
Delegated Legislation, the Financial Memorandum or the Annexure. Citing a restatement is not
digging into the bill, and restatements can be wrong.

**The result:**
- 15 questions, 75 points (was 65) and 85 passages, with 4 to 6 points per question;
- every new point resolves to the passages the review named, and each is pinned as an expectation
  in the builder;
- `coverage.ts` confirms each passage exists, matches its hash and holds one of its point's
  anchors.

**Consequences for the measurement:**
- **The run in progress was stopped.** 8 of 120 runs were done, at $0.32, and they are discarded:
  the results kept only the missing points, not the cited passages, so they could not be rescored.
- **Results now record `cited_chunk_ids`,** so a later change to the set can be rescored without a
  rerun.
- **The earlier headroom probe** (87.7% coverage, full 10/15) was scored against the old set. It is
  superseded.
