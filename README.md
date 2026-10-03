# webddeploy

A web UI for [ddeploy](https://github.com/mducharme/ddeploy). It's for the
same admins who use the CLI, and it doesn't replace it. Sign-in is Google
Workspace SSO.

What it's for:

- **Create a staging site.** A wizard inspects the repository, then
  provisions the site with live output. A "next steps" checklist follows:
  environment, database, uploads, domain, deploy on push.
- **Monitor sites.** The fleet view shows health per site, including
  whether it actually answers over HTTP, when the live code was deployed
  and by whom, a "needs attention" filter, and runs in progress.
- **Read logs.** Each site has its own logs: deploys, nginx errors (with PHP
  errors) and access. The server-wide nginx and PHP-FPM logs are one click
  away on the Logs page, and every log follows live.
- **See deploys, successful and failed.** History per site and fleet-wide,
  with live run output, highlighted errors, "what changed" (the commits
  deployed or taken back out), and retry, roll back or cancel.
- **Branch previews.** Create a preview of any branch from a site's
  Previews tab, with shared or isolated data and basic auth on or off.
  Redeploy or remove it from the list or from the preview's own page;
  removing an isolated preview also drops its own database.
- **Change environment variables.** The `.env` editor masks secrets until
  you reveal one (each reveal is audited), accepts pasted `.env` content,
  and warns when a value needs quotes.
- **Change site settings and branch.** These are operator overrides
  (basic auth, hostnames, custom domains, upload size, PHP workers,
  caching, build, previews...) plus which branch the site deploys. Changes
  apply on the next deploy, and the save confirmation offers to deploy now.
- **Work with the database.** See its size and tables, get connection
  details (with the SSH tunnel command), download a dump, import one
  (with an upload progress bar), and use snapshots. Every import or
  restore takes one first, so it can be undone.
- **Know who did what.** The Activity page lists every action taken from
  the web. ddeploy's own history also records web actions as
  `web (<email>)`.

See [docs/PLAN.md](docs/PLAN.md) for the design and what's planned next.

## How it talks to ddeploy

```
browser ──HTTPS──▶ nginx (ddeploy.<BASE_DOMAIN>) ──▶ webddeploy server (Node, user ddeploy-web)
                                                         │  sudo -n /opt/ddeploy/provision.sh api <verb> …
                                                         ▼
                                                  ddeploy `api` (root) ──▶ JSON
```

- **Everything goes through `ddeploy api`.** It's a JSON subcommand of
  ddeploy (`lib/cmd_api.sh`). The web user's only root access is one sudoers
  rule for it, which `ddeploy init-web` installs. ddeploy holds the verb
  allowlist and validates every argument. This app can't do anything the
  `api` subcommand doesn't offer.
- **Deploys and provisions run as transient systemd units.** ddeploy starts
  them, so they outlive a web request or a restart of this app. Each run
  writes start and end events to ddeploy's event log and its full output to
  a run log. Runs started from the CLI or by a git-push webhook land in the
  same history.
- **Web actions are attributed to the signed-in user.** They appear as
  `web (<email>)` in ddeploy's own logs and Slack notifications. They're
  also recorded in this app's audit log (the Activity page).

## Layout

```
shared/   zod schemas for every `ddeploy api` payload, run-history helpers,
          the provision request (validated on both client and server).
          Tests run against real ddeploy output (shared/test/fixtures).
server/   Hono on Node: Google OIDC, sessions, audit log (node:sqlite),
          the ddeploy connector, SSE streams for live output.
client/   React + Vite + TanStack Router/Query + Tailwind.
deploy/   systemd unit, installer, production env template.
```

The server runs its TypeScript directly with Node's type stripping, so it
has no build step. Node 22.18 or later is required.

## Development

```
pnpm install
cp server/.env.example server/.env    # dev sign-in, ddeploy via docker
pnpm dev                              # server :8790 + Vite :5173 (proxies /api and /auth)
```

The default `.env.example` points the server at ddeploy's Docker test
harness. Bring that up from a ddeploy checkout with
`docker/test/run.sh --keep`, then provision something to look at:

```
docker exec ddeploytest-web-1 ddeploy api run start provision testsite \
  ssh://gitfixture@127.0.0.1/srv/git/testsite.git --actor you@example.com
```

Open http://localhost:5173 and use "Development sign-in".

```
pnpm test        # shared + server + client (vitest)
pnpm typecheck
```

When ddeploy's `api` output changes, re-capture the fixtures in
`shared/test/fixtures/` from the harness (`ddeploy api <verb>`). The fixture
tests will point at whatever drifted.

## Trying it against a real server, from your machine

Nothing needs installing on the server except a ddeploy recent enough to
have `ddeploy api`. The app runs on your laptop and reaches ddeploy over
SSH. Arguments are quoted for the remote shell automatically when the
command is `ssh`.

1. **On the server,** update ddeploy to a version with `api` (this work
   lives on ddeploy's `web-api` branch):
   ```
   sudo git -C /opt/ddeploy fetch && sudo git -C /opt/ddeploy checkout web-api
   ```
2. **On the server,** let your SSH user run `ddeploy api` without a
   password prompt, and nothing else:
   ```
   echo 'deploy ALL=(root) NOPASSWD: /opt/ddeploy/provision.sh api *' | sudo tee /etc/sudoers.d/ddeploy-api-dev
   sudo chmod 440 /etc/sudoers.d/ddeploy-api-dev && sudo visudo -c
   ```
   Check it from your machine:
   `ssh deploy@staging.example.com sudo -n /opt/ddeploy/provision.sh api info`
3. **On your machine,** reuse one SSH connection for every call. Each
   request (and each live-log poll) runs one command, so this is what
   makes the UI feel fast:
   ```
   # ~/.ssh/config
   Host staging.example.com
     ControlMaster auto
     ControlPath ~/.ssh/cm-%r@%h:%p
     ControlPersist 10m
   ```
4. **On your machine,** in `server/.env`:
   ```
   PUBLIC_URL=http://localhost:5173
   DEV_LOGIN_EMAIL=you@example.com
   DDEPLOY_COMMAND=["ssh","-o","BatchMode=yes","deploy@staging.example.com","sudo","-n","/opt/ddeploy/provision.sh"]
   SERVER_NAME=staging
   ```
   Then run `pnpm install && pnpm dev`, open http://localhost:5173 and use
   "Development sign-in".

Everything works this way: live output, database download and upload
(both stream through SSH), env and settings. Actions run on the real
server as `web (you@example.com)`, so treat it as production. Remove
`/etc/sudoers.d/ddeploy-api-dev` when you're done, or keep it as the way
to drive a server without installing the web UI there.

## Production

On the ddeploy server:

1. In `/etc/ddeploy/provisioner.conf`, set `WEB_ENABLED=true` (and
   optionally `WEB_HOSTNAME`, default `ddeploy.<BASE_DOMAIN>`). Then run
   `sudo ddeploy init-web`. That creates the `ddeploy-web` user, its
   sudoers rule (`provision.sh api *`, nothing else) and the nginx vhost on
   the wildcard certificate.
2. Create a Google OAuth client (type "Web application"). Its redirect URI is
   `https://<WEB_HOSTNAME>/auth/callback`.
3. Install the app:
   ```
   sudo git clone <this repo> /opt/webddeploy
   sudo /opt/webddeploy/deploy/install.sh
   sudoedit /etc/webddeploy/env          # PUBLIC_URL, GOOGLE_*, ADMIN_EMAILS
   sudo systemctl restart webddeploy
   ```
   The installer finds Node 22.18+ on `PATH` or in ddeploy's `/opt/nvm`,
   builds the client and installs `webddeploy.service`. The checkout stays
   root-owned.
4. Run `ddeploy doctor`. It now reports `web UI`.

To upgrade: `sudo git -C /opt/webddeploy pull && sudo /opt/webddeploy/deploy/install.sh`.

### Who can sign in

A user needs all three of the following:
- A verified Google account.
- Membership in a domain listed in `GOOGLE_ALLOWED_DOMAINS`, checked
  against the ID token's `hd` claim. Leaving the list empty skips this check.
- An email address listed in `ADMIN_EMAILS`. In v1, everyone on the list is
  an admin.

Removing an email from `ADMIN_EMAILS` and restarting the service revokes
that user's existing sessions too.

## Several servers

Every API route and page URL already carries a server id
(`/api/servers/<id>/…`, `/s/<id>/…`). `SERVERS` in the env takes a JSON
array of `{id, name, command}`, where `command` is the prefix that `api …`
is appended to. Phase 1 runs on the server itself with `sudo`. The next step
is an SSH connector that runs the same command on another box; it needs one
change, quoting each argument for the remote shell (see
`server/src/ddeploy/connector.ts`).
