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

/**
 * Chart colors in the order they were checked for color-blind separation on the dark theme.
 * New projects take the first unused one; gray is for overhead.
 */
export const PROJECT_COLORS = ['#e0559f', '#5f9e64', '#8f6fd1', '#2ea3ae', '#b0893a', '#5b8fd6', '#d0744a', '#c25bc9'];
export const OVERHEAD_COLOR = '#a9a1b8';

export type NewProject = {
  name: string; prefix: string; aliases?: string[]; color?: string; weeklyPct?: number; isOverhead?: boolean;
};

/** Adds a project. Every name it answers to must be free, so /t never has to guess between two. */
export async function addProject(input: NewProject, source: Source) {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const prefix = input.prefix.trim().toUpperCase();
  const aliases = [...new Set((input.aliases ?? []).map((a) => norm(a)).filter(Boolean))];
  const isOverhead = input.isOverhead ?? false;
  const weeklyPct = isOverhead ? 0 : input.weeklyPct ?? 0;

  if (!name) throw new UserError('A project needs a name.');
  if (!/^[A-Z][A-Z0-9]{1,5}$/.test(prefix)) {
    throw new UserError(`"${input.prefix}" can't be a prefix: use 2 to 6 letters or digits, starting with a letter (e.g. WEB).`);
  }
  if (!(weeklyPct >= 0 && weeklyPct <= 100)) throw new UserError('The weekly share must be between 0 and 100.');
  if (input.color && !/^#[0-9a-f]{6}$/i.test(input.color)) throw new UserError(`"${input.color}" isn't a color like #2ea3ae.`);

  return db.transaction(async (tx) => {
    const all = await tx.select().from(projects);
    const taken = new Map<string, Project>();
    for (const p of all) for (const n of [p.prefix.toLowerCase(), norm(p.name), ...p.aliases]) taken.set(n, p);
    if (all.some((p) => p.prefix === prefix)) throw new UserError(`${prefix} is already the prefix of ${all.find((p) => p.prefix === prefix)!.name}.`);
    for (const n of [prefix.toLowerCase(), norm(name), ...aliases]) {
      const other = taken.get(n);
      if (other) throw new UserError(`"${n}" already means ${describe(other)}. Pick another name or alias.`);
    }

    const used = new Set(all.filter((p) => !p.archivedAt).map((p) => p.color));
    const color = (input.color?.toLowerCase())
      ?? (isOverhead ? OVERHEAD_COLOR : PROJECT_COLORS.find((c) => !used.has(c)) ?? PROJECT_COLORS[all.length % PROJECT_COLORS.length]);
    const sortOrder = Math.max(0, ...all.map((p) => p.sortOrder)) + 1;

    const [project] = await tx.insert(projects)
      .values({ name, prefix, aliases, color, weeklyPct, isOverhead, sortOrder }).returning();
    await logEvent(tx, { kind: 'project.created', source, projectId: project.id, data: { name, prefix, aliases, weeklyPct, isOverhead } });
    return project;
  });
}
