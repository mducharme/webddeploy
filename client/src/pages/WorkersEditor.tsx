import {
  CRON_PRESETS,
  CRON_RE,
  presetsFor,
  workersConfigRequest,
  workersYaml,
  type SchedulePreset,
  type WorkerPreset,
  type WorkersConfigRequest,
  type WorkersResponse,
} from '@webddeploy/shared';
import { Clipboard, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Card, ConfirmButton, InlineError, Mono, cx, inputClass } from '../components/ui.tsx';
import { useSetWorkers } from '../lib/api.ts';
import { cronLabel } from '../lib/format.ts';

interface Row {
  cron: string;
  cmd: string;
}

/** What the site runs now, as an editable starting point: the server's lists if set, else the repository's. */
export function currentConfig(d: WorkersResponse): WorkersConfigRequest {
  const pick = (k: 'workers' | 'schedules') => (d.sources?.[k] === 'server' ? d.server : d.repo);
  return {
    queue_workers: [...(pick('workers')?.queue_workers ?? [])],
    schedule: (pick('schedules')?.schedule ?? []).map((s) => ({ ...s })),
  };
}

/** Field errors keyed like "queue_workers.0" / "schedule.1.cron". */
export function validateConfig(cfg: WorkersConfigRequest): Record<string, string> {
  const r = workersConfigRequest.safeParse(cfg);
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) out[i.path.join('.')] ??= i.message;
  return out;
}

const sameConfig = (a: WorkersConfigRequest, b: WorkersConfigRequest) => JSON.stringify(workersConfigRequest.safeParse(a).data ?? a) === JSON.stringify(workersConfigRequest.safeParse(b).data ?? b);

/**
 * Edits the site's queue workers and scheduled tasks. Saving stores them
 * on the server (they win over the repository's) and installs them now.
 */
export function WorkersEditor({ server, name, d, initial, onClose }: { server: string; name: string; d: WorkersResponse; initial?: WorkersConfigRequest; onClose: () => void }) {
  const start = useMemo(() => initial ?? currentConfig(d), [initial, d]);
  const [workers, setWorkers] = useState<string[]>(start.queue_workers);
  const [schedule, setSchedule] = useState<Row[]>(start.schedule);
  const [showYaml, setShowYaml] = useState(false);
  const save = useSetWorkers(server, name);
  const presets = presetsFor(d.framework, d.docroot);
  const cfg: WorkersConfigRequest = { queue_workers: workers, schedule };
  const errors = validateConfig(cfg);
  const valid = Object.keys(errors).length === 0;
  const unchanged = sameConfig(cfg, currentConfig(d)) && d.sources?.workers !== 'repo' && d.sources?.schedules !== 'repo';
  const repoHas = (d.repo?.queue_workers.length ?? 0) + (d.repo?.schedule.length ?? 0) > 0;
  const serverHas = (d.server?.queue_workers.length ?? 0) + (d.server?.schedule.length ?? 0) > 0;
  const submit = (c: WorkersConfigRequest) => save.mutateAsync(c).then(onClose);

  const addWorker = (cmd = '') => setWorkers((w) => [...w, cmd]);
  const addSchedule = (row: Row = { cron: '*/5 * * * *', cmd: '' }) => setSchedule((s) => [...s, row]);
  const unusedWorkerPresets = presets.workers.filter((p) => !workers.includes(p.cmd));
  const unusedSchedulePresets = presets.schedules.filter((p) => !schedule.some((s) => s.cmd === p.cmd));

  return (
    <Card title="Edit workers & schedules" actions={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <div className="space-y-5 p-4 text-sm" data-testid="workers-editor">
        <SourceNote d={d} repoHas={repoHas} />

        <section className="space-y-2">
          <h3 className="font-medium">Queue workers</h3>
          <p className="text-xs text-stone-500">Long-running commands that process background jobs (emails, image processing, imports). Kept running, restarted if they crash and on every deploy.</p>
          {workers.length === 0 && <p className="text-xs text-stone-400">None.</p>}
          {workers.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <input
                  className={cx(inputClass, 'font-mono')}
                  value={w}
                  placeholder="php artisan queue:work"
                  aria-label={`Worker #${i} command`}
                  onChange={(e) => setWorkers((ws) => ws.map((x, j) => (j === i ? e.target.value : x)))}
                />
                {errors[`queue_workers.${i}`] && w.trim() !== '' && <p className="mt-1 text-xs text-red-700">{errors[`queue_workers.${i}`]}</p>}
              </div>
              <Button variant="ghost" aria-label={`Remove worker #${i}`} onClick={() => setWorkers((ws) => ws.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => addWorker()}><Plus className="size-4" aria-hidden /> Add a worker</Button>
            {unusedWorkerPresets.map((p) => <PresetButton key={p.cmd} p={p} onClick={() => addWorker(p.cmd)} />)}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Scheduled tasks</h3>
          <p className="text-xs text-stone-500">Commands run on a timer (cron, server time). A run is skipped while the previous one is still going.</p>
          {schedule.length === 0 && <p className="text-xs text-stone-400">None.</p>}
          {schedule.map((s, i) => (
            <ScheduleRow
              key={i}
              i={i}
              row={s}
              errors={errors}
              onChange={(row) => setSchedule((rows) => rows.map((x, j) => (j === i ? row : x)))}
              onRemove={() => setSchedule((rows) => rows.filter((_, j) => j !== i))}
            />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => addSchedule()}><Plus className="size-4" aria-hidden /> Add a scheduled task</Button>
            {unusedSchedulePresets.map((p) => <PresetButton key={p.cmd} p={p} onClick={() => addSchedule({ cron: p.cron, cmd: p.cmd })} />)}
          </div>
        </section>

        <p className="text-xs text-stone-500">
          Commands run in the site's directory as its own user (<Mono>www-{name}</Mono>), with the site's PHP version first on the PATH — <Mono>php</Mono>, <Mono>composer</Mono> and <Mono>node</Mono> are the right ones.
        </p>

        <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
          <Button variant="primary" busy={save.isPending} disabled={!valid || unchanged} onClick={() => void submit(cfg).catch(() => {})}>
            {d.deployed === false ? 'Save (installed on the first deploy)' : 'Save and apply now'}
          </Button>
          {serverHas && (
            <ConfirmButton
              label={repoHas ? "Use the repository's instead" : 'Remove all'}
              confirmLabel={repoHas ? "Switch to the repository's lists" : 'Stop and remove them all'}
              busy={save.isPending}
              onConfirm={() => submit({ queue_workers: [], schedule: [] })}
            />
          )}
          <Button variant="ghost" onClick={() => setShowYaml((v) => !v)}>{showYaml ? 'Hide' : 'Keep it in the repository instead?'}</Button>
          {!valid && <span className="text-xs text-red-700">Fix the highlighted fields first.</span>}
        </div>
        {save.error && <InlineError error={save.error} className="text-sm text-red-700" />}
        {showYaml && <YamlHint cfg={cfg} />}
      </div>
    </Card>
  );
}

function SourceNote({ d, repoHas }: { d: WorkersResponse; repoHas: boolean }) {
  const fromServer = d.sources?.workers === 'server' || d.sources?.schedules === 'server';
  if (fromServer) {
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Set on this server.{repoHas ? " The repository's .ddeploy/config.yaml also declares some: they're ignored while these are set." : ''}
      </p>
    );
  }
  if (repoHas) {
    return (
      <p className="rounded-md bg-stone-100 px-3 py-2 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300">
        These come from the repository's <Mono>.ddeploy/config.yaml</Mono>. Saving keeps your version on this server, in place of the repository's, until you switch back.
      </p>
    );
  }
  return null;
}

function PresetButton({ p, onClick }: { p: WorkerPreset | SchedulePreset; onClick: () => void }) {
  return (
    <Button variant="ghost" onClick={onClick} title={p.help}>
      <Sparkles className="size-4 text-teal-600" aria-hidden /> {p.label}
    </Button>
  );
}

function ScheduleRow({ i, row, errors, onChange, onRemove }: { i: number; row: Row; errors: Record<string, string>; onChange: (r: Row) => void; onRemove: () => void }) {
  const preset = CRON_PRESETS.some((p) => p.cron === row.cron);
  const [custom, setCustom] = useState(!preset);
  const cronError = errors[`schedule.${i}.cron`];
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md border border-stone-200 p-2 dark:border-stone-800" data-testid="schedule-row">
      <div className="w-full sm:w-56">
        <select
          className={inputClass}
          aria-label={`Task #${i}: how often`}
          value={custom ? 'custom' : row.cron}
          onChange={(e) => {
            if (e.target.value === 'custom') setCustom(true);
            else {
              setCustom(false);
              onChange({ ...row, cron: e.target.value });
            }
          }}
        >
          {CRON_PRESETS.map((p) => <option key={p.cron} value={p.cron}>{p.label}</option>)}
          <option value="custom">Custom (cron)…</option>
        </select>
        {custom && (
          <input
            className={cx(inputClass, 'mt-1 font-mono')}
            value={row.cron}
            placeholder="*/10 * * * *"
            aria-label={`Task #${i}: cron expression`}
            onChange={(e) => onChange({ ...row, cron: e.target.value })}
          />
        )}
        {custom && (
          <p className={cx('mt-1 text-xs', cronError ? 'text-red-700' : 'text-stone-500')}>
            {cronError ? 'minute hour day month weekday — like */10 * * * *' : CRON_RE.test(row.cron.trim()) ? cronLabel(row.cron) : ''}
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <input
          className={cx(inputClass, 'font-mono')}
          value={row.cmd}
          placeholder="php artisan schedule:run"
          aria-label={`Task #${i}: command`}
          onChange={(e) => onChange({ ...row, cmd: e.target.value })}
        />
        {errors[`schedule.${i}.cmd`] && row.cmd.trim() !== '' && <p className="mt-1 text-xs text-red-700">{errors[`schedule.${i}.cmd`]}</p>}
      </div>
      <Button variant="ghost" aria-label={`Remove task #${i}`} onClick={onRemove}>
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

function YamlHint({ cfg }: { cfg: WorkersConfigRequest }) {
  const yaml = workersYaml(workersConfigRequest.safeParse(cfg).data ?? cfg);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-stone-200 p-3 text-xs dark:border-stone-800">
      <p className="text-stone-600 dark:text-stone-400">
        To review changes like code, put this in the repository's <Mono>.ddeploy/config.yaml</Mono> and deploy, instead of saving here (a list saved here would win over it).
      </p>
      <pre className="overflow-x-auto rounded bg-stone-950 p-3 font-mono text-stone-200">{yaml || '# nothing to declare'}</pre>
      <Button
        variant="ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(yaml).then(() => setCopied(true));
        }}
      >
        <Clipboard className="size-4" aria-hidden /> {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
