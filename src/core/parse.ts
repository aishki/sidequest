// Pure parsing and formatting helpers. No database access here.

/** A mistake in the input. exitCode 2 means "ask the user", e.g. an ambiguous project name. */
export class UserError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

// ---------- enums ----------

export const TYPES = ['feature', 'bug', 'ui_ux', 'update', 'launch_film', 'research', 'admin'] as const;
export const STATUSES = ['inbox', 'todo', 'in_progress', 'blocked', 'done'] as const;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TicketType = (typeof TYPES)[number];
export type TicketStatus = (typeof STATUSES)[number];
export type TicketPriority = (typeof PRIORITIES)[number];

const TYPE_ALIASES: Record<string, TicketType> = {
  feat: 'feature', 'ui': 'ui_ux', 'ux': 'ui_ux', 'ui ux': 'ui_ux', 'ui/ux': 'ui_ux', uiux: 'ui_ux', design: 'ui_ux',
  'launch film': 'launch_film', film: 'launch_film', launch: 'launch_film', video: 'launch_film',
  fix: 'bug', spike: 'research',
};
const STATUS_ALIASES: Record<string, TicketStatus> = {
  'to do': 'todo', planned: 'todo', open: 'todo',
  'in progress': 'in_progress', doing: 'in_progress', wip: 'in_progress', started: 'in_progress', progress: 'in_progress',
  waiting: 'blocked', stuck: 'blocked',
  finished: 'done', complete: 'done', completed: 'done', closed: 'done', shipped: 'done',
};
const PRIORITY_ALIASES: Record<string, TicketPriority> = { med: 'normal', medium: 'normal', asap: 'urgent', critical: 'urgent' };

const normWord = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

function parseEnum<T extends string>(what: string, all: readonly T[], aliases: Record<string, T>, input: string): T {
  const s = normWord(input);
  const direct = all.find((v) => v === s || v.replace(/_/g, ' ') === s);
  const hit = direct ?? aliases[s];
  if (!hit) throw new UserError(`Unknown ${what} "${input}". Use one of: ${all.map(label).join(', ')}.`);
  return hit;
}
export const parseType = (s: string) => parseEnum('type', TYPES, TYPE_ALIASES, s);
export const parseStatus = (s: string) => parseEnum('status', STATUSES, STATUS_ALIASES, s);
export const parsePriority = (s: string) => parseEnum('priority', PRIORITIES, PRIORITY_ALIASES, s);

/** Display label for an enum value: ui_ux -> UI/UX, in_progress -> in progress. */
export function label(v: string): string {
  return v === 'ui_ux' ? 'UI/UX' : v.replace(/_/g, ' ');
}

// ---------- ticket keys ----------

export function parseKey(input: string): { prefix: string; number: number } | null {
  const s = input.trim();
  const m = s.match(/^([A-Za-z][A-Za-z0-9]{1,5})-0*(\d{1,6})$/) ?? s.match(/^([A-Za-z]{2,6})0*(\d{1,6})$/);
  if (!m) return null;
  const number = Number(m[2]);
  return number > 0 ? { prefix: m[1].toUpperCase(), number } : null;
}

export const formatKey = (prefix: string, number: number) => `${prefix}-${String(number).padStart(3, '0')}`;

// ---------- titles ----------

export function cleanTitle(input: string): string {
  const t = input.replace(/\s+/g, ' ').trim();
  if (!t) throw new UserError('The title is empty.');
  if (t.length > 200) throw new UserError(`The title is ${t.length} characters; keep it under 200 and put the rest in --notes.`);
  return t;
}

// ---------- durations ----------

/** "2h", "90m", "1h30m", "1.5h", "1:30", "2 hours" -> minutes. */
export function parseDuration(input: string): number {
  const s = input.toLowerCase().replace(/\s+/g, '');
  let min: number | undefined;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):([0-5]\d)$/))) {
    min = Number(m[1]) * 60 + Number(m[2]);
  } else if ((m = s.match(/^(?:(\d+(?:\.\d+)?)h(?:rs?|ours?)?)?(?:(\d+)m(?:ins?|inutes?)?)?$/)) && (m[1] || m[2])) {
    min = Math.round((m[1] ? parseFloat(m[1]) * 60 : 0) + (m[2] ? Number(m[2]) : 0));
  } else if (/^\d+(\.\d+)?$/.test(s)) {
    throw new UserError(`"${input}" needs a unit: ${input}h or ${input}m?`);
  }
  if (min === undefined) throw new UserError(`Can't read duration "${input}". Use 2h, 45m, 1h30m or 1:30.`);
  if (min <= 0) throw new UserError('The duration must be more than 0 minutes.');
  if (min > 24 * 60) throw new UserError(`${fmtMin(min)} is more than a day. Split it into one entry per day.`);
  return min;
}

/** 150 -> "2h30m", 60 -> "1h", 45 -> "45m". */
export function fmtMin(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h${String(m).padStart(2, '0')}m` : `${h}h`;
}

// ---------- dates (local time) ----------

const pad2 = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const today = () => isoDate(new Date());

/** Local midnight at the start of an ISO date. */
export function startOfDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const addDays = (iso: string, n: number) => {
  const d = startOfDay(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
/** 0 = Sunday ... 6 = Saturday. */
export const weekday = (iso: string) => startOfDay(iso).getDay();
/** The Monday on or before the date. */
export const mondayOf = (iso: string) => addDays(iso, -((weekday(iso) + 6) % 7));

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * today / tomorrow / yesterday / a weekday / YYYY-MM-DD.
 * A weekday means the next one (today included) for 'future', the last one (today included) for 'past'.
 */
export function parseDay(input: string, dir: 'future' | 'past', base = today()): string {
  const s = input.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (isoDate(startOfDay(s)) !== s) throw new UserError(`${input} is not a real date.`);
    return s;
  }
  if (s === 'today' || s === 'tod') return base;
  if (s === 'tomorrow' || s === 'tmr' || s === 'tmrw') return addDays(base, 1);
  if (s === 'yesterday' || s === 'yday') return addDays(base, -1);
  const idx = s.length >= 3 ? DAY_NAMES.findIndex((d) => d.startsWith(s)) : -1;
  if (idx >= 0) {
    const wd = weekday(base);
    return dir === 'future' ? addDays(base, (idx - wd + 7) % 7) : addDays(base, -((wd - idx + 7) % 7));
  }
  throw new UserError(`Can't read date "${input}". Use YYYY-MM-DD, today, tomorrow, yesterday or a weekday.`);
}

/** Like parseDay, but "none" / "clear" / "-" mean no date. */
export function parseDayOrNone(input: string, dir: 'future' | 'past'): string | null {
  return ['none', 'clear', '-', 'null'].includes(input.trim().toLowerCase()) ? null : parseDay(input, dir);
}

/** "14:30", "9:05", "9am", "2:30pm" -> minutes after midnight. */
export function parseClock(input: string): number {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  let m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(1[0-2]|0?[1-9])(?::([0-5]\d))?(am|pm)$/);
  if (m) return ((Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + Number(m[2] ?? 0);
  throw new UserError(`Can't read time "${input}". Use 14:30 or 2:30pm.`);
}

/** "Mon 23 Nov". */
export function fmtDay(iso: string): string {
  return startOfDay(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "14:05". */
export const fmtClock = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
