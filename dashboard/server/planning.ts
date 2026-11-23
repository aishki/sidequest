import { and, gte, lt, lte } from 'drizzle-orm';
import { db, schema } from '../../src/core/db.ts';
import type { Project } from '../../src/core/projects.ts';
import { addDays, isoDate, mondayOf, startOfDay, weekday } from '../../src/core/parse.ts';
import type { Settings } from './settings.ts';

const { timeEntries, weekPlans } = schema;

type WeekPlan = { saturdayHours: number; sundayHours: number };

/** Hours available on one day: the work-week share on work days, opted-in weekend hours otherwise. */
export function dayHours(day: string, s: Settings, plan: WeekPlan | undefined): number {
  const wd = weekday(day);
  if (s.workDays.includes(wd)) return s.weekHours / (s.workDays.length || 1);
  if (wd === 6) return plan?.saturdayHours ?? 0;
  if (wd === 0) return plan?.sundayHours ?? 0;
  return 0;
}

/** Planned minutes per project for one day. Overhead projects (Admin) are never planned. */
export function dayTargets(day: string, projects: Project[], s: Settings, plan: WeekPlan | undefined): Map<number, number> {
  const hours = dayHours(day, s, plan);
  const planned = projects.filter((p) => !p.isOverhead && p.weeklyPct > 0);
  const total = planned.reduce((n, p) => n + p.weeklyPct, 0);
  const out = new Map<number, number>();
  for (const p of projects) out.set(p.id, total && planned.includes(p) ? (hours * 60 * p.weeklyPct) / total : 0);
  return out;
}

/** Weekend opt-ins for every week touching [fromDay, toDay). */
export async function weekPlansFor(fromDay: string, toDay: string) {
  const rows = await db.select().from(weekPlans)
    .where(and(gte(weekPlans.weekStart, mondayOf(fromDay)), lte(weekPlans.weekStart, toDay)));
  return new Map(rows.map((r) => [r.weekStart, r]));
}

/** Sum of planned minutes per project over [fromDay, toDay). */
export async function rangeTargets(fromDay: string, toDay: string, projects: Project[], s: Settings) {
  const plans = await weekPlansFor(fromDay, toDay);
  const totals = new Map<number, number>(projects.map((p) => [p.id, 0]));
  const weekend = new Map<number, number>(projects.map((p) => [p.id, 0]));
  for (let d = fromDay; d < toDay; d = addDays(d, 1)) {
    const wd = weekday(d);
    for (const [id, min] of dayTargets(d, projects, s, plans.get(mondayOf(d)))) {
      totals.set(id, (totals.get(id) ?? 0) + min);
      if (wd === 0 || wd === 6) weekend.set(id, (weekend.get(id) ?? 0) + min);
    }
  }
  return { totals, weekend };
}

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
