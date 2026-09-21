-- B2: children must match their conversation owner. Clients can submit user
-- messages and cancellation requests; assistant results and telemetry are
-- server-owned. HTTP caller validation before service writes remains D3/D6.
BEGIN;

-- Prevent writes between the preflight and validated FK installation. These
-- tables also require exclusive locks for the following ALTER TABLE commands.
LOCK TABLE public.conversations, public.chat_messages, public.chat_cancellations
IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    mismatched_messages bigint;
    mismatched_cancellations bigint;
BEGIN
    SELECT count(*) INTO mismatched_messages
    FROM public.chat_messages m
    LEFT JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.id IS NULL OR m.user_id IS DISTINCT FROM c.user_id;

    SELECT count(*) INTO mismatched_cancellations
    FROM public.chat_cancellations x
    LEFT JOIN public.conversations c ON c.id = x.conversation_id
    WHERE c.id IS NULL OR x.user_id IS DISTINCT FROM c.user_id;

    IF mismatched_messages > 0 OR mismatched_cancellations > 0 THEN
        RAISE EXCEPTION 'Conversation ownership migration stopped: % mismatched messages, % mismatched cancellations',
            mismatched_messages, mismatched_cancellations
            USING ERRCODE = '23514',
            HINT = 'Inspect child conversation_id/user_id against conversations.id/user_id; resolve with an owner-approved data remediation before retrying. No rows were changed.';
    END IF;
END;
$$;

ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE public.chat_messages
    DROP CONSTRAINT chat_messages_conversation_id_fkey,
    ADD CONSTRAINT chat_messages_conversation_owner_fkey
        FOREIGN KEY (conversation_id, user_id)
        REFERENCES public.conversations (id, user_id) ON DELETE CASCADE;
ALTER TABLE public.chat_cancellations
    DROP CONSTRAINT chat_cancellations_conversation_id_fkey,
    ADD CONSTRAINT chat_cancellations_conversation_owner_fkey
        FOREIGN KEY (conversation_id, user_id)
        REFERENCES public.conversations (id, user_id) ON DELETE CASCADE;

DROP POLICY chat_messages_select ON public.chat_messages;
DROP POLICY chat_messages_insert ON public.chat_messages;
DROP POLICY chat_messages_update ON public.chat_messages;
DROP POLICY chat_messages_delete ON public.chat_messages;

CREATE POLICY chat_messages_select ON public.chat_messages FOR SELECT TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.conversations c
        WHERE c.id = chat_messages.conversation_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY chat_messages_insert ON public.chat_messages FOR INSERT TO authenticated
WITH CHECK (
    role = 'user'
    AND user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.conversations c
        WHERE c.id = chat_messages.conversation_id AND c.user_id = (SELECT auth.uid()))
);

DROP POLICY chat_cancellations_select ON public.chat_cancellations;
DROP POLICY chat_cancellations_insert ON public.chat_cancellations;
DROP POLICY chat_cancellations_update ON public.chat_cancellations;
DROP POLICY chat_cancellations_delete ON public.chat_cancellations;

CREATE POLICY chat_cancellations_select ON public.chat_cancellations FOR SELECT TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.conversations c
        WHERE c.id = chat_cancellations.conversation_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY chat_cancellations_insert ON public.chat_cancellations FOR INSERT TO authenticated
WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.conversations c
        WHERE c.id = chat_cancellations.conversation_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY chat_cancellations_update ON public.chat_cancellations FOR UPDATE TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.conversations c
        WHERE c.id = chat_cancellations.conversation_id AND c.user_id = (SELECT auth.uid()))
)
WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.conversations c
        WHERE c.id = chat_cancellations.conversation_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY chat_cancellations_delete ON public.chat_cancellations FOR DELETE TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.conversations c
        WHERE c.id = chat_cancellations.conversation_id AND c.user_id = (SELECT auth.uid()))
);

-- Clear both table and historical column grants, including Supabase's broad
-- defaults. Table-only REVOKE would leave pre-existing column grants intact.
REVOKE ALL ON public.conversations, public.chat_messages, public.chat_cancellations,
    public.model_call_logs, public.chat_turn_traces FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
    relation text;
    columns text;
BEGIN
    FOREACH relation IN ARRAY ARRAY[
        'conversations', 'chat_messages', 'chat_cancellations',
        'model_call_logs', 'chat_turn_traces'
    ] LOOP
        SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns
        FROM pg_attribute
        WHERE attrelid = format('public.%I', relation)::regclass
          AND attnum > 0 AND NOT attisdropped;
        EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC, anon, authenticated', columns, relation);
    END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT SELECT ON public.chat_messages TO authenticated;
GRANT INSERT (id, conversation_id, user_id, role, content, turn_key)
    ON public.chat_messages TO authenticated;
-- Supabase upsert updates each supplied column, including conflict keys and
-- user_id. Ownership policies check the existing row and resulting row.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_cancellations TO authenticated;
GRANT SELECT ON public.model_call_logs, public.chat_turn_traces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations, public.chat_messages,
    public.chat_cancellations, public.model_call_logs, public.chat_turn_traces TO service_role;

COMMIT;
