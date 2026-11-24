import { and, asc, eq, getTableColumns, inArray, isNull, gte, lt, lte, sql as dsql, type SQL } from 'drizzle-orm';
import { db, logEvent, schema, type Exec, type Source } from './db.ts';
import { listProjects, matchProject } from './projects.ts';
import {
  addDays, cleanTitle, formatKey, parseKey, today, UserError, STATUSES,
  type TicketPriority, type TicketStatus, type TicketType,
} from './parse.ts';

const { tickets, projects, subtasks, timeEntries } = schema;

const ticketCols = {
  ...getTableColumns(tickets),
  prefix: projects.prefix,
  projectName: projects.name,
  color: projects.color,
  projectSort: projects.sortOrder,
};
type TicketRow = Awaited<ReturnType<typeof selectTickets>>[number];
export type Ticket = Omit<TicketRow, 'projectSort'> & { key: string };

const withKey = ({ projectSort: _, ...r }: TicketRow): Ticket => ({ ...r, key: formatKey(r.prefix, r.number) });

function selectTickets(x: Exec) {
  return x.select(ticketCols).from(tickets).innerJoin(projects, eq(projects.id, tickets.projectId));
}

export async function getTicket(keyInput: string, x: Exec = db): Promise<Ticket> {
  const k = parseKey(keyInput);
  if (!k) throw new UserError(`"${keyInput}" isn't a ticket key. Keys look like WEB-014.`);
  const [row] = await selectTickets(x).where(and(eq(projects.prefix, k.prefix), eq(tickets.number, k.number)));
  if (!row) throw new UserError(`${formatKey(k.prefix, k.number)} doesn't exist.`);
  return withKey(row);
}

/** Takes the project's next ticket number. Must run inside the transaction that inserts the ticket. */
async function takeNumber(x: Exec, projectId: number): Promise<number> {
  const [row] = await x.update(projects)
    .set({ nextNumber: dsql`${projects.nextNumber} + 1` })
    .where(eq(projects.id, projectId))
    .returning({ n: dsql<number>`${projects.nextNumber} - 1` });
  return Number(row.n);
}

export type TicketFields = {
  title?: string; notes?: string | null; type?: TicketType; status?: TicketStatus; priority?: TicketPriority;
  estimateMin?: number | null; dueOn?: string | null; plannedOn?: string | null;
};

export async function createTicket(projectId: number, f: TicketFields & { title: string; subtasks?: string[] }, source: Source) {
  const title = cleanTitle(f.title);
  // A ticket planned for a day is no longer just an idea in the inbox.
  const status = f.status ?? (f.plannedOn ? 'todo' : 'inbox');
  return db.transaction(async (tx) => {
    const number = await takeNumber(tx, projectId);
    const [created] = await tx.insert(tickets).values({
      projectId, number, title, status,
      notes: f.notes?.trim() || null,
      type: f.type ?? 'feature',
      priority: f.priority ?? 'normal',
      estimateMin: f.estimateMin ?? null,
      dueOn: f.dueOn ?? null,
      plannedOn: f.plannedOn ?? null,
      doneAt: status === 'done' ? new Date() : null,
    }).returning({ id: tickets.id });
    const subs = (f.subtasks ?? []).map(cleanTitle);
    if (subs.length) {
      await tx.insert(subtasks).values(subs.map((t, i) => ({ ticketId: created.id, title: t, sortOrder: i + 1 })));
    }
    const ticket = withKey((await selectTickets(tx).where(eq(tickets.id, created.id)))[0]);
    await logEvent(tx, {
      kind: 'ticket.created', source, ticketId: ticket.id, projectId,
      data: { key: ticket.key, title, type: ticket.type, status, priority: ticket.priority,
        estimateMin: ticket.estimateMin, dueOn: ticket.dueOn, plannedOn: ticket.plannedOn, subtasks: subs.length },
    });
    return ticket;
  });
}

const FIELDS = ['title', 'notes', 'type', 'status', 'priority', 'estimateMin', 'dueOn', 'plannedOn'] as const;

/** Applies only the fields that actually change, and records them as one event. */
export async function updateTicket(keyInput: string, patch: TicketFields, source: Source) {
  return db.transaction(async (tx) => {
    const before = await getTicket(keyInput, tx);
    const next: TicketFields = { ...patch };
    if (next.title !== undefined) next.title = cleanTitle(next.title);
    if (next.notes !== undefined) next.notes = next.notes?.trim() || null;

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of FIELDS) {
      if (next[f] !== undefined && next[f] !== before[f]) changes[f] = { from: before[f], to: next[f] };
    }
    if (!Object.keys(changes).length) return { ticket: before, changes };

    const set: Partial<typeof tickets.$inferInsert> = { updatedAt: new Date() };
    for (const f of Object.keys(changes) as (typeof FIELDS)[number][]) Object.assign(set, { [f]: next[f] });
    if (changes.status) set.doneAt = next.status === 'done' ? new Date() : null;

    await tx.update(tickets).set(set).where(eq(tickets.id, before.id));
    await logEvent(tx, { kind: 'ticket.updated', source, ticketId: before.id, projectId: before.projectId, data: { key: before.key, changes } });
    return { ticket: await getTicket(before.key, tx), changes };
  });
}

/**
 * Moves Inbox tickets that are due tomorrow, today or overdue into To Do, so they show up a day early. Safe to run often and from
 * several places at once: the status check in the update means each ticket moves (and is logged) once.
 * Only Inbox is touched. A ticket you already started, blocked or finished keeps its status.
 */
export async function promoteDueTickets(day = today(), x: Exec = db) {
  return x.transaction(async (tx) => {
    const moved = await tx.update(tickets)
      .set({ status: 'todo', updatedAt: new Date() })
      .where(and(eq(tickets.status, 'inbox'), lte(tickets.dueOn, addDays(day, 1))))
      .returning({ id: tickets.id, projectId: tickets.projectId, number: tickets.number, dueOn: tickets.dueOn });
    if (!moved.length) return [];
    const prefixes = new Map((await listProjects(tx)).map((p) => [p.id, p.prefix]));
    for (const t of moved) {
      await logEvent(tx, { kind: 'ticket.updated', source: 'system', ticketId: t.id, projectId: t.projectId,
        data: { key: formatKey(prefixes.get(t.projectId) ?? '?', t.number), reason: 'due', dueOn: t.dueOn,
          changes: { status: { from: 'inbox', to: 'todo' } } } });
    }
    return moved;
  });
}

/** Moves a ticket to another project. It gets a new key there; its logged time moves with it. */
export async function moveTicket(keyInput: string, projectInput: string, source: Source) {
  return db.transaction(async (tx) => {
    const before = await getTicket(keyInput, tx);
    const target = matchProject(projectInput, await listProjects(tx));
    if (target.id === before.projectId) return { ticket: before, from: before.key };
    const number = await takeNumber(tx, target.id);
    await tx.update(tickets).set({ projectId: target.id, number, updatedAt: new Date() }).where(eq(tickets.id, before.id));
    await tx.update(timeEntries).set({ projectId: target.id }).where(eq(timeEntries.ticketId, before.id));
    const ticket = withKey((await selectTickets(tx).where(eq(tickets.id, before.id)))[0]);
    await logEvent(tx, { kind: 'ticket.moved', source, ticketId: ticket.id, projectId: target.id,
      data: { from: before.key, to: ticket.key, fromProjectId: before.projectId } });
    return { ticket, from: before.key };
  });
}

/** Deletes a ticket and its subtasks. Logged time stays on the project, unlinked from the ticket. */
export async function deleteTicket(keyInput: string, source: Source) {
  return db.transaction(async (tx) => {
    const t = await getTicket(keyInput, tx);
    await tx.delete(tickets).where(eq(tickets.id, t.id));
    await logEvent(tx, { kind: 'ticket.deleted', source, ticketId: t.id, projectId: t.projectId,
      data: { key: t.key, title: t.title, type: t.type, status: t.status } });
    return t;
  });
}

export type TicketFilter = {
  projectId?: number;
  statuses?: TicketStatus[];
  types?: TicketType[];
  /** Inclusive range of planned days, or 'none' for unplanned tickets. */
  planned?: { from: string; to: string } | 'none';
  /** done_at in [from, to). */
  doneBetween?: { from: Date; to: Date };
  limit?: number;
};

const PRIORITY_RANK = dsql`array_position(array['urgent','high','normal','low']::ticket_priority[], ${tickets.priority})`;
const STATUS_RANK = dsql`array_position(array['in_progress','blocked','todo','inbox','done']::ticket_status[], ${tickets.status})`;

export async function listTickets(f: TicketFilter, x: Exec = db): Promise<Ticket[]> {
  const where: SQL[] = [];
  if (f.projectId) where.push(eq(tickets.projectId, f.projectId));
  if (f.statuses?.length && f.statuses.length < STATUSES.length) where.push(inArray(tickets.status, f.statuses));
  if (f.types?.length) where.push(inArray(tickets.type, f.types));
  if (f.planned === 'none') where.push(isNull(tickets.plannedOn));
  else if (f.planned) where.push(gte(tickets.plannedOn, f.planned.from), lte(tickets.plannedOn, f.planned.to));
  if (f.doneBetween) where.push(gte(tickets.doneAt, f.doneBetween.from), lt(tickets.doneAt, f.doneBetween.to));
  const rows = await selectTickets(x)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(projects.sortOrder), asc(STATUS_RANK), asc(PRIORITY_RANK), asc(tickets.number))
    .limit(f.limit ?? 100);
  return rows.map(withKey);
}

// ---------- subtasks ----------

export type Subtask = typeof subtasks.$inferSelect;

export function listSubtasks(ticketId: number, x: Exec = db): Promise<Subtask[]> {
  return x.select().from(subtasks).where(eq(subtasks.ticketId, ticketId)).orderBy(asc(subtasks.sortOrder), asc(subtasks.id));
}

export async function addSubtasks(keyInput: string, titles: string[], source: Source) {
  const clean = titles.map(cleanTitle);
  return db.transaction(async (tx) => {
    const t = await getTicket(keyInput, tx);
    const existing = await listSubtasks(t.id, tx);
    const start = existing.reduce((m, s) => Math.max(m, s.sortOrder), 0);
    await tx.insert(subtasks).values(clean.map((title, i) => ({ ticketId: t.id, title, sortOrder: start + i + 1 })));
    await tx.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, t.id));
    await logEvent(tx, { kind: 'subtask.added', source, ticketId: t.id, projectId: t.projectId, data: { key: t.key, titles: clean } });
    return { ticket: t, subtasks: await listSubtasks(t.id, tx) };
  });
}

/** `index` is the 1-based position shown by `tt show`. */
export async function changeSubtask(keyInput: string, index: number, action: 'done' | 'undo' | 'remove', source: Source) {
  return db.transaction(async (tx) => {
    const t = await getTicket(keyInput, tx);
    const list = await listSubtasks(t.id, tx);
    const s = list[index - 1];
    if (!s) throw new UserError(`${t.key} has ${list.length} subtask${list.length === 1 ? '' : 's'}; there is no #${index}.`);
    if (action === 'remove') await tx.delete(subtasks).where(eq(subtasks.id, s.id));
    else await tx.update(subtasks).set({ done: action === 'done', doneAt: action === 'done' ? new Date() : null }).where(eq(subtasks.id, s.id));
    await tx.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, t.id));
    await logEvent(tx, { kind: `subtask.${action}`, source, ticketId: t.id, projectId: t.projectId, data: { key: t.key, title: s.title } });
    return { ticket: t, subtask: s, subtasks: await listSubtasks(t.id, tx) };
  });
}
