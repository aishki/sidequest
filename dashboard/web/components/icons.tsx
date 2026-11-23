import type { ReactNode } from 'react';

// 16px line icons in currentColor (design system: iconography).
const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>{children}</svg>
);

export const I = {
  search: <Svg><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Svg>,
  today: <Svg><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>,
  board: <Svg><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 7v7M12 7v4M16 7v9" /></Svg>,
  projects: <Svg><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></Svg>,
  week: <Svg><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>,
  reports: <Svg><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></Svg>,
  list: <Svg><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Svg>,
  close: <Svg><path d="M18 6 6 18M6 6l12 12" /></Svg>,
  play: <Svg><path d="M7 4v16l13-8Z" /></Svg>,
  stop: <Svg><rect x="6" y="6" width="12" height="12" rx="1.5" /></Svg>,
  plus: <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  check: <Svg><path d="M20 6 9 17l-5-5" /></Svg>,
  chevL: <Svg><path d="m15 18-6-6 6-6" /></Svg>,
  chevR: <Svg><path d="m9 18 6-6-6-6" /></Svg>,
  trash: <Svg><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>,
  file: <Svg><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></Svg>,
  sparkle: <Svg><path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.4l-1.8-4.9L5 9.7l5.2-1.8Z" /><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7Z" /></Svg>,
  copy: <Svg><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Svg>,
};

export const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <rect x="0" y="0" width="10" height="10" rx="3" fill="#8f6fd1" /><rect x="12" y="0" width="10" height="10" rx="3" fill="#c160d0" />
    <rect x="0" y="12" width="10" height="10" rx="3" fill="#d552a3" /><rect x="12" y="12" width="10" height="10" rx="3" fill="#ff70bf" />
  </svg>
);
