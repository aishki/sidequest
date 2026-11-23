// Reports: the numbers behind the Reports screen and `tt report`, plus the written summary.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { and, count, eq, gte, inArray, lt, sql as dsql } from 'drizzle-orm';
import { db, logEvent, schema, type Source } from './db.ts';
import { listProjects } from './projects.ts';
import { listTickets, type Ticket } from './tickets.ts';
import { addDays, fmtDay, fmtMin, isoDate, label, mondayOf, startOfDay, today, UserError, weekday } from './parse.ts';
import { entriesBetween, getSettings, rangeTargets, sumBy } from './planning.ts';

const { tickets, events, timeEntries, reportSummaries } = schema;

export const PERIODS = ['week', 'month', 'quarter'] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(input: string | null | undefined): Period {
  const v = (input ?? 'week').toLowerCase().replace(/ly$/, '');
  if (v === 'q') return 'quarter';
  if ((PERIODS as readonly string[]).includes(v)) return v as Period;
  throw new UserError(`"${input}" isn't a report period. Use week, month or quarter.`);
}

/** [from, to) for the period holding `day`. */
export function periodRange(period: Period, day: string): { from: string; to: string } {
  if (period === 'week') { const from = mondayOf(day); return { from, to: addDays(from, 7) }; }
  const d = startOfDay(day);
  const firstMonth = period === 'quarter' ? Math.floor(d.getMonth() / 3) * 3 : d.getMonth();
  const start = new Date(d.getFullYear(), firstMonth, 1);
  const end = new Date(d.getFullYear(), firstMonth + (period === 'quarter' ? 3 : 1), 1);
  return { from: isoDate(start), to: isoDate(end) };
}

/** The same period shifted by n steps, as a day inside it. */
export function stepPeriod(period: Period, from: string, n: number): string {
  if (period === 'week') return addDays(from, n * 7);
  const d = startOfDay(from);
  d.setMonth(d.getMonth() + n * (period === 'quarter' ? 3 : 1));
  return isoDate(d);
}

export function periodLabel(period: Period, from: string, to: string): string {
  const d = startOfDay(from);
  if (period === 'week') {
    const thu = startOfDay(addDays(from, 3));
    const jan4 = new Date(thu.getFullYear(), 0, 4);
    const wk = 1 + Math.round(((thu.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
    return `W${wk} · ${fmtDay(from)} to ${fmtDay(addDays(to, -1))}`;
  }
  if (period === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

export type ShippedTicket = Ticket & {
  /** Local day it was marked done. */
  doneDay: string;
  /** All time logged on the ticket, not only inside the period. */
  minutes: number;
  /** When work started: first move to In progress or first time logged, else when it was created. */
  startedAt: Date;
  daysToDone: number;
  /** Null when it had no due date. */
  onTime: boolean | null;
};

export type Summary = { body: string; author: string; updatedAt: Date };

export async function buildReport(period: Period, day = today()) {
  const { from, to } = periodRange(period, day);
  const [projects, s, done, entries, created, summary] = await Promise.all([
    listProjects(), getSettings(),
    listTickets({ doneBetween: { from: startOfDay(from), to: startOfDay(to) }, limit: 5000 }),
    entriesBetween(from, to),
    // Tickets created in the range that still exist, so deleted ones don't inflate the count.
    db.select({ n: count() }).from(tickets).where(and(gte(tickets.createdAt, startOfDay(from)), lt(tickets.createdAt, startOfDay(to)))),
    getSummary(period, from),
  ]);
  const shipped = await shippedDetails(done);
  const { totals, weekend: weekendTargets } = await rangeTargets(from, to, projects, s);
  const isWeekend = (d: string) => [0, 6].includes(weekday(d));
  const weekdayLogged = sumBy(entries.filter((e) => !isWeekend(e.day)), (e) => e.projectId, (e) => e.minutes);
  const weekendLogged = sumBy(entries.filter((e) => isWeekend(e.day)), (e) => e.projectId, (e) => e.minutes);

  const days: { day: string; minutes: number; byProject: Record<number, number> }[] = [];
  const byDay = new Map<string, Record<number, number>>();
  for (const e of entries) {
    const m = byDay.get(e.day) ?? {};
    m[e.projectId] = (m[e.projectId] ?? 0) + e.minutes;
    byDay.set(e.day, m);
  }
  for (let d = from; d < to; d = addDays(d, 1)) {
    const m = byDay.get(d) ?? {};
    days.push({ day: d, minutes: Object.values(m).reduce((n, v) => n + v, 0), byProject: m });
  }

  const rows = projects.map((p) => ({
    id: p.id, name: p.name, prefix: p.prefix, color: p.color, isOverhead: p.isOverhead,
    targetMin: totals.get(p.id) ?? 0, weekendTargetMin: weekendTargets.get(p.id) ?? 0,
    weekdayMin: weekdayLogged.get(p.id) ?? 0, weekendMin: weekendLogged.get(p.id) ?? 0,
    shipped: shipped.filter((t) => t.projectId === p.id).length,
  }));
  const withDue = shipped.filter((t) => t.onTime != null);
  const stats = {
    loggedMin: entries.reduce((n, e) => n + e.minutes, 0),
    targetMin: rows.reduce((n, p) => n + p.targetMin, 0),
    weekendMin: rows.reduce((n, p) => n + p.weekendMin, 0),
    shipped: shipped.length,
    created: created[0].n,
    dueCount: withDue.length,
    onTimeCount: withDue.filter((t) => t.onTime).length,
    /** Null when nothing shipped. */
    avgDaysToDone: shipped.length ? shipped.reduce((n, t) => n + t.daysToDone, 0) / shipped.length : null,
    launchFilms: shipped.filter((t) => t.type === 'launch_film').length,
  };
  return { period, from, to, today: today(), label: periodLabel(period, from, to), stats, days, projects: rows, shipped, summary };
}

export type Report = Awaited<ReturnType<typeof buildReport>>;

async function shippedDetails(list: Ticket[]): Promise<ShippedTicket[]> {
  if (!list.length) return [];
  const ids = list.map((t) => t.id);
  const [started, firstLogged, logged] = await Promise.all([
    db.select({ id: events.ticketId, at: dsql<Date>`min(${events.at})`.mapWith((v) => new Date(v)) }).from(events)
      .where(and(inArray(events.ticketId, ids), eq(events.kind, 'ticket.updated'), dsql`${events.data}->'changes'->'status'->>'to' = 'in_progress'`))
      .groupBy(events.ticketId),
    db.select({ id: timeEntries.ticketId, at: dsql<Date>`min(${timeEntries.startedAt})`.mapWith((v) => new Date(v)) }).from(timeEntries)
      .where(inArray(timeEntries.ticketId, ids)).groupBy(timeEntries.ticketId),
    db.select({
      id: timeEntries.ticketId,
      min: dsql<number>`sum(extract(epoch from coalesce(${timeEntries.endedAt}, now()) - ${timeEntries.startedAt})) / 60`.mapWith(Number),
    }).from(timeEntries).where(inArray(timeEntries.ticketId, ids)).groupBy(timeEntries.ticketId),
  ]);
  const at = (rows: { id: number | null; at: Date }[], id: number) => rows.find((r) => r.id === id)?.at;
  return list.map((t) => {
    const doneAt = t.doneAt!;
    const candidates = [at(started, t.id), at(firstLogged, t.id)].filter((d): d is Date => !!d && d <= doneAt);
    const startedAt = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : t.createdAt;
    const doneDay = isoDate(doneAt);
    return {
      ...t, doneDay, startedAt,
      minutes: logged.find((r) => r.id === t.id)?.min ?? 0,
      daysToDone: Math.max(0, (doneAt.getTime() - startedAt.getTime()) / 86_400_000),
      onTime: t.dueOn ? doneDay <= t.dueOn : null,
    };
  }).sort((a, b) => a.doneAt!.getTime() - b.doneAt!.getTime());
}

// ---------- summary ----------

export async function getSummary(period: Period, from: string): Promise<Summary | null> {
  const [row] = await db.select().from(reportSummaries)
    .where(and(eq(reportSummaries.period, period), eq(reportSummaries.fromDay, from)));
  return row ? { body: row.body, author: row.author, updatedAt: row.updatedAt } : null;
}

/** Saves the summary for the period holding `day`. An empty body removes it. */
export async function saveSummary(period: Period, day: string, body: string, author: string, source: Source) {
  const { from } = periodRange(period, day);
  const text = body.replace(/\r\n/g, '\n').trim();
  if (text.length > 8000) throw new UserError('That summary is too long. Keep it under 8,000 characters.');
  await db.transaction(async (tx) => {
    const where = and(eq(reportSummaries.period, period), eq(reportSummaries.fromDay, from));
    if (!text) await tx.delete(reportSummaries).where(where);
    else {
      await tx.insert(reportSummaries).values({ period, fromDay: from, body: text, author, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [reportSummaries.period, reportSummaries.fromDay], set: { body: text, author, updatedAt: new Date() } });
    }
    await logEvent(tx, { kind: text ? 'report.summary' : 'report.summary_cleared', source, data: { period, from, author } });
  });
  return { period, from, summary: text ? await getSummary(period, from) : null };
}

/** The facts Claude writes the summary from, as plain text. */
export function summaryFacts(r: Report): string {
  const h = (min: number) => fmtMin(Math.round(min));
  const { stats: s } = r;
  const lines = [
    `Period: ${r.period}, ${r.label}${r.today >= r.from && r.today < r.to ? ` (in progress, today is ${fmtDay(r.today)})` : ''}`,
    `Logged ${h(s.loggedMin)} of ${h(s.targetMin)} planned.${s.weekendMin ? ` ${h(s.weekendMin)} of that was on weekends, extra to the planned week.` : ''}`,
    `Shipped ${s.shipped} ticket${s.shipped === 1 ? '' : 's'}, created ${s.created}.${s.dueCount ? ` ${s.onTimeCount} of ${s.dueCount} with a due date were on time.` : ''}`,
    '', 'Hours by project (logged / planned):',
    ...r.projects.filter((p) => p.targetMin || p.weekdayMin || p.weekendMin)
      .map((p) => `- ${p.name}: ${h(p.weekdayMin + p.weekendMin)} / ${p.isOverhead ? 'overhead, not planned' : h(p.targetMin)}${p.weekendMin ? ` (${h(p.weekendMin)} on weekends)` : ''}`),
    '', 'Shipped tickets:',
    ...(r.shipped.length
      ? r.shipped.map((t) => `- ${t.key} "${t.title}" (${t.projectName}, ${label(t.type)}, done ${fmtDay(t.doneDay)}, ${h(t.minutes)} logged${t.onTime === false ? `, due ${fmtDay(t.dueOn!)}` : ''})`)
      : ['- none']),
  ];
  return lines.join('\n');
}

const SYSTEM = [
  'You write a short work update for the user to send their manager, from their personal ticket tracker.',
  'Write in the first person as the user. Plain text only: no headings, no bold, no emoji.',
  'Start with one sentence on the period overall, then 3 to 6 lines that each start with "- ".',
  'Lead with what shipped, using the ticket titles as written with the key in parentheses, grouped by project when that reads better.',
  'Mention hours only where they say something: the total, the biggest projects, a clear gap against plan, and weekend hours as extra time.',
  'Skip projects with no time logged; do not list them one by one. Skip the created-ticket count unless it stands out.',
  'State only facts in the data. Do not invent reasons, outcomes, blockers or next steps.',
  'If the period is still in progress, write it as progress so far. Keep it under 130 words. Output only the update.',
].join(' ');

let drafting = false;

/** Drafts the summary with the local Claude Code CLI (no API key needed) and saves it. */
export async function draftSummary(period: Period, day: string, source: Source) {
  if (drafting) throw new UserError('A summary is already being written. Give it a few seconds.');
  drafting = true;
  try {
    const report = await buildReport(period, day);
    if (!report.stats.loggedMin && !report.stats.shipped) {
      throw new UserError('Nothing to summarize yet: no time logged and nothing shipped in this period.');
    }
    const body = await runClaude(`Write my update for this ${period}.\n\n${summaryFacts(report)}`);
    return await saveSummary(period, day, body, 'claude', source);
  } finally {
    drafting = false;
  }
}

function runClaude(prompt: string): Promise<string> {
  const bin = process.env.SIDEQUEST_CLAUDE_BIN || 'claude';
  const model = process.env.SIDEQUEST_SUMMARY_MODEL || 'sonnet';
  const args = ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--no-session-persistence',
    '--setting-sources', '', '--system-prompt', SYSTEM];
  return new Promise((resolve, reject) => {
    // A neutral folder, so no project instructions get pulled in.
    const child = spawn(bin, args, { cwd: tmpdir(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new UserError('Claude took too long to answer. Try again.')); }, 120_000);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new UserError(e.code === 'ENOENT'
        ? 'Couldn\'t find Claude Code (the claude command). Install it, or set SIDEQUEST_CLAUDE_BIN in .env. You can also ask /t to write the summary.'
        : `Couldn't start Claude Code: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code === 0 && text) resolve(text);
      else reject(new UserError(`Claude Code didn't write a summary${err.trim() ? `: ${err.trim().split('\n').at(-1)}` : '.'} Is it signed in?`));
    });
    child.stdin.end(prompt);
  });
}
