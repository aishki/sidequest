import { useApi } from '../lib/api.ts';
import { hrs, STATUS_LABEL } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { STATUSES, type ProjectCard } from '../lib/types.ts';
import { Dot, Loading } from '../components/bits.tsx';

export function Projects() {
  const { data, error } = useApi<ProjectCard[]>('/api/projects');
  return (
    <div className="page wide">
      <header className="page-head">
        <div><span className="eyebrow">Week split and ticket counts</span><h1 className="title">Projects</h1></div>
        <a className="btn sm" href={href('week', { plan: 'split' })}>Change split</a>
      </header>
      {!data ? <Loading error={error} /> : data.length === 0 ? (
        <div className="empty">No projects yet. Load them with <code>npm run db:seed</code> (see the README).</div>
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
      <p className="hint">Projects come from your seed file; link a folder with <code>tt link</code>. Change how the week is split on the Week plan, or with <code>tt share</code>.</p>
    </div>
  );
}
