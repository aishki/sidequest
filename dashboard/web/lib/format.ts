import type { Priority, Status, TicketType } from './types.ts';

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (iso: string, n: number) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoDate(d); };
export const weekdayOf = (iso: string) => parseIso(iso).getDay();
export const mondayOf = (iso: string) => addDays(iso, -((weekdayOf(iso) + 6) % 7));

/** "Mon 23 Nov" */
export const fmtDay = (iso: string) => parseIso(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
/** "Monday, Nov 23" */
export const fmtLongDay = (iso: string) => {
  const d = parseIso(iso);
  return `${d.toLocaleDateString('en-US', { weekday: 'long' })}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
};
/** "Nov 19 · 10:42" */
export const fmtStamp = (s: string) => {
  const d = new Date(s);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtClock = (s: string) => { const d = new Date(s); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Hours, one decimal: "2.4h". */
export const hrs = (min: number) => `${(Math.round(min / 6) / 10).toFixed(1)}h`;
/** Duration for timers and estimates: "1h05m", "25m". */
export const dur = (min: number) => {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) + 'm' : ''}`;
};
/** Running clock: "1:05:09". */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

/** ISO week number, "W48". */
export function weekNo(iso: string) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

export const TYPE_LABEL: Record<TicketType, string> = {
  feature: 'Feature', bug: 'Bug', ui_ux: 'UI/UX', update: 'Update', launch_film: 'Launch film', research: 'Research', admin: 'Admin',
};
/** Design-system token suffix for each type tag. */
export const TYPE_TOKEN: Record<TicketType, string> = {
  feature: 'feature', bug: 'bug', ui_ux: 'uiux', update: 'update', launch_film: 'demo', research: 'research', admin: 'admin',
};
export const STATUS_LABEL: Record<Status, string> = {
  inbox: 'Inbox', todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done',
};
export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };

/** Due/planned label relative to today: "Today", "Tomorrow", "Fri", "3 Dec", "2d late". */
export function relDay(iso: string, today: string) {
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  const diff = Math.round((parseIso(iso).getTime() - parseIso(today).getTime()) / 86_400_000);
  if (diff > 1 && diff < 7) return parseIso(iso).toLocaleDateString('en-GB', { weekday: 'short' });
  return parseIso(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
