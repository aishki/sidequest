# sidequest

Every ticket is a quest. **sidequest** is a personal ticket and to-do tracker you drive by typing `/t` in any Claude Code terminal, with a dark-mode dashboard on top and a local PostgreSQL database underneath.

> **Status:** early build. `/t` and the `tt` CLI work. The dashboard, planning and reports come next.

## What it does

- **`/t` from anywhere.** Add or update tickets in plain words (`/t the site login needs a loading state`). Claude fills in the project, type and priority, and asks when something is unclear.
- **Weekly plan.** Give each project a share of your week; sidequest turns it into recommended hours per day.
- **Dashboard.** Today, Board, Projects, Week plan, Reports and All tickets, all editable, all dark mode.
- **Reports.** Weekly and monthly metrics (tickets shipped, hours by project, planned vs logged) plus a written summary you can paste into an update for your manager.
- **Local first.** Your tickets live in Postgres on your own machine. Nothing is sent anywhere.

## Install

You need Node 22.18 or newer and PostgreSQL running locally.

```bash
git clone https://github.com/aishki/sidequest && cd sidequest
npm install
bash scripts/create-db.sh            # creates the sidequest role + database, writes .env
cp seed/projects.example.json seed/projects.json   # then edit: your projects, aliases, colors, weekly shares
npm run db:migrate && npm run db:seed
npm link                             # puts `tt` on your PATH
```

Then, in Claude Code:

```text
/plugin install sidequest --marketplace aishki/sidequest
```

`seed/projects.json` is git-ignored, so your project list stays on your machine.

## Using it

```text
/t site login needs a loading state, high, plan today
/t spent 1h30 on web-001
/t start working on app-004
/t done web-001
/t this: dark mode toggle flickers      ← "this" = the project linked to the current folder
/t                                      ← what's on today
```

When a project name is ambiguous, `/t` asks instead of guessing. You can also call the CLI directly: run `tt help` for every command.

## How it fits together

```text
/t in Claude Code ──▶ tt CLI (validates) ──▶ PostgreSQL (your machine) ◀──▶ Dashboard (localhost:4321)
```

`/t` never writes SQL. Claude calls a small CLI that checks every value before saving. Every change is also recorded in an append-only `events` table, which is what the reports are built from.

## License

sidequest uses two licenses:

| Part | License |
| --- | --- |
| Everything outside `dashboard/` (the `/t` plugin, CLI, database schema) | [MIT](LICENSE) |
| `dashboard/` | [AGPL-3.0](dashboard/LICENSE) |

In short: reuse the plugin and CLI however you like. If you modify the dashboard and let others use it over a network, share your changes under the AGPL.
