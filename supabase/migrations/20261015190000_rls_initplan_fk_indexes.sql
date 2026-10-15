-- Database advisor fixes: per-row auth.uid() in RLS policies, and foreign keys with no covering
-- index (open-work P12; owner approval 2026-10-15).
--
--   * auth_rls_initplan: twelve policies call auth.uid() bare, so PostgreSQL evaluates it once per
--     row. Written as (select auth.uid()) it becomes an initplan, evaluated once per statement. The
--     value is the same within a statement, so who can see or write which row does not change.
--     Each policy is altered in place (ALTER POLICY keeps its name, command, roles and
--     permissiveness); only its USING and WITH CHECK expressions are restated, with auth.uid()
--     wrapped and everything else as it was. The helpers is_platform_admin() and is_org_member()
--     are left as they are: the advisor does not flag them.
--       user_profiles            "Users can view own profile", "Users can update own profile"
--                                (backend/sql/auth_schema.sql section 16)
--       conversations            conversations_select, _insert, _update, _delete (0002)
--       user_roles               "Users can view roles" (auth_schema.sql section 18)
--       privacy_policy_consents  "Users can view own consent", "Users can create own consent"
--                                (auth_schema.sql section 20)
--       model_call_logs          model_call_logs_own (0004)
--       chat_turn_traces         chat_turn_traces_own (0004)
--       invoices                 "Owners and admins read invoices" (20260928140000_invoices.sql)
--     Before altering, the migration checks that each policy exists with the command, roles and
--     expressions those files give it (auth.uid() wrapped or not, schema prefixes ignored), and
--     refuses with the differences listed, changing nothing, if one does not.
--   * unindexed_foreign_keys: one btree index per flagged foreign key, on the key's columns in
--     the key's order, so a delete or key update on the referenced table does not scan the
--     referencing one.
--       ai_roles_model_id_fkey                          ai_roles (model_id)
--       chat_cancellations_conversation_owner_fkey      chat_cancellations (conversation_id, user_id)
--       chat_messages_conversation_owner_fkey           chat_messages (conversation_id, user_id)
--       chat_turn_traces_model_call_log_id_fkey         chat_turn_traces (model_call_log_id)
--       credit_settings_updated_by_fkey                 credit_settings (updated_by)
--       ingest_jobs_requested_by_fkey                   ingest_jobs (requested_by)
--       plan_grants_granted_by_fkey                     plan_grants (granted_by)
--       research_turns_conversation_id_user_id_fkey     research_turns (conversation_id, user_id)
--     Plain CREATE INDEX (the migration tool runs each file in one transaction, which rules out
--     CONCURRENTLY): each takes a brief SHARE lock on its table while it builds.
--
-- Not changed here (by design, docs/plans/open-work.md accepted risks): unused indexes, and
-- multiple permissive policies. research_turns_conversation (conversation_id) is now a prefix of
-- research_turns_conversation_owner_idx; it is kept.
--
-- No BEGIN/COMMIT: the migration tool runs each file in one transaction.
--
-- Down (manual): put the bare auth.uid() back and drop the indexes.
--   begin;
--   alter policy "Users can view own profile" on public.user_profiles
--     using (user_id = auth.uid() or public.is_platform_admin());
--   alter policy "Users can update own profile" on public.user_profiles
--     using (user_id = auth.uid() or public.is_platform_admin())
--     with check (user_id = auth.uid() or public.is_platform_admin());
--   alter policy conversations_select on public.conversations using (user_id = auth.uid());
--   alter policy conversations_insert on public.conversations with check (user_id = auth.uid());
--   alter policy conversations_update on public.conversations
--     using (user_id = auth.uid()) with check (user_id = auth.uid());
--   alter policy conversations_delete on public.conversations using (user_id = auth.uid());
--   alter policy "Users can view roles" on public.user_roles
--     using (public.is_platform_admin() or user_id = auth.uid()
--            or (organisation_id is not null and public.is_org_member(organisation_id)));
--   alter policy "Users can view own consent" on public.privacy_policy_consents
--     using (user_id = auth.uid() or public.is_platform_admin());
--   alter policy "Users can create own consent" on public.privacy_policy_consents
--     with check (user_id = auth.uid());
--   alter policy model_call_logs_own on public.model_call_logs using (user_id = auth.uid());
--   alter policy chat_turn_traces_own on public.chat_turn_traces using (user_id = auth.uid());
--   alter policy "Owners and admins read invoices" on public.invoices
--     using (user_id = auth.uid() or public.is_platform_admin());
--   drop index public.ai_roles_model_id_idx;
--   drop index public.chat_cancellations_conversation_owner_idx;
--   drop index public.chat_messages_conversation_owner_idx;
--   drop index public.chat_turn_traces_model_call_log_id_idx;
--   drop index public.credit_settings_updated_by_idx;
--   drop index public.ingest_jobs_requested_by_idx;
--   drop index public.plan_grants_granted_by_idx;
--   drop index public.research_turns_conversation_owner_idx;
--   commit;

-- Pre-check: every policy is the one this migration was written against ----------------------

do $$
declare
  problems text := '';
  expected record;
  actual record;
begin
  for expected in
    select * from (values
      ('user_profiles', 'Users can view own profile', 'SELECT',
       '((user_id = auth.uid()) OR is_platform_admin())', null),
      ('user_profiles', 'Users can update own profile', 'UPDATE',
       '((user_id = auth.uid()) OR is_platform_admin())', '((user_id = auth.uid()) OR is_platform_admin())'),
      ('conversations', 'conversations_select', 'SELECT', '(user_id = auth.uid())', null),
      ('conversations', 'conversations_insert', 'INSERT', null, '(user_id = auth.uid())'),
      ('conversations', 'conversations_update', 'UPDATE', '(user_id = auth.uid())', '(user_id = auth.uid())'),
      ('conversations', 'conversations_delete', 'DELETE', '(user_id = auth.uid())', null),
      ('user_roles', 'Users can view roles', 'SELECT',
       '(is_platform_admin() OR (user_id = auth.uid()) OR ((organisation_id IS NOT NULL) AND is_org_member(organisation_id)))', null),
      ('privacy_policy_consents', 'Users can view own consent', 'SELECT',
       '((user_id = auth.uid()) OR is_platform_admin())', null),
      ('privacy_policy_consents', 'Users can create own consent', 'INSERT', null, '(user_id = auth.uid())'),
      ('model_call_logs', 'model_call_logs_own', 'SELECT', '(user_id = auth.uid())', null),
      ('chat_turn_traces', 'chat_turn_traces_own', 'SELECT', '(user_id = auth.uid())', null),
      ('invoices', 'Owners and admins read invoices', 'SELECT',
       '((user_id = auth.uid()) OR is_platform_admin())', null)
    ) as v(tablename, policyname, cmd, qual, with_check)
  loop
    select p.cmd, p.roles, p.permissive,
           replace(replace(p.qual, '( SELECT auth.uid() AS uid)', 'auth.uid()'), 'public.', '') as qual,
           replace(replace(p.with_check, '( SELECT auth.uid() AS uid)', 'auth.uid()'), 'public.', '') as with_check
      into actual
      from pg_catalog.pg_policies p
     where p.schemaname = 'public' and p.tablename = expected.tablename and p.policyname = expected.policyname;
    if not found then
      problems := problems || format(E'\n  %s %L: missing', expected.tablename, expected.policyname);
    elsif actual.cmd is distinct from expected.cmd
       or actual.roles is distinct from array['authenticated']::name[]
       or actual.permissive is distinct from 'PERMISSIVE'
       or actual.qual is distinct from expected.qual
       or actual.with_check is distinct from expected.with_check then
      problems := problems || format(E'\n  %s %L: %s %s %s using %s with check %s',
        expected.tablename, expected.policyname, actual.cmd, actual.roles, actual.permissive,
        coalesce(actual.qual, 'none'), coalesce(actual.with_check, 'none'));
    end if;
  end loop;
  if problems <> '' then
    raise exception 'rls_initplan_fk_indexes: these policies differ from the definitions this migration restates; nothing was changed:%', problems;
  end if;
end;
$$;

-- auth_rls_initplan ----------------------------------------------------------------------------

alter policy "Users can view own profile" on public.user_profiles
  using (user_id = (select auth.uid()) or public.is_platform_admin());
alter policy "Users can update own profile" on public.user_profiles
  using (user_id = (select auth.uid()) or public.is_platform_admin())
  with check (user_id = (select auth.uid()) or public.is_platform_admin());

alter policy conversations_select on public.conversations
  using (user_id = (select auth.uid()));
alter policy conversations_insert on public.conversations
  with check (user_id = (select auth.uid()));
alter policy conversations_update on public.conversations
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
alter policy conversations_delete on public.conversations
  using (user_id = (select auth.uid()));

alter policy "Users can view roles" on public.user_roles
  using (public.is_platform_admin()
         or user_id = (select auth.uid())
         or (organisation_id is not null and public.is_org_member(organisation_id)));

alter policy "Users can view own consent" on public.privacy_policy_consents
  using (user_id = (select auth.uid()) or public.is_platform_admin());
alter policy "Users can create own consent" on public.privacy_policy_consents
  with check (user_id = (select auth.uid()));

alter policy model_call_logs_own on public.model_call_logs
  using (user_id = (select auth.uid()));
alter policy chat_turn_traces_own on public.chat_turn_traces
  using (user_id = (select auth.uid()));

alter policy "Owners and admins read invoices" on public.invoices
  using (user_id = (select auth.uid()) or public.is_platform_admin());

-- unindexed_foreign_keys -----------------------------------------------------------------------

create index if not exists ai_roles_model_id_idx
  on public.ai_roles (model_id);
create index if not exists chat_cancellations_conversation_owner_idx
  on public.chat_cancellations (conversation_id, user_id);
create index if not exists chat_messages_conversation_owner_idx
  on public.chat_messages (conversation_id, user_id);
create index if not exists chat_turn_traces_model_call_log_id_idx
  on public.chat_turn_traces (model_call_log_id);
create index if not exists credit_settings_updated_by_idx
  on public.credit_settings (updated_by);
create index if not exists ingest_jobs_requested_by_idx
  on public.ingest_jobs (requested_by);
create index if not exists plan_grants_granted_by_idx
  on public.plan_grants (granted_by);
create index if not exists research_turns_conversation_owner_idx
  on public.research_turns (conversation_id, user_id);
