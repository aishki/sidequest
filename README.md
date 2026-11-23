# sidequest

Every ticket is a quest. **sidequest** is a personal ticket and to-do tracker you drive by typing `/t` in any Claude Code terminal, with a dark-mode dashboard on top and a local PostgreSQL database underneath.

> **Status:** early build. `/t`, the `tt` CLI, the dashboard, weekly planning and reports work. Phone access comes next.

## What it does

- **`/t` from anywhere.** Add or update tickets in plain words (`/t the site login needs a loading state`). Claude fills in the project, type and priority, and asks when something is unclear.
- **Weekly plan.** Give each project a share of your week; sidequest turns it into recommended hours per day, after meetings. Change the split for one week only, and opt in to weekend hours when you want them.
- **Dashboard.** Today, Board, Projects, Week plan, Reports and All tickets, all editable, all dark mode.
- **Reports.** Week, month or quarter: tickets shipped, hours per day and per project, planned vs logged, on-time rate and time from start to done. Claude drafts a short summary for your manager's update, and the whole report saves as a PDF.
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

## Planning

Your week is a number of hours (40 by default) on chosen work days, minus meetings. Each project gets a share of what's left, and sidequest shows it as hours per week and per day. Overhead projects such as Admin are never planned.

```text
/t put 40% on the app this week      → tt share app 40 --week today   (the others scale to fit)
/t plan saturday 3h on the website   → tt weekend sat 3h --on web
/t I have 3h of meetings a week      → tt settings --meetings 3h
tt share                             → this week's split in % and hours
tt share reset --week today          → back to the usual split
```

Weekends get no planned hours unless you opt in, and an opt-in covers that one week. You can always log weekend time. The same controls are under **Edit plan** on the Week plan screen.

## Reports

```text
/t write my weekly update            → Claude reads tt report --json, writes it, saves it with tt summary save
tt report month                      → this month's numbers in the terminal
tt summary draft                     → Claude Code drafts this week's summary
```

Drafting runs the Claude Code CLI on your machine (`claude -p`, no tools, no API key), the same as `/t`. Set `SIDEQUEST_CLAUDE_BIN` in `.env` if `claude` isn't on your PATH, or `SIDEQUEST_SUMMARY_MODEL` to pick another model. The summary is yours to edit; Claude only redrafts when you ask. Weekend time is shown as extra, on top of the planned week.

## Dashboard

```bash
npm run dashboard          # dev mode with hot reload, http://localhost:4321
npm run dashboard:build    # build once
npm run dashboard:start    # serve the built app
```

Six screens, all editable, all dark mode:

| Screen | What it's for |
|---|---|
| **Today** | The one ticket to focus on, its checklist and timer, then today's hours per project. |
| **Board** | Inbox, To do, In progress, Blocked, Done. Drag a card to change its status. |
| **Projects** | Each project's share of the week, hours logged against it, and its ticket counts. |
| **Week plan** | Drag tickets onto days and see logged vs target hours. **Edit plan** changes the split (this week or every week), your hours, meetings and work days, and weekend hours. |
| **Reports** | Week, month or quarter: summary tiles, an editable written summary (**Draft with Claude**), hours per day by project, planned vs logged, and what shipped. **Copy as update** or **Save as PDF**. |
| **All tickets** | Search, filter and sort everything. |

Press `/` or `Ctrl+K` anywhere to find a ticket or add one. Changes made with `/t` show up in the dashboard within a second, and the other way round.

The server only listens on `127.0.0.1` and rejects requests from other hosts or origins. Set `DASHBOARD_PORT` in `.env` to use a different port.

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
