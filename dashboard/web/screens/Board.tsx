import { useState, type DragEvent } from 'react';
import { api, useAction, useApi } from '../lib/api.ts';
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
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const today = summary?.today ?? '';
  const projectName = summary?.projects.find((p) => String(p.id) === project)?.name;

  function drop(e: DragEvent, status: Status) {
    e.preventDefault();
    setOver(null);
    const key = e.dataTransfer.getData('text/plain');
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
        <div className="board">
          {STATUSES.map((s) => {
            const list = data.filter((t) => t.status === s);
            return (
              <section key={s} className="col" aria-label={STATUS_LABEL[s]}>
                <div className="col-head"><Dot color={DOT[s]} /><h2 className="heading">{STATUS_LABEL[s]}</h2><span className="count">{list.length}</span></div>
                <div className={`well${over === s ? ' over' : ''}`}
                  onDragOver={(e) => { if (dragKey) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(s); } }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
                  onDrop={(e) => drop(e, s)}>
                  {list.map((t) => (
                    <BoardCard key={t.id} t={t} today={today} dragging={dragKey === t.key}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.key); e.dataTransfer.effectAllowed = 'move'; setDragKey(t.key); }}
                      onDragEnd={() => { setDragKey(null); setOver(null); }} />
                  ))}
                  {list.length === 0 && <div className="empty-col">{dragKey ? 'Drop here' : 'Nothing here'}</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <p className="hint">Drag a card to change its status, or open it to edit everything.</p>
    </div>
  );
}

function BoardCard({ t, today, dragging, onDragStart, onDragEnd }: {
  t: Ticket; today: string; dragging: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void;
}) {
  const when = whenOf(t, today);
  return (
    <button type="button" className={`bcard${dragging ? ' dragging' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={() => openTicket(t.key)}>
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
