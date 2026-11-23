import { resolve as resolvePath } from 'node:path';
import { asc, eq, isNull } from 'drizzle-orm';
import { db, logEvent, schema, type Exec, type Source } from './db.ts';
import { parseKey, UserError } from './parse.ts';

const { projects } = schema;
export type Project = typeof projects.$inferSelect;

export function listProjects(x: Exec = db): Promise<Project[]> {
  return x.select().from(projects).where(isNull(projects.archivedAt)).orderBy(asc(projects.sortOrder), asc(projects.id));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
const describe = (p: Project) => `${p.prefix} (${p.name})`;

/** Normalized folder path: absolute, forward slashes, no trailing slash, lowercase on Windows. */
export function normDir(dir: string): string {
  let d = resolvePath(dir).replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32') d = d.toLowerCase();
  return d;
}

/** The project whose linked folder contains `dir` (deepest match wins). */
export function projectForDir(dir: string, list: Project[]): Project | undefined {
  const d = normDir(dir);
  let best: { p: Project; len: number } | undefined;
  for (const p of list) {
    for (const linked of p.dirs) {
      if ((d === linked || d.startsWith(linked + '/')) && (!best || linked.length > best.len)) best = { p, len: linked.length };
    }
  }
  return best?.p;
}

const THIS_WORDS = new Set(['this', 'here', 'current', 'this project', '.']);

/**
 * Turns what the user typed into exactly one project, or throws.
 *
 * Only exact matches count: the uppercase prefix (WEB), an alias (web, site), or the full name.
 * Anything else is never guessed; it fails with exit code 2 and the close candidates, so /t asks.
 * That is what keeps a shared word ambiguous instead of silently picking one of the projects it could mean.
 */
export function matchProject(input: string, list: Project[], cwd = process.cwd()): Project {
  const raw = input.trim();
  const q = norm(raw);

  if (THIS_WORDS.has(q)) {
    const p = projectForDir(cwd, list);
    if (p) return p;
    throw new UserError(
      `This folder (${normDir(cwd)}) isn't linked to a project yet. Ask which project it is, then run: tt link <project>`, 2);
  }

  const key = parseKey(raw);
  const exact = list.filter((p) =>
    p.prefix === raw || p.aliases.includes(q) || norm(p.name) === q || (key && raw.includes('-') && p.prefix === key.prefix));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new UserError(`"${raw}" matches more than one project: ${exact.map(describe).join(', ')}. Which one?`, 2);
  }

  const words = q.split(' ').filter((w) => w.length >= 2);
  const candidates = list.filter((p) => {
    const hay = [norm(p.name), ...p.aliases, p.prefix.toLowerCase()].join(' ').split(' ');
    return words.some((w) => hay.some((h) => h.startsWith(w) || (h.length >= 3 && w.startsWith(h))));
  });
  if (candidates.length > 1) {
    throw new UserError(`"${raw}" could be ${candidates.map(describe).join(' or ')}. Which one?`, 2);
  }
  if (candidates.length === 1) {
    throw new UserError(`"${raw}" isn't a project name. Did you mean ${describe(candidates[0])}?`, 2);
  }
  throw new UserError(`No project matches "${raw}". Projects: ${list.map(describe).join(', ')}.`, 2);
}

export async function resolveProject(input: string, x: Exec = db): Promise<Project> {
  return matchProject(input, await listProjects(x));
}

/** Links a folder to a project, moving it off any other project first. */
export async function linkDir(projectInput: string, dir: string, source: Source) {
  const d = normDir(dir);
  return db.transaction(async (tx) => {
    const list = await listProjects(tx);
    const project = matchProject(projectInput, list);
    const previous = list.find((p) => p.dirs.includes(d));
    if (previous?.id === project.id) return { project, dir: d, previous: undefined, changed: false };
    if (previous) {
      await tx.update(projects).set({ dirs: previous.dirs.filter((x) => x !== d) }).where(eq(projects.id, previous.id));
    }
    await tx.update(projects).set({ dirs: [...project.dirs, d] }).where(eq(projects.id, project.id));
    await logEvent(tx, { kind: 'project.linked', source, projectId: project.id, data: { dir: d, from: previous?.prefix ?? null } });
    return { project, dir: d, previous, changed: true };
  });
}

export async function unlinkDir(dir: string, source: Source) {
  const d = normDir(dir);
  return db.transaction(async (tx) => {
    const project = (await listProjects(tx)).find((p) => p.dirs.includes(d));
    if (!project) throw new UserError(`${d} isn't linked to any project.`);
    await tx.update(projects).set({ dirs: project.dirs.filter((x) => x !== d) }).where(eq(projects.id, project.id));
    await logEvent(tx, { kind: 'project.unlinked', source, projectId: project.id, data: { dir: d } });
    return { project, dir: d };
  });
}
