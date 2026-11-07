#!/usr/bin/env bash
# Run the SQL authorization fixtures against a disposable local PostgreSQL.
# Never point this at a hosted Supabase project: AGENTS.md requires a
# disposable local database for SQL authorization and migration checks, and
# several fixtures deliberately attempt privilege escalation and DDL.
#
#   ./supabase/tests/run.sh              # every fixture
#   ./supabase/tests/run.sh profile_authority conversation_ownership
#
# Requires Docker with two containers already running:
#   niyantran-recovery-db     postgres:17-alpine       (no pgvector)
#   niyantran-corpus-test-db  pgvector/pgvector:pg17   (pgvector)
#
# Each fixture gets a database created from scratch, so a run never inherits
# state from the last one. Bootstrap chains come from each fixture's header.
# Database names follow niyantran_<fixture>_test because bootstrap_auth.sql
# refuses to run anywhere else - a guard against pointing this at a real
# project. Do not relax that guard to make a name convenient.
set -euo pipefail

export PATH="$HOME/.docker/bin:$PATH"
cd "$(dirname "$0")/../.."

PLAIN=niyantran-recovery-db
VECTOR=niyantran-corpus-test-db
MIG=supabase/migrations
TESTS=supabase/tests
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 0001 without the vector extension, for the container that has no pgvector.
grep -v '^create extension if not exists vector' "$MIG/20260921000001_vector_and_email.sql" > "$WORK/0001_email_only.sql"

# 0007 without pg_cron/pg_net and without the schedule: the fixtures want only
# model_pricing_reconcile and its grants (see least_privilege.sql's header).
sed -n '22,101p' "$MIG/20260921000007_pricing_reconcile_and_schedule.sql" > "$WORK/0007_reconcile_only.sql"

# auth_schema.sql section 23 is a deliberate copy of migration 0012 ("Kept
# equivalent to..."). That makes profile_authority.sql vacuous when bootstrapped
# from it, because the guard is already installed before 0012 runs. For the
# vacuity baseline only, cut the file at that section header so the profile
# authority content is genuinely absent.
sed -n "1,$(( $(grep -n '^-- 23\. PROFILE AUTHORITY AND RPC PRIVILEGES' backend/sql/auth_schema.sql | cut -d: -f1) - 2 ))p" \
  backend/sql/auth_schema.sql > "$WORK/auth_schema_no_0012.sql"

# A migration applied as NTER applies migrations: by a role that owns the
# schema's objects but is NOT a superuser. NTER refused a function's
# `SET hnsw.ef_search` clause for exactly that reason on 2026-10-01; applied as
# the container's superuser, the same migration would pass here. The role is a
# member of postgres (so it may alter postgres's tables and replace its
# functions) and gets Supabase-style default grants, so a missing revoke still
# shows. CREATE ROLE is cluster-wide, hence the existence check.
#
#   as_non_superuser <migration file under supabase/migrations>
# writes $WORK/<name>.as_non_superuser.sql and prints its path, for chain().
as_non_superuser() {
  local name
  name="$(basename "$1" .sql)"
  {
    cat <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nter_migrator') THEN
    CREATE ROLE nter_migrator NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
  END IF;
END $$;
GRANT postgres TO nter_migrator;
GRANT CREATE ON SCHEMA public TO nter_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE nter_migrator IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE nter_migrator IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE nter_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
SET ROLE nter_migrator;
SQL
    cat "$MIG/$name.sql"
  } > "$WORK/$name.as_non_superuser.sql"
  echo "$WORK/$name.as_non_superuser.sql"
}

m() { echo "$MIG/$1"; }

# fixture name -> container, then the ordered bootstrap files.
chain() {
  case "$1" in
    admin_corpus_readiness)
      chain record_document_associations
      FILES+=("$(as_non_superuser 20261027231901_admin_corpus_readiness.sql)") ;;
    feature_search_recovery)
      chain unscoped_ef_search
      FILES+=("$(as_non_superuser 20261027185840_feature_search_recovery.sql)") ;;
    record_document_associations)
      chain law_listing
      FILES+=("$(as_non_superuser 20261027185747_record_document_associations.sql)") ;;
    pq_admission_links)
      chain record_document_associations
      FILES+=("$(as_non_superuser 20261028130000_pq_admission_links.sql)") ;;
    pq_row_refresh)
      chain pq_admission_links ;;
    # F278 step 8 (C3b): set-based registration. Phase B's chain (document_chunks_partitions: the
    # documents access-policy set, then the partitioned chunks with their facet trigger), the
    # corpus_ingest bootstrap, then the migration, as a non-superuser. The vacuity check drops the last.
    ingest_register_batch|ingest_register_text_parity|ingest_register_batch_attack)
      chain document_chunks_partitions
      FILES+=("$TESTS/bootstrap_corpus_ingest.sql" "$(as_non_superuser 20261102130000_batch_registration.sql)") ;;
    # F290: the admission lookups no longer scan the corpus. ingest_register_batch's chain, then the
    # migration, as a non-superuser. The vacuity check drops the last.
    ingest_admission_scans)
      chain ingest_register_batch
      FILES+=("$(as_non_superuser 20261106120000_admission_scans.sql)") ;;
    # F275: Bills through a sealed batch. ingest_admission_scans' chain, then the migration, as a
    # non-superuser. The vacuity check drops the last.
    ingest_bills_adapter)
      chain ingest_admission_scans
      FILES+=("$(as_non_superuser 20261107120000_bills_adapter.sql)") ;;
    # F278 step 3 (B1): document_chunks partitioned by feature. pq_admission_links' chain plus the
    # other migrations whose functions read chunks (the readiness helper, the unscoped ef_search, the
    # feature search recovery), then the migration, all as a non-superuser. The vacuity check drops
    # the last. The fixture also applies the migration again itself, after rehearsing its rollback.
    document_chunks_partitions)
      chain pq_admission_links
      FILES+=("$(as_non_superuser 20261027231901_admin_corpus_readiness.sql)" "$(as_non_superuser 20261015130000_unscoped_ef_search.sql)"
              "$(as_non_superuser 20261027185840_feature_search_recovery.sql)" "$(as_non_superuser 20261101120000_document_chunks_partitioned.sql)") ;;
    # F278 step 4 (C1): hybrid (keyword + vector) search. The partitions-and-policy pair's chain
    # (law_documents_serving_set: partitions, then the policy), then the migration, as a non-superuser.
    # The vacuity check drops the last.
    chunk_hybrid_search)
      chain law_documents_serving_set
      FILES+=("$(as_non_superuser 20261102120000_chunk_hybrid_search.sql)") ;;
    # The law publication policy on documents evaluated once per query (same rows), the second of
    # the pair: document_chunks_partitions' chain (which ends with the partitions), then the
    # migration, as a non-superuser. The vacuity check drops the last.
    law_documents_serving_set)
      chain document_chunks_partitions
      FILES+=("$(as_non_superuser 20261101130000_law_documents_serving_set.sql)") ;;
    persona_global)
      chain persona_prompts
      FILES+=("$(as_non_superuser 20261027192031_persona_global_rollout.sql)") ;;
    persona_prompts)
      CONTAINER=$PLAIN
      FILES=("$TESTS/bootstrap_auth.sql" backend/sql/auth_schema.sql "$(as_non_superuser 20261027175415_admin_persona_prompts.sql)" "$(as_non_superuser 20261027185300_persona_audit_actor_retention.sql)") ;;
    law_listing)
      chain supplied_text
      FILES+=("$(as_non_superuser 20261023184450_law_listing_publication.sql)") ;;
    supplied_text)
      chain corpus_records
      FILES+=("$(as_non_superuser 20261022230537_supplied_text_connection.sql)") ;;
    research_turn_deadline)
      chain research_turn_persistence
      FILES+=("$(as_non_superuser 20261022172302_research_turn_deadline.sql)") ;;
    billing_unused_topup_refund)
      chain billing_manual_grace
      FILES+=("$(as_non_superuser 20261021150010_billing_unused_topup_refund.sql)") ;;
    grant_paid_plan_retired)
      chain billing_unused_topup_refund
      FILES+=("$(as_non_superuser 20261031130000_retire_grant_paid_plan.sql)") ;;
    profile_authority)
      CONTAINER=$PLAIN
      FILES=("$TESTS/bootstrap_auth.sql" backend/sql/auth_schema.sql "$WORK/0001_email_only.sql" "$(m 20260921000012_profile_authority.sql)") ;;
    conversation_ownership)
      CONTAINER=$PLAIN
      FILES=("$TESTS/bootstrap_auth.sql" backend/sql/auth_schema.sql "$WORK/0001_email_only.sql" "$(m 20260921000002_conversations.sql)" "$(m 20260921000004_telemetry_and_pricing.sql)" "$(m 20260921000013_conversation_ownership.sql)") ;;
    corpus_revision_integrity)
      CONTAINER=$VECTOR
      FILES=("$TESTS/bootstrap_auth.sql" backend/sql/auth_schema.sql "$(m 20260921000001_vector_and_email.sql)" "$(m 20260921000002_conversations.sql)" "$(m 20260921000003_corpus_and_desk.sql)" "$(m 20260921000009_rag_rpcs.sql)" "$(m 20260921000014_corpus_revision_integrity.sql)") ;;
    least_privilege|research_turn_persistence|user_preferences|drop_ai_chats|analytics_events|app_flags_and_marketing_media|signup_persona|analytics_rate_limit|invoices|nter_news_articles|plan_entitlements|email_unique|inr_plans|halfvec_retrieval|feature_filter|page_contract|ingestion_v2|ingest_discard|corpus_records|search_document_pages|web_search|site_figures|ai_credits|credit_estimates_and_effort|credit_usage_reports|credit_paise_contract|credit_paise_convert|credit_paise_empty|billing_purchases|billing_creation_retry|billing_checkout_preflight|billing_plan_period_display|billing_cycle_changes|billing_daily_proration|credit_no_rollover|billing_live_cycle|billing_manual_grace|admin_model_plan|feed_records|feed_admin|feed_register_page|feed_nothing_new|feed_empty_outcome|feed_latest_run_page|unscoped_ef_search|rls_initplan_fk_indexes|desk_rows_date_range|handbook_period_ranges|record_briefs|record_brief_format)
      CONTAINER=$VECTOR
      FILES=("$TESTS/bootstrap_auth.sql" backend/sql/auth_schema.sql
             "$(m 20260921000001_vector_and_email.sql)" "$(m 20260921000002_conversations.sql)"
             "$(m 20260921000003_corpus_and_desk.sql)" "$(m 20260921000004_telemetry_and_pricing.sql)"
             "$(m 20260921000005_allowlist.sql)" "$(m 20260921000006_health_rpc.sql)"
             "$WORK/0007_reconcile_only.sql" "$(m 20260921000008_admin_models_rpc.sql)"
             "$(m 20260921000009_rag_rpcs.sql)" "$(m 20260921000010_service_role_timeout.sql)"
             "$(m 20260921000011_desk_rows_search.sql)" "$(m 20260921000012_profile_authority.sql)"
             "$(m 20260921000013_conversation_ownership.sql)" "$(m 20260921000014_corpus_revision_integrity.sql)"
             "$(m 20260921000015_least_privilege.sql)")
      [ "$1" = least_privilege ] && return 0
      FILES+=("$(m 20260921115831_research_turn_persistence.sql)")
      # Serverless-state stores (docs/plans/2026-09-28-serverless-state-to-supabase.md).
      # Each chain ends with the migration its fixture proves, for the vacuity check.
      case "$1" in
        user_preferences) FILES+=("$(m 20260928100000_user_preferences.sql)") ;;
        drop_ai_chats) FILES+=("$(m 20260928100000_user_preferences.sql)" "$(m 20260929130000_drop_ai_chats.sql)") ;;
        analytics_events) FILES+=("$(m 20260928100100_analytics_events.sql)") ;;
        app_flags_and_marketing_media)
          FILES+=("$TESTS/bootstrap_storage.sql" "$(m 20260928100200_app_flags_and_marketing_media.sql)") ;;
        signup_persona) FILES+=("$(m 20260928120000_signup_persona.sql)") ;;
        analytics_rate_limit) FILES+=("$(m 20260928130000_analytics_rate_limit.sql)") ;;
        invoices) FILES+=("$(m 20260928140000_invoices.sql)") ;;
        nter_news_articles) FILES+=("$(m 20260928150000_nter_news_articles.sql)") ;;
        plan_entitlements)
          FILES+=("$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)") ;;
        halfvec_retrieval)
          FILES+=("$(m 20260922104646_match_documents_prefilter_and_quota.sql)" "$(m 20260929120000_halfvec_index.sql)" "$(m 20260929120100_match_documents_halfvec.sql)") ;;
        # halfvec_retrieval's chain plus the feature migration; halfvec_retrieval
        # keeps guarding 20260929120100 on its own chain.
        feature_filter)
          FILES+=("$(m 20260922104646_match_documents_prefilter_and_quota.sql)" "$(m 20260929120000_halfvec_index.sql)" "$(m 20260929120100_match_documents_halfvec.sql)"
                  "$(m 20261001100000_match_documents_feature.sql)") ;;
        # feature_filter's chain plus the page contract, applied as a non-superuser.
        page_contract|ingestion_v2|ingest_discard|corpus_records|search_document_pages|unscoped_ef_search)
          FILES+=("$(m 20260922104646_match_documents_prefilter_and_quota.sql)" "$(m 20260929120000_halfvec_index.sql)" "$(m 20260929120100_match_documents_halfvec.sql)"
                  "$(m 20261001100000_match_documents_feature.sql)" "$(as_non_superuser 20261001120000_page_contract.sql)")
          # F35: page_contract's chain plus the unscoped ef_search, as a non-superuser.
          [ "$1" = unscoped_ef_search ] && FILES+=("$(as_non_superuser 20261015130000_unscoped_ef_search.sql)")
          # page_contract's chain plus the Storage stub and ingestion-v2, also
          # applied as a non-superuser; the chain ends with the migration it proves.
          case "$1" in page_contract|unscoped_ef_search) ;; *) FILES+=("$TESTS/bootstrap_storage.sql" "$(as_non_superuser 20261001140000_ingestion_v2.sql)") ;; esac
          # ingestion_v2's chain plus ingest_discard (admin-upload), as a non-superuser.
          case "$1" in ingest_discard|corpus_records|search_document_pages) FILES+=("$(as_non_superuser 20261001160000_ingest_discard.sql)") ;; esac
          # ingest_discard's chain plus corpus_records (admin-records), as a non-superuser.
          case "$1" in corpus_records|search_document_pages) FILES+=("$(as_non_superuser 20261001180000_corpus_records.sql)") ;; esac
          # corpus_records's chain plus search_document_pages and its folding fix (viewer-continuous,
          # viewer-f50), as a non-superuser. The vacuity check drops the last: the folding cases fail.
          [ "$1" = search_document_pages ] && FILES+=("$(as_non_superuser 20261002120000_search_document_pages.sql)" \
            "$(as_non_superuser 20261002180000_search_folding.sql)")
          return 0 ;;
        email_unique)
          FILES+=("$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)" "$(m 20260929110000_email_unique.sql)") ;;
        # Web search columns (F130), applied as a non-superuser; they need only 0002, 0004 and 0013.
        web_search) FILES+=("$(as_non_superuser 20261013140000_web_search.sql)") ;;
        # Live site figures (F142), applied as a non-superuser; they need only desk_rows and documents (0003).
        site_figures) FILES+=("$(as_non_superuser 20261014120000_site_figures.sql)") ;;
        # Desk-row date ranges and fields (F197): search_desk_rows as 082308 left it, then the
        # migration, as a non-superuser. The vacuity check drops the last.
        desk_rows_date_range|handbook_period_ranges)
          FILES+=("$(m 20260922082308_desk_rows_search_optional_predicates.sql)" "$(as_non_superuser 20261015210000_desk_rows_date_range.sql)")
          [ "$1" = handbook_period_ranges ] && FILES+=("$(as_non_superuser 20261017100644_handbook_period_ranges.sql)") ;;
        # Scheduled module records (F169 phase 4), applied as a non-superuser; they need only
        # is_platform_admin() and user_profiles (auth_schema.sql) for db_size().
        feed_records) FILES+=("$(as_non_superuser 20261015150000_feed_records.sql)") ;;
        # The admin's view of the feed store (F169 phase 4, C5): feed_records' chain plus
        # feed_admin_status(), applied as a non-superuser. The vacuity check drops the last.
        feed_admin) FILES+=("$(as_non_superuser 20261015150000_feed_records.sql)" "$(as_non_superuser 20261015160000_feed_admin.sql)") ;;
        # A register's first page across its variants, and a register never stale (C6 option 1):
        # feed_admin's chain plus feed_register_page, applied as a non-superuser. The vacuity check
        # drops the last.
        feed_register_page) FILES+=("$(as_non_superuser 20261015150000_feed_records.sql)" "$(as_non_superuser 20261015160000_feed_admin.sql)"
                                    "$(as_non_superuser 20261015170000_feed_register_page.sql)") ;;
        # A kept module whose source listed nothing new is a success (F196 review R2): feed_register_page's
        # chain plus feed_nothing_new, applied as a non-superuser. The vacuity check drops the last.
        feed_nothing_new|feed_empty_outcome|feed_latest_run_page) FILES+=("$(as_non_superuser 20261015150000_feed_records.sql)" "$(as_non_superuser 20261015160000_feed_admin.sql)"
                                  "$(as_non_superuser 20261015170000_feed_register_page.sql)"
                                  "$(as_non_superuser 20261015230000_feed_nothing_new.sql)")
          [ "$1" != feed_nothing_new ] && FILES+=("$(as_non_superuser 20261017094845_feed_empty_outcome.sql)")
          [ "$1" = feed_latest_run_page ] && FILES+=("$(as_non_superuser 20261017095859_feed_latest_run_page.sql)") ;;
        # P12: the twelve policies wrapped as (select auth.uid()) and eight foreign-key indexes. Every
        # table the policies and indexes name: the AI credits chain (conversations, traces, invoices,
        # plan grants, ingest jobs), applied as a non-superuser. The vacuity check drops the last.
        rls_initplan_fk_indexes)
          FILES+=("$(m 20260922104646_match_documents_prefilter_and_quota.sql)" "$(m 20260928120000_signup_persona.sql)"
                  "$(m 20260928140000_invoices.sql)" "$(m 20260929100000_plan_entitlements.sql)"
                  "$(m 20260929120000_halfvec_index.sql)" "$(m 20260929120100_match_documents_halfvec.sql)"
                  "$(m 20261001100000_match_documents_feature.sql)" "$(as_non_superuser 20261001120000_page_contract.sql)"
                  "$TESTS/bootstrap_storage.sql" "$(as_non_superuser 20261001140000_ingestion_v2.sql)"
                  "$(as_non_superuser 20261012120000_inr_plans.sql)" "$(as_non_superuser 20261013140000_web_search.sql)"
                  "$TESTS/bootstrap_ai_credits_seed.sql" "$(as_non_superuser 20261014200000_ai_credits.sql)"
                  "$(as_non_superuser 20261015190000_rls_initplan_fk_indexes.sql)") ;;
        # plan_entitlements' chain plus the INR plan set, applied as a non-superuser.
        inr_plans)
          FILES+=("$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)" "$(as_non_superuser 20261012120000_inr_plans.sql)") ;;
        # AI credits (F111): inr_plans' chain plus web search, then seeded data the
        # migration must process (a paid profile with no grant, an answer whose
        # usage carries dollars), then the credits migration. The migrations are
        # applied as a non-superuser.
        ai_credits)
          FILES+=("$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)" "$(as_non_superuser 20261012120000_inr_plans.sql)"
                  "$(as_non_superuser 20261013140000_web_search.sql)" "$TESTS/bootstrap_ai_credits_seed.sql"
                  "$(as_non_superuser 20261014200000_ai_credits.sql)") ;;
        # Model plans, credit estimates and the effort column (F150, F151, P3): the catalogue's
        # reasoning efforts (model_pricing.reasoning_efforts, which the new models' efforts come
        # from), ai_credits' chain, then the models and prices the migration must process, then
        # the migration, as a non-superuser.
        credit_estimates_and_effort)
          FILES+=("$(m 20260922121946_reasoning_efforts_from_catalogue.sql)" "$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)" "$(as_non_superuser 20261012120000_inr_plans.sql)"
                  "$(as_non_superuser 20261013140000_web_search.sql)" "$TESTS/bootstrap_ai_credits_seed.sql"
                  "$(as_non_superuser 20261014200000_ai_credits.sql)" "$TESTS/bootstrap_credit_estimates_seed.sql"
                  "$(as_non_superuser 20261014230000_credit_estimates_and_effort.sql)") ;;
        # Credits usage reports (F153): credit_estimates_and_effort's chain (model_call_logs.reasoning_effort),
        # then the reports migration, as a non-superuser.
        credit_usage_reports)
          FILES+=("$(m 20260922121946_reasoning_efforts_from_catalogue.sql)" "$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)" "$(as_non_superuser 20261012120000_inr_plans.sql)"
                  "$(as_non_superuser 20261013140000_web_search.sql)" "$TESTS/bootstrap_ai_credits_seed.sql"
                  "$(as_non_superuser 20261014200000_ai_credits.sql)" "$TESTS/bootstrap_credit_estimates_seed.sql"
                  "$(as_non_superuser 20261014230000_credit_estimates_and_effort.sql)"
                  "$(as_non_superuser 20261014233000_credit_usage_reports.sql)") ;;
        credit_paise_contract|credit_paise_convert|credit_paise_empty|billing_purchases|billing_creation_retry|billing_checkout_preflight|billing_plan_period_display|billing_cycle_changes|billing_daily_proration|credit_no_rollover|billing_live_cycle|billing_manual_grace)
          FILES+=("$(m 20260922121946_reasoning_efforts_from_catalogue.sql)" "$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)" "$(as_non_superuser 20261012120000_inr_plans.sql)"
                  "$(as_non_superuser 20261013140000_web_search.sql)" "$TESTS/bootstrap_ai_credits_seed.sql"
                  "$(as_non_superuser 20261014200000_ai_credits.sql)" "$TESTS/bootstrap_credit_estimates_seed.sql"
                  "$(as_non_superuser 20261014230000_credit_estimates_and_effort.sql)"
                  "$(as_non_superuser 20261014233000_credit_usage_reports.sql)"
                  "$(as_non_superuser 20261017194626_credit_paise_contract.sql)")
          [ "$1" = credit_paise_convert ] && FILES+=("$TESTS/credit_paise_seed.sql")
          if [ "$1" = credit_paise_convert ] || [ "$1" = credit_paise_empty ] || [ "$1" = billing_purchases ] || [ "$1" = billing_creation_retry ] || [ "$1" = billing_checkout_preflight ] || [ "$1" = billing_plan_period_display ] || [ "$1" = billing_cycle_changes ] || [ "$1" = billing_daily_proration ] || [ "$1" = credit_no_rollover ] || [ "$1" = billing_live_cycle ] || [ "$1" = billing_manual_grace ]; then
            FILES+=("$(as_non_superuser 20261017194628_credit_paise_convert.sql)")
          fi
          [[ "$1" = billing_purchases || "$1" = billing_creation_retry || "$1" = billing_checkout_preflight || "$1" = billing_plan_period_display || "$1" = billing_cycle_changes || "$1" = billing_daily_proration || "$1" = credit_no_rollover || "$1" = billing_live_cycle || "$1" = billing_manual_grace ]] && FILES+=("$(m 20260928140000_invoices.sql)" "$(as_non_superuser 20261018160700_billing_purchases.sql)")
          [[ "$1" = billing_creation_retry || "$1" = billing_checkout_preflight || "$1" = billing_plan_period_display || "$1" = billing_cycle_changes || "$1" = billing_daily_proration || "$1" = credit_no_rollover || "$1" = billing_live_cycle || "$1" = billing_manual_grace ]] && FILES+=("$(as_non_superuser 20261019000000_billing_creation_retry.sql)")
          [[ "$1" = billing_checkout_preflight || "$1" = billing_plan_period_display || "$1" = billing_cycle_changes || "$1" = billing_daily_proration || "$1" = credit_no_rollover || "$1" = billing_live_cycle || "$1" = billing_manual_grace ]] && FILES+=("$(as_non_superuser 20261019191550_billing_checkout_preflight.sql)")
          [[ "$1" = billing_plan_period_display || "$1" = billing_cycle_changes || "$1" = billing_daily_proration || "$1" = credit_no_rollover || "$1" = billing_live_cycle || "$1" = billing_manual_grace ]] && FILES+=("$(as_non_superuser 20261019194527_billing_plan_period_display.sql)")
          [[ "$1" = billing_cycle_changes || "$1" = billing_daily_proration || "$1" = credit_no_rollover || "$1" = billing_live_cycle || "$1" = billing_manual_grace ]] && FILES+=("$(as_non_superuser 20261020152221_billing_cycle_changes.sql)")
          [[ "$1" = billing_daily_proration || "$1" = credit_no_rollover || "$1" = billing_live_cycle || "$1" = billing_manual_grace ]] && FILES+=("$(as_non_superuser 20261020165347_billing_daily_proration.sql)")
          [[ "$1" = credit_no_rollover || "$1" = billing_live_cycle || "$1" = billing_manual_grace ]] && FILES+=("$(as_non_superuser 20261020211953_credit_no_rollover.sql)")
          [[ "$1" = billing_live_cycle || "$1" = billing_manual_grace ]] && FILES+=("$(as_non_superuser 20261020230745_billing_live_cycle.sql)")
          [ "$1" = billing_manual_grace ] && FILES+=("$(as_non_superuser 20261021123000_billing_manual_grace.sql)") ;;
        # The admin sets a model's plan (F155): credit_estimates_and_effort's chain (ai_models.min_plan
        # and its seeded plans), then admin_models_upsert with min_plan, as a non-superuser.
        admin_model_plan)
          FILES+=("$(m 20260922121946_reasoning_efforts_from_catalogue.sql)" "$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)" "$(as_non_superuser 20261012120000_inr_plans.sql)"
                  "$(as_non_superuser 20261013140000_web_search.sql)" "$TESTS/bootstrap_ai_credits_seed.sql"
                  "$(as_non_superuser 20261014200000_ai_credits.sql)" "$TESTS/bootstrap_credit_estimates_seed.sql"
                  "$(as_non_superuser 20261014230000_credit_estimates_and_effort.sql)"
                  "$(as_non_superuser 20261014234500_admin_model_plan.sql)") ;;
        # Stored AI record briefs (F123): ai_credits' chain (model_call_logs and the charging
        # functions the fixture proves ignore purpose 'record_brief'), the Storage stub and
        # app_flags (the kill switch), then the migration, as a non-superuser.
        record_briefs)
          FILES+=("$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)" "$(as_non_superuser 20261012120000_inr_plans.sql)"
                  "$(as_non_superuser 20261013140000_web_search.sql)" "$TESTS/bootstrap_ai_credits_seed.sql"
                  "$(as_non_superuser 20261014200000_ai_credits.sql)" "$TESTS/bootstrap_storage.sql"
                  "$(m 20260928100200_app_flags_and_marketing_media.sql)"
                  "$(as_non_superuser 20261015220000_record_briefs.sql)") ;;
        # The record brief's analysis-box format (F123, owner 2026-10-15): record_briefs' chain, then
        # 20261015240000, as a non-superuser. The vacuity check drops the last.
        record_brief_format)
          FILES+=("$(m 20260928120000_signup_persona.sql)" "$(m 20260929100000_plan_entitlements.sql)" "$(as_non_superuser 20261012120000_inr_plans.sql)"
                  "$(as_non_superuser 20261013140000_web_search.sql)" "$TESTS/bootstrap_ai_credits_seed.sql"
                  "$(as_non_superuser 20261014200000_ai_credits.sql)" "$TESTS/bootstrap_storage.sql"
                  "$(m 20260928100200_app_flags_and_marketing_media.sql)"
                  "$(as_non_superuser 20261015220000_record_briefs.sql)"
                  "$(as_non_superuser 20261015240000_record_brief_format.sql)") ;;
      esac
      return 0 ;;
    *) echo "unknown fixture: $1" >&2; return 1 ;;
  esac
}

psql_in() { docker exec -i "$CONTAINER" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q; }

# Vacuity check. Each chain ends with the migration the fixture exists to prove.
# Drop that one file and the fixture MUST fail; if it still passes, the fixture
# is asserting something that was already true and is worthless as a guard.
# corpus_revision_integrity.sql states this requirement in its own header.
vacuity_check() {
  local name="$1" db="niyantran_${1}_vac_test" rc=0
  chain "$name"
  local guard="${FILES[${#FILES[@]}-1]}"
  [ "$name" = profile_authority ] && FILES=("${FILES[@]/backend\/sql\/auth_schema.sql/$WORK/auth_schema_no_0012.sql}")
  docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $db" >/dev/null
  docker exec "$CONTAINER" psql -U postgres -q -c "create database $db" >/dev/null
  local i=0
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq ${#FILES[@]} ] && break
    psql_in "$db" < "$f" >/dev/null 2>&1 || { echo "  VACUITY: bootstrap broke at $(basename "$f")"; return 1; }
  done
  if fixture_sql "$name" | psql_in "$db" >/dev/null 2>&1; then
    echo "  VACUITY FAIL - fixture still passes without $(basename "$guard")"
    rc=1
  else
    echo "  vacuity ok - fails without $(basename "$guard")"
  fi
  docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $db" >/dev/null
  return $rc
}

# corpus_records only: two checks a fixture cannot make from inside its own
# database. Both start from the chain without the migration (base), copied.
#  * The D2 pre-check: over seeded duplicates the migration must refuse,
#    listing exactly the ingestion-v2 duplicates (legacy ones are allowed),
#    and create nothing; once they are resolved it must apply.
#  * The Down section, executed: the migration, then its header's Down block
#    as written (as the migrating role), with its two "run ...'s create
#    function" steps performed by extracting exactly those statements and
#    their revoke and grant. The schema must then dump identically to base.
corpus_records_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_corpus_records_base_test pre=niyantran_corpus_records_pre_test up=niyantran_corpus_records_up_test
  local id1=a0000000-0000-4000-8000-000000000001 id2=a0000000-0000-4000-8000-000000000002
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $pre $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $pre template $base" >/dev/null
  q "create database $up template $base" >/dev/null

  psql_in $pre >/dev/null <<SQL
insert into public.documents (id, source_key, title, content_sha256, ocr_text, storage_path, file_sha256, metadata) values
  ('$id1', 'pre-1', 'v2 duplicate', 'x', '', 'files/a.pdf', 'a', '{"document_key": "bill:1999:1"}'),
  ('$id2', 'pre-2', 'v2 duplicate', 'x', '', 'files/a.pdf', 'a', '{"document_key": "bill:1999:1"}'),
  ('a0000000-0000-4000-8000-000000000003', 'pre-3', 'legacy duplicate', 'x', '', null, null, '{"document_key": "bill:1999:2"}'),
  ('a0000000-0000-4000-8000-000000000004', 'pre-4', 'legacy duplicate', 'x', '', null, null, '{"document_key": "bill:1999:2"}'),
  ('a0000000-0000-4000-8000-000000000005', 'pre-5', 'v2 beside legacy', 'x', '', 'files/b.pdf', 'b', '{"document_key": "bill:1999:3"}'),
  ('a0000000-0000-4000-8000-000000000006', 'pre-6', 'legacy beside v2', 'x', '', null, null, '{"document_key": "bill:1999:3"}');
SQL
  local expected="ERROR:  corpus_records: ingestion-v2 documents share a document_key; resolve these before applying: bill:1999:1 -> $id1, $id2"
  if psql_in $pre < "$guard" > "$WORK/pre.txt" 2>&1; then
    echo "  PRE-CHECK FAIL - the migration applied over duplicate keys"; rc=1
  elif ! grep -qxF "$expected" "$WORK/pre.txt"; then
    echo "  PRE-CHECK FAIL - unexpected output:"; grep ERROR "$WORK/pre.txt" | head -2 | sed 's/^/    /'; rc=1
  elif [ "$(q "select to_regclass('public.corpus_admin_actions') is null and to_regprocedure('public.ingest_discard(uuid)') is not null" -d $pre)" != t ]; then
    echo "  PRE-CHECK FAIL - objects were created or replaced before the refusal"; rc=1
  else
    q "delete from public.documents where id = '$id2'" -d $pre >/dev/null
    if psql_in $pre < "$guard" >/dev/null 2>&1; then
      echo "  pre-check ok - refuses listing only ingestion-v2 duplicates, creates nothing, applies once resolved"
    else
      echo "  PRE-CHECK FAIL - the migration still refuses after the duplicate was resolved"; rc=1
    fi
  fi

  local mig="$MIG/20261001180000_corpus_records.sql"
  {
    echo 'SET ROLE nter_migrator;'
    sed -n '/^-- Down/,/^--   commit;/p' "$mig" | sed -n '/^--   begin;/,/^--   commit;/p' \
      | grep -v -e '^--   --' -e '^--   commit;' | sed 's/^--   //'
    awk '/^create function public\.ingest_register\(/,/^\$\$;/' "$MIG/20261001140000_ingestion_v2.sql"
    grep -E '^(revoke|grant) .* public\.ingest_register\(jsonb\)' "$MIG/20261001140000_ingestion_v2.sql"
    awk '/^create function public\.ingest_discard\(/,/^\$\$;/' "$MIG/20261001160000_ingest_discard.sql"
    grep -E '^(revoke|grant) .* public\.ingest_discard\(uuid\)' "$MIG/20261001160000_ingest_discard.sql"
    echo 'commit;'
  } > "$WORK/down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/down.sql" > "$WORK/down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    # (pg_dump 17.6+ brackets each dump with a random \restrict token.)
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/up.dump"
    if diff -q "$WORK/base.dump" "$WORK/up.dump" >/dev/null; then
      echo "  down ok - after the Down section the schema dumps identically to the chain without the migration"
    else
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/base.dump" "$WORK/up.dump" | head -8 | sed 's/^/    /'; rc=1
    fi
  fi
  for db in $base $pre $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# feed_records only: the migration's Down section, executed. Two databases from the chain
# without the migration: "base" gets only the non-superuser prelude (the role and its default
# privileges, which the migration file carries), "up" the migration and then its Down block as
# written, as the migrating role. The schemas must dump identically; then the migration must
# apply again on "up" and the fixture pass there.
feed_records_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_feed_records_base_test up=niyantran_feed_records_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  sed '/^SET ROLE nter_migrator;$/q' "$guard" | psql_in $base >/dev/null 2>&1

  local mig="$MIG/20261015150000_feed_records.sql"
  {
    echo 'SET ROLE nter_migrator;'
    sed -n '/^-- Down/,/^--   commit;/p' "$mig" | sed -n '/^--   begin;/,/^--   commit;/p' | sed 's/^--   //'
  } > "$WORK/feed_down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/feed_down.sql" > "$WORK/feed_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/feed_down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/feed_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/feed_up.dump"
    if ! diff -q "$WORK/feed_base.dump" "$WORK/feed_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/feed_base.dump" "$WORK/feed_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    elif ! psql_in $up < "$TESTS/feed_records.sql" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the fixture fails after Down and re-apply"; rc=1
    else
      echo "  down ok - the Down section restores the schema exactly; the migration re-applies and the fixture passes again"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# feed_admin only: the migration's Down section, executed (as feed_records_checks does). "base" is
# the chain without the migration plus its non-superuser prelude; "up" has the migration and then
# its Down block as written. The schemas must dump identically, and the migration must re-apply.
feed_admin_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_feed_admin_base_test up=niyantran_feed_admin_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  local mig="$MIG/20261015160000_feed_admin.sql"
  {
    echo 'SET ROLE nter_migrator;'
    sed -n '/^-- Down/,/^--   commit;/p' "$mig" | sed -n '/^--   begin;/,/^--   commit;/p' | sed 's/^--   //'
  } > "$WORK/feed_admin_down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/feed_admin_down.sql" > "$WORK/feed_admin_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/feed_admin_down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fa_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fa_up.dump"
    if ! diff -q "$WORK/fa_base.dump" "$WORK/fa_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/fa_base.dump" "$WORK/fa_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    else
      echo "  down ok - the Down section restores the schema exactly; the migration re-applies"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# feed_register_page only: the migration's Down section, executed (as feed_admin_checks does). Its
# Down block drops feed_page_across and feed_admin_status, then says to run feed_admin's create
# function with its revoke and grant: that step is performed by extracting exactly those statements
# from 20261015160000_feed_admin.sql (as corpus_records_checks does). The schemas must dump
# identically, then the migration must re-apply and the fixture pass again.
feed_register_page_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_feed_register_page_base_test up=niyantran_feed_register_page_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  local mig="$MIG/20261015170000_feed_register_page.sql"
  {
    echo 'SET ROLE nter_migrator;'
    sed -n '/^-- Down/,/^--   commit;/p' "$mig" | sed -n '/^--   begin;/,/^--   commit;/p' \
      | grep -v -e '^--   --' -e '^--   commit;' | sed 's/^--   //'
    awk '/^create function public\.feed_admin_status\(/,/^\$\$;/' "$MIG/20261015160000_feed_admin.sql"
    grep -E '^(revoke|grant) .* public\.feed_admin_status\(\)' "$MIG/20261015160000_feed_admin.sql"
    echo 'commit;'
  } > "$WORK/frp_down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/frp_down.sql" > "$WORK/frp_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/frp_down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/frp_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/frp_up.dump"
    if ! diff -q "$WORK/frp_base.dump" "$WORK/frp_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/frp_base.dump" "$WORK/frp_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    elif ! psql_in $up < "$TESTS/feed_register_page.sql" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the fixture fails after Down and re-apply"; rc=1
    else
      echo "  down ok - the Down section restores the schema exactly; the migration re-applies and the fixture passes again"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# feed_nothing_new only: the migration's Down section, executed (as feed_register_page_checks does). Its
# Down block drops feed_record, then says to run feed_records' create function public.feed_record: that
# step is performed by extracting exactly that statement from 20261015150000_feed_records.sql, followed by
# the block's own revoke and grant. The schemas must dump identically to the chain without the
# migration, then the migration must re-apply and the fixture pass again.
feed_nothing_new_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_feed_nothing_new_base_test up=niyantran_feed_nothing_new_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  local mig="$MIG/20261015230000_feed_nothing_new.sql"
  local block
  block="$(sed -n '/^-- Down/,/^--   commit;/p' "$mig" | sed -n '/^--   begin;/,/^--   commit;/p')"
  {
    echo 'SET ROLE nter_migrator;'
    printf '%s\n' "$block" | grep -E '^--   (begin;|drop )' | sed 's/^--   //'
    awk '/^create function public\.feed_record\(/,/^\$\$;/' "$MIG/20261015150000_feed_records.sql"
    printf '%s\n' "$block" | grep -E '^--   (revoke|grant) ' | sed 's/^--   //'
    echo 'commit;'
  } > "$WORK/fnn_down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/fnn_down.sql" > "$WORK/fnn_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/fnn_down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fnn_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fnn_up.dump"
    if ! diff -q "$WORK/fnn_base.dump" "$WORK/fnn_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/fnn_base.dump" "$WORK/fnn_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    elif ! psql_in $up < "$TESTS/feed_nothing_new.sql" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the fixture fails after Down and re-apply"; rc=1
    else
      echo "  down ok - the Down section restores the schema exactly; the migration re-applies and the fixture passes again"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# Empty outcomes: execute the self-contained Down, compare schema, reapply and retest.
feed_empty_outcome_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_feed_empty_outcome_base_test up=niyantran_feed_empty_outcome_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  local mig="$MIG/20261017094845_feed_empty_outcome.sql"
  { echo 'SET ROLE nter_migrator;'; sed -n '/^-- Down/,$p' "$mig" | sed '1d; s/^-- //'; } > "$WORK/fnn_down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/fnn_down.sql" > "$WORK/fnn_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/fnn_down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fnn_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fnn_up.dump"
    if ! diff -q "$WORK/fnn_base.dump" "$WORK/fnn_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/fnn_base.dump" "$WORK/fnn_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    elif ! psql_in $up < "$TESTS/feed_empty_outcome.sql" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the fixture fails after Down and re-apply"; rc=1
    else
      echo "  down ok - the Down section restores the schema exactly; the migration re-applies and the fixture passes again"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# Latest-run reader: the same executable Down/schema/reapply contract.
feed_latest_run_page_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_feed_latest_run_page_base_test up=niyantran_feed_latest_run_page_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  local mig="$MIG/20261017095859_feed_latest_run_page.sql"
  { echo 'SET ROLE nter_migrator;'; sed -n '/^-- Down/,$p' "$mig" | sed '1d; s/^-- //'; } > "$WORK/fnn_down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/fnn_down.sql" > "$WORK/fnn_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/fnn_down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fnn_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fnn_up.dump"
    if ! diff -q "$WORK/fnn_base.dump" "$WORK/fnn_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/fnn_base.dump" "$WORK/fnn_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    elif ! psql_in $up < "$TESTS/feed_latest_run_page.sql" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the fixture fails after Down and re-apply"; rc=1
    else
      echo "  down ok - the Down section restores the schema exactly; the migration re-applies and the fixture passes again"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# Handbook period filtering: executable Down/schema/reapply contract.
handbook_period_ranges_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_handbook_period_ranges_base_test up=niyantran_handbook_period_ranges_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  local mig="$MIG/20261017100644_handbook_period_ranges.sql"
  { echo 'SET ROLE nter_migrator;'; sed -n '/^-- Down/,$p' "$mig" | sed '1d; s/^-- //'; } > "$WORK/fnn_down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/fnn_down.sql" > "$WORK/fnn_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/fnn_down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fnn_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/fnn_up.dump"
    if ! diff -q "$WORK/fnn_base.dump" "$WORK/fnn_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/fnn_base.dump" "$WORK/fnn_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    elif ! psql_in $up < "$TESTS/handbook_period_ranges.sql" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the fixture fails after Down and re-apply"; rc=1
    else
      echo "  down ok - the Down section restores the schema exactly; the migration re-applies and the fixture passes again"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# record_briefs only: the migration's Down section, executed (as feed_admin_checks does). "base" is
# the chain without the migration; "up" has the migration and then its Down block as written. The
# schemas must dump identically, the kill-switch row must be gone, and the migration must re-apply
# and the fixture pass again.
record_briefs_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_record_briefs_base_test up=niyantran_record_briefs_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  local mig="$MIG/20261015220000_record_briefs.sql"
  {
    echo 'SET ROLE nter_migrator;'
    sed -n '/^-- Down/,/^--   commit;/p' "$mig" | sed -n '/^--   begin;/,/^--   commit;/p' | sed 's/^--   //'
  } > "$WORK/rb_down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/rb_down.sql" > "$WORK/rb_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/rb_down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/rb_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/rb_up.dump"
    if ! diff -q "$WORK/rb_base.dump" "$WORK/rb_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/rb_base.dump" "$WORK/rb_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif [ "$(q "select count(*) from public.app_flags where key = 'record_briefs'" -d $up)" != 0 ]; then
      echo "  DOWN FAIL - the kill-switch row is still there after the Down section"; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    elif ! psql_in $up < "$TESTS/record_briefs.sql" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the fixture fails after Down and re-apply"; rc=1
    else
      echo "  down ok - the Down section restores the schema exactly; the migration re-applies and the fixture passes again"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# record_brief_format only: the migration's Down section, executed, over a stored format-2 brief. Its
# block runs up to the line that says to run record_briefs' create function statements; that step is
# performed by extracting exactly those two statements from 20261015220000_record_briefs.sql; then the
# block's own revoke and grant lines. The brief must come back in the format-1 shape, the schema must
# dump identically to the chain without the migration, and the migration must re-apply and the
# fixture pass again.
record_brief_format_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_record_brief_format_base_test up=niyantran_record_brief_format_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  local mig="$MIG/20261015240000_record_brief_format.sql"
  local block
  block="$(sed -n '/^-- Down/,/^--   commit;/p' "$mig" | sed -n '/^--   begin;/,/^--   commit;/p' | sed 's/^--   //')"
  {
    echo 'SET ROLE nter_migrator;'
    printf '%s\n' "$block" | sed -n '1,/^-- run /p' | grep -v '^-- run '
    awk '/^create function public\.record_brief_(claim|finish)\(/,/^\$\$;/' "$MIG/20261015220000_record_briefs.sql"
    printf '%s\n' "$block" | sed -n '/^-- run /,$p' | grep -v '^-- run '
  } > "$WORK/rbf_down.sql"
  local seed="insert into public.record_briefs (tier, feature, row_key, hash_key, source, content_hash, status, headline, points, written_at, brief_format)
    values ('global', 'Open Fronts', 'down-1', '', 'desk_rows', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'ready', repeat('b', 400),
            '{\"why\": \"W.\", \"watch\": \"\", \"tags\": [\"T\"]}', now(), 2)"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! q "$seed" -d $up >/dev/null 2>&1; then
    echo "  DOWN FAIL - could not store a format-2 brief before the Down section"; rc=1
  elif ! psql_in $up < "$WORK/rbf_down.sql" > "$WORK/rbf_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/rbf_down.txt" | head -2 | sed 's/^/    /'; rc=1
  elif [ "$(q "select length(headline) = 300 and points = jsonb_build_array(repeat('b', 400), 'W.') from public.record_briefs where row_key = 'down-1'" -d $up)" != t ]; then
    echo "  DOWN FAIL - the format-2 brief did not come back in the format-1 shape"; rc=1
  else
    q "delete from public.record_briefs" -d $up >/dev/null
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/rbf_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/rbf_up.dump"
    if ! diff -q "$WORK/rbf_base.dump" "$WORK/rbf_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/rbf_base.dump" "$WORK/rbf_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    elif ! psql_in $up < "$TESTS/record_brief_format.sql" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the fixture fails after Down and re-apply"; rc=1
    else
      echo "  down ok - a format-2 brief returns to the format-1 shape; the schema is restored exactly; the migration re-applies and the fixture passes again"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# ingest_register_batch only (C3b), two checks a fixture cannot make from inside its own database.
#  * Parity: pq_admission_links and law_listing (and law_listing_concurrency.sh), as written, on
#    Phase B's chain (document_chunks_partitions) with and without the corpus_ingest bootstrap and
#    20261102130000.
#    Their assertions must come out the same.
#  * The Down section, executed: base is the chain without the migration; up gets the migration and
#    then its Down block as written, as the migrating role, with its three "run ..." steps performed
#    by extracting exactly those create statements (ingest_register_text's as create or replace).
#    The schemas must dump identically; then the migration must re-apply and the fixture pass again.
ingest_register_batch_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0 x db
  local base=niyantran_ingest_register_batch_base_test up=niyantran_ingest_register_batch_up_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  # supplied_text.sql is left out: its chain predates the Law wrapper, and on any chain with
  # 20261023184450 it fails (its law:hc source is held) with or without this migration.
  # ingest_register_text_parity.sql carries its messages.
  # law_listing.sql and pq_admission_links.sql keep their own chains, whose vacuity checks guard
  # their own migrations; here each runs again with this migration appended and must say exactly
  # what it says without it.
  for x in pq_admission_links law_listing; do
    for side in old new; do
      db="niyantran_${x}_${side}_batch_test"
      chain document_chunks_partitions
      [ $side = new ] && FILES+=("$TESTS/bootstrap_corpus_ingest.sql" "$guard")
      q "drop database if exists $db" >/dev/null; q "create database $db" >/dev/null
      for f in "${FILES[@]}"; do psql_in "$db" < "$f" >/dev/null 2>&1 || { echo "  PARITY FAIL - $x: bootstrap broke at $(basename "$f")"; rc=1; }; done
      fixture_sql "$x" | psql_in "$db" 2>&1 | grep -oE 'PASS .*|ERROR: .*' > "$WORK/parity_$side.txt" || true
      if [ $side = new ] && [ "$x" = law_listing ] && ! sed "s/^DB=niyantran_law_listing_test$/DB=$db/" "$TESTS/law_listing_concurrency.sh" | bash > "$WORK/parity.txt" 2>&1; then
        echo "  PARITY FAIL - law_listing_concurrency.sh fails on the batch-registration migration:"; tail -3 "$WORK/parity.txt" | sed 's/^/    /'; rc=1
      fi
      q "drop database if exists $db" >/dev/null
    done
    if ! cmp -s "$WORK/parity_old.txt" "$WORK/parity_new.txt" || grep -q '^ERROR' "$WORK/parity_new.txt" || ! [ -s "$WORK/parity_new.txt" ]; then
      echo "  PARITY FAIL - $x.sql differs on the batch-registration migration:"; diff "$WORK/parity_old.txt" "$WORK/parity_new.txt" | head -4 | sed 's/^/    /'; rc=1
    fi
  done
  [ $rc -eq 0 ] && echo "  parity ok - pq_admission_links.sql and law_listing.sql identical with and without the migration; law_listing_concurrency.sh passes on it"
  chain ingest_register_batch
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  q "create database $up template $base" >/dev/null
  local mig="$MIG/20261102130000_batch_registration.sql"
  {
    echo 'SET ROLE nter_migrator;'
    sed -n '/^-- Down/,/^--   commit;/p' "$mig" | sed -n '/^--   begin;/,/^--   commit;/p' \
      | grep -v -e '^--   --' -e '^--   commit;' | sed 's/^--   //'
    awk '/^create or replace function public\.ingest_claim\(/,/^\$\$;/' "$MIG/20261022230537_supplied_text_connection.sql"
    awk '/^create or replace function public\.ingest_register_text_unmapped\(/,/\$\$;[[:space:]]*$/' "$MIG/20261028130000_pq_admission_links.sql"
    awk '/^create function public\.ingest_register_text\(/,/\$\$;[[:space:]]*$/' "$MIG/20261023184450_law_listing_publication.sql" \
      | sed '1s/^create function/create or replace function/'
    echo 'commit;'
  } > "$WORK/irb_down.sql"
  if ! psql_in $up < "$guard" >/dev/null 2>&1; then
    echo "  DOWN FAIL - the migration did not apply"; rc=1
  elif ! psql_in $up < "$WORK/irb_down.sql" > "$WORK/irb_down.txt" 2>&1; then
    echo "  DOWN FAIL - the Down section did not run:"; grep ERROR "$WORK/irb_down.txt" | head -2 | sed 's/^/    /'; rc=1
  else
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $base | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/irb_base.dump"
    docker exec "$CONTAINER" pg_dump -U postgres --schema-only $up | grep -v -e '^\\restrict ' -e '^\\unrestrict ' > "$WORK/irb_up.dump"
    if ! diff -q "$WORK/irb_base.dump" "$WORK/irb_up.dump" >/dev/null; then
      echo "  DOWN FAIL - the schema differs after the Down section:"; diff "$WORK/irb_base.dump" "$WORK/irb_up.dump" | head -8 | sed 's/^/    /'; rc=1
    elif ! psql_in $up < "$guard" >/dev/null 2>&1; then
      echo "  DOWN FAIL - the migration did not apply again after the Down section"; rc=1
    elif ! psql_in $up < "$TESTS/ingest_register_batch.sql" > "$WORK/irb_again.txt" 2>&1; then
      echo "  DOWN FAIL - the fixture fails after Down and re-apply:"; grep -E 'ERROR|FAIL' "$WORK/irb_again.txt" | head -2 | sed 's/^/    /'; rc=1
    else
      echo "  down ok - the Down section restores the schema exactly; the migration re-applies and the fixture passes again"
    fi
  fi
  for db in $base $up; do q "drop database if exists $db" >/dev/null; done
  return $rc
}

# document_chunks_partitions only: the partition migration's preconditions refuse what it would
# otherwise drop silently. From the chain without the migration (base), one copy per anomaly: inject
# it, apply the migration, and require the named refusal with nothing changed. The untouched base
# must then apply.
document_chunks_partitions_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0
  local base=niyantran_dcp_base_test try=niyantran_dcp_try_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for db in $base $try; do q "drop database if exists $db" >/dev/null; done
  q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  CHECKS: bootstrap broke at $(basename "$f")"; return 1; }
  done
  local cases=(
    "grant select on public.document_chunks to anon|has grants this migration does not carry over"
    "grant references on public.document_chunks to authenticated|has grants this migration does not carry over"
    "grant select (content) on public.document_chunks to anon|has column grants"
    "alter table public.document_chunks set (fillfactor = 90)|or one of its indexes has storage parameters"
    "alter table public.document_chunks alter column content set storage external|has a column storage or compression setting"
    "alter table public.document_chunks alter column metadata set compression pglz|has a column storage or compression setting"
    "alter index public.document_chunks_embedding_halfvec_hnsw set (m = 24)|or one of its indexes has storage parameters"
  )
  local c sql want
  for c in "${cases[@]}"; do
    sql="${c%%|*}"; want="${c#*|}"
    q "drop database if exists $try" >/dev/null; q "create database $try template $base" >/dev/null
    q "$sql" -d $try >/dev/null 2>&1 || { echo "  PRECONDITION CHECK: could not inject: $sql"; rc=1; continue; }
    if psql_in $try < "$guard" > "$WORK/dcp.txt" 2>&1; then
      echo "  PRECONDITION FAIL - applied over: $sql"; rc=1
    elif ! grep -q "document_chunks_partitioned: .*$want" "$WORK/dcp.txt"; then
      echo "  PRECONDITION FAIL - $sql: unexpected output:"; grep ERROR "$WORK/dcp.txt" | head -1 | sed 's/^/    /'; rc=1
    elif [ "$(q "select relkind from pg_class where oid = 'public.document_chunks'::regclass" -d $try)" != r ]; then
      echo "  PRECONDITION FAIL - $sql: document_chunks changed although the migration refused"; rc=1
    fi
  done
  q "drop database if exists $try" >/dev/null
  if [ $rc -eq 0 ]; then
    if psql_in $base < "$guard" >/dev/null 2>&1 && [ "$(q "select relkind from pg_class where oid = 'public.document_chunks'::regclass" -d $base)" = p ]; then
      echo "  preconditions ok - ${#cases[@]} anomalies refused by name, nothing changed; the untouched chain applies"
    else
      echo "  PRECONDITION FAIL - the untouched chain did not apply"; rc=1
    fi
  fi
  q "drop database if exists $base" >/dev/null
  return $rc
}
# chunk_hybrid_search only. Schema retrieval_internal holds the keyword helper, a security definer function that
# reads every chunk, so it must never be exposed through the API: supabase/config.toml's [api] schemas and
# extra_search_path must not name it. Proved non-vacuous: the same check on a copy with it added must see it.
# (The hosted project's "Exposed schemas" setting is the production counterpart and is checked by hand.)
hybrid_exposure_check() {
  local cfg=supabase/config.toml
  api_schemas() { sed -n '/^\[api\]/,/^\[/p' "$1" | grep -E '^(schemas|extra_search_path)[[:space:]]*='; }
  if ! api_schemas "$cfg" | grep -q '"public"'; then
    echo "  EXPOSURE FAIL - could not read [api] schemas from $cfg"; return 1
  fi
  sed 's/^schemas = \[/schemas = ["retrieval_internal", /' "$cfg" > "$WORK/config_hybrid.toml"
  if ! api_schemas "$WORK/config_hybrid.toml" | grep -q '"retrieval_internal"'; then
    echo "  EXPOSURE FAIL - the check cannot see a schema added to [api] schemas"; return 1
  fi
  if api_schemas "$cfg" | grep -q '"retrieval_internal"'; then
    echo "  EXPOSURE FAIL - schema retrieval_internal is exposed through the API in $cfg"; return 1
  fi
  echo "  exposure ok - schema retrieval_internal is not in [api] schemas or extra_search_path (and the check sees it when added)"
}

# chunk_hybrid_search only: the migration must not touch the billing and credits schema (named private, created by
# the credits migrations; hard-stop scope). Three checks.
#  * The migration names no schema called private, not even in a comment, and no other migration uses the name
#    retrieval_internal (CREATE SCHEMA has no IF NOT EXISTS, so a clash would fail, not reuse).
#  * ACLs: the schema's, every function's and every relation's in private, before and after the migration, on the
#    chain without it. The hybrid chain does not include the credits migrations, so a stand-in is created first:
#    the schema with the credits migration's own revoke, a table and a security definer function with the default
#    (PUBLIC execute) ACL, so a stray grant or revoke on anything in private shows. The same snapshot must differ
#    when a grant is added by hand (proof the check can see one).
# chunk_hybrid_search only: the migration's last statement runs the helper's policy check on the database being
# migrated. On a database whose access policies differ from the helper's list it must fail with 55000 and leave
# nothing behind (one transaction); the same run without the drift must apply (so the check is not vacuous).
hybrid_drift_rollback_check() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i f drift out left rc_m
  local db=niyantran_chunk_hybrid_search_drift_test
  local objs="select (select count(*) from pg_namespace where nspname = 'retrieval_internal')
                   + (select count(*) from pg_class where relname = 'document_chunks_content_tsv')
                   + (select count(*) from pg_proc where proname in ('hybrid_candidate_ids', 'match_documents_hybrid'))"
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  for drift in "alter policy law_documents_serving on public.documents rename to law_documents_serving_x" ""; do
    q "drop database if exists $db" >/dev/null; q "create database $db" >/dev/null
    i=0
    for f in "${FILES[@]}"; do
      i=$((i+1)); [ $i -eq $n ] && break
      psql_in $db < "$f" >/dev/null 2>&1 || { echo "  DRIFT: bootstrap broke at $(basename "$f")"; q "drop database if exists $db" >/dev/null; return 1; }
    done
    [ -n "$drift" ] && q "$drift" -d $db >/dev/null
    out="$({ echo '\set VERBOSITY verbose'; cat "$guard"; } | psql_in $db 2>&1)" && rc_m=0 || rc_m=$?
    left="$(q "$objs" -d $db)"
    q "drop database if exists $db" >/dev/null
    if [ -n "$drift" ]; then
      if [ $rc_m -eq 0 ] || ! grep -q 'ERROR:  55000: keyword search unavailable' <<<"$out" || [ "$left" != 0 ]; then
        echo "  DRIFT FAIL - on a drifted database the migration must fail with 55000 and leave nothing (exit $rc_m, objects left $left)"; return 1
      fi
    elif [ $rc_m -ne 0 ] || [ "$left" != 4 ]; then
      echo "  DRIFT FAIL - without drift the migration did not apply (exit $rc_m, objects $left)"; return 1
    fi
  done
  echo "  drift ok - a drifted database refuses the migration with 55000 and keeps nothing; without drift it applies"
}

# chunk_hybrid_search only: the fixture's guards, each proved against the defect it guards. The migration is mutated once per
# defect (a perl substitution on the as-non-superuser copy; a mutation that changes nothing fails the check, so a reworded
# migration cannot make a mutation silently vanish). Each mutated migration must still APPLY, and the fixture must then
# FAIL on one of its own assertions ("FAIL:"), not on an error. Round 2 added the title gate, the month list and the
# similarity order to the helper; the paths that read rows (the probe, the titles, the keyword scan, the month scan) must each
# keep hidden documents out, which is why each exclusion has its own mutation. The chain without the migration is built once
# and copied for each mutation.
hybrid_mutation_checks() {
  local guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f rc=0 k out
  local base=niyantran_chunk_hybrid_search_mutbase_test db=niyantran_chunk_hybrid_search_mut_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  local names=(
    "title count includes unpublished orders"
    "title count includes unindexed orders"
    "title count ignores the feature"
    "name gate removed"
    "probe counts unpublished chunks"
    "probe ignores the feature"
    "keyword scan returns unpublished chunks"
    "month scans return unpublished chunks"
    "month scans ignore the tier"
    "month scans keep chunks without a vector"
    "keyword list ordered by id, not by distance"
    "month cap removed"
    "month list left out of the fusion"
    "invoker's existence check removed"
    "drift guard ignores a policy's command"
    "drift guard blind to a space inside a literal"
    "word budget one too small"
    "word budget one too large")
  local exprs=(
    's/\n         and d\.id not in \(select h\.id from unnest\(v_hidden\) h\(id\)\)\n    \),/\n    ),/'
    's/where d\.indexed_at is not null\n         and \(p_desk_feature is null/where (p_desk_feature is null/'
    's/(where d\.indexed_at is not null\n)         and \(p_desk_feature is null or d\.desk_feature = p_desk_feature\)\n/$1/'
    's/where n\.n between 1 and c_name_df_max/where n.n >= 1/'
    's/\n               and c\.document_id is not null and c\.document_id not in \(select h\.id from unnest\(v_hidden\) h\(id\)\)\n             limit c_rare_df_max/\n             limit c_rare_df_max/'
    's/\n               and \(p_desk_feature is null or c\.desk_feature = p_desk_feature\)(\n               and c\.document_id is not null)/$1/'
    's/\n         and c\.document_id is not null and c\.document_id not in \(select h\.id from unnest\(v_hidden\) h\(id\)\)\n    \),\n    admitted/\n    ),\n    admitted/'
    's/\n\s+and c\.document_id is not null and c\.document_id not in \(select h\.id from unnest\(v_hidden\) h\(id\)\)(\n\s+limit c_month_max_chunks)/$1/g'
    's/\n\s+and \(p_desk_tier is null or d\.desk_tier = p_desk_tier\)(\n\s+and c\.document_id is not null and c\.document_id not in \(select h\.id from unnest\(v_hidden\) h\(id\)\)\n\s+limit c_month_max_chunks)/$1/g'
    's/(c\.doc_date < v_to)\n\s+and c\.embedding is not null/$1/g'
    's/order by k\.dist, k\.id/order by k.id/'
    's/if v_mn <= c_month_max_chunks then/if true then/'
    's/ \+ coalesce\(1\.0 \/ \(c_rrf_k \+ m\.rn\), 0\)//'
    's/\n   where exists \(select 1 from public\.document_chunks c where c\.id = h\.id and c\.desk_feature = c_nclt\)//'
    's/(case when p\.polpermissive then \x27permissive\x27 else \x27restrictive\x27 end,) p\.polcmd,/$1 \x27r\x27,/'
    's/regexp_replace\(regexp_replace\(coalesce\(pg_get_expr\(p\.polqual/regexp_replace(regexp_replace(regexp_replace(coalesce(pg_get_expr(p.polqual/; s/(pg_get_expr\(p\.polqual.*?\x27\\s\+\x27, \x27 \x27, \x27g\x27\)),/$1, \x27supplied ?- ?text\x27, \x27supplied-text\x27, \x27g\x27),/s'
    's/v_sum \+ v_df <= c_match_budget/v_sum + v_df < c_match_budget/'
    's/v_sum \+ v_df <= c_match_budget/v_sum + v_df <= c_match_budget + 1/')
  q "drop database if exists $base" >/dev/null; q "create database $base" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $base < "$f" >/dev/null 2>&1 || { echo "  MUTATION: bootstrap broke at $(basename "$f")"; q "drop database if exists $base" >/dev/null; return 1; }
  done
  for k in "${!names[@]}"; do
    perl -0pe "${exprs[$k]}" "$guard" > "$WORK/hybrid_mutant.sql"
    if cmp -s "$guard" "$WORK/hybrid_mutant.sql"; then
      echo "  MUTATION FAIL - '${names[$k]}' did not change the migration (the pattern no longer matches)"; rc=1; continue
    fi
    q "drop database if exists $db" >/dev/null; q "create database $db template $base" >/dev/null
    if ! psql_in $db < "$WORK/hybrid_mutant.sql" > "$WORK/hybrid_mutant.out" 2>&1; then
      echo "  MUTATION FAIL - '${names[$k]}': the mutated migration does not apply"; sed 's/^/    /' "$WORK/hybrid_mutant.out" | head -3; rc=1; q "drop database if exists $db" >/dev/null; continue
    fi
    if out="$(fixture_sql chunk_hybrid_search | psql_in $db 2>&1)"; then
      echo "  MUTATION FAIL - the fixture still passes with: ${names[$k]}"; rc=1
    elif ! grep -q 'FAIL:' <<<"$out"; then
      echo "  MUTATION FAIL - with '${names[$k]}' the fixture stopped on an error, not on an assertion:"; grep -m2 ERROR <<<"$out" | sed 's/^/    /'; rc=1
    else
      echo "  mutation ok - fails with: ${names[$k]}  [$(grep -m1 'FAIL:' <<<"$out" | sed 's/^ERROR:  FAIL: //' | cut -c1-110)]"
    fi
    q "drop database if exists $db" >/dev/null
  done
  q "drop database if exists $base" >/dev/null
  return $rc
}

hybrid_private_check() {
  local mig="$MIG/20261102120000_chunk_hybrid_search.sql" guard="${FILES[${#FILES[@]}-1]}" n=${#FILES[@]} i=0 f
  local db=niyantran_chunk_hybrid_search_acl_test
  q() { docker exec "$CONTAINER" psql -U postgres -q -tA -c "$@"; }
  if grep -qiw private "$mig"; then
    echo "  PRIVATE FAIL - the migration names the schema private:"; grep -niw private "$mig" | head -3 | sed 's/^/    /'; return 1
  fi
  if grep -rlw retrieval_internal "$MIG" | grep -vq '20261102120000_chunk_hybrid_search.sql'; then
    echo "  PRIVATE FAIL - another migration uses the name retrieval_internal:"; grep -rlw retrieval_internal "$MIG" | grep -v chunk_hybrid_search | sed 's/^/    /'; return 1
  fi
  if ! grep -q '^create schema retrieval_internal;' "$mig"; then
    echo "  PRIVATE FAIL - the migration must create its schema with a plain CREATE SCHEMA (no IF NOT EXISTS)"; return 1
  fi
  q "drop database if exists $db" >/dev/null
  q "create database $db" >/dev/null
  for f in "${FILES[@]}"; do
    i=$((i+1)); [ $i -eq $n ] && break
    psql_in $db < "$f" >/dev/null 2>&1 || { echo "  PRIVATE: bootstrap broke at $(basename "$f")"; return 1; }
  done
  psql_in $db >/dev/null 2>&1 <<'SQL' || { echo "  PRIVATE FAIL - could not create the stand-in"; return 1; }
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
create table if not exists private.acl_sentinel (x int);
create or replace function private.acl_sentinel_fn() returns int language sql security definer as $f$ select 1 $f$;
SQL
  local snap="select string_agg(l, E'\n' order by l) from (
      select 'schema ' || coalesce(nspacl::text, '-') || ' owner ' || nspowner::regrole::text as l from pg_namespace where nspname = 'private'
      union all select 'func ' || p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, '-') || ' owner ' || p.proowner::regrole::text
        from pg_proc p where p.pronamespace = 'private'::regnamespace
      union all select 'rel ' || c.relname || ' ' || coalesce(c.relacl::text, '-') || ' owner ' || c.relowner::regrole::text
        from pg_class c where c.relnamespace = 'private'::regnamespace
      union all select 'col ' || c.relname || '.' || a.attname || ' ' || a.attacl::text
        from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'private'::regnamespace and a.attacl is not null
      union all select 'default ' || d.defaclobjtype::text || ' ' || d.defaclacl::text from pg_default_acl d where d.defaclnamespace = 'private'::regnamespace
    ) x"
  local before after
  before="$(q "$snap" -d $db)"
  if [ -z "$before" ] || ! printf '%s' "$before" | grep -q 'func private.acl_sentinel_fn'; then
    echo "  PRIVATE FAIL - the snapshot did not see the stand-in objects"; q "drop database if exists $db" >/dev/null; return 1
  fi
  psql_in $db < "$guard" >/dev/null 2>&1 || { echo "  PRIVATE FAIL - the migration did not apply"; q "drop database if exists $db" >/dev/null; return 1; }
  after="$(q "$snap" -d $db)"
  q "grant usage on schema private to authenticated" -d $db >/dev/null
  local changed
  changed="$(q "$snap" -d $db)"
  q "drop database if exists $db" >/dev/null
  if [ "$before" != "$after" ]; then
    echo "  PRIVATE FAIL - the migration changed an ACL in private:"; diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | head -6 | sed 's/^/    /'; return 1
  fi
  if [ "$changed" = "$after" ]; then
    echo "  PRIVATE FAIL - the snapshot cannot see a grant added by hand"; return 1
  fi
  echo "  private ok - the migration names no such schema, uses a fresh schema name, and changes no ACL in private ($(printf '%s\n' "$before" | wc -l | tr -d ' ') entries compared; a grant added by hand is seen)"
}

credit_paise_atomic_check() {
  local db="$1" line
  : > "$WORK/credit_paise_atomic.expanded.sql"
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$line" = '-- @cutover-migration' ]; then
      cat "$MIG/20261017194628_credit_paise_convert.sql" >> "$WORK/credit_paise_atomic.expanded.sql"
    else
      printf '%s\n' "$line" >> "$WORK/credit_paise_atomic.expanded.sql"
    fi
  done < "$TESTS/credit_paise_atomic.sql"
  if psql_in "$db" < "$WORK/credit_paise_atomic.expanded.sql" > "$WORK/atomic_out.txt" 2>&1; then
    echo '  atomic failure rollback ok - both initial pause states preserved'
  else
    echo '  ATOMIC FAIL'
    { grep -E 'ERROR|FAIL:' "$WORK/atomic_out.txt" || cat "$WORK/atomic_out.txt"; } | head -8 | sed 's/^/    /'
    return 1
  fi
}

# Expand the one operator-script include into the same psql session. Docker
# receives SQL on stdin and cannot read workspace paths itself.
fixture_sql() {
  while IFS= read -r line; do
    if [ "$line" = '\i backend/sql/operations/reset_test_billing.sql' ]; then
      cat backend/sql/operations/reset_test_billing.sql
    elif [ "$line" = '\i scripts/pq-row-refresh.sql' ]; then
      cat scripts/pq-row-refresh.sql
    elif [ "$line" = '\i supabase/tests/ingest_register_batch.sql' ]; then
      # Every case, without the closing rollback: the including fixture closes the transaction.
      sed '/^rollback;$/d' supabase/tests/ingest_register_batch.sql
    elif [ "$line" = '\i supabase/migrations/20261101120000_document_chunks_partitioned.sql' ]; then
      cat supabase/migrations/20261101120000_document_chunks_partitioned.sql
    else
      printf '%s\n' "$line"
    fi
  done < "$TESTS/$1.sql"
}

run_fixture() {
  local name="$1" db="niyantran_${1}_test" rc=0
  # set -e is off inside "run_fixture || fail=1", so an unknown fixture must be
  # failed here; unchecked, the unset CONTAINER below ended the run with exit 0 (F303).
  if ! chain "$name"; then
    echo "=== $name"
    echo "  FAIL  (no chain() entry)"
    return 1
  fi
  echo "=== $name  [${CONTAINER#niyantran-}]"

  docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $db" >/dev/null
  docker exec "$CONTAINER" psql -U postgres -q -c "create database $db" >/dev/null

  for f in "${FILES[@]}"; do
    if ! psql_in "$db" < "$f" > "$WORK/out.txt" 2>&1; then
      echo "  BOOTSTRAP FAILED at $(basename "$f")"
      grep -iE 'error' "$WORK/out.txt" | head -3 | sed 's/^/    /'
      return 1
    fi
  done

  if fixture_sql "$name" | psql_in "$db" > "$WORK/out.txt" 2>&1; then
    echo "  PASS  ($(grep -c . "$WORK/out.txt") lines of output)"
    [ "$name" = law_listing ] && { bash "$TESTS/law_listing_concurrency.sh" || rc=1; }
    [ "$name" = ingest_register_batch ] && { bash "$TESTS/ingest_register_batch_concurrency.sh" || rc=1; }
    [ "$name" = billing_creation_retry ] && { bash "$TESTS/billing_retry_concurrency.sh" || rc=1; }
    [ "$name" = billing_cycle_changes ] && { bash "$TESTS/billing_cycle_concurrency.sh" || rc=1; }
    [ "$name" = billing_live_cycle ] && { bash "$TESTS/billing_live_cycle_concurrency.sh" || rc=1; }
    [ "$name" = billing_manual_grace ] && { bash "$TESTS/billing_manual_grace_concurrency.sh" || rc=1; }
    [ "$name" = billing_purchases ] && { bash "$TESTS/billing_concurrency.sh" || rc=1; }
    [ "$name" = credit_paise_contract ] && { credit_paise_atomic_check "$db" || rc=1; }
    [ "${VACUITY:-1}" = 1 ] && { vacuity_check "$name" || rc=1; }
    [ "$name" = chunk_hybrid_search ] && { hybrid_exposure_check || rc=1; hybrid_private_check || rc=1; hybrid_drift_rollback_check || rc=1; hybrid_mutation_checks || rc=1; }
    [ "$name" = corpus_records ] && { corpus_records_checks || rc=1; }
    [ "$name" = document_chunks_partitions ] && { document_chunks_partitions_checks || rc=1; }
    [ "$name" = feed_records ] && { feed_records_checks || rc=1; }
    [ "$name" = feed_admin ] && { feed_admin_checks || rc=1; }
    [ "$name" = feed_register_page ] && { feed_register_page_checks || rc=1; }
    [ "$name" = feed_nothing_new ] && { feed_nothing_new_checks || rc=1; }
    [ "$name" = feed_empty_outcome ] && { feed_empty_outcome_checks || rc=1; }
    [ "$name" = feed_latest_run_page ] && { feed_latest_run_page_checks || rc=1; }
    [ "$name" = handbook_period_ranges ] && { handbook_period_ranges_checks || rc=1; }
    [ "$name" = record_briefs ] && { record_briefs_checks || rc=1; }
    [ "$name" = record_brief_format ] && { record_brief_format_checks || rc=1; }
    [ "$name" = ingest_register_batch ] && { ingest_register_batch_checks || rc=1; }
  else
    rc=1
    echo "  FAIL"
    # The raised assertion first: a fixture's result columns are also named assert_true.
    { grep -E 'ERROR|FAIL:' "$WORK/out.txt" || grep -iE 'error|assert' "$WORK/out.txt"; } | head -6 | sed 's/^/    /'
  fi
  return $rc
}

FIXTURES=("$@")
# Default: every fixture file in supabase/tests, so a new fixture cannot be
# forgotten here; one without a chain() entry fails as "unknown fixture".
if [ ${#FIXTURES[@]} -eq 0 ]; then
  for f in "$TESTS"/*.sql; do
    n="$(basename "$f" .sql)"
    case "$n" in bootstrap_*|credit_paise_seed|credit_paise_atomic) ;; *) FIXTURES+=("$n") ;; esac
  done
fi

fail=0
# Seconds per fixture, its extra checks and vacuity included, so the CI job's
# time limit can be watched (F302).
for f in "${FIXTURES[@]}"; do
  t0=$SECONDS
  run_fixture "$f" || fail=1
  echo "  time $((SECONDS - t0)) s"
done
echo
echo "total $((SECONDS / 60)) min $((SECONDS % 60)) s"
[ $fail -eq 0 ] && echo "all fixtures passed" || echo "one or more fixtures FAILED"
exit $fail
