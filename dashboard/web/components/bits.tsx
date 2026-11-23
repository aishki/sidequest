import { useEffect, useState } from 'react';
import { useToasts } from '../lib/api.ts';
import { isoDate, PRIORITY_LABEL, relDay, STATUS_LABEL, TYPE_LABEL, TYPE_TOKEN } from '../lib/format.ts';
import { openTicket } from '../lib/router.ts';
import type { Priority, Status, Ticket, TicketType } from '../lib/types.ts';

export const TypeTag = ({ type }: { type: TicketType }) => <span className={`tag t-${TYPE_TOKEN[type]}`}>{TYPE_LABEL[type]}</span>;
export const StatusTag = ({ status }: { status: Status }) => <span className={`tag s-${status}`}>{STATUS_LABEL[status]}</span>;
/** Only urgent and high get a tag; normal and low stay quiet. */
export const PriorityTag = ({ priority }: { priority: Priority }) =>
  priority === 'urgent' || priority === 'high' ? <span className={`tag p-${priority}`}>{PRIORITY_LABEL[priority]}</span> : null;
export const Dot = ({ color, label }: { color: string; label?: string }) =>
  <span className="dot" style={{ background: color }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;

/** The date that matters most for a ticket: overdue due date, else planned day, else due date. */
export function whenOf(t: Ticket, today: string): { text: string; late: boolean } | null {
  if (t.status === 'done') return t.doneAt ? { text: `Done ${relDay(isoDate(new Date(t.doneAt)), today)}`, late: false } : null;
  if (t.dueOn && t.dueOn < today) return { text: `Due ${relDay(t.dueOn, today)}`, late: true };
  if (t.dueOn && t.dueOn === today) return { text: 'Due today', late: false };
  if (t.plannedOn && t.plannedOn < today) return { text: `From ${relDay(t.plannedOn, today)}`, late: false };
  if (t.plannedOn) return { text: relDay(t.plannedOn, today), late: false };
  if (t.dueOn) return { text: `Due ${relDay(t.dueOn, today)}`, late: false };
  return null;
}

/** Card anatomy, always the same: ID · title · type tag · progress · due. */
export function TicketRow({ t, today }: { t: Ticket; today: string }) {
  const when = whenOf(t, today);
  return (
    <button type="button" className={`ticket${t.status === 'done' ? ' done' : ''}`} onClick={() => openTicket(t.key)}>
      <span className="key"><Dot color={t.color} label={t.projectName} />{t.key}</span>
      <span className="t-title">{t.title}</span>
      <span className="meta">
        {t.status !== 'todo' && t.status !== 'inbox' && t.status !== 'done' && <StatusTag status={t.status} />}
        <PriorityTag priority={t.priority} />
        <TypeTag type={t.type} />
        {t.subtasks && t.subtasks.total > 0 && <span className="small muted mono">{t.subtasks.done}/{t.subtasks.total}</span>}
      </span>
      <span className={`when${when?.late ? ' late' : ''}`}>{when?.text ?? ''}</span>
    </button>
  );
}

/** Re-renders every `ms` so running clocks tick. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

export function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} className={`toastx ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

export function Loading({ error }: { error?: string }) {
  return error ? <div className="empty late" role="alert">{error}</div> : <div className="empty" aria-busy="true">Loading…</div>;
}
