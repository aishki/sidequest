import { useSyncExternalStore } from 'react';

// Hash routes: #/board?t=WEB-001&project=3. The `t` param opens a ticket in the side panel.

export const SCREENS = ['today', 'board', 'projects', 'week', 'reports', 'tickets'] as const;
export type Screen = (typeof SCREENS)[number];

function read() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const screen = (SCREENS as readonly string[]).includes(path) ? (path as Screen) : 'today';
  return { screen, params: new URLSearchParams(query) };
}

let current = read();
let snapshot = location.hash;
const subs = new Set<() => void>();
window.addEventListener('hashchange', () => { current = read(); snapshot = location.hash; subs.forEach((f) => f()); });

export function useRoute() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snapshot);
  return current;
}

export function href(screen: Screen, params: Record<string, string | null | undefined> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return `#/${screen}${s ? `?${s}` : ''}`;
}

/** Changes query params on the current screen, keeping the others. */
export function setParams(patch: Record<string, string | null | undefined>) {
  const { screen, params } = read();
  const next: Record<string, string> = Object.fromEntries(params);
  for (const [k, v] of Object.entries(patch)) { if (v) next[k] = v; else delete next[k]; }
  location.hash = href(screen, next);
}

export const openTicket = (key: string) => setParams({ t: key });
export const closeTicket = () => setParams({ t: null });
