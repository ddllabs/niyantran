// The landing page's persona glyphs (the same drawings nter.pro's hero uses).
const GLYPH = {
  policy: 'M4 3h11l4 4v14H4zM14 3v5h5M7 17v-3m4 3v-6m4 6v-4M7 9h3',
  journalist: 'M9 2h6v12H9zM6 10v1a6 6 0 0 0 12 0v-1M12 17v5M8 22h8M11 5h2M11 8h2',
  student: 'M3 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3zM13 7a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2M6 8h4M6 11h4M16 9l1.5 1.5L20 8',
  analyst: 'M3 7h18v14H3zM8 7V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 12a23 23 0 0 0 18 0M10 12h4v4h-4z',
  lawyer: 'M12 3v18M5 21h14M4 7h16M5 7l-3 7h6zM19 7l-3 7h6zM12 3a2 2 0 1 0 0 4 2 2 0 1 0 0-4',
  academic: 'M2 9l10-5 10 5-10 5zM6 11v6c3 3 9 3 12 0v-6M22 9v8M21 20l1-3 1 3',
};

export function PersonaGlyph({ id }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPH[id] || GLYPH.policy} />
    </svg>
  );
}
