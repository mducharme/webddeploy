// A "run" is one deploy/provision/preview invocation. ddeploy records it
// as a `started` event and a final one (succeeded/failed/skipped) sharing
// a run_id; these helpers fold those into one row for history views, and
// work out a live state for runs the web UI started itself.
import type { DdeployEvent, LegacyDeploy, RunMeta, RunShowResponse } from './ddeploy.ts';

export type RunPhase = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'unknown';

export interface Run {
  run_id: string;
  site: string;
  kind: string;
  phase: RunPhase;
  trigger: string;
  started_at: string | null;
  finished_at: string | null;
  duration_s: number | null;
  from_sha: string | null;
  to_sha: string | null;
  subject: string | null;
  /** Git author of the deployed commit. */
  author?: string | null;
  branch: string | null;
  project: string | null;
  error: string | null;
  /** A failed run: the step it failed at. */
  failed_step?: string | null;
  /** A failed deploy: true if it failed after going live, false if the previous release still runs, null if unknown. */
  went_live?: boolean | null;
  /** From the pre-event-log `.deploys` file: only a timestamp and a SHA. */
  legacy?: boolean;
}

/** A run with no final event this long after it started is presumed dead (a reboot, an OOM kill). */
export const STALE_RUN_MS = 3 * 3600_000;

/** Config changes and other one-shot events: no run log, no duration. */
export const CHANGE_KINDS: ReadonlySet<string> = new Set([
  'env-change',
  'settings-change',
  'file-change',
  'worker-restart',
  'worker-stop',
  'worker-start',
  'schedules-paused',
  'schedules-resumed',
]);

export const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set(['succeeded', 'failed', 'skipped', 'unknown']);

export function isTerminal(phase: RunPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

/** Folds events into runs, newest first. Event order within a run doesn't matter. */
export function collapseRuns(events: readonly DdeployEvent[], now: Date = new Date()): Run[] {
  const groups = new Map<string, DdeployEvent[]>();
  for (const e of events) {
    const key = e.run_id ?? `${e.site}|${e.kind}|${e.ts}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(e);
  }
  const runs: Run[] = [];
  for (const [key, list] of groups) {
    const started = list.find((e) => e.phase === 'started');
    const finals = list.filter((e) => e.phase !== 'started');
    const final = finals[finals.length - 1];
    const pick = <K extends keyof DdeployEvent>(k: K): DdeployEvent[K] | undefined => final?.[k] ?? started?.[k];
    const first = (started ?? final)!;
    runs.push({
      run_id: first.run_id ?? key,
      site: first.site,
      // The final event's kind wins: a deploy turns out to be a rollback
      // only once it's underway.
      kind: final?.kind || first.kind,
      phase: final ? final.phase as RunPhase : 'running',
      trigger: first.trigger,
      started_at: started?.ts ?? null,
      finished_at: final?.ts ?? null,
      duration_s: final?.duration_s ?? null,
      from_sha: pick('from_sha') ?? null,
      to_sha: pick('to_sha') ?? null,
      subject: pick('subject') ?? null,
      author: pick('author') ?? null,
      branch: pick('branch') ?? null,
      project: pick('project') ?? null,
      error: final?.error ?? null,
      failed_step: final?.failed_step ?? null,
      went_live: final?.live === 'yes' ? true : final?.live === 'no' ? false : null,
    });
    const run = runs[runs.length - 1]!;
    if (run.phase === 'running' && run.started_at && now.getTime() - Date.parse(run.started_at) > STALE_RUN_MS) {
      run.phase = 'unknown';
      run.error = 'no result was ever recorded — the run was probably killed (a reboot, out of memory)';
    }
  }
  return runs.sort((a, b) => runTime(b).localeCompare(runTime(a)));
}

function runTime(r: Run): string {
  return r.started_at ?? r.finished_at ?? '';
}

/**
 * Deploy history for one site: its runs, plus `.deploys` entries older
 * than the first recorded event (history from before the event log).
 */
export function siteHistory(events: readonly DdeployEvent[], legacy: readonly LegacyDeploy[], site: string, now: Date = new Date()): Run[] {
  const runs = collapseRuns(events, now);
  const earliest = runs.reduce<string | null>((min, r) => {
    const t = runTime(r);
    return t && (!min || t < min) ? t : min;
  }, null);
  const older = legacy
    .filter((l) => !earliest || l.ts < earliest)
    .map<Run>((l) => ({
      run_id: `legacy-${l.ts}-${l.sha.slice(0, 12)}`,
      site,
      kind: 'deploy',
      phase: 'succeeded',
      trigger: 'unknown',
      started_at: null,
      finished_at: l.ts,
      duration_s: null,
      from_sha: null,
      to_sha: l.sha,
      subject: null,
      branch: null,
      project: null,
      error: null,
      legacy: true,
    }));
  return [...runs, ...older.reverse()];
}

/** How long a web-started run may go without a `started` event before it's presumed dead. */
export const RUN_START_GRACE_MS = 30_000;

/**
 * The live state of one run (`api run show`). Events decide when there
 * are any; otherwise the systemd unit's state does. ddeploy collects
 * finished units (`--collect`), so a unit that's gone with no final event
 * means the run ended without recording one.
 */
export function runFromShow(show: RunShowResponse, now: Date = new Date()): Run {
  const [fromEvents] = collapseRuns(show.events, now);
  const meta: RunMeta | null = show.meta;
  const unitAlive = ['active', 'activating', 'reloading'].includes(show.unit.active_state ?? '');
  const age = meta ? now.getTime() - Date.parse(meta.submitted_at) : Infinity;

  if (fromEvents) {
    const run = { ...fromEvents, run_id: show.run_id };
    if (run.phase === 'running' && meta && !unitAlive && age > RUN_START_GRACE_MS) {
      return { ...run, phase: 'unknown', error: 'the run ended without recording a result — see its output' };
    }
    if (run.phase === 'failed' && show.cancelled_by) return { ...run, error: `cancelled by ${show.cancelled_by}` };
    return run;
  }
  const base: Run = {
    run_id: show.run_id,
    site: meta?.site ?? '',
    kind: meta?.kind ?? 'deploy',
    phase: 'queued',
    trigger: meta ? `web (${meta.actor})` : 'unknown',
    started_at: null,
    finished_at: null,
    duration_s: null,
    from_sha: null,
    to_sha: null,
    subject: null,
    branch: null,
    project: null,
    error: null,
  };
  if (show.cancelled_by && !unitAlive) {
    return { ...base, phase: 'failed', error: `cancelled by ${show.cancelled_by} before it started` };
  }
  if (!unitAlive && age > RUN_START_GRACE_MS) {
    return { ...base, phase: 'failed', error: 'the run exited before it started — see its output' };
  }
  return base;
}

export type Actor = { type: 'web' | 'manual' | 'webhook' | 'schedule' | 'unknown'; label: string };

/**
 * Who started a run, from ddeploy's trigger string: "web (a@b.c)",
 * "manual (deploy)", "webhook [id] by <who pushed>". For a push, the
 * pusher if the forge said; else the deployed commit's author (`author`);
 * else just "git push".
 */
export function parseTrigger(trigger: string, author?: string | null): Actor {
  let m = /^web \((.+)\)$/.exec(trigger);
  if (m) return { type: 'web', label: m[1]! };
  // ddeploy's cron jobs (backups, preview cleanup) run with DDEPLOY_TRIGGER=schedule.
  if (trigger === 'schedule') return { type: 'schedule', label: 'schedule' };
  m = /^manual(?: \((.+)\))?$/.exec(trigger);
  if (m) return { type: 'manual', label: m[1] ?? 'root' };
  m = /^webhook(?: \[[^\]]*\])?(?: by (.+))?$/.exec(trigger);
  if (m) return { type: 'webhook', label: m[1] ?? author ?? 'git push' };
  return { type: 'unknown', label: trigger };
}

export const PREVIEW_KINDS: ReadonlySet<string> = new Set(['provision-preview', 'deploy-preview', 'remove-preview']);

/**
 * How a code run relates to the history before it: "same" when it deployed
 * the commit that was already live (nothing new — a redeploy), "earlier"
 * when it went back to a commit an earlier deploy already shipped (a
 * rollback, by whatever name). `history` is newest first, as listed.
 */
export function deployRelation(run: Run, history: readonly Run[]): { kind: 'same' } | { kind: 'earlier'; run: Run } | null {
  if (!run.to_sha || run.phase !== 'succeeded') return null;
  if (run.from_sha && run.from_sha === run.to_sha) return { kind: 'same' };
  const i = history.findIndex((r) => r.run_id === run.run_id);
  const older = i >= 0 ? history.slice(i + 1) : [];
  // Not the run right before it (that's "same", above): an older one.
  const earlier = older.find((r) => r.phase === 'succeeded' && r.to_sha === run.to_sha && r.run_id !== run.run_id && r !== older[0]);
  if (earlier && older[0]?.to_sha !== run.to_sha) return { kind: 'earlier', run: earlier };
  return null;
}
