// Planning: work-week settings, each project's share of the week, weekend opt-ins, and the targets they produce.
// Shared by the tt CLI and the dashboard so both always agree on the numbers.
import { and, eq, gte, lt, lte } from 'drizzle-orm';
import { db, logEvent, schema, type Exec, type Source } from './db.ts';
import { listProjects, matchProject, type Project } from './projects.ts';
import { addDays, isoDate, mondayOf, startOfDay, UserError, weekday } from './parse.ts';

const { projects: projectsT, settings: settingsT, timeEntries, weekPlans } = schema;

// ---------- settings ----------

export type Settings = { weekHours: number; workDays: number[]; meetingHours: number; timezone: string };

const DEFAULTS: Settings = { weekHours: 40, workDays: [1, 2, 3, 4, 5], meetingHours: 0, timezone: 'auto' };

export async function getSettings(x: Exec = db): Promise<Settings> {
  const rows = await x.select().from(settingsT);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, ok: (n: number) => boolean, d: number) => {
    const n = Number(map.get(k) ?? d);
    return Number.isFinite(n) && ok(n) ? n : d;
  };
  const workDays = map.get('workDays');
  const timezone = map.get('timezone');
  return {
    weekHours: num('weekHours', (n) => n > 0, DEFAULTS.weekHours),
    workDays: Array.isArray(workDays) ? workDays.map(Number).filter((d) => d >= 0 && d <= 6) : DEFAULTS.workDays,
    meetingHours: num('meetingHours', (n) => n >= 0, DEFAULTS.meetingHours),
    timezone: typeof timezone === 'string' ? timezone : DEFAULTS.timezone,
  };
}

export type SettingsPatch = Partial<Pick<Settings, 'weekHours' | 'workDays' | 'meetingHours'>>;

export async function setSettings(patch: SettingsPatch, source: Source): Promise<Settings> {
  return db.transaction(async (tx) => {
    const cur = await getSettings(tx);
    const next = { ...cur, ...patch };
    if (!(next.weekHours > 0 && next.weekHours <= 100)) throw new UserError('Hours per week must be between 1 and 100.');
    if (!(next.meetingHours >= 0 && next.meetingHours < next.weekHours)) {
      throw new UserError(`Meeting hours must be at least 0 and less than your ${next.weekHours}h week.`);
    }
    next.workDays = [...new Set(next.workDays.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    if (!next.workDays.length) throw new UserError('Pick at least one work day.');
    const changed: Record<string, unknown> = {};
    for (const k of ['weekHours', 'workDays', 'meetingHours'] as const) {
      if (JSON.stringify(next[k]) === JSON.stringify(cur[k])) continue;
      changed[k] = next[k];
      await tx.insert(settingsT).values({ key: k, value: next[k] })
        .onConflictDoUpdate({ target: settingsT.key, set: { value: next[k], updatedAt: new Date() } });
    }
    if (Object.keys(changed).length) await logEvent(tx, { kind: 'settings.changed', source, data: changed });
    return next;
  });
}

/** Uses the timezone from settings, so "today" means the same day in tt and the dashboard. */
export async function applyTimezone() {
  const { timezone } = await getSettings();
  if (timezone !== 'auto') process.env.TZ = timezone;
}

// ---------- week plans ----------

export type WeekPlan = {
  weekStart: string;
  saturdayHours: number; sundayHours: number;
  saturdayProjectId: number | null; sundayProjectId: number | null;
  /** This week's split (project id -> percent), or null for the usual split. */
  shares: Record<string, number> | null;
};

const emptyPlan = (weekStart: string): WeekPlan => ({
  weekStart, saturdayHours: 0, sundayHours: 0, saturdayProjectId: null, sundayProjectId: null, shares: null,
});

const toPlan = (r: typeof weekPlans.$inferSelect): WeekPlan => ({
  weekStart: r.weekStart, saturdayHours: r.saturdayHours, sundayHours: r.sundayHours,
  saturdayProjectId: r.saturdayProjectId, sundayProjectId: r.sundayProjectId, shares: r.shares ?? null,
});

export async function getWeekPlan(day: string, x: Exec = db): Promise<WeekPlan> {
  const weekStart = mondayOf(day);
  const [row] = await x.select().from(weekPlans).where(eq(weekPlans.weekStart, weekStart));
  return row ? toPlan(row) : emptyPlan(weekStart);
}

/** Week plans for every week touching [fromDay, toDay), keyed by Monday. */
export async function weekPlansFor(fromDay: string, toDay: string) {
  const rows = await db.select().from(weekPlans)
    .where(and(gte(weekPlans.weekStart, mondayOf(fromDay)), lte(weekPlans.weekStart, toDay)));
  return new Map(rows.map((r) => [r.weekStart, toPlan(r)]));
}

export type WeekendDay = { hours: number; projectId?: number | null };

/** Opt in to weekend hours for one week. A day can put all its hours on one project; otherwise they follow the split. */
export async function setWeekend(day: string, change: { saturday?: WeekendDay; sunday?: WeekendDay }, source: Source) {
  const weekStart = mondayOf(day);
  return db.transaction(async (tx) => {
    const cur = await getWeekPlan(weekStart, tx);
    const list = await listProjects(tx);
    const pick = (d: WeekendDay | undefined, hours: number, projectId: number | null) => {
      if (!d) return { hours, projectId };
      if (!(d.hours >= 0 && d.hours <= 16)) throw new UserError('Weekend hours must be between 0 and 16 per day.');
      const pid = d.hours === 0 ? null : d.projectId === undefined ? projectId : d.projectId;
      if (pid != null) {
        const p = list.find((x) => x.id === pid);
        if (!p) throw new UserError('That project no longer exists.');
        if (p.isOverhead) throw new UserError(`${p.name} is overhead and never gets planned hours. Pick a project, or leave it to the split.`);
      }
      return { hours: d.hours, projectId: pid };
    };
    const sat = pick(change.saturday, cur.saturdayHours, cur.saturdayProjectId);
    const sun = pick(change.sunday, cur.sundayHours, cur.sundayProjectId);
    const set = {
      saturdayHours: sat.hours, sundayHours: sun.hours, saturdayProjectId: sat.projectId, sundayProjectId: sun.projectId,
    };
    await tx.insert(weekPlans).values({ weekStart, ...set }).onConflictDoUpdate({ target: weekPlans.weekStart, set });
    await logEvent(tx, { kind: 'week.weekend', source, data: { weekStart, ...set } });
    const name = (id: number | null) => (id == null ? null : list.find((p) => p.id === id)?.name ?? null);
    return {
      weekStart, saturday: addDays(weekStart, 5), sunday: addDays(weekStart, 6), ...set,
      saturdayProject: name(set.saturdayProjectId), sundayProject: name(set.sundayProjectId),
    };
  });
}

// ---------- shares ----------

/** Projects that get planned hours: not overhead, not archived. */
export const plannable = (list: Project[]) => list.filter((p) => !p.isOverhead && !p.archivedAt);

/** The usual split, scaled to add up to exactly 100. */
export function defaultShares(list: Project[]): Map<number, number> {
  const ps = plannable(list);
  const total = ps.reduce((n, p) => n + p.weeklyPct, 0);
  return new Map(ps.map((p) => [p.id, total ? (p.weeklyPct / total) * 100 : 0]));
}

/** The split that applies to a week: its own override if it has one, else the usual split. Always adds up to 100 (or 0). */
export function effectiveShares(list: Project[], plan: Pick<WeekPlan, 'shares'> | undefined): Map<number, number> {
  if (!plan?.shares) return defaultShares(list);
  const ps = plannable(list);
  const raw = new Map(ps.map((p) => [p.id, Math.max(0, Number(plan.shares![String(p.id)] ?? 0))]));
  const total = [...raw.values()].reduce((a, b) => a + b, 0);
  return new Map([...raw].map(([id, v]) => [id, total ? (v / total) * 100 : 0]));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Sets one project's percent and scales the others so the split still adds up to 100. */
export function rebalance(shares: Map<number, number>, id: number, pct: number): Map<number, number> {
  const others = [...shares].filter(([k]) => k !== id);
  const otherSum = others.reduce((n, [, v]) => n + v, 0);
  const left = 100 - pct;
  const out = new Map<number, number>([[id, pct]]);
  for (const [k, v] of others) out.set(k, otherSum > 0 ? (v * left) / otherSum : others.length ? left / others.length : 0);
  return new Map([...out].map(([k, v]) => [k, round3(v)]));
}

function checkShares(shares: Map<number, number>, list: Project[]) {
  const ok = new Set(plannable(list).map((p) => p.id));
  for (const [id, v] of shares) {
    if (!ok.has(id)) {
      const p = list.find((x) => x.id === id);
      throw new UserError(p ? `${p.name} is overhead and never gets planned hours.` : `Unknown project id ${id}.`);
    }
    if (!(Number.isFinite(v) && v >= 0 && v <= 100)) throw new UserError('Each share must be between 0% and 100%.');
  }
  const total = [...shares.values()].reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 0.5) throw new UserError(`The split adds up to ${Math.round(total * 10) / 10}%. It needs to add up to 100%.`);
}

/**
 * Saves a whole split. With `week`, it applies to that week only; otherwise it becomes the usual split for every week.
 * Projects left out get 0%.
 */
export async function setShares(input: Map<number, number>, opts: { week?: string }, source: Source) {
  return db.transaction(async (tx) => {
    const list = await listProjects(tx);
    const shares = new Map(plannable(list).map((p) => [p.id, round3(input.get(p.id) ?? 0)]));
    for (const id of input.keys()) if (!shares.has(id)) shares.set(id, input.get(id)!);
    checkShares(shares, list);
    const data = Object.fromEntries([...shares].map(([k, v]) => [String(k), v]));
    if (opts.week) {
      const weekStart = mondayOf(opts.week);
      await tx.insert(weekPlans).values({ weekStart, shares: data })
        .onConflictDoUpdate({ target: weekPlans.weekStart, set: { shares: data } });
      await logEvent(tx, { kind: 'week.shares', source, data: { weekStart, shares: data } });
    } else {
      for (const [id, pct] of shares) await tx.update(projectsT).set({ weeklyPct: pct }).where(eq(projectsT.id, id));
      await logEvent(tx, { kind: 'project.shares', source, data: { shares: data } });
    }
    return shares;
  });
}

/** Changes one project's share and rebalances the rest. */
export async function setShare(projectInput: string, pct: number, opts: { week?: string }, source: Source) {
  const list = await listProjects();
  const p = matchProject(projectInput, list);
  if (p.isOverhead) throw new UserError(`${p.name} is overhead and never gets planned hours.`);
  if (!(pct >= 0 && pct <= 100)) throw new UserError('A share must be between 0% and 100%.');
  const base = opts.week ? effectiveShares(list, await getWeekPlan(opts.week)) : defaultShares(list);
  const shares = await setShares(rebalance(base, p.id, pct), opts, source);
  return { project: p, shares };
}

/** Drops a week's own split so it goes back to the usual one. */
export async function clearWeekShares(day: string, source: Source) {
  const weekStart = mondayOf(day);
  return db.transaction(async (tx) => {
    await tx.update(weekPlans).set({ shares: null }).where(eq(weekPlans.weekStart, weekStart));
    await logEvent(tx, { kind: 'week.shares', source, data: { weekStart, shares: null } });
    return { weekStart };
  });
}

// ---------- targets ----------

/** Hours for focused project work on one day: (week - meetings) spread over work days, or the weekend opt-in. */
export function dayHours(day: string, s: Settings, plan: WeekPlan | undefined): number {
  const wd = weekday(day);
  if (s.workDays.includes(wd)) return Math.max(0, s.weekHours - s.meetingHours) / (s.workDays.length || 1);
  if (wd === 6) return plan?.saturdayHours ?? 0;
  if (wd === 0) return plan?.sundayHours ?? 0;
  return 0;
}

/** Planned minutes per project for one day. Overhead projects (Admin) are never planned. */
export function dayTargets(day: string, list: Project[], s: Settings, plan: WeekPlan | undefined): Map<number, number> {
  const hours = dayHours(day, s, plan);
  const out = new Map<number, number>(list.map((p) => [p.id, 0]));
  const wd = weekday(day);
  const only = s.workDays.includes(wd) ? null : wd === 6 ? plan?.saturdayProjectId : wd === 0 ? plan?.sundayProjectId : null;
  if (only != null && out.has(only)) {
    out.set(only, hours * 60);
    return out;
  }
  for (const [id, pct] of effectiveShares(list, plan)) out.set(id, (hours * 60 * pct) / 100);
  return out;
}

/** Sum of planned minutes per project over [fromDay, toDay), plus the weekend part of it. */
export async function rangeTargets(fromDay: string, toDay: string, list: Project[], s: Settings) {
  const plans = await weekPlansFor(fromDay, toDay);
  const totals = new Map<number, number>(list.map((p) => [p.id, 0]));
  const weekend = new Map<number, number>(list.map((p) => [p.id, 0]));
  for (let d = fromDay; d < toDay; d = addDays(d, 1)) {
    const wd = weekday(d);
    for (const [id, min] of dayTargets(d, list, s, plans.get(mondayOf(d)))) {
      totals.set(id, (totals.get(id) ?? 0) + min);
      if (wd === 0 || wd === 6) weekend.set(id, (weekend.get(id) ?? 0) + min);
    }
  }
  return { totals, weekend };
}

// ---------- logged time ----------

export type Entry = { projectId: number; ticketId: number | null; day: string; minutes: number; running: boolean };

/** Time entries that started in [fromDay, toDay), bucketed by local start day. A running timer counts up to now. */
export async function entriesBetween(fromDay: string, toDay: string): Promise<Entry[]> {
  const rows = await db.select({
    projectId: timeEntries.projectId, ticketId: timeEntries.ticketId,
    startedAt: timeEntries.startedAt, endedAt: timeEntries.endedAt,
  }).from(timeEntries)
    .where(and(gte(timeEntries.startedAt, startOfDay(fromDay)), lt(timeEntries.startedAt, startOfDay(toDay))));
  const now = Date.now();
  return rows.map((r) => ({
    projectId: r.projectId, ticketId: r.ticketId, day: isoDate(r.startedAt), running: !r.endedAt,
    minutes: Math.max(0, ((r.endedAt?.getTime() ?? now) - r.startedAt.getTime()) / 60_000),
  }));
}

export function sumBy<T>(items: T[], key: (t: T) => number | string, value: (t: T) => number) {
  const out = new Map<number | string, number>();
  for (const it of items) out.set(key(it), (out.get(key(it)) ?? 0) + value(it));
  return out;
}
