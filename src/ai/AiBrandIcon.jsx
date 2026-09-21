import { useId } from 'react';

/** Official-style brand marks for the AI model picker. */

export function AiBrandIcon({ id, size = 16 }) {
  const uid = useId().replace(/:/g, '');
  const s = size;
  const key = String(id || '').toLowerCase();
  const wrap = (node) => (
    <span className="ai-brand-ico" style={{ width: s, height: s }} aria-hidden="true">
      {node}
    </span>
  );

  if (key === 'gemini') {
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
      </svg>,
    );
  }

  if (key === 'deepseek') {
    return wrap(
      <svg width={s} height={s} viewBox="0 0 24 24" role="img">
        <rect width="24" height="24" rx="6" fill="#4D6BFE" />
        <path
          fill="#fff"
          d="M6.8 12.2c0-3.15 2.2-5.5 5.4-5.5 2 0 3.55.75 4.55 2l-1.4 1.15c-.7-.85-1.7-1.35-3.15-1.35-2 0-3.35 1.45-3.35 3.7s1.35 3.7 3.35 3.7c1.45 0 2.45-.5 3.15-1.35l1.4 1.15c-1 1.25-2.55 2-4.55 2-3.2 0-5.4-2.35-5.4-5.5zm9.7-1.4c0-.55.45-1 1-1s1 .45 1 1-.45 1-1 1-1-.45-1-1z"
        />
      </svg>,
    );
  }

  if (key === 'openrouter' || key === 'openai' || key === 'gpt') {
    return wrap(
      <svg width={s} height={s} viewBox="0 0 24 24" role="img">
        <path
          fill="#10A37F"
          d="M22.28 9.83a5.55 5.55 0 0 0-.48-4.57 5.64 5.64 0 0 0-6.07-2.7A5.62 5.62 0 0 0 10.05 1a5.64 5.64 0 0 0-5.35 3.9A5.55 5.55 0 0 0 1.1 9.2a5.64 5.64 0 0 0 .73 6.6 5.55 5.55 0 0 0 .48 4.57 5.64 5.64 0 0 0 6.07 2.7A5.62 5.62 0 0 0 13.95 23a5.64 5.64 0 0 0 5.35-3.9 5.55 5.55 0 0 0 3.6-4.3 5.64 5.64 0 0 0-.62-5zm-8.33 11.6c-.9 0-1.78-.25-2.54-.72l.13-.07 4.3-2.48a.7.7 0 0 0 .35-.6v-6.06l1.82 1.05c.04.02.06.06.06.1v5.02a4.05 4.05 0 0 1-4.12 4.06zm-8.9-3.8c-.45-.78-.6-1.7-.42-2.58l.13.08 4.3 2.48a.7.7 0 0 0 .7 0l5.25-3.03v2.1a.18.18 0 0 1-.07.14l-4.35 2.51a4.05 4.05 0 0 1-5.54-1.7zM3.5 7.9a4.02 4.02 0 0 1 2.1-1.74v5.17c0 .25.13.48.35.6l5.25 3.03-1.82 1.05a.18.18 0 0 1-.17 0L4.86 13.5A4.05 4.05 0 0 1 3.5 7.9zm14.6 3.4-5.25-3.03 1.82-1.05a.18.18 0 0 1 .17 0l4.35 2.51a4.05 4.05 0 0 1-.62 7.3v-5.17a.7.7 0 0 0-.35-.6zm1.77-2.6-.13-.08-4.3-2.48a.7.7 0 0 0-.7 0L9.5 9.17V7.07c0-.04.02-.08.07-.1l4.35-2.51a4.05 4.05 0 0 1 6 4.2zM8.45 13.5l-1.82-1.05a.18.18 0 0 1-.06-.1V7.33a4.05 4.05 0 0 1 6.64-3.34l-.13.07-4.3 2.48a.7.7 0 0 0-.35.6v6.06z"
        />
      </svg>,
    );
  }

  return wrap(
    <svg width={s} height={s} viewBox="0 0 24 24" role="img">
      <circle cx="12" cy="12" r="10" fill="#64748b" />
      <circle cx="12" cy="12" r="4" fill="#fff" />
    </svg>,
  );
}
