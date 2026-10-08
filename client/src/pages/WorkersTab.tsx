import { Link, useNavigate } from '@tanstack/react-router';
import { presetsFor, type WorkersConfigRequest, type WorkersResponse } from '@webddeploy/shared';
import { Clock, Pause, Pencil, Play, Plus, RotateCw, ScrollText, Sparkles, Square } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBox, InlineError, Mono, Spinner, StatusDot } from '../components/ui.tsx';
import { usePauseSchedules, useRunSchedule, useWorkerAction, useWorkers } from '../lib/api.ts';
import { cronLabel, duration, relativeTime } from '../lib/format.ts';
import { useCan } from '../lib/role.tsx';
import { LogStream } from './Site.tsx';
import { WorkersEditor } from './WorkersEditor.tsx';

type Worker = WorkersResponse['workers'][number];
type Schedule = WorkersResponse['schedules'][number];

/** A worker's state in words, and the dot that goes with it. */
export function workerStatus(w: Worker): { tone: 'ok' | 'warn' | 'fail' | 'off'; text: string } {
  if (w.state === 'missing') return { tone: 'warn', text: 'not installed yet — deploy to start it' };
  if (w.state === 'active' && (w.restarts ?? 0) > 3) return { tone: 'warn', text: `running, but restarted ${w.restarts} times — probably crashing` };
  if (w.state === 'active') return { tone: 'ok', text: `running${w.since ? ` since ${relativeTime(w.since)}` : ''}` };
  if (w.state === 'activating') return { tone: 'warn', text: 'restarting (it stopped on its own)' };
  if (w.state === 'failed') return { tone: 'fail', text: 'failed — systemd gave up restarting it' };
  if (w.state === 'inactive') return { tone: 'off', text: 'stopped' };
  return { tone: 'warn', text: w.state };
}

/** A schedule's last run in words. */
export function lastRunText(s: Schedule): { tone: 'ok' | 'fail' | 'running' | 'none'; text: string } {
  if (s.running) return { tone: 'running', text: `running since ${relativeTime(s.last?.started_at)}` };
  if (!s.last) return { tone: 'none', text: s.installed === 'legacy' ? 'history starts after the next deploy' : 'not run yet' };
  if (s.last.exit_code === 0) return { tone: 'ok', text: `${relativeTime(s.last.started_at)}${s.last.duration_s != null ? `, took ${duration(s.last.duration_s)}` : ''}` };
  return { tone: 'fail', text: `${relativeTime(s.last.started_at)}: exit ${s.last.exit_code ?? '?'}` };
}

export function WorkersTab({ server, name }: { server: string; name: string }) {
  const data = useWorkers(server, name);
  const [log, setLog] = useState<string | null>(null);
  // null: not editing; otherwise the editor's starting lists (a suggestion, or what runs now).
  const [editing, setEditing] = useState<WorkersConfigRequest | 'current' | null>(null);
  const isAdmin = useCan('admin');
  if (data.isPending) return <Spinner size="lg" label="Reading workers and schedules…" />;
  if (data.error) return <ErrorBox error={data.error} title="Couldn't read the workers and schedules" />;
  const d = data.data;
  if (d.preview) return <Card className="p-4 text-sm text-stone-600 dark:text-stone-400">Previews don't run queue workers or scheduled tasks: a shared preview would process its parent's queue twice.</Card>;
  const none = d.workers.length === 0 && d.schedules.length === 0;
  // ddeploy that can store the lists server-side (older: the repo only).
  const editable = isAdmin && !!d.sources;
  return (
    <div className="space-y-4">
      {editing ? (
        <WorkersEditor server={server} name={name} d={d} initial={editing === 'current' ? undefined : editing} onClose={() => setEditing(null)} />
      ) : none ? (
        editable ? <SetUp d={d} onStart={setEditing} /> : (
          <Card className="p-4 text-sm text-stone-600 dark:text-stone-400">
            <p>This site runs no queue workers or scheduled tasks.</p>
            <HowTo />
          </Card>
        )
      ) : (
        <>
          {editable && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SourceLine d={d} />
              <Button onClick={() => setEditing('current')}><Pencil className="size-4" aria-hidden /> Edit workers & schedules</Button>
            </div>
          )}
          <WorkersCard server={server} name={name} d={d} onLog={setLog} />
          <SchedulesCard server={server} name={name} d={d} onLog={setLog} />
          {!editable && <HowTo />}
        </>
      )}
      {log && <LogStream key={log} server={server} name={log} title={<>Log: <Mono>{log}</Mono></>} />}
    </div>
  );
}

/** Where the lists the site runs come from, in one line. */
function SourceLine({ d }: { d: WorkersResponse }) {
  const s = d.sources!;
  const text =
    s.workers === 'server' || s.schedules === 'server'
      ? 'Set on this server, from this page.'
      : "Declared in the repository's .ddeploy/config.yaml.";
  return <p className="text-xs text-stone-500">{text}</p>;
}

/** Nothing set up yet: what these are, suggestions for the site's framework, and a way to start from scratch. */
function SetUp({ d, onStart }: { d: WorkersResponse; onStart: (c: WorkersConfigRequest) => void }) {
  const p = presetsFor(d.framework, d.docroot);
  const suggested: WorkersConfigRequest = { queue_workers: p.workers.slice(0, 1).map((w) => w.cmd), schedule: p.schedules.slice(0, 1).map(({ cron, cmd }) => ({ cron, cmd })) };
  const hasSuggestion = suggested.queue_workers.length + suggested.schedule.length > 0;
  return (
    <Card title="Background jobs" >
      <div className="space-y-4 p-4 text-sm" data-testid="workers-setup">
        <p className="text-stone-600 dark:text-stone-400">This site runs nothing in the background yet. Two kinds of jobs can be set up here — no deploy needed:</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          <li className="rounded-md border border-stone-200 p-3 dark:border-stone-800">
            <p className="font-medium">Queue workers</p>
            <p className="text-xs text-stone-500">Always running, processing jobs the site puts in its queue (emails, image processing, imports). Restarted if they crash, and on every deploy.</p>
          </li>
          <li className="rounded-md border border-stone-200 p-3 dark:border-stone-800">
            <p className="font-medium">Scheduled tasks</p>
            <p className="text-xs text-stone-500">A command on a timer: every minute, nightly at 3:00… (cron). Each run's output and result is kept.</p>
          </li>
        </ul>
        {hasSuggestion && (
          <div className="rounded-md border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900 dark:bg-teal-950/30">
            <p className="flex items-center gap-1.5 font-medium"><Sparkles className="size-4 text-teal-600" aria-hidden /> Suggested for {p.name}</p>
            <ul className="mt-2 space-y-1.5 text-xs">
              {[...p.workers.slice(0, 1).map((w) => ({ ...w, kind: 'Worker' })), ...p.schedules.slice(0, 1).map((s) => ({ ...s, kind: cronLabel(s.cron).replace(/^./, (c) => c.toUpperCase()) }))].map((x) => (
                <li key={x.cmd}>
                  <span className="text-stone-500">{x.kind}:</span> <Mono>{x.cmd}</Mono>
                  <span className="block text-stone-500">{x.help}</span>
                </li>
              ))}
            </ul>
            <Button variant="primary" className="mt-3" onClick={() => onStart(suggested)}>Review and set up</Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => onStart({ queue_workers: [''], schedule: [] })}><Plus className="size-4" aria-hidden /> Add a queue worker</Button>
          <Button onClick={() => onStart({ queue_workers: [], schedule: [{ cron: '*/5 * * * *', cmd: '' }] })}><Plus className="size-4" aria-hidden /> Add a scheduled task</Button>
        </div>
        <p className="text-xs text-stone-500">
          Prefer code review? They can also be declared in the repository's <Mono>.ddeploy/config.yaml</Mono> (<Mono>queue_workers</Mono>, <Mono>schedule</Mono>) — the editor shows the YAML to commit.
        </p>
      </div>
    </Card>
  );
}

function HowTo() {
  return (
    <p className="text-xs text-stone-500">
      Declared in the repository's <Mono>.ddeploy/config.yaml</Mono> (<Mono>queue_workers</Mono>, <Mono>schedule</Mono>): change them there and deploy, so
      changes go through code review like the rest of the site. Workers restart on every deploy.
    </p>
  );
}

function WorkersCard({ server, name, d, onLog }: { server: string; name: string; d: WorkersResponse; onLog: (l: string) => void }) {
  const action = useWorkerAction(server, name);
  const canAct = useCan('admin');
  if (d.workers.length === 0) return null;
  const busy = (i: number, a: string) => action.isPending && action.variables?.index === i && action.variables.action === a;
  return (
    <Card title="Queue workers">
      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
        {d.workers.map((w) => {
          const st = workerStatus(w);
          return (
            <li key={w.index} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid={`worker-${w.index}`}>
              <StatusDot status={st.tone} label={st.text} />
              <div className="min-w-0 flex-1">
                <Mono className="break-all">{w.command}</Mono>
                <div className="text-xs text-stone-500">
                  #{w.index} · {st.text}
                  {w.restarts ? ` · ${w.restarts} restart${w.restarts > 1 ? 's' : ''}` : ''}
                </div>
              </div>
              <span className="flex flex-wrap items-center gap-1">
                {w.log && <Button variant="ghost" onClick={() => onLog(w.log!)}><ScrollText className="size-4" aria-hidden /> Log</Button>}
                {canAct && w.state !== 'missing' && (
                  <>
                    <Button variant="ghost" busy={busy(w.index, 'restart')} disabled={action.isPending} onClick={() => action.mutate({ index: w.index, action: 'restart' })}>
                      <RotateCw className="size-4" aria-hidden /> Restart
                    </Button>
                    {w.state === 'inactive' || w.state === 'failed' ? (
                      <Button variant="ghost" busy={busy(w.index, 'start')} disabled={action.isPending} onClick={() => action.mutate({ index: w.index, action: 'start' })}>
                        <Play className="size-4" aria-hidden /> Start
                      </Button>
                    ) : (
                      <ConfirmButton
                        label="Stop"
                        busyLabel="Stopping…"
                        confirmLabel="Stop it (until the next deploy or start)"
                        icon={<Square className="size-4" aria-hidden />}
                        onConfirm={() => action.mutateAsync({ index: w.index, action: 'stop' })}
                      />
                    )}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {action.error && <InlineError error={action.error} className="px-4 pb-3 text-sm text-red-700" />}
    </Card>
  );
}

function SchedulesCard({ server, name, d, onLog }: { server: string; name: string; d: WorkersResponse; onLog: (l: string) => void }) {
  const pause = usePauseSchedules(server, name);
  const run = useRunSchedule(server, name);
  const navigate = useNavigate();
  const canAct = useCan('admin');
  if (d.schedules.length === 0) return null;
  return (
    <Card
      title={<span className="flex items-center gap-2">Scheduled tasks {d.schedules_paused && <Badge tone="warn">paused</Badge>}</span>}
      actions={
        canAct ? (
          d.schedules_paused ? (
            <Button busy={pause.isPending} onClick={() => pause.mutate(false)}><Play className="size-4" aria-hidden /> Resume</Button>
          ) : (
            <ConfirmButton label="Pause all" busyLabel="Pausing…" confirmLabel="Pause every scheduled task" icon={<Pause className="size-4" aria-hidden />} onConfirm={() => pause.mutateAsync(true)} />
          )
        ) : null
      }
    >
      {d.schedules_paused && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Paused: cron skips these until you resume (Run now still works). Handy during a migration or an import.
        </p>
      )}
      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
        {d.schedules.map((s) => {
          const last = lastRunText(s);
          return (
            <li key={s.index} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid={`schedule-${s.index}`}>
              <Clock className="size-4 shrink-0 text-stone-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <Mono className="break-all">{s.command}</Mono>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                  <span title={s.cron}>{cronLabel(s.cron)}</span>
                  <span>·</span>
                  <span>
                    Last run:{' '}
                    {last.tone === 'ok' ? <Badge tone="ok">ok</Badge> : last.tone === 'fail' ? <Badge tone="fail">failed</Badge> : last.tone === 'running' ? <Badge tone="running">running</Badge> : null}{' '}
                    {last.text}
                  </span>
                </div>
              </div>
              <span className="flex flex-wrap items-center gap-1">
                {s.log && <Button variant="ghost" onClick={() => onLog(s.log!)}><ScrollText className="size-4" aria-hidden /> Log</Button>}
                {canAct && s.installed === 'current' && (
                  <Button
                    variant="ghost"
                    busy={run.isPending && run.variables === s.index}
                    disabled={s.running || run.isPending}
                    title={s.running ? 'Already running' : 'Run it now, with live output'}
                    onClick={() => run.mutate(s.index, { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } }) })}
                  >
                    <Play className="size-4" aria-hidden /> Run now
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {(pause.error ?? run.error) && <InlineError error={pause.error ?? run.error} className="px-4 pb-3 text-sm text-red-700" />}
      {d.schedules.some((s) => s.installed === 'legacy') && (
        <p className="border-t border-stone-200 px-4 py-2 text-xs text-stone-500 dark:border-stone-800">
          Installed by an older ddeploy: run history, logs and Run now start after this site's next deploy.{' '}
          <Link to="/s/$server/sites/$name" params={{ server, name }} search={{ tab: 'overview' }} className="text-teal-700 hover:underline">Deploy from the Overview</Link>
        </p>
      )}
    </Card>
  );
}
