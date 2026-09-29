-- F1: drop user_preferences.ai_chats and its size check (docs/plans/open-work.md).
--
-- Research conversations live in public.conversations. Nothing has read or
-- written this column since f05a5b6 (server/userPrefsApi.mjs selects only
-- watchlist, tours and updated_at), and its values were cleared on
-- 2026-09-28. On NTER, before this was applied, 0 of 4 rows held a value and
-- the size check was the column's only dependent.

ALTER TABLE public.user_preferences DROP CONSTRAINT IF EXISTS user_preferences_ai_chats_size;
ALTER TABLE public.user_preferences DROP COLUMN IF EXISTS ai_chats;
