import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

// ---------- live version ----------
// The server pushes the latest event id whenever anything changes (from /t or from another tab).

let version = 0;
let connected = true;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function startLive() {
  const es = new EventSource('/api/live');
  es.onmessage = (m) => {
    const v = Number(m.data);
    if (v !== version) { version = v; emit(); }
    if (!connected) { connected = true; emit(); }
  };
  es.onerror = () => { if (connected) { connected = false; emit(); } };
}

/** Forces every view to refetch (after a write, before the server's push arrives). */
export function refresh() { version += 0.001; emit(); }

const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
export const useVersion = () => useSyncExternalStore(subscribe, () => version);
export const useConnected = () => useSyncExternalStore(subscribe, () => connected);

// ---------- requests ----------

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Can\'t reach the dashboard server. Is it still running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status}).`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T = unknown>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T = unknown>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = unknown>(path: string) => request<T>('DELETE', path),
};

/** Fetches `path` and refetches whenever anything changes. Keeps showing the last data while it reloads. */
export function useApi<T>(path: string | null) {
  const v = useVersion();
  const [state, setState] = useState<{ path: string | null; data?: T; error?: string }>({ path });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api.get<T>(path).then(
      (data) => alive && setState({ path, data }),
      (e: Error) => alive && setState((s) => ({ path, data: s.path === path ? s.data : undefined, error: e.message })),
    );
    return () => { alive = false; };
  }, [path, v]);
  const fresh = state.path === path;
  return { data: fresh ? state.data : undefined, error: fresh ? state.error : undefined };
}

// ---------- toasts ----------

export type Toast = { id: number; text: string; kind: 'info' | 'error' };
let toasts: Toast[] = [];
let toastId = 0;
const toastSubs = new Set<() => void>();
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = ++toastId;
  toasts = [...toasts, { id, text, kind }];
  toastSubs.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); toastSubs.forEach((f) => f()); }, kind === 'error' ? 7000 : 3500);
}
export const useToasts = () => useSyncExternalStore((f) => { toastSubs.add(f); return () => toastSubs.delete(f); }, () => toasts);

/** Runs a write, shows its error as a toast, refreshes views. Returns undefined on failure. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      refresh();
      return r;
    } catch (e) {
      toast((e as Error).message, 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy };
}
