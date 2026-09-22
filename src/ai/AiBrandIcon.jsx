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

export function AiBrandIcon({ id, size = 14 }) {
  const s = size;
  const common = { width: s, height: s, viewBox: '0 0 24 24', 'aria-hidden': true };
  switch (vendorKey(id)) {
    case 'google':
      // The Gemini four-point star: convex arcs pinching to a point on each axis.
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 1.8c0 5.6 4.6 10.2 10.2 10.2C16.6 12 12 16.6 12 22.2 12 16.6 7.4 12 1.8 12 7.4 12 12 7.4 12 1.8z"
          />
        </svg>
      );
    case 'anthropic':
      // The Claude burst: eight tapering spokes from a common centre.
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M12 1.9l1.7 6.2 4.6-4.4-2.6 5.9 6.2-1.7-5.4 3.4 5.4 3.4-6.2-1.7 2.6 5.9-4.6-4.4-1.7 6.2-1.7-6.2-4.6 4.4 2.6-5.9-6.2 1.7 5.4-3.4-5.4-3.4 6.2 1.7-2.6-5.9 4.6 4.4z"
          />
        </svg>
      );
    case 'deepseek':
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M4 12c0-4.4 3.6-8 8-8 3.1 0 5.8 1.8 7.1 4.4C17.4 6.6 14.9 5.5 12 5.5 8.4 5.5 5.5 8.4 5.5 12S8.4 18.5 12 18.5c2.9 0 5.4-1.1 7.1-2.9C17.8 18.2 15.1 20 12 20c-4.4 0-8-3.6-8-8zm10.2-.8c0 1.8-1.4 3.3-3.2 3.3S7.8 13 7.8 11.2 9.2 7.9 11 7.9s3.2 1.5 3.2 3.3zm2.5 1.1c.9 0 1.6-.8 1.6-1.7s-.7-1.7-1.6-1.7-1.6.8-1.6 1.7.7 1.7 1.6 1.7z"
          />
        </svg>
      );
    case 'openai':
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M22.3 10.1c-.2-1.6-1-3.1-2.2-4.1l-.3-.2-2.2 3.8c.9.5 1.5 1.5 1.5 2.6 0 1.6-1.3 2.9-2.9 2.9H12v3.3h4.2c3.4 0 6.2-2.8 6.1-6.3zM7.8 16.1c-.9-.5-1.5-1.5-1.5-2.6 0-1.6 1.3-2.9 2.9-2.9H13V7.3H8.8C5.4 7.3 2.6 10.1 2.7 13.6c.2 1.6 1 3.1 2.2 4.1l.3.2 2.6-3.8zM16.2 9.1l2.2-3.8c-1.5-.9-3.3-1.3-5.1-1.1L12 7.5h1.2c1.6 0 2.9 1.3 2.9 2.9.1-.4.1-.9.1-1.3zM9 12.5c0-1.6 1.3-2.9 2.9-2.9H15V6.3H10.8c-3.4 0-6.2 2.8-6.1 6.3.1.5.2 1 .4 1.4L7.8 16c.9.5 1.5.1 1.2-3.5z"
          />
        </svg>
      );
    default: {
      // No mark for this vendor yet. Its initial still tells two rows apart.
      const initial = (vendorKey(id).match(/[a-z0-9]/)?.[0] || '?').toUpperCase();
      return (
        <svg {...common}>
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
