import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../lib/api.ts';
import { fmtStamp, PRIORITY_LABEL, plural, STATUS_LABEL, TYPE_LABEL } from '../lib/format.ts';
import { openTicket, setParams } from '../lib/router.ts';
import { PRIORITIES, STATUSES, TYPES, type Summary, type Ticket } from '../lib/types.ts';
import { Dot, Loading, StatusTag, TypeTag, whenOf } from '../components/bits.tsx';

type SortKey = 'key' | 'title' | 'status' | 'priority' | 'when' | 'updated';

export function Tickets({ summary, params }: { summary?: Summary; params: URLSearchParams }) {
  const status = params.get('status') ?? '';
  const type = params.get('type') ?? '';
  const project = params.get('project') ?? '';
  const sort = (params.get('sort') as SortKey) || 'updated';
  const [text, setText] = useState(params.get('q') ?? '');
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (type) query.set('type', type);
  if (project) query.set('project', project);
  const { data, error } = useApi<Ticket[]>(`/api/tickets?${query}`);
  const today = summary?.today ?? '';

  // Keep the search box in the URL without re-rendering on every keystroke.
  useEffect(() => { const id = setTimeout(() => setParams({ q: text.trim() || null }), 300); return () => clearTimeout(id); }, [text]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = text.trim().toLowerCase();
    const list = q ? data.filter((t) => t.key.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || (t.notes ?? '').toLowerCase().includes(q)) : data;
    const by: Record<SortKey, (a: Ticket, b: Ticket) => number> = {
      key: (a, b) => a.prefix.localeCompare(b.prefix) || a.number - b.number,
      title: (a, b) => a.title.localeCompare(b.title),
      status: (a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status),
      priority: (a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority),
      when: (a, b) => (a.dueOn ?? a.plannedOn ?? '9999').localeCompare(b.dueOn ?? b.plannedOn ?? '9999'),
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    };
    return [...list].sort(by[sort] ?? by.updated);
  }, [data, text, sort]);

  const th = (k: SortKey, label: string, cls?: string) => (
    <th scope="col" className={cls} aria-sort={sort === k ? (k === 'updated' ? 'descending' : 'ascending') : undefined}>
      <button type="button" onClick={() => setParams({ sort: k === 'updated' ? null : k })}>{label}{sort === k ? ' ↓' : ''}</button>
    </th>
  );
  const sel = (id: string, label: string, value: string, key: string, opts: [string, string][]) => (
    <>
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} className="select" style={{ width: 'auto', minHeight: 32 }} value={value} onChange={(e) => setParams({ [key]: e.target.value || null })}>
        <option value="">{label}: all</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </>
  );

  return (
    <div className="page wide">
      <header className="page-head">
        <div><span className="eyebrow">{data ? plural(rows.length, 'ticket') : '…'}</span><h1 className="title">All tickets</h1></div>
      </header>
      <div className="filters">
        <label className="sr-only" htmlFor="search">Search</label>
        <input id="search" className="input" style={{ width: 260, minHeight: 32 }} placeholder="Search key, title or notes" value={text} onChange={(e) => setText(e.target.value)} />
        {sel('f-status', 'Status', status, 'status', [
          ...STATUSES.map((s) => [s, STATUS_LABEL[s]] as [string, string]),
          ['inbox,todo,in_progress,blocked', 'Open (not done)'],
        ])}
        {sel('f-type', 'Type', type, 'type', TYPES.map((t) => [t, TYPE_LABEL[t]]))}
        {sel('f-project', 'Project', project, 'project', (summary?.projects ?? []).map((p) => [String(p.id), p.name]))}
        {(status || type || project || text) && (
          <button type="button" className="btn quiet sm" onClick={() => { setText(''); setParams({ status: null, type: null, project: null, q: null }); }}>Clear filters</button>
        )}
      </div>
      {!data ? <Loading error={error} /> : rows.length === 0 ? <div className="empty">No tickets match.</div> : (
        <div className="table-wrap">
          <table className="tickets">
            <thead><tr>
              {th('key', 'ID')}{th('title', 'Title')}<th scope="col">Type</th>{th('status', 'Status')}{th('priority', 'Priority')}
              <th scope="col" className="num">Steps</th>{th('when', 'Due / planned')}{th('updated', 'Updated')}
            </tr></thead>
            <tbody>
              {rows.map((t) => {
                const when = whenOf(t, today);
                return (
                  <tr key={t.id} onClick={() => openTicket(t.key)}>
                    <td className="key"><span className="row-flex" style={{ flexWrap: 'nowrap', gap: 6 }}><Dot color={t.color} label={t.projectName} />
                      <a href={`#`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openTicket(t.key); }} style={{ color: 'inherit' }}>{t.key}</a></span></td>
                    <td className="ttl">{t.title}</td>
                    <td><TypeTag type={t.type} /></td>
                    <td><StatusTag status={t.status} /></td>
                    <td className={t.priority === 'urgent' ? 'late' : t.priority === 'high' ? 'warn' : 'muted'}>{PRIORITY_LABEL[t.priority]}</td>
                    <td className="num">{t.subtasks?.total ? `${t.subtasks.done}/${t.subtasks.total}` : <span className="muted">—</span>}</td>
                    <td className={`small${when?.late ? ' late' : ' muted'}`} style={{ whiteSpace: 'nowrap' }}>{when?.text ?? '—'}</td>
                    <td className="small muted mono" style={{ whiteSpace: 'nowrap' }}>{fmtStamp(t.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
