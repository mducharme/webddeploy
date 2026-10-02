# webddeploy — plan

A web frontend for [ddeploy](https://github.com/mducharme/ddeploy). For the
same admins who use the CLI today: it doesn't replace the CLI and it doesn't
open ddeploy up to a new kind of user.

Status: phases 0–2 (v1) implemented on 2026-10-02, on the `web-api` branch
in ddeploy. See "Implementation notes" at the end for where the build
departs from this plan.

---

## 1. Scope

### v1

| Feature | ddeploy source today |
| --- | --- |
| List projects (sites), previews nested under their parent | `list` (text table) |
| Deploy history per site | `deploy <name> --history` (text), `generated/<name>.deploys` (ts + sha, successes only) |
| Preview history per project (active and removed) | `generated/<name>.preview` (active only, deleted on removal), site logs |
| Start a deploy, watch it live | `deploy <name>` |
| Read logs: per site, webhook, webhook-other, backup-uploads, backup-database, prune-previews | `logs <name>` |
| General status | `doctor [-v] [name]` (colored text, TSV internally) |
| Provision a new project | `provision <name> <repo> [flags]` (can prompt interactively) |
| Google SSO, admins only | — |
| Audit trail of who did what from the web | — (`DDEPLOY_TRIGGER` / `SUDO_USER` attribution exists) |

### Later (designed for now, built later)

Rollback, preview actions (create, redeploy, remove), `env` and `override`
editing, `notify` settings, backup and restore, `remove`, more than one
server, finer roles.

### Phase 1 runs on one server, without blocking several

- Every backend route and every stored record carries a `serverId` from day
  one. Phase 1 has exactly one server, `local`.
- The backend talks to ddeploy only through a **connector** interface that
  sends a versioned JSON contract (§3). Phase 1 ships `LocalConnector`, which
  runs `sudo provision.sh api …`. A later `SshConnector` runs
  `ssh deploy@host sudo provision.sh api …` with the same contract. A central
  webddeploy can then manage several servers with no new daemon on them,
  because SSH and the `deploy` user already exist.
- The contract carries `api_version` so one web UI can talk to servers
  running different ddeploy versions.

---

## 2. Architecture

```
 Browser (React SPA)
    │  HTTPS, session cookie
    ▼
 nginx  ddeploy.<BASE_DOMAIN>   (wildcard cert already covers it)
    │  proxy → 127.0.0.1:8790
    ▼
 webddeploy-api  (Node + TypeScript, runs as unprivileged user `ddeploy-web`)
    │  SQLite: users, sessions, audit log, server registry, cache
    │
    │  Connector (phase 1: LocalConnector)
    │  sudo /opt/ddeploy/provision.sh api <verb> …    ← one sudoers rule
    ▼
 ddeploy `api` subcommand (root)  →  JSON on stdout
    │
    ├─ reads:  list / site / deploys / previews / doctor / logs   (synchronous)
    └─ writes: run start <deploy|provision> …   → detached systemd unit
                  └─ /var/log/ddeploy/runs/<run-id>.log + events.jsonl
```

### The privilege boundary

ddeploy's security model keeps lower-trust actors away from root: the
unprivileged webhook listener, the root worker, the root-owned checkout. A
web app is exactly that kind of lower-trust actor, so it gets the same
treatment:

- **`ddeploy-web` is a system user with no shell and no sudo** beyond one
  rule:
  `ddeploy-web ALL=(root) NOPASSWD: /opt/ddeploy/provision.sh api *`
- **`provision.sh api` is the whole attack surface.** It accepts an
  allowlist of verbs and validates every argument in Bash with the existing
  validators (`validate_name`, `NAME_RE`, the URL and path checks in
  `lib/config.sh`). It never passes free text to a shell. Anything not on the
  list is refused.
- **What a compromised web process can do:** exactly what the allowlist
  permits, and no more than a v1 web admin could do anyway. It can't read
  `/etc/ddeploy` secrets, rewrite ddeploy, or run arbitrary root commands.
- **Excluded from the v1 allowlist:** `env` (it holds secrets), `restore-*`,
  `remove`, `override`, `init*`, `configure`, `node-gc`. Each is added
  deliberately later, with its own validation.
- **`--deploy-cmd` on provision is excluded from the v1 web form.** It runs
  arbitrary commands, as the site user rather than root, but it's still the
  one free-text-to-exec path. Projects declare deploy steps in
  `.ddeploy/config.yaml` instead, which is the preferred path anyway.

### Long-running actions are detached runs, not child processes

A deploy can take minutes, and it must survive a restart of the web process.
`api run start …` starts a transient systemd unit
(`systemd-run --unit=ddeploy-run-<id> …`), prints `{run_id}` and returns
immediately. The run writes its full output to
`/var/log/ddeploy/runs/<id>.log` and its status to events (§3.2). The web app
polls `api run status` and `api run log --offset` and relays them to the
browser over SSE.

Side benefit: the CLI can see web-started runs (`ddeploy runs`), and the web
can see CLI-started and webhook-started runs. One shared history.

---

## 3. Changes to ddeploy

This is the biggest piece of new work, and it lands in ddeploy before any
UI. All of it is useful from the CLI too.

### 3.1 `provision.sh api` — machine-readable verbs

JSON on stdout, errors as `{"error": {"code", "message"}}` with a nonzero
exit. Every payload includes `"api_version": 1`.

| Verb | Returns | Notes |
| --- | --- | --- |
| `api info` | hostname, ddeploy git sha, `BASE_DOMAIN`, installed PHP versions, default Node, enabled features (webhook, backups, DB backups, previews, prune) | for the header and the provision form's options |
| `api sites` | list rows (name, php, node, build, docroot, db, branch, sha, last deploy, preview `{project, branch, mode}`) plus url, hostnames, custom domains, repo url | reuses `list_row` |
| `api site <name>` | detail: resolved config with the **source of each key** (repo `.ddeploy`, `.ddev`, sidecar, override), current release, releases on disk, previews of this site | |
| `api deploys <name> [--limit N]` | history from events (§3.2), falling back to `.deploys` | |
| `api previews <project>` | active previews, plus removed ones from events | |
| `api doctor [name] [--no-notify]` | `[{section, site?, status, check, detail}]` | `doctor_result` already prints TSV, so this is a thin layer. `--no-notify` stops web-triggered runs from paging `NOTIFY_WEBHOOK` |
| `api logs <name> [--lines N \| --offset B]` | `{lines, next_offset, size}` | same `validate_name` allowlist as `logs`; offset-based so polling is cheap |
| `api inspect-repo <url> [--branch b]` | reachable with the deploy key?, branches, default branch, detected `.ddev` / `.ddeploy` config, CMS detection (`lib/cms.sh`), which fallback fields are still needed | shallow clone into a temp dir as root, then deleted. Powers the provision wizard |
| `api run start deploy <name>` | `{run_id}` | |
| `api run start provision <name> <url> [validated flags]` | `{run_id}` | always `--non-interactive` |
| `api run status <id>` / `api run log <id> --offset B` / `api runs [--site n] [--limit N]` | | |

Every mutating verb takes `--actor <email>` (charset-validated), which becomes
`DDEPLOY_TRIGGER="web (<email>)"`. ddeploy's existing `notify_trigger`
attribution then shows it in logs and in Slack and Discord messages.

### 3.2 A structured event log

Today deploy history is successes only (`.deploys`). Preview metadata is
deleted when a preview is removed, and failures exist only as free-text site
log lines. So v1's "deploy history" and "previews history" need a real event
record:

- `/var/lib/ddeploy/events/<site>.jsonl` (root-owned), one line per event:
  `{ts, run_id, site, kind: deploy|rollback|provision|provision-preview|deploy-preview|remove-preview|prune, phase: started|succeeded|failed|skipped, trigger, from_sha, to_sha, subject, branch, duration_s, error?}`.
- Written from the same places that call `site_log` and `record_deploy`
  today: start, success, failure, and the `--if-changed` skip.
- `.deploys` stays, because rollback reads it. Events add to it; they don't
  replace it.
- One-time backfill: import `.deploys` and parse existing site logs best
  effort, flagged `backfilled: true`.

### 3.3 Every run gets a full output log

Today a failed deploy keeps only the last 25 lines in the site log
(`site_log_output`). Each deploy, provision and preview run, from any entry
point (CLI, webhook, web), gets a run id and tees its full output to
`/var/log/ddeploy/runs/<id>.log`, included in the weekly rotation with a
retention setting (`RUN_LOG_RETENTION_DAYS`, default 30). The web's deploy
view and the history's "view log" link both read from it.

### 3.4 Per-site locking for every entry point

`with_site_lock` (`lib/hook.sh`) only serializes **webhook** deploys. A CLI
deploy can already race a webhook deploy today, and a web button makes that
more likely. The plan moves the flock into `deploy`, `provision` and the
preview commands themselves. A run that's blocked reports
`waiting for lock (held by run <id>)` instead of piling up.

### 3.5 Install pieces (`ddeploy init-web`)

The security-relevant setup belongs with ddeploy's security model, not with
the app:

- creates the `ddeploy-web` user
- writes the sudoers drop-in (validated with `visudo -c`)
- writes the nginx vhost `ddeploy.<BASE_DOMAIN>` (`WEB_HOSTNAME` in
  `provisioner.conf`) from a template; no basic auth, since SSO replaces it
- `doctor` reports the web UI as `[ok]` / `[off]`, like the webhook listener

webddeploy itself (the built app and its systemd unit) installs separately
(§6).

### 3.6 Tests

Extend `docker/test` with `api` assertions: JSON shape, refused verbs,
refused arguments, run lifecycle, locking. The same harness later runs
webddeploy's end-to-end tests against a real ddeploy.

---

## 4. webddeploy app

### Stack

- **Frontend: React + Vite + TypeScript.** I recommend React over Astro.
  This is an authenticated, interactive dashboard with live logs and forms,
  which is where React fits best. Astro's strengths (static content, partial
  hydration) don't apply here.
  - TanStack Router (typed routes, `/servers/:serverId/...`) and TanStack
    Query (caching, polling)
  - Tailwind + shadcn/ui
  - SSE for live run output and log following
- **Backend: Node 22 + TypeScript, Hono.** Small, typed and SSE-friendly.
  Serves the built SPA as static files too, so there's one process.
  - `better-sqlite3` + Drizzle: users, sessions, audit log, server registry
  - Google OIDC via `openid-client`
- **Shared `contract` package:** zod schemas for every `api` payload, used by
  the connector (to validate ddeploy's output) and by the frontend (types).
  This is where `api_version` compatibility is handled.
- **Layout:** pnpm workspaces in this repo:
  ```
  apps/web        React SPA
  apps/api        Hono server, connectors, auth, SSE
  packages/contract  zod schemas + types
  deploy/         systemd unit, install script
  ```

### Authentication and authorization

- Google OIDC (authorization code + PKCE). Check the `hd` claim **on the
  server** against the allowed Workspace domain(s), **and** check the email
  against an admin allowlist in config. Being in the domain alone isn't
  enough to get admin.
- Sessions: an opaque id in an `HttpOnly; Secure; SameSite=Lax` cookie,
  stored in SQLite, with idle and absolute expiry. Mutating requests also
  need a matching `Origin` header.
- Roles: a single `admin` role in v1, with a `role` column so viewer and
  deployer roles can come later without a migration.
- Audit log: every mutating request writes (user, server, action, args,
  run_id, result). It's shown on an Activity page.

### Backend API

All routes are under `/api/servers/:serverId`:

```
GET  /info
GET  /sites                         ?includePreviews
GET  /sites/:name
GET  /sites/:name/deploys
GET  /sites/:name/previews
GET  /doctor                        ?site
GET  /logs/:name                    ?lines|offset
GET  /logs/:name/stream             SSE
POST /sites/:name/deploy            → {runId}
POST /provision/inspect             {repoUrl, branch?}
POST /provision                     {name, repoUrl, branch?, php?, docroot?, db?, hostnames?, customDomains?, uploadDirs?, auth?, node?, build?} → {runId}
GET  /runs                          ?site
GET  /runs/:id
GET  /runs/:id/stream               SSE
GET  /api/activity                  (audit)
```

**Caching:** `list` and `doctor` each spawn dozens of `yq` processes per
site. The backend caches `sites` and `doctor` per server (stale-while-
revalidate, about 30 s TTL, plus "refresh" buttons), and invalidates a
site's entries when one of its runs finishes. If that's still slow on a
large fleet, ddeploy can keep a parsed-config cache keyed on config file
mtimes. That's a later optimization, not v1.

### Screens

1. **Sign in:** a Google button. Unauthorized emails get a clear "not on
   the admin list" page.
2. **Fleet** (home)
   - Server card: worst doctor status, disk, nearest certificate expiry,
     webhook, backup and prune status, ddeploy version.
   - Sites table: name, status dot (from doctor), branch @ sha, last deploy
     (relative time, trigger), PHP and Node, preview count. Search, a
     "show previews" toggle, and a Deploy action per row.
3. **Site**
   - Header: URLs, branch, live sha with a forge commit link, status, and a
     **Deploy** button that asks for confirmation.
   - *Deploys* tab: a timeline (started, succeeded, failed, skipped) with
     trigger (`web (alice@…)`, `webhook [id]`, `manual (deploy)`), duration,
     commit, and a "view log" link to the run.
   - *Previews* tab: active previews (URL, branch, mode, last deployed),
     then removed ones with created and removed times and who removed them.
   - *Logs* tab: the site log, with a follow toggle.
   - *Health* tab: `doctor <name>` checks.
   - *Config* tab (read-only): resolved config with where each value comes
     from.
4. **Run:** live output (ANSI rendered), phase, duration, and a link back
   to the site. Each run has a permanent URL, so it can be pasted into
   Slack.
5. **Logs:** pick a site log or a fleet log (webhook, webhook-other,
   backup-uploads, backup-database, prune-previews), with tail and follow.
6. **Status:** the full doctor output, server section plus sites section,
   with a re-run button.
7. **Provision** (wizard)
   1. Name (live `NAME_RE` check, plus "already exists" from `sites`),
      repo URL, optional branch.
   2. Inspect: reachable?, branches, detected config and CMS. The form is
      prefilled, and only fields that are actually missing are required.
      Optional overrides: hostnames, custom domains (with a warning that DNS
      must already point here), auth, Node, build, upload dirs.
   3. Review, showing the **exact equivalent CLI command** so it can be
      copied, rerun or documented.
   4. Submit, which opens the Run view.
8. **Activity:** the audit log.

---

## 5. Phases

**Phase 0: ddeploy API foundations** (ddeploy repo)
`api` dispatcher plus `info`, `sites`, `site`, `doctor`, `logs`; event log
and run logs; per-site locking; `--actor`; docker tests.

**Phase 1: read-only web**
Monorepo scaffold, `contract` schemas, Google SSO and allowlist,
`LocalConnector`, Fleet, Site (Deploys / Previews / Logs / Health / Config),
Logs, Status. This is safe to put in front of admins early: it can't change
anything yet.

**Phase 2: actions**
ddeploy: `run start|status|log`, `runs`, `inspect-repo`. Web: Deploy button,
Run view with SSE, Provision wizard, audit log and Activity page.
`init-web` and the install script. **Phase 2 completes v1.**

**Phase 3+ (later):** rollback (the data is already there: events plus
releases on disk), preview actions, override editing, notify, backup and
restore, `SshConnector` plus a server registry UI, roles, browser
notifications on run completion.

---

## 6. Deployment of webddeploy itself

- Runs on the ddeploy server as `ddeploy-web`, under the systemd unit
  `webddeploy.service`, bound to `127.0.0.1:8790`.
- Built artifact (`apps/api/dist` plus `apps/web/dist`) lives at
  `/opt/webddeploy`, root-owned, read-only to `ddeploy-web`. This matches
  ddeploy's root-owned-checkout rule: the process that runs the code can't
  rewrite it.
- Runtime state: `/var/lib/webddeploy/` (SQLite), owned by `ddeploy-web`.
- Secrets: `/etc/webddeploy/env` (Google client id and secret, session key,
  allowed domain, admin emails), `root:ddeploy-web 0640`.
- Node: a pinned version installed for webddeploy. It doesn't share the
  per-site nvm toolchain.
- Optional extra layer: Cloudflare Access in front of the hostname if the
  zone is proxied.

---

## 7. Decisions needed

1. **Hostname:** is `ddeploy.<BASE_DOMAIN>` OK, or something else?
2. **Google Workspace domain(s)** allowed, and the initial admin email list.
3. **`init-web` in ddeploy (§3.5):** OK for ddeploy to own the sudoers rule
   and vhost, with webddeploy owning only the app?
4. **React** (recommended) vs Astro: confirm.
5. **Run log retention:** is a 30-day default OK?
6. **`--deploy-cmd` excluded from the web provision form in v1:** OK?
7. **Event backfill from old site logs:** worth doing, or start history
   fresh from the upgrade?

---

## Implementation notes (2026-10-02)

The open decisions in §7 were built with the defaults stated there:
`ddeploy.<BASE_DOMAIN>`, React, 30-day run log retention, no
`--deploy-cmd` from the web, and `init-web` living in ddeploy. Where the
build differs from the plan above:

- **Server registry.** It comes from configuration (`SERVERS`, or the
  single `DDEPLOY_COMMAND`), not a SQLite table. Routes and URLs are keyed
  by server id either way.
- **No backfill from old site logs.** Site history shows `.deploys`
  entries from before the event log as "before history" rows (timestamp
  and SHA only).
- **Events are per site.** They live in `/var/lib/ddeploy/events/<site>.jsonl`.
  Preview events carry `project`, so `api events --project` finds a
  project's preview history after the previews themselves are gone.
- **The server has no build step.** It runs its TypeScript with Node's type
  stripping (Node 22.18+). The client is built with Vite and served by the
  server.
- **The provision wizard enforces the `.ddev` name.** It requires the site
  name to match the repository's `.ddev/config.yaml` `name:`, because
  ddeploy refuses a mismatch.
- **Retrying a failed provision.** A failed first provision leaves its
  checkout behind. `api run start provision` allows a retry from the web
  only when that checkout's origin is the same repository.

Tests:
- ddeploy:
  - `tests/unit.sh`: JSON helpers, the event log and the API validators. No
    root needed. Runs in CI.
  - `docker/test/steps/04-api.sh`: every verb against the real stack, plus
    locking, the sudoers rule and preview history.
- webddeploy: `pnpm test` (vitest), covering the shared contract against
  real fixtures, server routes and auth, and client components.

---

## Second pass (2026-10-02): blindspots and phase 2

### Blindspots found in the first pass, and fixed

| Blindspot | Fix |
| --- | --- |
| The event log grew forever, and "recent activity" ran `cat` on all of it every 15s | Files are trimmed past 2 MB to their newest 4000 lines. `api events` merges only the tail of each file |
| A killed run (reboot, OOM, `systemctl stop`) stayed "running" forever; a hung build couldn't be stopped | A TERM/INT/HUP trap records `failed: interrupted`. `api run cancel` stops runs the web started. The UI marks runs with no result after 3h as "no result" |
| Cloudflare (`CLOUDFLARE_PROXIED=true` by default) cuts idle connections after ~100s, which dropped live streams | SSE heartbeat every 20s |
| Each open tab polled ddeploy on its own (N tabs means N `sudo` calls every 1.5s) | Identical polls (same log and offset, same run) are coalesced into one call per window |
| Health didn't check that a site answers: a 500 still showed as healthy | New `doctor` check `http` (GET `/` through local nginx) |
| History showed failures, but not what changed or how to recover | "What changed" commits, plus retry, roll back (from the run or any good deploy in history) and cancel |
| Restoring a snapshot left tables created after it | `db-import` drops every table and view before loading: a replace, not a merge |
| `run_notifying` used the raw site argument as an event path and in a trap string | Only plain site names (`NAME_RE`) get events or runs |
| The provision wizard checked names against the server's cached site list, so a just-removed site still looked taken | The wizard reads a fresh list |

### Phase 2: what users came to do

| Goal | Built |
| --- | --- |
| Create a new staging site | The wizard (first pass), plus a "next steps" checklist on new sites |
| Monitor existing sites | Fleet "needs attention" and "running" filters, failing rows highlighted, the HTTP check, a site overview tab |
| Access the database | Database tab: info, credentials and tunnel command (audited), dump download, import upload with progress and a typed confirmation, snapshots with restore |
| Change env vars / site settings | Environment tab (`.env` editor, masked secrets, values over stdin) and Settings tab (overrides, branch, reset to repository value) |
| View failed and successful deploys | History tab with filters, the run page (errors highlighted, jump to first error, commits, actions), config changes and database runs in the same timeline |

New `ddeploy api` verbs: `env`, `settings`, `branches`, `commits`,
`db info|credentials|dump`, `run cancel`, and run kinds `rollback`,
`db-import`, `db-restore`, `db-snapshot`. New CLI commands: `db-snapshot`
and `db-import`. Tests: ddeploy unit 53, Docker API checks 92;
webddeploy 81 shared + 87 server + 50 client.

### Next

- **Uploads (files):** syncing local uploads to a new staging site is
  still rsync. A web upload or archive import into `upload_dirs` would
  close the last gap in "create a staging site".
- **Previews from the UI:** create, redeploy and remove a branch preview.
  The verbs exist in ddeploy; the api allowlist doesn't include them yet.
- **Read-only SQL console:** needs a read-only DB user per site (ddeploy
  doesn't create one), so it isn't done with the site's own user.
- **Notifications:** per-site Slack channel settings (`notify`), whose
  values are secrets and so go over stdin, plus browser notifications when
  a run finishes.
- **Roles:** a viewer role (read-only) for non-admins, e.g. project
  managers checking a staging site's state.
- **SSH connector** for a second server.
- **`api sites` cost on large fleets:** cache each row's parsed config,
  keyed on config file mtimes, if `sites` gets slow (0.15s for one site
  today).
