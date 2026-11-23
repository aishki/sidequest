import { and, desc, eq, gte, isNull, lt, sql as dsql } from 'drizzle-orm';
import { db, logEvent, schema, type Exec, type Source } from './db.ts';
import { listProjects, matchProject, type Project } from './projects.ts';
import { getTicket, updateTicket, type Ticket } from './tickets.ts';
import { fmtMin, parseKey, startOfDay, UserError } from './parse.ts';

const { timeEntries, projects, tickets } = schema;

/** A ticket key (WEB-014) or a project name (web, admin, this). */
export type Target = { project: Project; ticket?: Ticket };

export async function resolveTarget(input: string, x: Exec = db): Promise<Target> {
  const list = await listProjects(x);
  const key = parseKey(input);
  if (key && /\d/.test(input) && list.some((p) => p.prefix === key.prefix)) {
    const ticket = await getTicket(input, x);
    return { project: list.find((p) => p.id === ticket.projectId)!, ticket };
  }
  return { project: matchProject(input, list) };
}

const MINUTES = dsql<number>`coalesce(sum(extract(epoch from (coalesce(${timeEntries.endedAt}, now()) - ${timeEntries.startedAt})) / 60), 0)::float8`;

/** Logs work that already happened ("spent 2h on WEB-014"). */
export async function logTime(target: Target, startedAt: Date, minutes: number, note: string | undefined, source: Source) {
  const endedAt = new Date(startedAt.getTime() + minutes * 60_000);
  if (endedAt.getTime() > Date.now() + 60_000) {
    throw new UserError(`That entry would end in the future (${endedAt.toLocaleString('en-GB')}). Pick an earlier start.`);
  }
  return db.transaction(async (tx) => {
    const [entry] = await tx.insert(timeEntries).values({
      ticketId: target.ticket?.id ?? null, projectId: target.project.id, startedAt, endedAt,
      note: note?.trim() || null, source: 'chat',
    }).returning();
    await logEvent(tx, { kind: 'time.logged', source, ticketId: target.ticket?.id, projectId: target.project.id,
      data: { entryId: entry.id, minutes, key: target.ticket?.key ?? null, startedAt: startedAt.toISOString() } });
    return entry;
  });
}

export type RunningTimer = { entry: typeof timeEntries.$inferSelect; project: Project; ticket?: Ticket; minutes: number };

export async function runningTimer(x: Exec = db): Promise<RunningTimer | undefined> {
  const [entry] = await x.select().from(timeEntries).where(isNull(timeEntries.endedAt)).limit(1);
  if (!entry) return undefined;
  const [project] = await x.select().from(projects).where(eq(projects.id, entry.projectId));
  let ticket: Ticket | undefined;
  if (entry.ticketId) {
    const [t] = await x.select({ prefix: projects.prefix, number: tickets.number }).from(tickets)
      .innerJoin(projects, eq(projects.id, tickets.projectId)).where(eq(tickets.id, entry.ticketId));
    if (t) ticket = await getTicket(`${t.prefix}-${t.number}`, x);
  }
  return { entry, project, ticket, minutes: (Date.now() - entry.startedAt.getTime()) / 60_000 };
}

export const timerLabel = (r: RunningTimer) => r.ticket ? `${r.ticket.key} ${r.ticket.title}` : r.project.name;

/** Starts the timer. With `switchFrom`, a running timer is stopped first instead of being an error. */
export async function startTimer(target: Target, opts: { note?: string; switch?: boolean }, source: Source) {
  const result = await db.transaction(async (tx) => {
    const running = await runningTimer(tx);
    let stopped: { timer: RunningTimer; minutes: number } | undefined;
    if (running) {
      if (!opts.switch) {
        throw new UserError(`A timer is already running on ${timerLabel(running)} (${fmtMin(running.minutes)}). Stop it first, or start with --switch.`);
      }
      stopped = await stopInTx(tx, running, undefined, source);
    }
    const [entry] = await tx.insert(timeEntries).values({
      ticketId: target.ticket?.id ?? null, projectId: target.project.id, startedAt: new Date(),
      note: opts.note?.trim() || null, source: 'timer',
    }).returning();
    await logEvent(tx, { kind: 'timer.started', source, ticketId: target.ticket?.id, projectId: target.project.id,
      data: { entryId: entry.id, key: target.ticket?.key ?? null } });
    return { entry, stopped };
  });
  // Working on it means it's in progress.
  let moved = false;
  if (target.ticket && ['inbox', 'todo'].includes(target.ticket.status)) {
    await updateTicket(target.ticket.key, { status: 'in_progress' }, source);
    moved = true;
  }
  return { ...result, movedToInProgress: moved };
}

async function stopInTx(tx: Exec, running: RunningTimer, note: string | undefined, source: Source) {
  // ended_at must be after started_at, even for a timer stopped in the same second.
  const endedAt = new Date(Math.max(Date.now(), running.entry.startedAt.getTime() + 1000));
  const minutes = (endedAt.getTime() - running.entry.startedAt.getTime()) / 60_000;
  const set: Partial<typeof timeEntries.$inferInsert> = { endedAt };
  if (note?.trim()) set.note = [running.entry.note, note.trim()].filter(Boolean).join('\n');
  await tx.update(timeEntries).set(set).where(eq(timeEntries.id, running.entry.id));
  await logEvent(tx, { kind: 'timer.stopped', source, ticketId: running.ticket?.id, projectId: running.project.id,
    data: { entryId: running.entry.id, minutes: Math.round(minutes), key: running.ticket?.key ?? null } });
  return { timer: running, minutes };
}

export async function stopTimer(note: string | undefined, source: Source) {
  return db.transaction(async (tx) => {
    const running = await runningTimer(tx);
    if (!running) throw new UserError('No timer is running.');
    return stopInTx(tx, running, note, source);
  });
}

/** Throws the running entry away without logging it. */
export async function cancelTimer(source: Source) {
  return db.transaction(async (tx) => {
    const running = await runningTimer(tx);
    if (!running) throw new UserError('No timer is running.');
    await tx.delete(timeEntries).where(eq(timeEntries.id, running.entry.id));
    await logEvent(tx, { kind: 'timer.cancelled', source, ticketId: running.ticket?.id, projectId: running.project.id,
      data: { minutes: Math.round(running.minutes), key: running.ticket?.key ?? null } });
    return running;
  });
}

/** Minutes logged per project between two local days (from inclusive, to exclusive). Includes a running timer. */
export async function minutesByProject(fromDay: string, toDay: string, x: Exec = db) {
  return x.select({ projectId: timeEntries.projectId, prefix: projects.prefix, name: projects.name, minutes: MINUTES })
    .from(timeEntries).innerJoin(projects, eq(projects.id, timeEntries.projectId))
    .where(and(gte(timeEntries.startedAt, startOfDay(fromDay)), lt(timeEntries.startedAt, startOfDay(toDay))))
    .groupBy(timeEntries.projectId, projects.prefix, projects.name, projects.sortOrder)
    .orderBy(projects.sortOrder);
}

export async function ticketTime(ticketId: number, x: Exec = db) {
  const [{ minutes }] = await x.select({ minutes: MINUTES }).from(timeEntries).where(eq(timeEntries.ticketId, ticketId));
  const recent = await x.select().from(timeEntries).where(eq(timeEntries.ticketId, ticketId))
    .orderBy(desc(timeEntries.startedAt)).limit(5);
  return { minutes, recent };
}
