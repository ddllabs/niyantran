# File Manager integration audit

> **Status: Living.** Read-only source audit for the proposed Niyantran AI
> File Manager. Updated 2026-11-14. This records the local Niyantran and Tejas
> OS checkouts; it is not a live database or deployment verification.

## Purpose

Establish how the Tejas OS File Manager works, how Niyantran currently handles
identity, authorization, storage, chat attachments and retrieval, and the
constraints for a private per-user File Manager. No implementation, migration,
live query, upload or deployment was performed for this audit.

## Agreed product direction

- Each signed-in Niyantran user gets a File Manager containing that user's own
  files and folders. Another user must not see or operate on them.
- Users can upload files, create folders, browse, rename, move and delete files
  and folders, and access their files through the UI.
- Files remain in the File Manager until deleted by their user.
- Users can attach their stored files to Niyantran AI chat and ask questions
  using them.
- AI-created artifacts should be saved and visible in the same user's File
  Manager.
- Preserve existing Niyantran RBAC and shared-corpus behavior. The feature must
  add an owner-scoped area; it must not broaden or rewrite existing policies.
- User intent is to allow any file type in the uploader/storage. Storage
  acceptance and AI readability are separate: a stored file can be unsupported
  for preview, extraction or AI until a safe handler exists.

Not yet specified: storage quota and plan interaction; per-file upload size;
preview behavior for arbitrary formats; AI extraction support and limits;
AI retrieval scope when a personal file is attached; artifact format and
destination behavior; recoverable deletion/trash; and user-visible status for
unsupported or failed processing.

## Tejas OS reference module

### Entry points and UI

- Route: `sources/src/routes/_workspace/agent-hub/sources.tsx`
- Page: `sources/src/pages/Sources.tsx`
- Shell: `sources/src/components/agent-hub/files/FileManagerShell.tsx`
- Browser: `sources/src/components/agent-hub/drive/DriveBrowser.tsx`
- Main state and Supabase operations: `sources/src/hooks/useDrive.ts`
- Upload policy: `sources/src/lib/drive/uploadPolicy.ts`

The shell provides a Drive tab and Tejas-specific read-only Tender Documents
and Results PDFs tabs. The Drive UI includes folder navigation and breadcrumbs,
uploads, preview/download, rename, move, delete, bulk selection/actions, search,
index status/actions, and sharing-related controls. Tejas tender/results tabs,
agent integrations, and organisation sharing are not part of the agreed
Niyantran personal-file scope unless separately requested.

### Data and behavior

Tejas source models drives and items separately. `drive_items` carries the
parent/folder hierarchy, materialized path and depth, kind, storage bucket/path,
MIME type, byte size, content hash, upload/index state, ownership and optional
domain links. Related tables track item grants and indexing jobs. A trigger
checks that a parent is a folder in the same drive and limits nesting. A
delete RPC reports the storage paths under a subtree so the UI can remove
objects as well as rows.

Uploads are decoupled from indexing. The inspected upload policy accepts PDF,
Excel and CSV extensions/types up to 50 MiB in the
`uploaded-tender-documents` bucket. The UI creates a metadata row, uploads the
object, computes a hash, updates completion state, and optionally starts
indexing according to the parent folder policy. This is Tejas behavior, not a
Niyantran requirement or established Niyantran limit.

### Tejas authorization caveats

- The main migration `sources/supabase_migrations_archive/20261007000003_create_drives_and_file_tables.sql`
  is in an archive folder, so its presence does not show it is active in the
  deployed Tejas database.
- An earlier archived Drive migration has owner/grant helpers and policies
  that distinguish personal drives and shared/org drives. The later inspected
  migration has organisation-wide member access policies.
- The current `useDrive` bootstrap calls `ensure_my_drives()` and assigns its
  returned `org_drive_id`. The inspected later migration's `ensure_my_drives`
  provisions/returns an organisation drive, although it also defines personal
  drive constraints. Therefore the UI label “My Files” is not sufficient
  evidence of private-by-owner enforcement.
- Tejas uses organisation membership, organisation roles, grants, indexing,
  and other application services. These are not drop-in dependencies for
  Niyantran's individual-user model.

Reference source reviewed: the archived Drive schema above, the earlier
`20260821132741_1065dfad-d76c-4d66-8f51-c50c2969620.sql` Drive migration,
`20260904201049_0350a00c-2bf5-45ee-9d92-19dd714f5195.sql` delete RPC,
`src/components/agent-hub/files/FileManagerShell.tsx`,
`src/components/agent-hub/drive/DriveBrowser.tsx`, `src/hooks/useDrive.ts`,
and `src/lib/drive/uploadPolicy.ts`.

## Niyantran authorization and storage baseline

### Identity and RBAC

- Supabase Auth supplies the authenticated user id. Edge handlers verify
  bearer tokens and bind requests to that verified identity.
- Platform administration is a separate server-checked capability
  (`is_platform_admin()`); it is not inferred from client state.
- `20260921000012_profile_authority.sql` protects profile authority fields.
  Authenticated users can read profiles and update a limited personal-field
  list; trusted server roles create profiles or update role/status/entitlement
  authority.
- `20260921000015_least_privilege.sql` removes broad default/table/column
  privileges for the covered relations and grants only the required verbs to
  authenticated users or service code.

### Existing owner-scoped data

- `20260921000002_conversations.sql` scopes conversations, chat messages, and
  cancellations by `user_id = auth.uid()`.
- `20260921000013_conversation_ownership.sql` further binds message and
  cancellation rows to the matching conversation owner. Browser inserts are
  limited to user-role chat messages; server paths write assistant results.
- `20260928100000_user_preferences.sql` scopes preference reads and writes to
  the caller (no user DELETE policy).
- Invoices have owner/platform-admin reads. Credits and plan operations use
  restricted functions and server-only grants.

### Intentionally shared data

`20260921000003_corpus_and_desk.sql` enables RLS and grants authenticated
SELECT on `documents`, `document_chunks`, and `desk_rows` with read policies
whose predicate is `true`. This is intentional shared research data. It is
incompatible with user-file metadata or extracted personal content and must
not be copied for File Manager tables.

The `corpus` bucket is private and is configured in
`20261001140000_ingestion_v2.sql` with a 50,000,000-byte limit and PDF/JPEG/PNG/
WebP MIME types. `document-file` checks caller-readable corpus document and
part metadata, then uses server credentials to issue a short-lived signed URL
for a validated corpus path. Corpus upload/ingestion is a platform-admin or
trusted service workflow, not ordinary personal storage.

The repository's `backend/sql/auth_schema.sql` explicitly warns that it is
local-test bootstrap input and not the source of truth for the live database.
Migrations are the local schema record. Production migration history has
documented drift, and only live schema inspection can prove deployed policies.

### Current chat file behavior

There are two relevant paths:

1. Browser-selected or dropped files are read client-side by
   `src/lib/fileText.js` and `src/lib/aiDrop.js`; the extracted text is attached
   for a chat turn. Current limits include 25,000,000 bytes per file,
   50,000,000 bytes per drop and 12,000 characters of text sent per file.
   Read support covers PDF, spreadsheet/CSV and text; some files (including
   images and Word documents) are rejected as unreadable. This does not save a
   durable file object in a personal library.
2. The research agent resolves attached corpus document ids/keys and applies
   retrieval scope/focus rules to the shared corpus. Such ids are not
   authorization for an arbitrary user-owned storage object.

The inspected app does not establish a durable File Manager or a flow that
saves generated AI artifacts into one. Treat artifact persistence as a new
feature path, not as an existing behavior.

## Niyantran's centralized ingestion architecture

Niyantran has a centralized, queued PDF ingestion-v2 pipeline. Its single
registration contract is `ingest_register`; current sources include the admin
upload UI and approved acquisition/maintenance callers. The File Manager's
requested “Index for AI” action should enter this pipeline rather than add a
second OCR/chunk/embed implementation.

The current flow is:

1. `src/admin/DocumentsPage.jsx` and `src/lib/corpusUpload.js` prepare and
   split PDF uploads in the browser. `admin-ingest` verifies an active
   platform admin for each action and grants upload access only to fresh
   staging paths in the private `corpus` bucket.
2. `ingest_register` (migration `20261001140000_ingestion_v2.sql`) verifies
   file part hashes/sizes and registers document/file/job records. Registration
   is idempotent and uses the global `documents` identity model.
3. `ingest-worker` is called with its worker secret (and can also be driven by
   the configured schedule). It claims jobs using bounded leases, claim tokens
   and fencing; records status, retries, OCR/embedding usage and costs.
4. The OCR step obtains short-lived URLs for stored PDF parts and calls the
   configured Mistral OCR model. Page OCR is checkpointed so work can resume
   without redoing completed OCR. Image/page metadata is stored separately.
5. The index step composes page-aware text, chunks it with the shared
   `_shared/chunking.ts` contract, computes content hashes, embeds missing
   chunks through the OpenRouter embedding helper, and commits bounded slices
   through `chunk_commit`. A document is made searchable only after successful
   completion/activation.
6. `research-chat` retrieves from the shared corpus through its retrieval
   RPCs, applies attachment/focus scoping, and returns source citations.

There is also the older `ingest-documents` path for supplied OCR text. It
upserts into global `documents`, chunks and embeds text, then commits via
`chunk_commit`; it refuses page-aware documents owned by ingestion-v2. It is
not a safe shortcut for private File Manager content either.

### Reuse boundary for personal files

The v2 pipeline is centered on PDF parts and global corpus records. Its
`ingest_register`, `documents`, `document_files`, `document_chunks`,
`chunk_commit`, and current retrieval policies are not a direct personal-file
API: the corpus tables are shared-readable by authenticated users and the
document source key is global. Calling this path unchanged would conflict with
the requirement that another user cannot see or search a user's files.

The intended design constraint is therefore **one ingestion architecture,
with an owner-scoped File Manager source and persistence/retrieval boundary**:
reuse the existing queue/worker lifecycle, OCR and chunking helpers,
embedding gateway, cost logging, leases/fencing/retry discipline and progress
states; add owner validation and owner-scoped metadata/chunk/search writes and
reads for File Manager items. Do not put private chunks in the shared corpus
tables or weaken those tables' current RLS. The exact extension point (new
source kind/registration contract and persistence adapter versus another
owner-scoped job relation consumed by the same worker) belongs in the approved
design.

Storage can accept more types than the ingestion pipeline can understand. The
current v2 admin-upload path is PDF-oriented (PDF splitting, page counts and
`files/<sha256>.pdf` parts). The `corpus` bucket is private and has a 50 MB
object limit and PDF/JPEG/PNG/WebP MIME allowlist. “Accept any file type” for
File Manager storage must not be interpreted as “OCR/index every format.” The
File Manager may store unsupported objects, while exposing indexing only for
formats with an approved parser; PDF is the initial format supported by the
existing central page-aware path unless further adapters are approved.

Local evidence: `docs/specs/2026-10-01-rag-v2-ingestion-v2.md`,
`docs/specs/2026-10-01-rag-v2-admin-upload.md`,
`supabase/functions/admin-ingest/handler.ts`,
`supabase/functions/ingest-worker/{handler.ts,ocr.ts,index-step.ts}`,
`supabase/functions/ingest-documents/handler.ts`, and
`supabase/migrations/20261001140000_ingestion_v2.sql`.

## Niyantran integration constraints

1. **Keep File Manager ownership user-based.** Use the verified Supabase Auth
   user id as the owner. Do not require or infer organisation membership for
   ordinary personal files.
2. **Keep authorization across metadata and object access.** A user must not
   be able to change an owner id, parent to another user's folder, substitute
   another user's file id/path, or access another user's signed URL. RLS,
   storage object policies, RPCs, and Edge Functions must agree on ownership.
3. **Preserve current RBAC.** Do not grant the platform-admin role blanket
   access to user files by accident. Any support/admin access to private files
   would be a separate explicit policy decision.
4. **Do not reuse the shared corpus tables as the personal-file store.** Keep
   the corpus read policy and data semantics intact. If file contents need
   vectors or chunks, design owner-scoped tables/search predicates and validate
   user identity on every privileged server query.
5. **Separate storing from understanding.** “Any type” can describe the
   uploader's storage acceptance only. MIME sniffing, safe download headers,
   archive limits, preview allowlists, parser isolation, malware scanning, and
   AI extraction support require separate policies. Unknown types should be
   stored/downloadable only under a safe attachment response until supported.
6. **Keep chat references durable and checked.** Chat should send a stable
   File Manager item id, not trust browser-supplied text/path as authority.
   Server code must verify ownership and retrieve/extract the file under the
   caller's scope. Citations should identify the user's file without exposing
   storage internals.
7. **Treat AI-generated artifacts as owned files.** Persist the output and
   metadata under the requesting user, add it to that user's File Manager, and
   ensure the result remains private. Define artifact formats and folder
   destination before implementing.
8. **Define lifecycle and quota before storage launch.** Include atomic
   metadata/object cleanup, derived OCR/chunk/vector cleanup, abandoned-upload
   cleanup, user deletion behavior, and plan/storage accounting. The current
   legal-policy note says personal storage is not yet offered/priced.

## Suggested audit-to-design sequence

This is not an implementation plan or authorization to change production.

1. Obtain live, read-only inventory of NTER table/column grants, RLS enabled
   state and policies, storage buckets and `storage.objects` policies,
   migration history, and deployed Edge Function versions. Local inspection
   attempted using `.env.local`, but DNS resolution of the Supabase hostname
   failed in this execution environment; no live query succeeded.
2. Write the Niyantran-specific data contract: user-owned folders/files,
   object path scheme, ownership invariants, upload state, artifact record,
   deletion lifecycle, and whether file text/indexing is durable.
3. Write the authorization matrix and test cases before SQL: user A cannot
   list/read/download/move/delete/index/attach user B's file; forged owner,
   parent, object path and item ids fail; allowed own-file operations work;
   platform admin behavior matches existing policy.
4. Specify the chat contract: attach stored item, exact retrieval scope, file
   extraction support, citations, credit/cost limits and deletion effects.
5. Specify the UI scope based on Tejas DriveBrowser, replacing organisation,
   role, share, tender, route, chat and indexing dependencies with
   Niyantran-native contracts.
6. Decide file size/type/quota and artifact destination policies, then create
   a feature spec and implementation plan with explicit write scopes and
   disposable-local verification. Production migration/deployment requires its
   own authorization and live release gates.

## Source files reviewed

Niyantran: `supabase/migrations/20260921000002_conversations.sql`,
`20260921000003_corpus_and_desk.sql`, `20260921000012_profile_authority.sql`,
`20260921000013_conversation_ownership.sql`,
`20260921000015_least_privilege.sql`,
`20260928100000_user_preferences.sql`, `20260928140000_invoices.sql`,
`20261001140000_ingestion_v2.sql`, `supabase/functions/admin-ingest/handler.ts`,
`supabase/functions/document-file/handler.ts`,
`supabase/functions/research-chat/handler.ts`, `src/lib/fileText.js`,
`src/lib/aiDrop.js`, `src/ai/AiPanel.jsx`, and
`docs/specs/2026-10-12-legal-policies.md`.

Tejas OS: files and modules listed in “Tejas OS reference module,” plus
`sources/supabase_migrations_archive/20261007000003_create_drives_and_file_tables.sql`.
