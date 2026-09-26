import { useId } from 'react';

/**
 * Brand marks for the model chips.
 *
 * Two vocabularies reach this component and they do not agree. The legacy
 * store hard-codes `provider: 'gemini'` (aiModelsStore.js) while the research
 * path passes `ai_models.vendor`, which is the OpenRouter id prefix - 'google',
 * 'anthropic', 'openai', 'deepseek'. The switch used to key on the legacy
 * spelling only, so five of the seven enabled models - every Gemini row and
 * Claude - fell through to an unlabelled circle. `vendorKey` folds both
 * vocabularies onto one key before the switch sees it.
 *
 * A vendor with no mark gets its initial rather than a blank dot, so a model
 * added to the allowlist tomorrow is still told apart from its neighbours.
 */

/** Fold the legacy provider ids and the OpenRouter vendor prefixes onto one key. */
export function vendorKey(id) {
  const raw = String(id || '').trim().toLowerCase();
  if (raw === 'gemini' || raw === 'google') return 'google';
  if (raw === 'anthropic' || raw === 'claude') return 'anthropic';
  if (raw === 'openai' || raw === 'gpt' || raw === 'openrouter') return 'openai';
  return raw;
}

/** Official-style brand marks for the AI model picker. */
export function AiBrandIcon({ id, size = 16 }) {
  const uid = useId().replace(/:/g, '');
  const s = size;
  const key = vendorKey(id);

  const wrap = (node) => (
    <span className="ai-brand-ico" style={{ width: s, height: s, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
      {node}
    </span>
  );

  switch (key) {
    case 'google': {
      const gid = `niyGemini_${uid}`;
      return wrap(
        <svg width={s} height={s} viewBox="0 0 24 24" role="img">
          <defs>
            <linearGradient id={gid} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1BA1E3" />
              <stop offset="40%" stopColor="#8B6CE8" />
              <stop offset="70%" stopColor="#D96570" />
              <stop offset="100%" stopColor="#F4B400" />
            </linearGradient>
          </defs>
          <path
            fill={`url(#${gid})`}
            d="M12 1.8 14.05 9.1 21.5 12 14.05 14.9 12 22.2 9.95 14.9 2.5 12l7.45-2.9L12 1.8z"
          />
        </svg>
      );
    }
    case 'anthropic': {
      // The Claude burst: eight tapering spokes from a common centre.
      return wrap(
        <svg width={s} height={s} viewBox="0 0 24 24" role="img">
          <path
            fill="#D97706"
            d="M12 1.9l1.7 6.2 4.6-4.4-2.6 5.9 6.2-1.7-5.4 3.4 5.4 3.4-6.2-1.7 2.6 5.9-4.6-4.4-1.7 6.2-1.7-6.2-4.6 4.4 2.6-5.9-6.2 1.7 5.4-3.4-5.4-3.4 6.2 1.7-2.6-5.9 4.6 4.4z"
          />
        </svg>
      );
    }
    case 'deepseek': {
      return wrap(
        <svg width={s} height={s} viewBox="0 0 24 24" role="img">
          <path
            fill="#0284C7"
            d="M4 12c0-4.4 3.6-8 8-8 3.1 0 5.8 1.8 7.1 4.4C17.4 6.6 14.9 5.5 12 5.5 8.4 5.5 5.5 8.4 5.5 12S8.4 18.5 12 18.5c2.9 0 5.4-1.1 7.1-2.9C17.8 18.2 15.1 20 12 20c-4.4 0-8-3.6-8-8zm10.2-.8c0 1.8-1.4 3.3-3.2 3.3S7.8 13 7.8 11.2 9.2 7.9 11 7.9s3.2 1.5 3.2 3.3zm2.5 1.1c.9 0 1.6-.8 1.6-1.7s-.7-1.7-1.6-1.7-1.6.8-1.6 1.7.7 1.7 1.6 1.7z"
          />
        </svg>
      );
    }
    case 'openai': {
      return wrap(
        <svg width={s} height={s} viewBox="0 0 24 24" role="img">
          <path
            fill="#10A37F"
            d="M22.28 9.83a5.55 5.55 0 0 0-.48-4.57 5.64 5.64 0 0 0-6.07-2.7A5.62 5.62 0 0 0 10.05 1a5.64 5.64 0 0 0-5.35 3.9A5.55 5.55 0 0 0 1.1 9.2a5.64 5.64 0 0 0 .73 6.6 5.55 5.55 0 0 0 .48 4.57 5.64 5.64 0 0 0 6.07 2.7A5.62 5.62 0 0 0 13.95 23a5.64 5.64 0 0 0 5.35-3.9 5.55 5.55 0 0 0 3.6-4.3 5.64 5.64 0 0 0-.62-5zm-8.33 11.6c-.9 0-1.78-.25-2.54-.72l.13-.07 4.3-2.48a.7.7 0 0 0 .35-.6v-6.06l1.82 1.05c.04.02.06.06.06.1v5.02a4.05 4.05 0 0 1-4.12 4.06zm-8.9-3.8c-.45-.78-.6-1.7-.42-2.58l.13.08 4.3 2.48a.7.7 0 0 0 .7 0l5.25-3.03v2.1a.18.18 0 0 1-.07.14l-4.35 2.51a4.05 4.05 0 0 1-5.54-1.7zM3.5 7.9a4.02 4.02 0 0 1 2.1-1.74v5.17c0 .25.13.48.35.6l5.25 3.03-1.82 1.05a.18.18 0 0 1-.17 0L4.86 13.5A4.05 4.05 0 0 1 3.5 7.9zm14.6 3.4-5.25-3.03 1.82-1.05a.18.18 0 0 1 .17 0l4.35 2.51a4.05 4.05 0 0 1-.62 7.3v-5.17a.7.7 0 0 0-.35-.6zm1.77-2.6-.13-.08-4.3-2.48a.7.7 0 0 0-.7 0L9.5 9.17V7.07c0-.04.02-.08.07-.1l4.35-2.51a4.05 4.05 0 0 1 6 4.2zM8.45 13.5l-1.82-1.05a.18.18 0 0 1-.06-.1V7.33a4.05 4.05 0 0 1 6.64-3.34l-.13.07-4.3 2.48a.7.7 0 0 0-.35.6v6.06z"
          />
        </svg>
      );
    }
    default: {
      const initial = (key.match(/[a-z0-9]/)?.[0] || '?').toUpperCase();
      return wrap(
        <svg width={s} height={s} viewBox="0 0 24 24" role="img">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <text
            x="12"
            y="12"
            fill="currentColor"
            fontSize="12"
            fontWeight="600"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {initial}
          </text>
        </svg>
      );
    }
  }
}
