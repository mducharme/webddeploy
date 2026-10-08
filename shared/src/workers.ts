// Setting a site's queue workers and scheduled tasks from the web UI:
// the request (validated like ddeploy validates it), ready-made commands
// per framework, and cron shortcuts.
import { z } from 'zod';

const oneLine = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `${what}: required`)
    .max(500, `${what}: at most 500 characters`)
    .refine((v) => !/[\n\r\t\0]/.test(v), `${what}: one line`)
    .refine((v) => !/ddev|\/var\/www\/html/.test(v), `${what}: mentions ddev or /var/www/html — those only exist in the local DDEV container`);

/** A plain 5-field cron expression, the only kind ddeploy accepts. */
export const CRON_RE = /^[0-9*/,-]+\s+[0-9*/,-]+\s+[0-9*/,-]+\s+[0-9*/,-]+\s+[0-9*/,-]+$/;

export const workersConfigRequest = z.object({
  queue_workers: z.array(oneLine('worker command')).max(20, 'at most 20 workers'),
  schedule: z
    .array(
      z.object({
        cron: z.string().trim().regex(CRON_RE, 'a 5-field cron expression, like */5 * * * *'),
        cmd: oneLine('command'),
      }),
    )
    .max(20, 'at most 20 scheduled tasks'),
});
export type WorkersConfigRequest = z.infer<typeof workersConfigRequest>;

export const CRON_PRESETS: readonly { cron: string; label: string }[] = [
  { cron: '* * * * *', label: 'Every minute' },
  { cron: '*/5 * * * *', label: 'Every 5 minutes' },
  { cron: '*/15 * * * *', label: 'Every 15 minutes' },
  { cron: '0 * * * *', label: 'Every hour' },
  { cron: '0 */6 * * *', label: 'Every 6 hours' },
  { cron: '0 3 * * *', label: 'Every day at 03:00' },
  { cron: '0 3 * * 1', label: 'Every Monday at 03:00' },
];

export interface WorkerPreset {
  label: string;
  cmd: string;
  help: string;
}
export interface SchedulePreset extends WorkerPreset {
  cron: string;
}
export interface Presets {
  /** A human name for the framework, for "Suggested for Laravel". */
  name: string | null;
  workers: WorkerPreset[];
  schedules: SchedulePreset[];
}

const FRAMEWORK_NAMES: Record<string, string> = {
  laravel: 'Laravel',
  craftcms: 'Craft CMS',
  wordpress: 'WordPress',
  'wordpress-bedrock': 'WordPress (Bedrock)',
  charcoal: 'Charcoal',
  symfony: 'Symfony',
};

/**
 * Ready-made commands for what the site is built on. Commands run from
 * the site's directory (the release root), as the site's own user, with
 * its PHP version first on the PATH.
 */
export function presetsFor(framework: string | null | undefined, docroot = ''): Presets {
  const name = framework ? (FRAMEWORK_NAMES[framework] ?? null) : null;
  const inDocroot = (file: string) => (docroot && docroot !== '.' ? `${docroot.replace(/\/$/, '')}/${file}` : file);
  switch (framework) {
    case 'laravel':
      return {
        name,
        workers: [
          { label: 'Queue worker', cmd: 'php artisan queue:work --sleep=3 --tries=3 --max-time=3600', help: "Processes queued jobs. Restarted on every deploy; --max-time recycles it hourly so memory doesn't creep." },
        ],
        schedules: [{ label: 'Laravel scheduler', cron: '* * * * *', cmd: 'php artisan schedule:run', help: "Runs whatever app/Console/Kernel.php (or routes/console.php) schedules — Laravel decides what's due." }],
      };
    case 'craftcms':
      return {
        name,
        workers: [{ label: 'Queue listener', cmd: 'php craft queue/listen --verbose', help: 'Runs queued jobs as they arrive (search indexing, image transforms, emails).' }],
        schedules: [
          { label: 'Run the queue (instead of a listener)', cron: '*/5 * * * *', cmd: 'php craft queue/run', help: "Works through the queue every 5 minutes — use this or the listener, not both." },
          { label: 'Garbage collection', cron: '0 3 * * *', cmd: 'php craft gc --interactive=0', help: 'Deletes expired caches, sessions and soft-deleted elements.' },
        ],
      };
    case 'wordpress':
    case 'wordpress-bedrock':
      return {
        name,
        workers: [],
        schedules: [
          {
            label: 'WordPress cron',
            cron: '*/5 * * * *',
            cmd: `php ${inDocroot(framework === 'wordpress-bedrock' ? 'wp/wp-cron.php' : 'wp-cron.php')}`,
            help: "Runs scheduled posts and plugin tasks on time instead of on visitors' page loads. Pair it with define('DISABLE_WP_CRON', true).",
          },
        ],
      };
    case 'symfony':
      return {
        name,
        workers: [{ label: 'Messenger consumer', cmd: 'php bin/console messenger:consume async --time-limit=3600', help: 'Consumes the "async" transport; --time-limit recycles it hourly.' }],
        schedules: [],
      };
    default:
      return { name, workers: [], schedules: [] };
  }
}

/** The lists as .ddeploy/config.yaml declares them — to commit instead of keeping them on the server. */
export function workersYaml(req: WorkersConfigRequest): string {
  const q = (v: string) => (/^[\w./:=@-][\w ./:=@-]*$/.test(v) && !/:\s/.test(v) ? v : JSON.stringify(v));
  const out: string[] = [];
  if (req.queue_workers.length) out.push('queue_workers:', ...req.queue_workers.map((c) => `  - ${q(c)}`));
  if (req.schedule.length) out.push('schedule:', ...req.schedule.flatMap((s) => [`  - cron: "${s.cron}"`, `    cmd: ${q(s.cmd)}`]));
  return out.join('\n') + (out.length ? '\n' : '');
}
