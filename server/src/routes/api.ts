import {
  PREVIEW_KINDS,
  SECRET_KEY,
  envChangeRequest,
  fetchTestRequest,
  sourceSpec,
  forgetHostRequest,
  uploadsFetchRequest,
  optionsRequest,
  serverConfigRequest,
  SERVER_SETTINGS,
  userRequest,
  previewBranchRequest,
  previewCreateRequest,
  settingsRequest,
  type EnvResponse,
  CHANGE_KINDS,
  collapseRuns,
  isTerminal,
  patterns,
  provisionRequest,
  runFromShow,
  siteHistory,
  type Me,
  type Run,
  workersConfigRequest,
} from '@webddeploy/shared';
import { Readable, Transform } from 'node:stream';
import { Hono, type Context } from 'hono';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { z } from 'zod';
import type { AppDeps, AppEnv } from '../app.ts';
import { DdeployError } from '../ddeploy/connector.ts';
import type { ManagedServer } from '../servers.ts';

// Loose on purpose: these helpers only read params and query strings.
type Ctx = Context<any, string>;

function bad(message: string): never {
  throw new DdeployError('bad_request', message);
}

function siteParam(c: Ctx): string {
  const name = c.req.param('name') ?? '';
  if (!patterns.siteName.test(name)) bad(`invalid site name '${name}'`);
  return name;
}

function logParam(c: Ctx): string {
  const name = c.req.param('name') ?? '';
  if (!patterns.logName.test(name)) bad(`invalid log name '${name}'`);
  return name;
}

function runParam(c: Ctx): string {
  const id = c.req.param('id') ?? '';
  if (!patterns.runId.test(id)) bad(`invalid run id '${id}'`);
  return id;
}

function intQuery(c: Ctx, key: string, def: number, max: number): number {
  const raw = c.req.query(key);
  if (raw == null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) bad(`${key} must be a non-negative integer`);
  return Math.min(n, max);
}

const inspectBody = z.object({
  repo_url: z.string().trim().regex(patterns.repoUrl, 'an ssh://, git@ or https:// URL'),
  branch: z
    .string()
    .trim()
    .regex(patterns.branch)
    .nullish()
    .or(z.literal('').transform(() => null)),
});

export function apiRoutes(deps: AppDeps): Hono<AppEnv> {
  const { config, servers, audit } = deps;
  const now = deps.now ?? Date.now;
  const api = new Hono<AppEnv>();

  /** Runs a mutating action with an audit entry before it and its outcome after. */
  const audited = async (
    email: string,
    serverId: string,
    action: string,
    target: string | null,
    detail: unknown,
    fn: () => Promise<{ body: unknown; runId?: string; status?: 200 | 202 }>,
    c: Ctx,
  ) => {
    const entry = audit.begin({ email, serverId, action, target, detail });
    try {
      const r = await fn();
      audit.succeeded(entry, r.runId);
      return c.json(r.body, r.status ?? 200);
    } catch (err) {
      audit.rejected(entry, (err as Error).message);
      throw err;
    }
  };

  api.get('/me', (c) => {
    const u = c.get('user');
    const me: Me = { email: u.email, name: u.name, picture: u.picture, role: c.get('role'), servers: servers.list() };
    return c.json(me);
  });

  // --- super-admin: users and global options --------------------------------

  api.get('/admin/users', (c) => c.json({ users: deps.access.users() }));

  api.put('/admin/users', async (c) => {
    const user = c.get('user');
    const parsed = userRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    if (parsed.data.email === user.email) bad("you can't change your own role");
    const entry = audit.begin({ email: user.email, serverId: '-', action: 'user.set', target: parsed.data.email, detail: { role: parsed.data.role } });
    try {
      deps.access.setUser(parsed.data.email, parsed.data.role, user.email);
    } catch (err) {
      audit.rejected(entry, (err as Error).message);
      throw err;
    }
    audit.succeeded(entry);
    return c.json({ users: deps.access.users() });
  });

  api.delete('/admin/users/:email', (c) => {
    const user = c.get('user');
    const email = decodeURIComponent(c.req.param('email')).toLowerCase();
    if (email === user.email) bad("you can't remove yourself");
    const entry = audit.begin({ email: user.email, serverId: '-', action: 'user.remove', target: email });
    try {
      deps.access.removeUser(email);
    } catch (err) {
      audit.rejected(entry, (err as Error).message);
      throw err;
    }
    audit.succeeded(entry);
    return c.json({ users: deps.access.users() });
  });

  api.get('/admin/options', (c) => c.json({ ...deps.access.options(), allowed_domains: config.allowedDomains }));

  api.put('/admin/options', async (c) => {
    const user = c.get('user');
    const parsed = optionsRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    audit.succeeded(audit.begin({ email: user.email, serverId: '-', action: 'options.set', target: null, detail: parsed.data }));
    return c.json({ ...deps.access.setOptions(parsed.data), allowed_domains: config.allowedDomains });
  });

  api.get('/activity', (c) => c.json({ entries: audit.list(intQuery(c, 'limit', 100, 1000)) }));

  const srv = new Hono<AppEnv & { Variables: { server: ManagedServer } }>();
  srv.use('*', async (c, next) => {
    const s = servers.get(c.req.param('serverId') ?? '');
    if (!s) return c.json({ error: { code: 'not_found', message: 'no such server' } }, 404);
    c.set('server', s);
    await next();
  });

  // --- super-admin: server settings (provisioner.conf) ----------------------

  srv.get('/config', async (c) => c.json(await c.get('server').client.config()));

  srv.put('/config', async (c) => {
    const s = c.get('server');
    const user = c.get('user');
    const parsed = serverConfigRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    // Secrets (NOTIFY_WEBHOOK) are recorded as changed, never with their value.
    const detail = Object.fromEntries(Object.entries(parsed.data.set).map(([k, v]) => [k, SERVER_SETTINGS.find((d) => d.key === k)?.kind === 'secret' ? '(changed)' : v]));
    return audited(user.email, s.ref.id, 'config.set', null, detail, async () => {
      const result = await s.client.applyConfig(user.email, parsed.data.set);
      s.cache.invalidate('info');
      s.cache.invalidate('doctor');
      return { body: result };
    }, c);
  });

  srv.get('/info', async (c) => {
    const s = c.get('server');
    return c.json(await s.cache.get('info', 5 * 60_000, () => s.client.info(), { fresh: !!c.req.query('fresh') }));
  });

  // Names only (no config parsing): the list and the site switcher show these at once.
  srv.get('/site-names', async (c) => {
    const s = c.get('server');
    // "sites:…": cleared with the sites list (cache.invalidate('sites')), so a new site shows up at once.
    return c.json(await s.cache.get('sites:names', 10_000, () => s.client.siteNames(), { fresh: !!c.req.query('fresh') }));
  });

  srv.get('/sites', async (c) => {
    const s = c.get('server');
    return c.json(await s.cache.get('sites', config.sitesCacheMs, () => s.client.sites(), { fresh: !!c.req.query('fresh') }));
  });

  const siteDetail = (s: ManagedServer, name: string, fresh = false) =>
    s.cache.get(`site:${name}`, 15_000, () => s.client.site(name), { fresh });

  srv.get('/sites/:name', async (c) => c.json(await siteDetail(c.get('server'), siteParam(c), !!c.req.query('fresh'))));

  srv.get('/sites/:name/runs', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const [{ events }, detail] = await Promise.all([s.client.events({ site: name, limit: 2000 }), siteDetail(s, name)]);
    const runs: Run[] = siteHistory(events, detail.legacy_deploys, name);
    return c.json({ runs });
  });

  srv.get('/sites/:name/previews', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const [active, { events }] = await Promise.all([s.client.previews(name), s.client.events({ project: name, limit: 2000 })]);
    const history = collapseRuns(events.filter((e) => PREVIEW_KINDS.has(e.kind)));
    return c.json({ active: active.previews, history });
  });

  srv.post('/sites/:name/previews', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const parsed = previewCreateRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    return audited(user.email, s.ref.id, 'preview.create', name, parsed.data, async () => {
      const r = await s.client.startPreviewCreate(name, user.email, parsed.data);
      invalidateSite(s, name);
      return { body: { run_id: r.run_id, site: r.site ?? null }, runId: r.run_id, status: 202 };
    }, c);
  });

  for (const [path, action, start] of [
    ['deploy', 'preview.deploy', 'startPreviewDeploy'],
    ['remove', 'preview.remove', 'startPreviewRemove'],
  ] as const) {
    srv.post(`/sites/:name/previews/${path}`, async (c) => {
      const s = c.get('server');
      const name = siteParam(c);
      const user = c.get('user');
      const parsed = previewBranchRequest.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return issues(c, parsed.error);
      return audited(user.email, s.ref.id, action, name, parsed.data, async () => {
        const r = await s.client[start](name, user.email, parsed.data.branch);
        invalidateSite(s, name);
        if (r.site) invalidateSite(s, r.site);
        return { body: { run_id: r.run_id, site: r.site ?? null }, runId: r.run_id, status: 202 };
      }, c);
    });
  }

  srv.post('/sites/:name/deploy', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const entry = audit.begin({ email: user.email, serverId: s.ref.id, action: 'deploy', target: name });
    try {
      const { run_id } = await s.client.startDeploy(name, user.email);
      audit.succeeded(entry, run_id);
      s.cache.invalidate('sites');
      s.cache.invalidate(`site:${name}`);
      return c.json({ run_id }, 202);
    } catch (err) {
      audit.rejected(entry, (err as Error).message);
      throw err;
    }
  });

  srv.post('/provision/inspect', async (c) => {
    const parsed = inspectBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) bad(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return c.json(await c.get('server').client.inspectRepo(parsed.data.repo_url, parsed.data.branch));
  });

  srv.post('/provision', async (c) => {
    const s = c.get('server');
    const user = c.get('user');
    const parsed = provisionRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          error: { code: 'bad_request', message: 'invalid provision request' },
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        400,
      );
    }
    const req = parsed.data;
    const entry = audit.begin({ email: user.email, serverId: s.ref.id, action: 'provision', target: req.name, detail: req });
    try {
      const { run_id } = await s.client.startProvision(req, user.email);
      audit.succeeded(entry, run_id);
      s.cache.invalidate('sites');
      return c.json({ run_id }, 202);
    } catch (err) {
      audit.rejected(entry, (err as Error).message);
      throw err;
    }
  });

  srv.get('/doctor', async (c) => {
    const s = c.get('server');
    // ?snapshot=1: ddeploy's last scheduled check, nothing run (instant).
    // An older ddeploy has none: the checks run, cached as before.
    if (c.req.query('snapshot')) {
      const fresh = !!c.req.query('fresh');
      const info = await s.cache.get('info', 5 * 60_000, () => s.client.info());
      if (info.capabilities?.includes('doctor_snapshot')) {
        return c.json(await s.cache.get('doctor:snapshot', 30_000, () => s.client.doctorSnapshot(), { fresh }));
      }
      return c.json(await s.cache.get('doctor:*', config.doctorCacheMs, () => s.client.doctor(), { fresh }));
    }
    const site = c.req.query('site') || undefined;
    if (site && !patterns.siteName.test(site)) bad(`invalid site name '${site}'`);
    return c.json(await s.cache.get(`doctor:${site ?? '*'}`, config.doctorCacheMs, () => s.client.doctor(site), { fresh: !!c.req.query('fresh') }));
  });

  srv.get('/logs', async (c) => c.json(await c.get('server').client.logs()));

  srv.get('/logs/:name', async (c) => {
    const name = logParam(c);
    const offset = c.req.query('offset');
    return c.json(
      await c.get('server').client.log(name, offset != null ? { offset: intQuery(c, 'offset', 0, Number.MAX_SAFE_INTEGER) } : { lines: intQuery(c, 'lines', 200, 5000) }),
    );
  });

  srv.get('/logs/:name/stream', (c) => {
    const s = c.get('server');
    const name = logParam(c);
    const lines = intQuery(c, 'lines', 200, 5000);
    return streamSSE(c, async (stream) => {
      const beat = heartbeat(stream);
      let first;
      try {
        first = await s.client.log(name, { lines });
      } catch (err) {
        // Said, not just a closed stream: the page shows why.
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (err as Error).message }) });
        return;
      }
      await sendChunk(stream, first);
      let offset = first.next_offset;
      while (!stream.aborted) {
        await stream.sleep(config.logPollMs);
        if (stream.aborted) break;
        try {
          // Coalesced: every tab following this log at the same offset
          // shares one ddeploy call per poll window.
          const at = offset;
          const chunk = await s.polls.get(`log:${name}:${at}`, config.logPollMs, () => s.client.log(name, { offset: at }));
          if (chunk.rotated || chunk.text) await sendChunk(stream, chunk);
          offset = chunk.next_offset;
          await beat();
        } catch (err) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (err as Error).message }) });
          break;
        }
      }
    });
  });

  srv.get('/runs', async (c) => {
    const s = c.get('server');
    const site = c.req.query('site') || undefined;
    if (site && !patterns.siteName.test(site)) bad(`invalid site name '${site}'`);
    const limit = intQuery(c, 'limit', 50, 500);
    const { events } = await s.client.events({ site, limit: Math.min(limit * 3, 5000) });
    return c.json({ runs: collapseRuns(events).slice(0, limit) });
  });

  // What's happening, pushed: the runs in progress whenever that changes,
  // and each run that finished since the last message. One ddeploy call
  // per LIVE_POLL_MS, shared by every open tab (s.polls).
  srv.get('/live', (c) => {
    const s = c.get('server');
    return streamSSE(c, async (stream) => {
      const beat = heartbeat(stream);
      let running = new Map<string, Run>();
      let seen = new Set<string>();
      let lastSig = '';
      let first = true;
      while (!stream.aborted) {
        let runs: Run[];
        try {
          const { events } = await s.polls.get('live', config.livePollMs, () => s.client.events({ limit: 200 }));
          runs = collapseRuns(events, new Date(now())).slice(0, 60);
        } catch (err) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (err as Error).message }) });
          await stream.sleep(config.livePollMs * 3);
          continue;
        }
        const nowRunning = runs.filter((r) => !isTerminal(r.phase));
        // Finished: was running at the last check, or wasn't there at all and
        // already is done (a short run, between two checks). Config changes
        // aren't runs anyone waits for.
        const finished = first
          ? []
          : runs.filter((r) => isTerminal(r.phase) && !CHANGE_KINDS.has(r.kind) && (running.has(r.run_id) || !seen.has(r.run_id)));
        // Anything new at the top (a run started, finished, or a config change) changes the signature.
        const sig = runs.slice(0, 20).map((r) => `${r.run_id}:${r.phase}`).join(',');
        if (first || sig !== lastSig || finished.length) {
          const sites = [...new Set(runs.filter((r) => !lastSig.includes(`${r.run_id}:${r.phase}`)).map((r) => r.site))];
          await stream.writeSSE({ event: 'live', data: JSON.stringify({ running: nowRunning, finished, changed_sites: first ? [] : sites }) });
          lastSig = sig;
        }
        running = new Map(nowRunning.map((r) => [r.run_id, r]));
        seen = new Set(runs.map((r) => r.run_id));
        first = false;
        await beat();
        await stream.sleep(config.livePollMs);
      }
    });
  });

  srv.get('/runs/:id', async (c) => {
    const show = await c.get('server').client.runShow(runParam(c));
    return c.json({ run: runFromShow(show, new Date(now())), meta: show.meta, log_size: show.log_size, steps: show.steps ?? [] });
  });

  srv.get('/runs/:id/log', async (c) => {
    const id = runParam(c);
    return c.json(await c.get('server').client.runLog(id, { offset: intQuery(c, 'offset', 0, Number.MAX_SAFE_INTEGER) }));
  });

  // Live run: its state whenever it changes, its output as it grows, and
  // `end` once it's finished and every byte of output has been sent.
  srv.get('/runs/:id/stream', (c) => {
    const s = c.get('server');
    const id = runParam(c);
    let offset = intQuery(c, 'offset', 0, Number.MAX_SAFE_INTEGER);
    return streamSSE(c, async (stream) => {
      const beat = heartbeat(stream);
      let lastState = '';
      while (!stream.aborted) {
        let run: Run;
        let logSize: number | null;
        try {
          const show = await s.polls.get(`run:${id}`, 900, () => s.client.runShow(id));
          run = runFromShow(show, new Date(now()));
          logSize = show.log_size;
        } catch (err) {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (err as Error).message }) });
          return;
        }
        const state = JSON.stringify(run);
        if (state !== lastState) {
          lastState = state;
          await stream.writeSSE({ event: 'run', data: state });
        }
        let drained = true;
        if (logSize != null && logSize > offset) {
          const at = offset;
          const chunk = await s.polls.get(`runlog:${id}:${at}`, 900, () => s.client.runLog(id, { offset: at }));
          if (chunk.text) await sendChunk(stream, chunk);
          offset = chunk.next_offset;
          drained = offset >= chunk.size;
        }
        if (isTerminal(run.phase) && drained) {
          s.cache.invalidate('sites');
          s.cache.invalidate(`site:${run.site}`);
          await stream.writeSSE({ event: 'end', data: JSON.stringify({ phase: run.phase }) });
          return;
        }
        await beat();
        await stream.sleep(drained ? 1000 : 50);
      }
    });
  });

  srv.post('/runs/:id/cancel', async (c) => {
    const s = c.get('server');
    const id = runParam(c);
    const user = c.get('user');
    return audited(user.email, s.ref.id, 'run.cancel', id, undefined, async () => {
      await s.client.cancelRun(id, user.email);
      return { body: { run_id: id, cancelled: true }, runId: id };
    }, c);
  });

  // --- deploy recovery ---------------------------------------------------

  srv.post('/sites/:name/rollback', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const body = z.object({ sha: z.string().regex(patterns.sha).nullish() }).safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) bad('sha must be a commit SHA');
    return audited(user.email, s.ref.id, 'rollback', name, { sha: body.data.sha ?? null }, async () => {
      const { run_id } = await s.client.startRollback(name, user.email, body.data.sha);
      invalidateSite(s, name);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  srv.get('/sites/:name/commits', async (c) => {
    const name = siteParam(c);
    const from = c.req.query('from') ?? '';
    const to = c.req.query('to') ?? '';
    if (!patterns.sha.test(from) || !patterns.sha.test(to)) bad('from and to must be commit SHAs');
    const s = c.get('server');
    return c.json(await s.cache.get(`commits:${name}:${from}:${to}`, 3600_000, () => s.client.commits(name, from, to)));
  });

  srv.get('/sites/:name/branches', async (c) => c.json(await c.get('server').client.branches(siteParam(c))));

  // --- environment -------------------------------------------------------
  // Secret-looking values never leave the server unless asked for one at
  // a time (audited); the rest are shown as they are.

  // --- debugging: is a deploy going to change anything, what is the site complaining about

  srv.get('/sites/:name/deploy-check', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    return c.json(await s.cache.get(`site:${name}:deploy-check`, 10_000, () => s.client.deployCheck(name)));
  });

  srv.get('/sites/:name/errors', async (c) => {
    const s = c.get('server');
    const since = c.req.query('since');
    if (since && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(since)) bad('since: an ISO time like 2026-10-04T12:00:00Z');
    return c.json(await s.client.errors(siteParam(c), since || undefined));
  });

  // --- queue workers and scheduled tasks ------------------------------------

  srv.get('/sites/:name/workers', async (c) => c.json(await c.get('server').client.workers(siteParam(c))));

  // Set the site's workers and scheduled tasks on the server (they win
  // over the repository's; empty lists fall back to it), installed now.
  srv.put('/sites/:name/workers', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const parsed = workersConfigRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    const cfg = parsed.data;
    return audited(c.get('user').email, s.ref.id, 'workers.config', name, { workers: cfg.queue_workers.length, schedules: cfg.schedule.length }, async () => {
      const body = await s.client.setWorkers(name, c.get('user').email, cfg);
      invalidateSite(s, name);
      return { body };
    }, c);
  });

  srv.post('/sites/:name/workers/:index/:action', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const parsed = z
      .object({ index: z.coerce.number().int().min(0).max(99), action: z.enum(['restart', 'stop', 'start']) })
      .safeParse({ index: c.req.param('index'), action: c.req.param('action') });
    if (!parsed.success) return issues(c, parsed.error);
    const { index, action } = parsed.data;
    return audited(c.get('user').email, s.ref.id, `worker.${action}`, name, { index }, async () => ({
      body: await s.client.workerAction(name, c.get('user').email, action, index),
    }), c);
  });

  srv.post('/sites/:name/schedules/:action{pause|resume}', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const pause = c.req.param('action') === 'pause';
    return audited(c.get('user').email, s.ref.id, pause ? 'schedules.pause' : 'schedules.resume', name, undefined, async () => ({
      body: await s.client.pauseSchedules(name, c.get('user').email, pause),
    }), c);
  });

  srv.post('/sites/:name/schedules/:index/run', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const index = z.coerce.number().int().min(0).max(99).safeParse(c.req.param('index'));
    if (!index.success) return issues(c, index.error);
    return audited(c.get('user').email, s.ref.id, 'schedule.run', name, { index: index.data }, async () => {
      const { run_id } = await s.client.startScheduleRun(name, c.get('user').email, index.data);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  // --- config files (charcoal's config.local.json, persistent_files) -------

  const filePath = z.string().regex(patterns.configFile, 'a config file path');

  srv.get('/sites/:name/files', async (c) => c.json(await c.get('server').client.configFiles(siteParam(c))));

  // Opening a file shows its content, credentials included: recorded, like revealing a secret.
  srv.post('/sites/:name/files/read', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const parsed = z.object({ path: filePath }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    return audited(c.get('user').email, s.ref.id, 'file.read', name, { path: parsed.data.path }, async () => ({
      body: await s.client.configFile(name, parsed.data.path),
    }), c);
  });

  srv.put('/sites/:name/files', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const parsed = z
      .object({ path: filePath, content: z.string().max(262_144), expect_sha: z.string().regex(/^[0-9a-f]{64}$/).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    const { path, content, expect_sha } = parsed.data;
    // The path only: the content may hold credentials.
    return audited(c.get('user').email, s.ref.id, 'file.edit', name, { path }, async () => ({
      body: await s.client.writeConfigFile(name, c.get('user').email, path, content, expect_sha),
    }), c);
  });

  srv.post('/sites/:name/files/restore', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const parsed = z.object({ path: filePath, version: z.string().regex(patterns.fileVersion) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    return audited(c.get('user').email, s.ref.id, 'file.restore', name, parsed.data, async () => ({
      body: await s.client.restoreConfigFile(name, c.get('user').email, parsed.data.path, parsed.data.version),
    }), c);
  });

  srv.get('/sites/:name/env', async (c) => c.json(maskEnv(await c.get('server').client.env(siteParam(c)))));

  srv.post('/sites/:name/env/reveal', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const key = z.object({ key: z.string().regex(patterns.envKey) }).safeParse(await c.req.json().catch(() => null));
    if (!key.success) bad('key required');
    const env = await s.client.env(name);
    const entry = env.entries.find((e) => e.key === key.data.key);
    if (!entry) throw new DdeployError('not_found', `no ${key.data.key} in ${name}'s .env`);
    audit.succeeded(audit.begin({ email: c.get('user').email, serverId: s.ref.id, action: 'env.reveal', target: name, detail: { key: entry.key } }));
    return c.json({ key: entry.key, value: entry.value });
  });

  srv.put('/sites/:name/env', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const parsed = envChangeRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    const { set, unset } = parsed.data;
    // The audit log gets key names, never values.
    return audited(user.email, s.ref.id, 'env.change', name, { set: Object.keys(set), unset }, async () => {
      const env = await s.client.applyEnv(name, user.email, set, unset);
      return { body: maskEnv(env) };
    }, c);
  });

  // --- settings ----------------------------------------------------------

  srv.put('/sites/:name/settings', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const parsed = settingsRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    const { set, unset, branch } = parsed.data;
    if (!Object.keys(set).length && !unset.length && branch === undefined) bad('nothing to change');
    return audited(user.email, s.ref.id, 'settings.change', name, parsed.data, async () => {
      const detail = await s.client.applySettings(name, user.email, set, unset, branch);
      invalidateSite(s, name);
      return { body: detail };
    }, c);
  });

  // --- database ----------------------------------------------------------

  srv.get('/sites/:name/db', async (c) => c.json(await c.get('server').client.dbInfo(siteParam(c))));

  srv.post('/sites/:name/db/credentials', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    return audited(c.get('user').email, s.ref.id, 'db.credentials', name, undefined, async () => ({ body: await s.client.dbCredentials(name) }), c);
  });

  srv.get('/sites/:name/db/dump', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const snapshot = c.req.query('snapshot') || undefined;
    if (snapshot && !patterns.snapshotId.test(snapshot)) bad('invalid snapshot id');
    const entry = audit.begin({ email: c.get('user').email, serverId: s.ref.id, action: 'db.download', target: name, detail: { snapshot: snapshot ?? null } });
    let dump;
    try {
      dump = await s.client.dbDump(name, snapshot);
    } catch (err) {
      audit.rejected(entry, (err as Error).message);
      throw err;
    }
    audit.succeeded(entry);
    dump.done.catch((err: Error) => console.warn(`db dump of ${name} ended badly: ${err.message}`));
    const filename = `${name}-${snapshot ?? new Date(now()).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'}.sql.gz`;
    return new Response(Readable.toWeb(dump.stdout) as ReadableStream, {
      headers: {
        'content-type': 'application/gzip',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  });

  srv.post('/sites/:name/db/import', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const body = c.req.raw.body;
    if (!body) bad('send the dump as the request body');
    const length = Number(c.req.header('content-length') ?? 0);
    const info = await s.cache.get('info', 5 * 60_000, () => s.client.info());
    const max = info.limits?.db_import_max_bytes;
    if (max && length > max) bad(`the dump is larger than the ${Math.round(max / 1024 / 1024)} MB limit`);
    const filename = (c.req.header('x-filename') ?? 'upload').slice(0, 200);
    return audited(user.email, s.ref.id, 'db.import', name, { filename, bytes: length || null }, async () => {
      // Content-Length can be absent (chunked) or wrong: count as we go too.
      // ddeploy enforces the same limit on its side.
      const upload = Readable.fromWeb(body as never).pipe(byteLimit(max ?? Infinity));
      const { run_id } = await s.client.startDbImport(name, user.email, upload);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  // --- backups (object storage) ---------------------------------------------

  srv.get('/sites/:name/backups', async (c) => c.json(await c.get('server').client.backups(siteParam(c))));

  srv.post('/sites/:name/backups/run', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const body = z.object({ what: z.enum(['database', 'uploads']) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) bad('what: database or uploads');
    return audited(user.email, s.ref.id, `backup.${body.data.what}`, name, undefined, async () => {
      const { run_id } = await s.client.startBackup(name, user.email, body.data.what);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  srv.post('/sites/:name/backups/restore-db', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const body = z.object({ file: z.string().regex(patterns.backupDump) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) bad('file: a backup dump name');
    return audited(user.email, s.ref.id, 'backup.restore-db', name, { file: body.data.file }, async () => {
      const { run_id } = await s.client.startBackupRestoreDb(name, user.email, body.data.file);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  srv.post('/sites/:name/backups/restore-uploads', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const body = z
      .object({ dir: z.string().regex(patterns.uploadDir).refine((d) => !d.startsWith('/')), version: z.string().regex(patterns.uploadsVersion).nullish() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) bad('dir: an upload dir; version: a backup run id');
    return audited(user.email, s.ref.id, 'backup.restore-uploads', name, body.data, async () => {
      const { run_id } = await s.client.startBackupRestoreUploads(name, user.email, body.data.dir, body.data.version);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  for (const action of ['keep', 'unkeep', 'delete'] as const) {
    srv.post(`/sites/:name/backups/${action}`, async (c) => {
      const s = c.get('server');
      const name = siteParam(c);
      const user = c.get('user');
      const body = z.object({ file: z.string().regex(patterns.backupDump) }).safeParse(await c.req.json().catch(() => null));
      if (!body.success) bad('file: a backup dump name');
      return audited(user.email, s.ref.id, `backup.${action}`, name, { file: body.data.file }, async () => ({
        body: await s.client.manageBackup(name, user.email, action, body.data.file),
      }), c);
    });
  }

  srv.get('/sites/:name/backups/download', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const file = c.req.query('file') ?? '';
    if (!patterns.backupDump.test(file)) bad('file: a backup dump name');
    const entry = audit.begin({ email: c.get('user').email, serverId: s.ref.id, action: 'backup.download', target: name, detail: { file } });
    let stream;
    try {
      stream = await s.client.backupDownload(name, file);
    } catch (err) {
      audit.rejected(entry, (err as Error).message);
      throw err;
    }
    audit.succeeded(entry);
    stream.done.catch((err: Error) => console.warn(`backup download ${name}/${file} ended badly: ${err.message}`));
    return new Response(Readable.toWeb(stream.stdout) as ReadableStream, {
      headers: { 'content-type': file.endsWith('.gz') ? 'application/gzip' : 'application/sql', 'content-disposition': `attachment; filename="${file}"`, 'cache-control': 'no-store' },
    });
  });

  // --- uploads (files) -----------------------------------------------------

  srv.get('/sites/:name/uploads', async (c) => c.json(await c.get('server').client.uploads(siteParam(c))));

  srv.post('/sites/:name/uploads/import', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const dir = c.req.query('dir') ?? '';
    const mode = c.req.query('mode') ?? 'merge';
    if (!patterns.uploadDir.test(dir) || dir.startsWith('/')) bad('dir must be one of the site\'s upload dirs');
    if (mode !== 'merge' && mode !== 'replace') bad('mode is merge or replace');
    const body = c.req.raw.body;
    if (!body) bad('send the archive as the request body');
    const length = Number(c.req.header('content-length') ?? 0);
    const info = await s.cache.get('info', 5 * 60_000, () => s.client.info());
    const max = info.limits?.uploads_import_max_bytes;
    if (max && length > max) bad(`the upload is larger than the ${Math.round(max / 1024 / 1024)} MB limit`);
    const label = (c.req.header('x-filename') ?? 'upload').slice(0, 200);
    const files = Number(c.req.header('x-file-count') ?? 0) || null;
    return audited(user.email, s.ref.id, 'uploads.import', name, { dir, mode, source: label, files, bytes: length || null }, async () => {
      const archive = Readable.fromWeb(body as never).pipe(byteLimit(max ?? Infinity));
      const { run_id } = await s.client.startUploadsImport(name, user.email, dir, mode, archive);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  // --- copy from another server (rsync over SSH, run by ddeploy) ----------

  srv.get('/fetch-key', async (c) => c.json(await c.get('server').client.fetchKey()));

  srv.post('/fetch-key/forget', async (c) => {
    const s = c.get('server');
    const user = c.get('user');
    const parsed = forgetHostRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    return audited(user.email, s.ref.id, 'fetch.forget-host', null, parsed.data, async () => ({
      body: await s.client.forgetFetchHost(user.email, parsed.data.host, parsed.data.port),
    }), c);
  });

  srv.post('/sites/:name/uploads/fetch-test', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const parsed = fetchTestRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    const { source, accept } = parsed.data;
    // Confirming a host key is a trust decision: it's audited; a plain test isn't.
    if (!accept) return c.json(await s.client.fetchTest(name, user.email, source));
    return audited(user.email, s.ref.id, 'fetch.accept-host', name, { host: source.host, port: source.port, fingerprint: accept }, async () => ({
      body: await s.client.fetchTest(name, user.email, source, accept),
    }), c);
  });

  srv.post('/sites/:name/uploads/fetch', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const parsed = uploadsFetchRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return issues(c, parsed.error);
    const { dir, mode, source } = parsed.data;
    return audited(user.email, s.ref.id, 'uploads.fetch', name, { dir, mode, source: sourceSpec(source), port: source.port }, async () => {
      const { run_id } = await s.client.startUploadsFetch(name, user.email, dir, mode, source);
      s.cache.invalidate(`site:${name}`);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  srv.post('/sites/:name/uploads/restore', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const body = z.object({ snapshot: z.string().regex(patterns.uploadsSnapshotId) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) bad('snapshot id required');
    return audited(user.email, s.ref.id, 'uploads.restore', name, { snapshot: body.data.snapshot }, async () => {
      const { run_id } = await s.client.startUploadsRestore(name, user.email, body.data.snapshot);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  srv.post('/sites/:name/uploads/snapshot', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    return audited(user.email, s.ref.id, 'uploads.snapshot', name, undefined, async () => {
      const { run_id } = await s.client.startUploadsSnapshot(name, user.email);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  srv.get('/sites/:name/uploads/download', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const dir = c.req.query('dir') ?? '';
    if (!patterns.uploadDir.test(dir) || dir.startsWith('/')) bad('dir must be one of the site\'s upload dirs');
    const entry = audit.begin({ email: c.get('user').email, serverId: s.ref.id, action: 'uploads.download', target: name, detail: { dir } });
    let stream;
    try {
      stream = await s.client.uploadsDownload(name, dir);
    } catch (err) {
      audit.rejected(entry, (err as Error).message);
      throw err;
    }
    audit.succeeded(entry);
    stream.done.catch((err: Error) => console.warn(`uploads download of ${name}/${dir} ended badly: ${err.message}`));
    const stamp = new Date(now()).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const filename = `${name}-${dir.replace(/[^A-Za-z0-9.-]+/g, '-')}-${stamp}.tar.gz`;
    return new Response(Readable.toWeb(stream.stdout) as ReadableStream, {
      headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' },
    });
  });

  srv.post('/sites/:name/db/snapshot', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    return audited(user.email, s.ref.id, 'db.snapshot', name, undefined, async () => {
      const { run_id } = await s.client.startDbSnapshot(name, user.email);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  srv.post('/sites/:name/db/restore', async (c) => {
    const s = c.get('server');
    const name = siteParam(c);
    const user = c.get('user');
    const body = z.object({ snapshot: z.string().regex(patterns.snapshotId) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) bad('snapshot id required');
    return audited(user.email, s.ref.id, 'db.restore', name, { snapshot: body.data.snapshot }, async () => {
      const { run_id } = await s.client.startDbRestore(name, user.email, body.data.snapshot);
      return { body: { run_id }, runId: run_id, status: 202 };
    }, c);
  });

  api.route('/servers/:serverId', srv);
  return api;
}

async function sendChunk(stream: SSEStreamingApi, chunk: { text: string; next_offset: number; rotated: boolean }) {
  await stream.writeSSE({ event: 'chunk', data: JSON.stringify({ text: chunk.text, next_offset: chunk.next_offset, rotated: chunk.rotated }) });
}

/** Writes a ping when nothing else was sent for a while: proxies (Cloudflare: ~100s) cut idle streams. */
function heartbeat(stream: SSEStreamingApi, everyMs = 20_000): () => Promise<void> {
  let last = Date.now();
  const write = stream.writeSSE.bind(stream);
  stream.writeSSE = async (m) => {
    last = Date.now();
    return write(m);
  };
  return async () => {
    if (Date.now() - last > everyMs) await stream.writeSSE({ event: 'ping', data: '{}' });
  };
}

function maskEnv(env: EnvResponse) {
  return {
    ...env,
    entries: env.entries.map((e) => {
      const masked = SECRET_KEY.test(e.key) && e.value !== '';
      return { ...e, value: masked ? '' : e.value, masked, length: e.value.length };
    }),
  };
}

function invalidateSite(s: ManagedServer, name: string) {
  s.cache.invalidate('sites');
  s.cache.invalidate(`site:${name}`);
}

function issues(c: Ctx, error: z.ZodError) {
  return c.json(
    {
      error: { code: 'bad_request', message: error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; ') },
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
    400,
  );
}

function byteLimit(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > max) cb(new DdeployError('bad_request', `the dump is larger than the ${Math.round(max / 1024 / 1024)} MB limit`));
      else cb(null, chunk);
    },
  });
}
