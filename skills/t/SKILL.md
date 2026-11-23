---
name: t
description: sidequest ticket tracker. Use when the user types /t, or asks to add, update, finish, plan or list tickets/to-dos, log time ("spent 2h on web-014"), start or stop a timer, or see what's on today. Works from any folder; "this" means the project linked to the current folder.
argument-hint: "[what to add, update or log — or nothing for today]"
allowed-tools: Bash(tt:*)
---

# /t — sidequest

The user's request: `$ARGUMENTS`

You turn plain words into `tt` commands. `tt` is the sidequest CLI. It validates everything and records every change in the event log.

## Hard rules

1. **Only `tt`.** Never write SQL, open the database, or edit sidequest files to change data.
2. **Never guess a project.** Pass the user's word for the project straight to `tt`. If `tt` exits with **code 2**, it needs the user to choose. Ask with AskUserQuestion, using the candidates from its message, then re-run. Fixed naming rules:
   - Never turn a word into a project yourself (for example "website" into a project whose name merely contains "web"). `tt` only accepts exact prefixes, names and aliases, and asks when a word fits several.
3. **"this" / "here"** means the current folder's project. Pass `this` to `tt`. If the folder isn't linked yet (exit 2), ask which project it is, run `tt link <project>`, then carry on. Don't ask again in that folder.
4. **Deleting** needs the user's explicit yes in this conversation. `tt delete KEY` refuses without `--yes`.
5. If `tt` isn't found or says sidequest isn't set up, follow **Setup** below.

## Ask little

The user has ADHD. Every question costs focus. Ask **only** when you can't act:
- the project is ambiguous or unknown (exit 2)
- several tickets fit "that bug" / "the login one"
- they said "spent" but gave no duration

Put everything you need into **one** AskUserQuestion. Infer everything else, act, and mention what you assumed so they can correct it.

## Inferring fields

| Field | How |
| --- | --- |
| title | The user's own words, tidied: sentence case, short, starts with what needs doing. Drop the project name and filler ("add a ticket to…"). |
| type | bug: broken, crash, error, wrong, fix. ui_ux: looks, spacing, layout, design, UX, loading state, copy on screen. launch film: video, film, demo reel. research: look into, investigate, compare, spike. admin: meeting, email, timesheet, report, call. update: bump, upgrade, dependency, content update. Otherwise feature. |
| priority | Only from clear signals: "urgent", "asap", "!" mean urgent or high. "whenever", "someday" mean low. Otherwise leave it. |
| estimate, due, plan | Only when the user says them. Weekday names and today/tomorrow go straight to `tt`. Work out anything else ("next Tuesday", "end of month") as YYYY-MM-DD. |
| subtasks | A list in the request becomes `--sub "…"` once per item. |

Several things in one message mean several `tt` commands.

## Finding a ticket without a key

Run `tt list <project> --json`, or `tt list --json` if the project is unknown, and match on the title. Exactly one match: use it. Several: ask, showing each key and title. None: say so, and offer to add it.

## Commands

```text
tt add <project> "<title>" [--type T] [--priority P] [--status S] [--estimate 2h] [--due DAY] [--plan DAY] [--notes "…"] [--sub "…"]...
tt update <KEY> [--title "…"] [--type T] [--status S] [--priority P] [--estimate 2h|none] [--due DAY|none] [--plan DAY|none] [--notes "…"] [--add-note "…"]
tt done <KEY> [KEY…]
tt move <KEY> <project>                       new key in the other project
tt show <KEY>
tt list [project] [--status open|all|S,S] [--type T] [--plan today|week|none|DAY]
tt today
tt sub add <KEY> "<text>"… | tt sub done|undo|rm <KEY> <n>
tt log <KEY|project> <duration> [--on DAY] [--at 14:00] [--note "…"]
tt timer start <KEY|project> [--switch] | tt timer stop [--note "…"] | tt timer cancel | tt timer
tt share | tt share <project> <pct> [--week DAY] | tt share reset --week DAY
tt settings [--hours 40] [--days mon-fri] [--meetings 3h|none]
tt weekend sat|sun <hours|off> [--on project] [--week DAY]
tt weekend <sat-hours> <sun-hours> [--on project] [--week DAY] | tt weekend off [--week DAY]
tt report [week|month|quarter] [--day DAY] [--json]
tt summary [period] [--day DAY] | tt summary save [period] [--day DAY] (text on stdin) | tt summary clear [period]
tt projects | tt resolve <name> | tt link <project> | tt here
tt projects add <name> --prefix P [--alias a] [--share N] [--color #hex] [--overhead]
```

DAY is today, tomorrow, yesterday, mon…sun, or YYYY-MM-DD. Durations look like 2h, 45m, 1h30m or 1:30. Keys accept any case: web-14, WEB-014 and web14 all work. Always quote titles and notes.

## Time

- "spent 2h on web-014" → `tt log web-014 2h`. "yesterday" → `--on yesterday`. "from 2 to 4" → `--at 14:00` with 2h.
- Time can go to a project with no ticket: `tt log admin 30m --note "standup"`.
- "starting on X" / "working on X now" → `tt timer start X`. If a timer is already running, add `--switch`. Switching is what the user means.
- Weekend time can always be logged. **Weekend hours are planned only when the user explicitly asks for that week.** Never plan weekend work on your own.

## Planning

- "plan saturday 3h on the app" → `tt weekend sat 3h --on app`. For "next weekend", add `--week` with a day in that week. Without `--on`, weekend hours split like a work day. "no weekend" → `tt weekend off`. A weekend opt-in counts for that one week only.
- "put 40% on web" → `tt share web 40`; the other projects scale to fit. If the user means one week only ("this week", "next week"), add `--week DAY`. If it's unclear whether they mean every week or one week, ask. Changing the usual split also changes past weeks in reports.
- "back to normal this week" → `tt share reset --week today`.
- "how's my week split" → `tt share`.
- "I work 35 hours", "I have 3h of meetings a week", "I work Mon–Thu" → `tt settings --hours 35`, `--meetings 3h`, `--days mon-thu`. These change every week, so confirm in one line first.
- Overhead projects (e.g. Admin) never get planned hours.

## Reports and the update summary

- "how did my week go", "what did I ship this month" → `tt report` (or `month`, `quarter`; `--day` with a day in an earlier period). Answer in a few lines; don't paste the whole report.
- "write my weekly update" / "summarize my month for my boss":
  1. Run `tt report <period> --json` and write the update from it: first person, plain text, one opening sentence, then 3 to 6 lines starting with "- ". Lead with what shipped (titles as written, key in brackets), then hours where they say something: the total, the biggest projects, clear gaps against plan, and weekend hours as extra time. Skip projects with no time logged. Under 130 words.
  2. Use only facts from the report. Never invent reasons, outcomes, blockers or next steps. If the user tells you any, add them.
  3. Show it, then save it so it appears on the Reports screen: pipe it to `tt summary save <period> [--day DAY]`. If a summary already exists (`summary` in the JSON), ask before replacing it, since the user may have edited it.
- The dashboard can also draft it (**Draft with Claude** on Reports), which runs `tt summary draft` the same way.

## Setup

Run this when the user types `/t setup`, when `tt` isn't found, or when `tt` says sidequest isn't set up or can't reach Postgres. These steps use `git`, `node`, `npm` and `docker` as well as `tt`.

1. **Find the sidequest folder.** `tt` names it in its errors and on the last line of `tt help`. If `tt` isn't found, ask once whether they already have a sidequest folder. If not, clone it to `~/sidequest` (`git clone https://github.com/aishki/sidequest ~/sidequest`). Use a lasting folder like that, never the plugin's own folder, which is replaced on updates.
2. **Check:** `node scripts/setup.ts check --json` in that folder. Then follow `next`, one step at a time, and re-check after each one.
3. **No database yet** (`database.kind` is `none`): ask once, Docker or their own Postgres.
   - Docker: `node scripts/setup.ts docker`. It writes a generated password to `.env` and starts Postgres 17 on 127.0.0.1:5433.
   - Their own Postgres: ask them to run `bash scripts/create-db.sh` **in their own terminal** and tell you when it's done. It asks for the Postgres admin password. **Never** run it yourself, and never ask for, read or type that password.
4. **Install:** `node scripts/setup.ts install` (npm packages, tables, `tt` on the PATH).
5. **Projects** (`projects` is 0): ask in one question what they work on: names, short nicknames, and a rough share of the week. Propose a 2–6 letter prefix per project and an Admin overhead bucket, confirm the list in one line, then run `tt projects add "<name>" --prefix P --alias a --share N` for each (`--overhead` for Admin). Every alias must be unique, so drop ambiguous ones and let `/t` ask instead.
6. **Finish** with the check showing ready, then suggest `tt link <project>` inside each project's folder and `npm run dashboard` for the dashboard.

Never print or repeat the contents of `.env`.

## No arguments

When `/t` has no arguments, run `tt today` and give a short summary:
- the running timer
- what's planned
- what's overdue
- logged time

Then offer the obvious next step, in one line.

## Replying

Keep it short. Use one line per change, with the key in bold:

> **WEB-014** · Login needs a loading state · UI/UX, high, planned today

After the lines, add at most one short line for anything you assumed (e.g. "Typed it as UI/UX."). Don't paste raw `tt` output unless the user asked to see it.
