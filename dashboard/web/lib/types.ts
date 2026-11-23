// Shapes the dashboard API returns. Dates arrive as ISO strings.

export const TYPES = ['feature', 'bug', 'ui_ux', 'update', 'launch_film', 'research', 'admin'] as const;
export const STATUSES = ['inbox', 'todo', 'in_progress', 'blocked', 'done'] as const;
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type TicketType = (typeof TYPES)[number];
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export type Ticket = {
  id: number; key: string; number: number; projectId: number; prefix: string; projectName: string; color: string;
  title: string; notes: string | null; type: TicketType; status: Status; priority: Priority;
  estimateMin: number | null; dueOn: string | null; plannedOn: string | null;
  createdAt: string; updatedAt: string; doneAt: string | null;
  subtasks?: { done: number; total: number };
};

export type Subtask = { id: number; title: string; done: boolean; doneAt: string | null };

export type Timer = {
  startedAt: string; note: string | null;
  project: { id: number; name: string; prefix: string; color: string };
  ticket: { key: string; title: string } | null;
} | null;

export type ProjectLite = { id: number; name: string; prefix: string; color: string; isOverhead: boolean };

export type Summary = {
  today: string;
  timer: Timer;
  counts: { today: number; open: number; all: number; inbox: number };
  projects: (ProjectLite & { open: number; loggedMin: number })[];
  week: { start: string; loggedMin: number; targetMin: number; todayLeftMin: number };
};

export type PlanRow = { id: number; name: string; prefix: string; color: string; targetMin: number; loggedMin: number };

export type TodayData = {
  today: string; isWorkDay: boolean;
  focus: { ticket: Ticket; subtasks: Subtask[]; loggedMin: number } | null;
  list: Ticket[]; done: Ticket[]; plan: PlanRow[];
};

export type EventRow = { id: number; at: string; kind: string; source: string; data: Record<string, unknown> };
export type TimeEntry = { id: number; startedAt: string; endedAt: string | null; note: string | null; source: string };

export type TicketDetail = { ticket: Ticket; subtasks: Subtask[]; loggedMin: number; recent: TimeEntry[]; history: EventRow[] };

export type ProjectCard = ProjectLite & {
  aliases: string[]; dirs: string[]; sharePct: number; weekOverride: boolean; weekTargetMin: number; weekLoggedMin: number;
  counts: Record<Status, number>; doneThisWeek: number;
};

export type PlanSettings = { weekHours: number; workDays: number[]; meetingHours: number };
export type Share = { projectId: number; usualPct: number; pct: number };

export type WeekData = {
  weekStart: string; today: string; days: string[]; weekHours: number; workDays: number[];
  settings: PlanSettings;
  saturdayHours: number; sundayHours: number; saturdayProjectId: number | null; sundayProjectId: number | null;
  /** Hours of project work planned for each of the 7 days. */
  hours: number[];
  /** True when this week has its own split instead of the usual one. */
  weekOverride: boolean;
  shares: Share[];
  projects: ProjectLite[];
  cells: { projectId: number; targetMin: number; loggedMin: number }[][];
  planned: Ticket[]; unplanned: Ticket[];
};

export type ReportData = {
  period: 'week' | 'month'; from: string; to: string; today: string; created: number;
  shipped: Ticket[]; days: { day: string; minutes: number }[];
  projects: (ProjectLite & { targetMin: number; weekendTargetMin: number; weekdayMin: number; weekendMin: number; shipped: number })[];
};
