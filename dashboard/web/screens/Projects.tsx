import { useState, type FormEvent } from 'react';
import { api, useAction, useApi } from '../lib/api.ts';
import { hrs, STATUS_LABEL } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { STATUSES, type ProjectCard } from '../lib/types.ts';
import { Dot, Loading } from '../components/bits.tsx';

export function Projects() {
  const { data, error } = useApi<ProjectCard[]>('/api/projects');
  const [adding, setAdding] = useState(false);
  return (
    <div className="page wide">
      <header className="page-head">
        <div><span className="eyebrow">Week split and ticket counts</span><h1 className="title">Projects</h1></div>
        <div className="row-flex">
          <a className="btn sm" href={href('week', { plan: 'split' })}>Change split</a>
          {!adding && <button type="button" className="btn sm primary" onClick={() => setAdding(true)}>Add project</button>}
        </div>
      </header>
      {adding && <NewProject taken={data ?? []} onClose={() => setAdding(false)} />}
      {!data ? <Loading error={error} /> : data.length === 0 ? (
        <div className="empty">No projects yet. Add one above, or with <code>tt projects add</code>.</div>
      ) : (
        <div className="projects-grid">
          {data.map((p) => {
            const pct = p.weekTargetMin ? (p.weekLoggedMin / p.weekTargetMin) * 100 : 0;
            const over = p.weekTargetMin > 0 && p.weekLoggedMin > p.weekTargetMin;
            return (
              <article key={p.id} className="pcard" aria-labelledby={`p-${p.id}`}>
                <div className="row-flex">
                  <Dot color={p.color} />
                  <h2 className="heading" id={`p-${p.id}`} style={{ flex: 1, minWidth: 0 }}>{p.name}</h2>
                  <span className="mono small muted">{p.prefix}</span>
                </div>
                <div className="stack" style={{ gap: 6 }}>
                  <div className="row-flex small" style={{ justifyContent: 'space-between' }}>
                    <span className="muted">{p.isOverhead ? 'Overhead, no target' : `${+p.sharePct.toFixed(1)}% of ${p.weekOverride ? 'this' : 'the'} week`}</span>
                    <span className="mono">{hrs(p.weekLoggedMin)}{p.weekTargetMin ? ` / ${hrs(p.weekTargetMin)}` : ''}</span>
                  </div>
                  <div className={`track thin${over ? ' over' : ''}`} role="img" aria-label={`${hrs(p.weekLoggedMin)} of ${hrs(p.weekTargetMin)} this week`}>
                    <span style={{ width: `${Math.min(100, p.weekTargetMin ? pct : p.weekLoggedMin ? 100 : 0)}%`, background: p.color }} />
                  </div>
                </div>
                <div className="counts">
                  {STATUSES.map((s) => <div key={s} className={p.counts[s] ? undefined : 'zero'}><b>{p.counts[s]}</b><span>{STATUS_LABEL[s]}</span></div>)}
                </div>
                <div className="row-flex small">
                  <span className="muted">{p.doneThisWeek ? `${p.doneThisWeek} shipped this week` : 'Nothing shipped yet this week'}</span>
                  <span className="spacer" />
                  <a href={href('board', { project: String(p.id) })}>Open board</a>
                </div>
                {(p.aliases.length > 0 || p.dirs.length > 0) && (
                  <details className="small">
                    <summary className="muted" style={{ cursor: 'pointer' }}>Aliases and linked folders</summary>
                    <div className="stack" style={{ marginTop: 8, gap: 4 }}>
                      {p.aliases.length > 0 && <span>Aliases: <span className="mono-ink">{p.aliases.join(', ')}</span></span>}
                      {p.dirs.map((d) => <span key={d} className="mono muted" style={{ wordBreak: 'break-all' }}>{d}</span>)}
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="hint">Add projects here or with <code>tt projects add</code>; link a folder with <code>tt link</code>. Change how the week is split on the Week plan, or with <code>tt share</code>.</p>
    </div>
  );
}

/** A prefix guess from the name: initials for several words ("Mobile app" -> MA), else the first letters. */
function suggestPrefix(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0]).slice(0, words.length > 1 ? 6 : 3);
}

function NewProject({ taken, onClose }: { taken: ProjectCard[]; onClose: () => void }) {
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [aliases, setAliases] = useState('');
  const [share, setShare] = useState('0');
  const [overhead, setOverhead] = useState(false);

  const shownPrefix = prefixTouched ? prefix : suggestPrefix(name);
  const clash = taken.find((p) => p.prefix === shownPrefix.trim().toUpperCase());
  const shareNum = Number(share);
  const shareBad = !overhead && !(share.trim() !== '' && shareNum >= 0 && shareNum <= 100);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name, prefix: shownPrefix, isOverhead: overhead, share: overhead ? 0 : shareNum,
      aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
    };
    const p = await run(() => api.post<{ prefix: string }>('/api/projects', body), `Added ${shownPrefix.toUpperCase()} ${name.trim()}.`);
    if (p) onClose();
  }

  return (
    <form className="card new-project" onSubmit={submit} aria-labelledby="np-h">
      <div className="row-flex"><h2 className="heading" id="np-h">New project</h2><span className="spacer" />
        <button type="button" className="btn quiet sm" onClick={onClose}>Cancel</button></div>
      <div className="np-grid">
        <label className="field"><span>Name</span>
          <input className="input" value={name} autoFocus required onChange={(e) => setName(e.target.value)} placeholder="Website" /></label>
        <label className="field"><span>Prefix (2–6 letters, for keys like {(shownPrefix || 'WEB').toUpperCase()}-001)</span>
          <input className="input mono" value={shownPrefix} required maxLength={6} aria-invalid={!!clash}
            onChange={(e) => { setPrefixTouched(true); setPrefix(e.target.value.toUpperCase()); }} placeholder="WEB" />
          {clash && <span className="small warn">Already used by {clash.name}.</span>}</label>
        <label className="field"><span>Aliases (comma-separated, optional)</span>
          <input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="site, web" /></label>
        <label className="field"><span>Share of every week (%)</span>
          <input className="input mono" type="number" min={0} max={100} step={1} value={overhead ? '' : share} disabled={overhead}
            aria-invalid={shareBad} onChange={(e) => setShare(e.target.value)} />
          <span className="small muted">{overhead ? 'Overhead never gets planned hours.' : shareNum > 0 ? 'The other projects scale down to fit.' : 'No planned hours. Time can still be logged.'}</span></label>
      </div>
      <label className="check" style={{ alignSelf: 'flex-start' }}>
        <input type="checkbox" checked={overhead} onChange={(e) => setOverhead(e.target.checked)} />
        <span>Overhead, like Admin (gray, never planned)</span></label>
      <div className="row-flex">
        <button type="submit" className="btn primary" disabled={busy || !name.trim() || !shownPrefix.trim() || !!clash || shareBad}>Add project</button>
        <span className="small muted">A color is picked for you.</span>
      </div>
    </form>
  );
}
