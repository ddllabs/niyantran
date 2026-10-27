# F261: Record availability and answer presentation

> **Status: Living.** User-approved scope, 28 October 2026.

Current code conflates missing stored identity with inaccessible linked text; Parliamentary displays assert answer absence from metadata while verified OCR may exist. Cached briefs describe register fields, not retrieved answers. The saved FMBAP answer contains an indented Markdown table inside a list item, which renders as literal pipes. Earlier HTML attribution was an inference corrected by inspection of the saved response.

Expected outcome: metadata-only records remain usable as Record only, missing stored records are explained as Record snapshot, and full-text lookup errors make no absence/readiness claim. Preserve partial/full/access/privacy/web override and retrieval boundaries. Show current verified question coverage independently of register answer fields; label existing briefs as metadata analysis without regenerating them. Prefer question subjects in attachment titles and suggestions. Render nested Markdown tables as safe React nodes with citations; instruct synthesis to avoid unsupported verbatim assertions.

Acceptance: causal regression tests fail before fixes; focused and full Vitest/Deno, lint and build pass. No schema, data, dependencies or ingestion changes. This task agent performs no paid calls, production or release actions; the supervisor owns the separately authorized release after verification. Scope: corpusCoverage/AttachmentTray, deskRows/aiDrop/AiPanel identity, Parliamentary adapter/host/RecordPanel and tests, shapeQuestions/plainSourceNote if needed, AiMarkdown and research-chat prompt/tests.
