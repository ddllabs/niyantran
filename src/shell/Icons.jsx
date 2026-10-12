export function Icon({ name, size = 16 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  switch (name) {
    case 'chevron':
      return (
        <svg {...p}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    case 'search':
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.2-3.2" />
        </svg>
      );
    case 'mic':
      return (
        <svg {...p}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...p}>
          <path d="M21 12a9 9 0 1 1-2.3-6M21 4v6h-6" />
        </svg>
      );
    case 'globe':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...p}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
        </svg>
      );
    case 'home':
      return (
        <svg {...p}>
          <path d="M4 11l8-7 8 7v9H4z" />
        </svg>
      );
    case 'landmark':
      return (
        <svg {...p}>
          <path d="M4 21h16M4 10h16M12 3l8 7H4zM7 10v11M12 10v11M17 10v11" />
        </svg>
      );
    case 'map':
      return (
        <svg {...p}>
          <path d="M9 4l6 2 5-2v16l-5 2-6-2-5 2V6z" />
        </svg>
      );
    case 'building':
      return (
        <svg {...p}>
          <path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6" />
        </svg>
      );
    case 'scale':
      return (
        <svg {...p}>
          <path d="M12 3v18M5 7h14M5 7l-3 6h6zm14 0l-3 6h6z" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...p}>
          <path d="M4 20h16M7 16V10M12 16V6M17 16v-8" />
        </svg>
      );
    case 'leaf':
      return (
        <svg {...p}>
          <path d="M5 19c8-1 12-8 14-14-6 2-13 6-14 14zM5 19c3-6 8-10 14-14" />
        </svg>
      );
    case 'sport':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18M3 12h18" />
        </svg>
      );
    case 'film':
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M8 5v14M16 5v14" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...p}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case 'close':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'info':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6M12 7h.01" />
        </svg>
      );
    case 'filter':
      return (
        <svg {...p}>
          <path d="M4 5h16l-6 7v5l-4 2v-7z" />
        </svg>
      );
    default:
      return null;
  }
}

export const TAB_ICON = {
  home: 'home',
  global: 'globe',
  national: 'landmark',
  state: 'map',
  local: 'building',
  law: 'scale',
  economics: 'chart',
  carbon: 'leaf',
  sports: 'sport',
  entertainment: 'film',
};
