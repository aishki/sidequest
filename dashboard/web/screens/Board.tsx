import { useRef } from 'react';
import { api, useAction, useApi } from '../lib/api.ts';
import { DropZone, useDraggableTicket, useDraggedTicket, useDragAutoScroll } from '../lib/dnd.tsx';
import { STATUS_LABEL, TYPE_LABEL } from '../lib/format.ts';
import { href, openTicket, setParams } from '../lib/router.ts';
import { STATUSES, TYPES, type Status, type Summary, type Ticket } from '../lib/types.ts';
import { Dot, Loading, PriorityTag, TypeTag, whenOf } from '../components/bits.tsx';

const DOT: Record<Status, string> = {
  inbox: 'var(--ink-muted)', todo: 'var(--cat-feature)', in_progress: 'var(--ochre)', blocked: 'var(--brick)', done: 'var(--leaf)',
};

export function Board({ summary, params }: { summary?: Summary; params: URLSearchParams }) {
  const project = params.get('project');
  const type = params.get('type');
  const q = new URLSearchParams({ doneDays: '7' });
  if (project) q.set('project', project);
  if (type) q.set('type', type);
  const { data, error } = useApi<Ticket[]>(`/api/tickets?${q}`);
  const { run } = useAction();
  const dragKey = useDraggedTicket();
  const boardRef = useRef<HTMLDivElement>(null);
  useDragAutoScroll(boardRef);
  const today = summary?.today ?? '';
  const projectName = summary?.projects.find((p) => String(p.id) === project)?.name;

  function drop(key: string, status: Status) {
    const t = data?.find((x) => x.key === key);
    if (t && t.status !== status) run(() => api.patch(`/api/tickets/${key}`, { status }), `${key} → ${STATUS_LABEL[status]}`);
  }

  return (
    <div className="page wide">
      <header className="page-head">
        <div><span className="eyebrow">Done column shows the last 7 days</span><h1 className="title">{projectName ? `Board · ${projectName}` : 'Board'}</h1></div>
      </header>
      <div className="filters" role="group" aria-label="Filters">
        <a className="chip" href={href('board', { type })} aria-pressed={!project}>All projects</a>
        {summary?.projects.map((p) => (
          <a key={p.id} className="chip" href={href('board', { project: String(p.id), type })} aria-pressed={project === String(p.id)}>
            <Dot color={p.color} />{p.prefix}
          </a>
        ))}
        <span style={{ width: 12 }} />
        <label className="sr-only" htmlFor="type-f">Type</label>
        <select id="type-f" className="select" style={{ width: 'auto', minHeight: 30 }} value={type ?? ''} onChange={(e) => setParams({ type: e.target.value || null })}>
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </div>
      {!data ? <Loading error={error} /> : (
        <div className="board" ref={boardRef}>
          {STATUSES.map((s) => {
            const list = data.filter((t) => t.status === s);
            return (
              // The whole column takes the drop, not just its cards, so a short column is easy to hit.
              <DropZone key={s} as="section" className="col" label={STATUS_LABEL[s]} onDropKey={(key) => drop(key, s)}>
                <div className="col-head"><Dot color={DOT[s]} /><h2 className="heading">{STATUS_LABEL[s]}</h2><span className="count">{list.length}</span></div>
                <div className="well">
                  {list.map((t) => <BoardCard key={t.id} t={t} today={today} />)}
                  {list.length === 0 && <div className="empty-col">{dragKey ? 'Drop here' : 'Nothing here'}</div>}
                </div>
              </DropZone>
            );
          })}
        </div>
      )}
      <p className="hint">Drag a card to change its status, or open it to edit everything.</p>
    </div>
  );
}

function BoardCard({ t, today }: { t: Ticket; today: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const dragging = useDraggableTicket(ref, t.key);
  const when = whenOf(t, today);
  return (
    <button ref={ref} type="button" className={`bcard${dragging ? ' dragging' : ''}`} onClick={() => openTicket(t.key)}>
      <span className="top"><Dot color={t.color} label={t.projectName} />{t.key}</span>
      <span className="t">{t.title}</span>
      <span className="bottom">
        <TypeTag type={t.type} /><PriorityTag priority={t.priority} />
        {t.subtasks && t.subtasks.total > 0 && <span className="mono">{t.subtasks.done}/{t.subtasks.total}</span>}
        {when && <span className={`when${when.late ? ' late' : ''}`}>{when.text}</span>}
      </span>
    </button>
  );
}
