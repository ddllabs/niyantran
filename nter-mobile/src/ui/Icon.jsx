// The nter.pro mobile icon family: one 24-grid line set, 1.75 stroke, round caps and joins.
// Path data is static and trusted (authored here), so it is injected as markup.
const P = {"plus":"<path d=\"M12 5v14M5 12h14\"/>",
  "send":"<path d=\"m21.5 2.5-9.3 9.3M21.5 2.5l-6.2 18.5-3.6-8.2-8.2-3.6z\"/>",
  "clip":"<path d=\"m20.6 11.3-8.3 8.3a5.3 5.3 0 0 1-7.5-7.5l8.8-8.8a3.5 3.5 0 0 1 5 5l-8.8 8.8a1.8 1.8 0 0 1-2.5-2.5l8.2-8.2\"/>",
  "search":"<circle cx=\"11\" cy=\"11\" r=\"7.25\"/><path d=\"m20.5 20.5-4.3-4.3\"/>",
  "back":"<path d=\"m15 5-7 7 7 7\"/>",
  "close":"<path d=\"M18 6 6 18M6 6l12 12\"/>",
  "chev":"<path d=\"m9 5 7 7-7 7\"/>",
  "down":"<path d=\"m6 9 6 6 6-6\"/>",
  "menu":"<path d=\"M4 7h16M4 12h16M4 17h16\"/>",
  "history":"<path d=\"M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v5h5M12 8v4.5l3 1.8\"/>",
  "bell":"<path d=\"M6.5 9a5.5 5.5 0 0 1 11 0c0 6 2.5 8 2.5 8H4s2.5-2 2.5-8M10.3 21a2 2 0 0 0 3.4 0\"/>",
  "newchat":"<path d=\"M12 20h9M16.6 3.4a2 2 0 0 1 2.8 2.8L8 17.6 3.5 18.5l.9-4.5z\"/>",
  "sparkle":"<path d=\"M12 3q.9 7.1 8 8-7.1.9-8 8-.9-7.1-8-8 7.1-.9 8-8zM19.2 2.3q.3 2.2 2.5 2.5-2.2.3-2.5 2.5-.3-2.2-2.5-2.5 2.2-.3 2.5-2.5z\"/>",
  "home":"<path d=\"M3 10.5 12 3.5l9 7v9.5a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z\"/>",
  "library":"<path d=\"M4 3.5h3.5v17H4zM10 3.5h3.5v17H10zM15 5l3-.8 4 15.2-3 .8z\"/>",
  "user":"<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4.5 21a7.5 7.5 0 0 1 15 0\"/>",
  "pin":"<path d=\"M12 16.5V22M8.5 2.5h7M9.5 2.5v5.5L6 12.5v2.5h12v-2.5L14.5 8V2.5\"/>",
  "download":"<path d=\"M12 3v11M7.5 9.5l4.5 4.5 4.5-4.5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17\"/>",
  "copy":"<rect x=\"9\" y=\"9\" width=\"12\" height=\"12\" rx=\"2.2\"/><path d=\"M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5\"/>",
  "share":"<path d=\"M12 3v12.5M7.5 7.5 12 3l4.5 4.5M5 13.5v5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-5\"/>",
  "rerun":"<path d=\"M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 4v5h-5\"/>",
  "doc":"<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4\"/>",
  "pdf":"<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M8.5 17.5v-5h2.2a1.6 1.6 0 0 1 0 3.2H8.5\"/>",
  "word":"<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M8 12l1.5 5.5 1.7-4.5 1.7 4.5L14.5 12\"/>",
  "file":"<path d=\"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5\"/>",
  "upload":"<path d=\"M12 15V4M7.5 8.5 12 4l4.5 4.5M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17\"/>",
  "camera":"<path d=\"M4 9a2 2 0 0 1 2-2h2.2l1.4-2.2h4.8L15.8 7H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z\"/><circle cx=\"12\" cy=\"13.5\" r=\"3.5\"/>",
  "image":"<rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2.2\"/><circle cx=\"9\" cy=\"9.5\" r=\"1.8\"/><path d=\"m21 15.5-4.3-4.3a1.5 1.5 0 0 0-2.1 0L7 18.5\"/>",
  "check":"<path d=\"m5 12.5 4.5 4.5L19 7.5\"/>",
  "globe":"<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5s1.2-6.1 3.6-8.5z\"/>",
  "scale":"<path d=\"M12 3.5v17M7.5 20.5h9M4 7.5h16M6.5 7.5 3.5 14a3 3 0 0 0 6 0zM17.5 7.5l-3 6.5a3 3 0 0 0 6 0z\"/>",
  "chart":"<path d=\"M3.5 3.5v17h17M7.5 15l3.5-4 3 2.5 5-6\"/>",
  "building":"<path d=\"M3.5 21h17M5.5 21v-9M9.5 21v-9M14.5 21v-9M18.5 21v-9M3 12h18M12 3.5 3.5 9.5h17z\"/>",
  "mic":"<rect x=\"9\" y=\"3\" width=\"6\" height=\"11\" rx=\"3\"/><path d=\"M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6\"/>",
  "book":"<path d=\"M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5V4.5A2.5 2.5 0 0 1 6.5 2H20v15M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5\"/>",
  "briefcase":"<rect x=\"3\" y=\"7.5\" width=\"18\" height=\"13\" rx=\"2.2\"/><path d=\"M8.5 7.5v-2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2M3 13h18\"/>",
  "grad":"<path d=\"M2.5 9.5 12 5l9.5 4.5L12 14zM6 11.5v4.5c0 1.6 2.7 3 6 3s6-1.4 6-3v-4.5M21.5 9.5v6\"/>",
  "news":"<path d=\"M4 5.5h16v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 13.5h8M8 17h5\"/>",
  "shield":"<path d=\"M12 2.5 4.5 5.5v6c0 5 3.2 8.8 7.5 10 4.3-1.2 7.5-5 7.5-10v-6zM9 12l2 2 4-4\"/>",
  "bubble":"<path d=\"M20.5 12a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1-4.6A8.5 8.5 0 1 1 20.5 12z\"/>",
  "leaf":"<path d=\"M11 20.5a7.5 7.5 0 0 1-1.6-14.5C12.7 3 16.5 3 21 3c0 4.5 0 8.3-3 11.6A7.5 7.5 0 0 1 11 20.5zM3 21c1-3.5 3.2-6.5 6.5-8.5\"/>",
  "star":"<path d=\"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z\"/>",
  "trophy":"<path d=\"M8 21h8M12 17v4M6.5 3.5h11v5a5.5 5.5 0 0 1-11 0zM6.5 6h-3v1.5a3 3 0 0 0 3 3M17.5 6h3v1.5a3 3 0 0 1-3 3\"/>",
  "film":"<path d=\"M3.5 9h17v10.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5zM3.5 9 5 4.5l15-1 1 4.5M8.5 4.3 7 8.7M13 4l-1.5 4.5M17.5 3.7 16 8.2\"/>",
  "map":"<path d=\"M9 3.5 3.5 5.5v15L9 18.5l6 2 5.5-2v-15L15 5.5zM9 3.5v15M15 5.5v15\"/>",
  "cal":"<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"16\" rx=\"2.2\"/><path d=\"M3.5 10h17M8 3v4M16 3v4\"/>",
  "sheet":"<rect x=\"3.5\" y=\"4\" width=\"17\" height=\"16\" rx=\"2.2\"/><path d=\"M3.5 10h17M3.5 15h17M9.5 4v16\"/>",
  "slide":"<rect x=\"3\" y=\"4\" width=\"18\" height=\"12.5\" rx=\"2.2\"/><path d=\"M12 16.5V21M8 21h8\"/>",
  "cite":"<path d=\"M9 14H5.5A1.5 1.5 0 0 1 4 12.5v-4A1.5 1.5 0 0 1 5.5 7h2A1.5 1.5 0 0 1 9 8.5V14zM9 14a3.5 3.5 0 0 1-3.5 3.5M20 14h-3.5a1.5 1.5 0 0 1-1.5-1.5v-4A1.5 1.5 0 0 1 16.5 7h2A1.5 1.5 0 0 1 20 8.5V14zM20 14a3.5 3.5 0 0 1-3.5 3.5\"/>",
  "moon":"<path d=\"M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z\"/>",
  "lang":"<path d=\"M3.5 5.5h10M8.5 3.5v2c0 5-2.7 8.8-5.5 10.5M5 9c1.3 3.7 4.3 6.4 8 7.5M13 21l4-10 4 10M14.5 17.5h5\"/>",
  "help":"<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01\"/>",
  "out":"<path d=\"M9.5 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 16.5 20.5 12 16 7.5M20.5 12H9.5\"/>",
  "edit":"<path d=\"M12 20h9M16.6 3.4a2 2 0 0 1 2.8 2.8L8 17.6 3.5 18.5l.9-4.5z\"/>",
  "ext":"<path d=\"M14 4h6v6M20 4l-9.5 9.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10\"/>",
  "policy":"<path d=\"M7 3h7.5L19 7.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM14.5 3v4.5H19M9 12.5h6M9 16h6\"/>",
  "flag":"<path d=\"M4.5 21.5v-18M4.5 4h12.5l-2.2 4.5 2.2 4.5H4.5\"/>",
  "filter":"<path d=\"M4 5h16l-6.5 8v6l-3-1.5v-4.5z\"/>",
  "bold":"<path d=\"M7 4.5h6a3.5 3.5 0 0 1 0 7H7zM7 11.5h7a3.75 3.75 0 0 1 0 7.5H7z\"/>",
  "italic":"<path d=\"M10 4.5h8.5M5.5 19.5H14M14.5 4.5l-5 15\"/>",
  "list":"<path d=\"M8.5 6h12M8.5 12h12M8.5 18h12\"/><circle cx=\"4\" cy=\"6\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"4\" cy=\"12\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"4\" cy=\"18\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/>",
  "undo":"<path d=\"M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H10\"/>",
  "marker":"<path d=\"M4 20.5h16M14 4l6 6-8.5 8.5H6.5v-5z\"/>",
  "folder":"<path d=\"M4 4h5l2 3h9a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 4 4z\"/>",
  "trash":"<path d=\"M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z\"/>"};
const EXTRA = {"check":"stroke-width=\"2.5\""};

export const ICON_NAMES = Object.keys(P);

export default function Icon({ name, size, className, style, title }) {
  const d = P[name];
  if (!d) return null;
  const sw = /stroke-width="([\d.]+)"/.exec(EXTRA[name] || '');
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw ? sw[1] : 1.75} strokeLinecap="round" strokeLinejoin="round"
      width={size} height={size} className={className} style={style} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      dangerouslySetInnerHTML={{ __html: (title ? '<title>' + title + '</title>' : '') + d }} />
  );
}
