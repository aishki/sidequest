import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, useAction, useApi } from '../lib/api.ts';
import { TYPE_LABEL } from '../lib/format.ts';
import { openTicket } from '../lib/router.ts';
import { TYPES, type Summary, type Ticket } from '../lib/types.ts';
import { Dot, StatusTag, TypeTag } from './bits.tsx';
import { I } from './icons.tsx';

/** "Add or find…": type to search every ticket; Enter on "Create" makes a new one in a project you pick. */
export function CommandBar({ summary, onClose, defaultProject }: { summary?: Summary; onClose: () => void; defaultProject: string | null }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [creating, setCreating] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { data } = useApi<Ticket[]>('/api/tickets');

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const results = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (!data) return [];
    const list = text
      ? data.filter((t) => t.key.toLowerCase().includes(text) || t.title.toLowerCase().includes(text) || t.projectName.toLowerCase().includes(text))
      : data.filter((t) => t.status !== 'done');
    // Open tickets first, then by most recently touched.
    return [...list].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  }, [data, q]);

  const items = q.trim() ? results.length + 1 : results.length; // last item = create
  const pick = (i: number) => {
    if (i < results.length) { onClose(); openTicket(results[i].key); } else setCreating(true);
  };

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && items > 0) { e.preventDefault(); pick(sel); }
  }

  return (
    <>
      <div className="backdrop" style={{ zIndex: 30 }} onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Add or find a ticket">
        {creating ? (
          <CreateForm summary={summary} title={q.trim()} defaultProject={defaultProject} onCancel={() => setCreating(false)} onDone={onClose} />
        ) : (
          <>
            <input ref={input} className="palette-input" placeholder="Search tickets, or type a title to add one…" value={q}
              onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
              role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items ? `pi-${sel}` : undefined} />
            <ul className="palette-list" id="palette-list" role="listbox">
              {results.map((t, i) => (
                <li key={t.id} id={`pi-${i}`} role="option" aria-selected={sel === i} className="palette-item"
                  onMouseEnter={() => setSel(i)} onClick={() => pick(i)}>
                  <span className="key"><Dot color={t.color} label={t.projectName} /> {t.key}</span>
                  <span className="ttl">{t.title}</span>
                  {t.status !== 'todo' && <StatusTag status={t.status} />}
                  <TypeTag type={t.type} />
                </li>
              ))}
              {q.trim() && (
                <li id={`pi-${results.length}`} role="option" aria-selected={sel === results.length} className="palette-item"
                  onMouseEnter={() => setSel(results.length)} onClick={() => pick(results.length)}>
                  <span className="key" style={{ color: 'var(--accent)' }}>{I.plus}</span>
                  <span className="ttl">Create “{q.trim()}”</span>
                </li>
              )}
              {!q.trim() && results.length === 0 && <li className="palette-item muted">No open tickets. Type a title to add one.</li>}
            </ul>
            <p className="hint" style={{ padding: '8px 16px 12px' }}>
              <kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close. From any terminal: <code>/t add …</code>
            </p>
          </>
        )}
      </div>
    </>
  );
}

function CreateForm({ summary, title: initial, defaultProject, onCancel, onDone }: {
  summary?: Summary; title: string; defaultProject: string | null; onCancel: () => void; onDone: () => void;
}) {
  const { run, busy } = useAction();
  const [title, setTitle] = useState(initial);
  const [projectId, setProjectId] = useState(defaultProject ?? '');
  const [type, setType] = useState<string>('feature');
  const [plannedOn, setPlannedOn] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [estimate, setEstimate] = useState('');
  const [subtasks, setSubtasks] = useState('');
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = await run(() => api.post<Ticket>('/api/tickets', {
      projectId: Number(projectId), title, type,
      plannedOn: plannedOn || undefined, dueOn: dueOn || undefined, estimateMin: estimate.trim() || undefined,
      subtasks: subtasks.split('\n').map((s) => s.trim()).filter(Boolean),
    }));
    if (t) { onDone(); openTicket(t.key); }
  }

  return (
    <form className="palette-form" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}>
      <h2 className="heading">New ticket</h2>
      <label className="field"><span>Title</span>
        <input className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <div className="grid-2">
        <label className="field"><span>Project (required)</span>
          <select ref={first} className="select" required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="" disabled>Choose a project…</option>
            {summary?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.prefix})</option>)}
          </select>
        </label>
        <label className="field"><span>Type</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="field"><span>Planned for</span>
          <input type="date" className="input" value={plannedOn} onChange={(e) => setPlannedOn(e.target.value)} /></label>
        <label className="field"><span>Due</span>
          <input type="date" className="input" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
        <label className="field"><span>Estimate</span>
          <input className="input mono" placeholder="e.g. 2h" value={estimate} onChange={(e) => setEstimate(e.target.value)} /></label>
      </div>
      <label className="field"><span>Subtasks (one per line, optional)</span>
        <textarea className="textarea" style={{ minHeight: 72 }} value={subtasks} onChange={(e) => setSubtasks(e.target.value)} /></label>
      <div className="row-flex">
        <button type="submit" className="btn primary" disabled={busy || !title.trim() || !projectId}>Create ticket</button>
        <button type="button" className="btn quiet" onClick={onCancel}>Back</button>
      </div>
    </form>
  );
}
