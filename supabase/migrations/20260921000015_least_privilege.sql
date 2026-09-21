-- B5: enforce the existing RLS operation matrix at the privilege boundary.
-- Supabase defaults and historical column ACLs can retain privileges after a
-- table-level REVOKE. Data access needs no structural or maintenance powers.
-- No policies, RPC ACLs, other schemas, or default privileges are changed.
-- B1/B2's column-scoped profile updates and user-message inserts stay intact.
-- Rollback requires a reviewed ACL snapshot; do not restore broad defaults.
BEGIN;

DO $$
DECLARE
  table_name text;
  columns text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'documents', 'document_chunks', 'desk_rows', 'ai_models', 'ai_roles',
    'model_pricing', 'organisations', 'organisation_members', 'user_roles',
    'organisation_invites', 'privacy_policy_consents', 'user_profiles',
    'conversations', 'chat_messages', 'chat_cancellations', 'model_call_logs',
    'chat_turn_traces'
  ] LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
      INTO columns
      FROM pg_attribute
      WHERE attrelid = format('public.%I', table_name)::regclass
        AND attnum > 0 AND NOT attisdropped;

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', table_name);
    EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC, anon', columns, table_name);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM authenticated', table_name);
    EXECUTE format('REVOKE REFERENCES (%s) ON TABLE public.%I FROM authenticated', columns, table_name);

    -- Reset service grants everywhere, including B1/B2 tables. ALL also removes
    -- version-specific privileges such as PostgreSQL 17 MAINTAIN, without
    -- requiring that privilege name on older supported PostgreSQL versions.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM service_role', table_name);
    EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM service_role', columns, table_name);

    -- The six B1/B2 tables already have deliberately narrower data grants.
    -- Reset only the six read-only tables and the five retained org/consent
    -- tables, including historical column grants on those eleven tables.
    IF table_name = ANY(ARRAY[
      'documents', 'document_chunks', 'desk_rows', 'ai_models', 'ai_roles',
      'model_pricing', 'organisations', 'organisation_members', 'user_roles',
      'organisation_invites', 'privacy_policy_consents'
    ]) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
      EXECUTE format('REVOKE ALL (%s) ON TABLE public.%I FROM authenticated', columns, table_name);
    END IF;
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE public.documents, public.document_chunks,
  public.desk_rows, public.ai_models, public.ai_roles, public.model_pricing
  TO authenticated;

-- These verbs correspond to the existing policies in auth_schema.sql.
-- Organisation INSERT remains disabled by B1; invites have no DELETE policy.
GRANT SELECT, UPDATE ON TABLE public.organisations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organisation_members,
  public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.organisation_invites TO authenticated;
GRANT SELECT, INSERT ON TABLE public.privacy_policy_consents TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documents,
  public.document_chunks, public.desk_rows, public.ai_models, public.ai_roles,
  public.model_pricing, public.organisations, public.organisation_members,
  public.user_roles, public.organisation_invites, public.privacy_policy_consents,
  public.user_profiles, public.conversations, public.chat_messages,
  public.chat_cancellations, public.model_call_logs, public.chat_turn_traces
  TO service_role;

COMMIT;
