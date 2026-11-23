import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, check, date, index, integer, jsonb, numeric, pgEnum, pgTable,
  serial, smallint, text, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';

export const ticketType = pgEnum('ticket_type', [
  'feature', 'bug', 'ui_ux', 'update', 'launch_film', 'research', 'admin',
]);
export const ticketStatus = pgEnum('ticket_status', ['inbox', 'todo', 'in_progress', 'blocked', 'done']);
export const ticketPriority = pgEnum('ticket_priority', ['low', 'normal', 'high', 'urgent']);

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  /** Ticket key prefix, e.g. WEB -> WEB-014. */
  prefix: text('prefix').notNull().unique(),
  /** Lowercase names /t accepts for this project. */
  aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
  color: text('color').notNull(),
  /** Folders that belong to this project, so "/t ... this" knows which one you mean. Normalized: forward slashes, lowercase on Windows. */
  dirs: text('dirs').array().notNull().default(sql`'{}'::text[]`),
  /** Share of the planned work week, in percent. Normalized against the total when planning. */
  weeklyPct: numeric('weekly_pct', { precision: 6, scale: 3, mode: 'number' }).notNull().default(0),
  /** Admin / non-project bucket: never planned, still loggable. */
  isOverhead: boolean('is_overhead').notNull().default(false),
  sortOrder: smallint('sort_order').notNull().default(0),
  nextNumber: integer('next_number').notNull().default(1),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  check('projects_prefix_format', sql`${t.prefix} ~ '^[A-Z][A-Z0-9]{1,5}$'`),
  check('projects_color_format', sql`${t.color} ~ '^#[0-9a-f]{6}$'`),
  check('projects_weekly_pct_range', sql`${t.weeklyPct} between 0 and 100`),
]);

export const tickets = pgTable('tickets', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  notes: text('notes'),
  type: ticketType('type').notNull().default('feature'),
  status: ticketStatus('status').notNull().default('inbox'),
  priority: ticketPriority('priority').notNull().default('normal'),
  estimateMin: integer('estimate_min'),
  dueOn: date('due_on'),
  /** Day it is planned for (Today / Week plan). */
  plannedOn: date('planned_on'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  doneAt: ts('done_at'),
}, (t) => [
  uniqueIndex('tickets_project_number').on(t.projectId, t.number),
  index('tickets_status').on(t.status),
  index('tickets_planned_on').on(t.plannedOn),
  check('tickets_title_not_blank', sql`length(trim(${t.title})) > 0`),
  check('tickets_estimate_positive', sql`${t.estimateMin} is null or ${t.estimateMin} > 0`),
]);

export const subtasks = pgTable('subtasks', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  done: boolean('done').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  doneAt: ts('done_at'),
}, (t) => [index('subtasks_ticket').on(t.ticketId)]);

/** Logged work. A running dashboard timer is a row with ended_at null (at most one). */
export const timeEntries = pgTable('time_entries', {
  id: serial('id').primaryKey(),
  ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  startedAt: ts('started_at').notNull(),
  endedAt: ts('ended_at'),
  note: text('note'),
  /** 'chat' (/t) or 'timer' (dashboard). */
  source: text('source').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  index('time_entries_started_at').on(t.startedAt),
  uniqueIndex('time_entries_one_running').on(sql`(true)`).where(sql`${t.endedAt} is null`),
  check('time_entries_order', sql`${t.endedAt} is null or ${t.endedAt} > ${t.startedAt}`),
  check('time_entries_source', sql`${t.source} in ('chat', 'timer')`),
]);

/** Append-only history. Reports are computed from this. */
export const events = pgTable('events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: ts('at').notNull().defaultNow(),
  kind: text('kind').notNull(),
  ticketId: integer('ticket_id'),
  projectId: integer('project_id'),
  data: jsonb('data').notNull().default({}),
  /** 'cli', 'dashboard' or 'system'. */
  source: text('source').notNull(),
}, (t) => [
  index('events_at').on(t.at),
  index('events_ticket').on(t.ticketId),
]);

/** Per-week planning overrides, e.g. opting in to weekend hours for one week. */
export const weekPlans = pgTable('week_plans', {
  /** The Monday that starts the week. */
  weekStart: date('week_start').primaryKey(),
  saturdayHours: numeric('saturday_hours', { precision: 4, scale: 2, mode: 'number' }).notNull().default(0),
  sundayHours: numeric('sunday_hours', { precision: 4, scale: 2, mode: 'number' }).notNull().default(0),
  /** Put all of a weekend day's hours on one project instead of splitting them by share. */
  saturdayProjectId: integer('saturday_project_id').references(() => projects.id, { onDelete: 'set null' }),
  sundayProjectId: integer('sunday_project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** This week's split, project id -> percent (adds up to 100). Null means the usual weekly_pct split. */
  shares: jsonb('shares').$type<Record<string, number>>(),
  note: text('note'),
}, (t) => [check('week_plans_monday', sql`extract(isodow from ${t.weekStart}) = 1`)]);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
