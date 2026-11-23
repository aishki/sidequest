#!/usr/bin/env node
// First-run setup and health check. Uses only Node built-ins, so it works before `npm install`.
//
//   npm run setup              check everything and say what to do next   (add --json for /t)
//   npm run setup docker       run Postgres in Docker: writes .env, starts the container
//   npm run setup install      npm install, database tables, the `tt` command
//
// Already have Postgres? Run `bash scripts/create-db.sh` in your own terminal instead of `docker`:
// it asks for your Postgres admin password, which never leaves psql.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const envPath = join(root, '.env');
const MIN_NODE = [22, 18];
const DOCKER_PORT = '5433';
const isWin = process.platform === 'win32';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const [step = 'check'] = argv.filter((a) => a !== '--json');

// ---------- helpers ----------

function readEnv(): Record<string, string> {
  const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) as Record<string, string> : {};
  // The line copied from .env.example is a placeholder, not a choice.
  if (env.DATABASE_URL?.includes(':change-me@')) delete env.DATABASE_URL;
  return env;
}

/** Sets keys in .env, keeping everything else (comments included) as it is. */
function writeEnv(values: Record<string, string>) {
  if (!existsSync(envPath)) copyFileSync(join(root, '.env.example'), envPath);
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  }
  writeFileSync(envPath, lines.join('\n'));
}

/** Runs a command in the repo. On Windows npm is a .cmd file, which needs a shell; the arguments here are fixed words. */
function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}) {
  const shell = isWin && cmd === 'npm';
  return spawnSync(shell ? [cmd, ...args].join(' ') : cmd, shell ? [] : args, {
    cwd: root, shell, encoding: 'utf8', stdio: opts.quiet ? 'pipe' : 'inherit', timeout: opts.quiet ? 15_000 : undefined,
  });
}

function runStep(title: string, cmd: string, args: string[]) {
  console.log(`\n→ ${title}`);
  const r = run(cmd, args);
  if (r.status !== 0) {
    console.error(`\n✗ ${title} failed. Fix the error above, then run: npm run setup install`);
    process.exit(1);
  }
}

function tcpOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ host, port, timeout: 2000 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
}

function findPsql(): string | undefined {
  if (run(isWin ? 'where' : 'which', ['psql'], { quiet: true }).status === 0) return 'psql';
  if (!isWin) return undefined;
  const base = 'C:/Program Files/PostgreSQL';
  if (!existsSync(base)) return undefined;
  const v = readdirSync(base).filter((d) => existsSync(`${base}/${d}/bin/psql.exe`)).sort((a, b) => Number(b) - Number(a))[0];
  return v ? `${base}/${v}/bin/psql.exe` : undefined;
}

// ---------- check ----------

type Item = { ok: boolean; label: string; detail?: string };
type Report = {
  ok: boolean; root: string; items: Record<string, Item>; projects: number | null; next: string;
  database: { kind: 'docker' | 'postgres' | 'none'; host?: string; port?: number };
};

async function check(): Promise<Report> {
  const items: Record<string, Item> = {};
  const [maj, min] = process.versions.node.split('.').map(Number);
  const nodeOk = maj > MIN_NODE[0] || (maj === MIN_NODE[0] && min >= MIN_NODE[1]);
  items.node = { ok: nodeOk, label: 'Node', detail: `v${process.versions.node}${nodeOk ? '' : `, needs ${MIN_NODE.join('.')} or newer`}` };

  const env = readEnv();
  const url = env.DATABASE_URL ?? process.env.DATABASE_URL;
  const usesDocker = Boolean(env.SIDEQUEST_DB_PASSWORD);
  let host: string | undefined; let port: number | undefined;
  if (url) { try { const u = new URL(url); host = u.hostname; port = Number(u.port || 5432); } catch { /* reported below */ } }
  items.env = {
    ok: Boolean(url && host), label: 'Database settings (.env)',
    detail: !url ? 'no DATABASE_URL yet' : host ? `${usesDocker ? 'Docker' : 'Postgres'} at ${host}:${port}` : 'DATABASE_URL is not a valid URL',
  };

  const depsOk = existsSync(join(root, 'node_modules', 'drizzle-orm', 'package.json'))
    && existsSync(join(root, 'node_modules', 'postgres', 'package.json'));
  items.deps = { ok: depsOk, label: 'npm packages', detail: depsOk ? 'installed' : 'not installed' };

  let projects: number | null = null;
  const journal = JSON.parse(readFileSync(join(root, 'drizzle', 'meta', '_journal.json'), 'utf8')).entries.length as number;
  items.db = { ok: false, label: 'Database', detail: 'not checked' };
  items.tables = { ok: false, label: 'Tables', detail: 'not checked' };
  if (url && host && port) {
    if (!depsOk) {
      const open = await tcpOpen(host, port);
      items.db = { ok: open, label: 'Database', detail: open ? `something answers on ${host}:${port} (install packages to check more)` : `nothing on ${host}:${port}` };
    } else {
      const postgres = (await import(pathToFileURL(join(root, 'node_modules', 'postgres', 'src', 'index.js')).href)).default;
      const sql = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });
      try {
        await sql`select 1`;
        items.db = { ok: true, label: 'Database', detail: `connected to ${host}:${port}` };
        const [{ n }] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations'`;
        const applied = n ? (await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n as number : 0;
        items.tables = { ok: applied >= journal, label: 'Tables', detail: `${applied} of ${journal} migrations applied` };
        if (applied) projects = (await sql`select count(*)::int as n from projects where archived_at is null`)[0].n;
      } catch (e) {
        const err = e as { code?: string; message: string };
        const why: Record<string, string> = {
          ECONNREFUSED: `nothing on ${host}:${port}`,
          '28P01': 'the password in .env was rejected',
          '3D000': 'the database does not exist yet',
          '28000': 'the role does not exist yet',
        };
        items.db = { ok: false, label: 'Database', detail: why[err.code ?? ''] ?? err.message };
      } finally {
        await sql.end({ timeout: 1 });
      }
    }
  }

  const tt = run(isWin ? 'where' : 'which', ['tt'], { quiet: true });
  items.tt = { ok: tt.status === 0, label: '`tt` command', detail: tt.status === 0 ? tt.stdout.split(/\r?\n/)[0] : 'not on PATH' };

  const docker = run('docker', ['info', '--format', '{{.ServerVersion}}'], { quiet: true });
  const dockerOk = docker.status === 0;
  const psql = findPsql();

  const next = !nodeOk ? `Install Node ${MIN_NODE.join('.')} or newer, then run npm run setup again.`
    : !items.env.ok ? (url ? 'Fix DATABASE_URL in .env.' : [
      'Pick a database:',
      dockerOk ? '  Docker (easiest): npm run setup docker' : '  Docker: install and start Docker Desktop, then npm run setup docker',
      psql ? '  Your own Postgres: bash scripts/create-db.sh  (in your own terminal; it asks for the Postgres admin password)'
        : '  Your own Postgres: install PostgreSQL 17, then bash scripts/create-db.sh in your own terminal',
    ].join('\n'))
    : !depsOk ? 'npm run setup install'
    : !items.db.ok ? (items.db.detail?.startsWith('nothing on')
      ? (usesDocker ? (dockerOk ? 'Start the database: docker compose up -d --wait' : 'Start Docker Desktop, then: docker compose up -d --wait')
        : 'Start your Postgres service, then run npm run setup again.')
      : usesDocker ? 'The Docker database does not match .env. See "Docker" in the README.'
      : 'Run bash scripts/create-db.sh in your own terminal (it fixes the role, password and database).')
    : !items.tables.ok || !items.tt.ok ? 'npm run setup install'
    : !projects ? 'Add your projects: tt projects add "Website" --prefix WEB --alias site --share 50'
    : 'Ready. Use /t in Claude Code, and npm run dashboard for the dashboard.';

  const ok = Object.values(items).every((i) => i.ok) && Boolean(projects);
  return { ok, root, items, projects, next, database: { kind: !url ? 'none' : usesDocker ? 'docker' : 'postgres', host, port } };
}

function printReport(r: Report) {
  for (const i of Object.values(r.items)) console.log(`${i.ok ? '✓' : '✗'} ${i.label.padEnd(26)} ${i.detail ?? ''}`);
  console.log(`${r.projects ? '✓' : '✗'} ${'Projects'.padEnd(26)} ${r.projects ?? 0}`);
  console.log(`\nNext: ${r.next}`);
}

// ---------- docker ----------

function docker() {
  const env = readEnv();
  if (env.DATABASE_URL && !env.SIDEQUEST_DB_PASSWORD) {
    console.error('.env already points at a Postgres you set up yourself, so Docker would replace it.\n' +
      'To switch to Docker, delete the DATABASE_URL line from .env and run this again.');
    process.exit(1);
  }
  if (run('docker', ['info', '--format', '{{.ServerVersion}}'], { quiet: true }).status !== 0) {
    console.error('Docker isn\'t running. Install or start Docker Desktop, then run: npm run setup docker');
    process.exit(1);
  }
  const fresh = !env.SIDEQUEST_DB_PASSWORD;
  const password = env.SIDEQUEST_DB_PASSWORD ?? randomBytes(18).toString('base64url');
  const port = env.SIDEQUEST_DB_PORT ?? DOCKER_PORT;
  writeEnv({
    SIDEQUEST_DB_PASSWORD: password,
    SIDEQUEST_DB_PORT: port,
    DATABASE_URL: `postgres://sidequest:${password}@127.0.0.1:${port}/sidequest`,
  });
  console.log(fresh ? 'Wrote a new database password to .env.' : 'Using the password already in .env.');
  console.log(`Starting Postgres 17 in Docker on 127.0.0.1:${port}...`);
  const r = run('docker', ['compose', 'up', '-d', '--wait']);
  if (r.status !== 0) {
    console.error(`\nDocker couldn't start the database. If port ${port} is taken, set SIDEQUEST_DB_PORT in .env to a free port and run this again.`);
    process.exit(1);
  }
  console.log('\n✓ Postgres is running. Next: npm run setup install');
}

// ---------- install ----------

async function install() {
  if (!readEnv().DATABASE_URL && !process.env.DATABASE_URL) {
    console.error('Set up a database first: npm run setup docker, or bash scripts/create-db.sh in your own terminal.');
    process.exit(1);
  }
  runStep('Installing npm packages', 'npm', ['install']);
  runStep('Creating or updating the tables', 'npm', ['run', 'db:migrate']);
  let r = await check();
  if (r.projects === 0 && existsSync(join(root, 'seed', 'projects.json'))) {
    runStep('Loading your projects from seed/projects.json', 'npm', ['run', 'db:seed']);
  }
  runStep('Putting `tt` on your PATH', 'npm', ['link']);
  console.log('');
  r = await check();
  printReport(r);
}

// ---------- main ----------

if (step === 'check') {
  const r = await check();
  if (json) console.log(JSON.stringify(r, null, 2));
  else printReport(r);
  process.exitCode = r.ok ? 0 : 1;
} else if (step === 'docker') {
  docker();
} else if (step === 'install') {
  await install();
} else {
  console.error('Usage: npm run setup [check|docker|install] [--json]');
  process.exitCode = 1;
}
