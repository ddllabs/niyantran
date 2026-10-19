# Owner citation and web-search checks

> **Status: Living.** Read-only investigation 2026-10-19; no further release or provider calls authorized by this audit.

Production v68 differs from v67 only in research-chat/handler.ts (bounded format
correction); web policy, agent, citation ladder/repair and viewer unchanged.

Owner's13:45UTC ISI2026 turn using Gemini2.5 Flash Lite: complete, zero citations,
one document search for generic tell-me-about-this-bill returned unrelated broad
passages; web_searches0. ISI bill record exists, keybill:2026:144, no indexed full
text found by title. Citation repair attempted and rejected for content changes.

Owner's13:47UTC Anti-Doping2025 Lite turn: complete, zero citations, two searches.
Relevant Anti-Doping document passages were found; search_desk_rows queried the
previous ISI subject and returned one row. Citation repair rejected for content.
Thus missing citations do not establish missing embeddings. Generic query/history
resolution and omitted citations need explicit quality regression coverage.

Subsequent Gemini3.8 Flash turn: complete22.203s, one search, eight citations,
web_searches0. Sources1,2,4-8 reference legacy passed-both-Houses document
ad275a72-15ad-4f79-8b2a-ab46523ecae8, source_kind=document, no stored PDF.
Source3 references stored22-page Anti-Doping as-introduced document
89b71893-778b-4180-be16-73aa6469c1e7, source_kind=pdf_page,page3,extract hash and
boxes. WorkSurface routes only pdf_page plus page_number to PageViewer; other
text sources use SourceReader. Owner screenshot opens Source6/passed version,
so a legacy highlighted text pane is expected for that citation. To exercise
PDF viewer, click Source3. Actual click/render not verified by this audit.

Hosted PDF-backed documents: Anti-Doping Amendment2025 (22 pages,81 chunks),
and Classified Information and Espionage Control2025 (12 pages,40 chunks).
Legacy variants of a bill do not inherit the uploaded PDF's page metadata.

Web facility remains present; registry does not disable either Gemini model.
Conversation override is null (automatic). Policy offers the tool for unindexed
records, but model invocation remains auto. Zero web searches in these turns
is confirmed, exact request-time offered/reason is not durably logged. Prompt
requires web context beyond fields when indexed text is absent; observed Lite
Not-in-record answers fall short of that intended outcome. Activity cannot
show an executed Web search when none occurred; Lite No-reasoning reports zero
reasoning tokens, separate from tool activity.

Existing final acceptance permits complete uncited content when evidence.size>0,
after at most one content-preserving citation repair. This predates v68 and is
not a new raw-answer fallback, but is a real quality gap for record research.
No stronger guarantee or claim of complete RAG health is warranted yet.

Next scope pending: deterministic reproductions for row-only citations, generic
query subject resolution, missing-full-text web fallback and source3 PDF render;
agree citation failure behavior and web execution requirement before changes.
No ingestion, secret, model catalogue or financial mutations performed.
