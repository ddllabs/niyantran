# System Execution Flows

> **Status: Living.** Describes the authoritative execution paths for authentication,
> AI research, desk brief synthesis, and data pipelines in Niyantran Terminal.

## 1. Authentication Flow: Native Google OAuth & Supabase Auth

Google authentication is handled exclusively through Supabase Auth native OAuth.
No custom token verification or server-side OAuth proxies (`google-auth-library` or `server/googleAuth.mjs`)
are used in the active execution path.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend as NTER Frontend (Vite / React)
    participant SupabaseAuth as Supabase Auth (Native OAuth)
    participant Google as Google Identity Provider
    participant DB as Supabase PostgreSQL (Source of Truth)

    User->>Frontend: Clicks "Sign in with Google" / "Sign up with Google"
    Frontend->>SupabaseAuth: supabase.auth.signInWithOAuth({ provider: 'google' })
    SupabaseAuth->>Google: Redirects to Google OAuth consent
    Google-->>User: Prompts user consent & authorization
    User->>Google: Confirms authorization
    Google-->>SupabaseAuth: Returns OAuth authorization code / callback
    SupabaseAuth->>DB: Upserts auth user & profile record
    SupabaseAuth-->>Frontend: Dispatches authenticated Supabase session
    Frontend->>Frontend: Sets session user & hydrates user preferences
    Frontend->>DB: Authorizes data queries using Supabase RLS JWT
```

**Key Execution Stages:**
1. **User Initiation:** User clicks the Google Sign-In or Sign-Up button in `GoogleSignInButton.jsx`.
2. **Direct Native Handshake:** `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })` initiates browser OAuth flow directly with Supabase.
3. **Session Establishment:** Upon return from OAuth redirect, Supabase Auth issues durable session JWTs.
4. **Authorization:** All authenticated API requests attach the Supabase bearer token. PostgreSQL RLS policies enforce tenant and role isolation.

### 1.2. Server-Side Authentication Endpoints Flow (`/api/auth/*`)

Server-side authentication endpoints in `server/authApi.mjs` provide switchable transactional email delivery (`SUPABASE_NATIVE` or `RESEND_API`) and session verification:

```mermaid
sequenceDiagram
    autonumber
    actor Client as Frontend / Client
    participant Router as API Router (/api/router.js)
    participant AuthApi as Auth API Controller (server/authApi.mjs)
    participant Supabase as Supabase Auth (Native / Admin)
    participant Resend as Resend API (When configured)

    Client->>Router: POST /api/auth/signup | resend-verification | forgot-password | login
    Router->>AuthApi: Dispatches request to handleAuthApi()
    alt Signup Flow
        AuthApi->>Supabase: Calls signUp() or admin.generateLink()
        opt RESEND_API Strategy
            AuthApi->>Resend: Dispatches branded verification HTML template
        end
        AuthApi-->>Client: Returns 201 Created with user details
    else Forgot Password Flow
        AuthApi->>Supabase: Dispatches recovery link (Anti-enumeration guaranteed)
        AuthApi-->>Client: Returns 200 OK with generic confirmation
    else Session Verification (/api/auth/me)
        AuthApi->>Supabase: Verifies Bearer token via getUser()
        AuthApi-->>Client: Returns 200 OK with authenticated user record
    end
```

---

## 2. Universal AI Research & RAG Flow

OpenRouter is the universal LLM gateway for all conversational AI, document grounding, and streaming research.
Direct LLM calls to Google Generative Language API, Gemini direct endpoints, or legacy providers are prohibited.

```mermaid
sequenceDiagram
    autonumber
    actor Analyst as Analyst / User
    participant Frontend as NTER Workspace UI
    participant Backend as NTER Backend / Edge Function
    participant VectorDB as Supabase pgvector (document_chunks)
    participant OpenRouter as OpenRouter API Gateway
    participant LLM as Target Model (e.g. Gemini 2.0 Flash / GPT-4o)

    Analyst->>Frontend: Submits research query / attachments
    Frontend->>Backend: Dispatches query payload (Edge Function / API)
    Backend->>VectorDB: Performs cosine similarity match (pgvector)
    VectorDB-->>Backend: Returns relevant document chunks & citations
    Backend->>OpenRouter: POST https://openrouter.ai/api/v1/chat/completions (System prompt, record context, user messages)
    OpenRouter->>LLM: Routes to selected model via unified gateway
    LLM-->>OpenRouter: Returns generated tokens / response
    OpenRouter-->>Backend: Streams completions with usage & model info
    Backend-->>Frontend: Delivers streaming response with verified citations
    Frontend-->>Analyst: Renders grounded research with interactive record citations
```

**Key Execution Stages:**
1. **Query Submission:** The analyst submits a research prompt with attached terminal rows, PDFs, or desk scope.
2. **RAG Retrieval:** The backend queries `public.document_chunks` using pgvector cosine similarity matching (`match_document_chunks`).
3. **Gateway Dispatch:** The backend packages the system prompt, grounding rules, extracted document text, and user messages, sending them to OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) using the server-side `OPENROUTER_API_KEY`.
4. **Model Execution & Streaming:** OpenRouter routes the request to the configured model (e.g., `google/gemini-2.0-flash-001`). The generated narrative and citation IDs stream back to the client interface.

---

## 3. Desk Brief Generation Flow

Desk briefs provide structured entity organization for selected table rows in analytical desks.
Desk briefs are generated by the server via OpenRouter and cached in local memory, SQLite/file cache for development, and persisted in database records.

```mermaid
sequenceDiagram
    autonumber
    actor Analyst as Analyst
    participant Frontend as Desk Rail / Record View
    participant Router as Backend Router (/api/ai/desk-brief)
    participant Cache as Cache Layer (Memory / Disk / DB)
    participant OpenRouter as OpenRouter API Gateway
    participant LLM as Target Model (google/gemini-2.0-flash-001)

    Analyst->>Frontend: Selects table row in desk
    Frontend->>Router: GET/POST /api/ai/desk-brief?feature=&tier=&hash=
    Router->>Cache: Checks cache for row fingerprint
    alt Cache Hit
        Cache-->>Router: Returns existing brief envelope
        Router-->>Frontend: Delivers cached desk brief
    else Cache Miss / Force Regenerate
        Router->>OpenRouter: POST https://openrouter.ai/api/v1/chat/completions (response_format: json_object, row prompt)
        OpenRouter->>LLM: Requests structured brief extraction
        LLM-->>OpenRouter: Returns JSON analysis
        OpenRouter-->>Router: Delivers structured brief payload
        Router->>Cache: Stores brief in cache
        Router-->>Frontend: Delivers synthesized brief (headline, summary, findings, KPIs)
    end
    Frontend-->>Analyst: Displays interactive desk brief in right rail
```

**Key Execution Stages:**
1. **Fingerprint Evaluation:** Stable hash generated from row fields (`entryFingerprint`).
2. **Cache Resolution:** Fast memory and disk check; if present, skips remote LLM call entirely.
3. **Structured OpenRouter Call:** When cache misses, `callOpenRouter` queries OpenRouter using `response_format: { type: 'json_object' }`.
4. **Normalization & Response:** The JSON response is normalized with server-calculated charts and returned to the frontend.
