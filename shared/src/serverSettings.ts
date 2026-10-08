// The server settings a super-admin may change: ddeploy's `api config`
// allowlist (lib/cmd_api_config.sh), with what a form needs. ddeploy
// validates every value again before it touches provisioner.conf.
import { z } from 'zod';
import { ddeployEvent } from './ddeploy.ts';

export type ServerSettingKind = 'bool' | 'text' | 'select' | 'secret';
export type Apply = 'deploy' | 'now' | 'cron' | 'web';

export interface ServerSettingDef {
  key: string;
  label: string;
  group: 'New sites & deploys' | 'Previews' | 'Backups' | 'Notifications' | 'Limits & retention';
  kind: ServerSettingKind;
  help: string;
  pattern?: RegExp;
  options?: readonly string[];
  placeholder?: string;
}

export const APPLY_LABELS: Record<Apply, string> = {
  deploy: "each site's next deploy",
  now: 'immediately',
  cron: 'immediately (the schedule is rewritten)',
  web: "immediately (the web UI's nginx config is rewritten)",
};

const int = /^[0-9]{1,9}$/;
const cron = /^[0-9*/,-]+(\s+[0-9*/,-]+){4}$/;

export const SERVER_SETTINGS: readonly ServerSettingDef[] = [
  { key: 'BASIC_AUTH_DEFAULT', label: 'Basic auth by default', group: 'New sites & deploys', kind: 'bool', help: "Sites without their own basic_auth setting are password-protected." },
  { key: 'BASIC_AUTH_ALLOW_IPS', label: 'Addresses without basic auth', group: 'New sites & deploys', kind: 'text', pattern: /^\s*([0-9A-Fa-f:.]+(\/[0-9]{1,3})?\s*)*$/, placeholder: '203.0.113.10 198.51.100.0/24', help: 'Space-separated IPs or ranges that skip the password on every site that has one (an office, a VPN). A site can add its own, or drop these.' },
  { key: 'CLIENT_MAX_BODY_SIZE', label: 'Max upload size', group: 'New sites & deploys', kind: 'text', pattern: /^[0-9]+[kKmMgG]?$/, placeholder: '64m', help: "nginx's request body limit for sites that don't set their own." },
  { key: 'FPM_MAX_CHILDREN', label: 'PHP-FPM workers per site', group: 'New sites & deploys', kind: 'text', pattern: /^[1-9][0-9]{0,2}$/, placeholder: '5', help: 'Concurrent PHP requests per site, unless the site sets its own.' },
  { key: 'DEFAULT_PHP', label: 'Default PHP version', group: 'New sites & deploys', kind: 'text', pattern: /^[0-9]+\.[0-9]+$/, placeholder: '8.3', help: 'For new sites whose repository doesn\'t say.' },
  { key: 'DEFAULT_NODE', label: 'Default Node version', group: 'New sites & deploys', kind: 'text', pattern: /^(v?[0-9]+(\.[0-9]+){0,2}|lts\/(\*|[a-z]+)|node)$/, placeholder: '22', help: 'For sites with no nodejs_version or .nvmrc.' },
  { key: 'RELEASES_KEEP', label: 'Releases kept per site', group: 'New sites & deploys', kind: 'text', pattern: int, placeholder: '5', help: 'Old releases kept on disk for instant rollback (1–50).' },
  { key: 'PREVIEW_DB_MODE', label: 'Preview data', group: 'Previews', kind: 'select', options: ['shared', 'isolated'], help: "shared: previews use the site's database and uploads; isolated: their own copy." },
  { key: 'PREVIEW_SEED', label: 'Seed isolated previews', group: 'Previews', kind: 'bool', help: "Copy the site's database and uploads into a new isolated preview." },
  { key: 'PREVIEW_BRANCHES', label: 'Preview branches (all sites)', group: 'Previews', kind: 'text', pattern: /^[A-Za-z0-9._/*?@+ -]*$/, placeholder: 'feature/* fix/*', help: 'Branches that get a preview on push, for sites that don\'t set their own.' },
  { key: 'PREVIEW_PRUNE_ENABLED', label: 'Remove previews of deleted branches', group: 'Previews', kind: 'bool', help: 'A scheduled job removes previews whose branch is gone.' },
  { key: 'PREVIEW_PRUNE_SCHEDULE', label: 'Preview cleanup schedule', group: 'Previews', kind: 'text', pattern: cron, placeholder: '37 3 * * *', help: 'Cron expression (server time).' },
  { key: 'DB_BACKUP_ENABLED', label: 'Database backups', group: 'Backups', kind: 'bool', help: 'Scheduled dumps to object storage. Needs object storage set up on the server (ddeploy configure backups).' },
  { key: 'DB_BACKUP_SCHEDULE', label: 'Database backup schedule', group: 'Backups', kind: 'text', pattern: cron, placeholder: '23 * * * *', help: 'Cron expression (server time).' },
  { key: 'DB_BACKUP_RETENTION_DAYS', label: 'Dumps kept (days)', group: 'Backups', kind: 'text', pattern: int, placeholder: '7', help: 'Default; sites can set their own. Kept dumps are never deleted.' },
  { key: 'BACKUP_ENABLED', label: 'Files backups', group: 'Backups', kind: 'bool', help: 'Scheduled sync of upload folders to object storage.' },
  { key: 'BACKUP_SCHEDULE', label: 'Files backup schedule', group: 'Backups', kind: 'text', pattern: cron, placeholder: '17 * * * *', help: 'Cron expression (server time).' },
  { key: 'UPLOADS_BACKUP_VERSIONS_DAYS', label: 'Changed/deleted files kept (days)', group: 'Backups', kind: 'text', pattern: int, placeholder: '30', help: 'How long a files backup keeps what it overwrote or deleted. 0: plain mirror.' },
  { key: 'DOCTOR_SCHEDULE', label: 'Health check schedule', group: 'Notifications', kind: 'text', pattern: cron, placeholder: '*/10 * * * *', help: "When the health checks run in the background (cron). The fleet page shows the last result; the webhook is paged only when a check starts failing or recovers." },
  { key: 'NOTIFY_WEBHOOK', label: 'Slack / Discord webhook', group: 'Notifications', kind: 'secret', pattern: /^(https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[A-Za-z0-9._~/?=&%+:@-]*)?)?$/, placeholder: 'https://hooks.slack.com/services/…', help: 'Server-wide channel for deploys and failures. Empty: off.' },
  { key: 'NOTIFY_EVENTS', label: 'Events sent', group: 'Notifications', kind: 'text', pattern: /^[a-z -]*$/, placeholder: 'deploy-success deploy-failure', help: 'Any of: deploy-success deploy-failure preview-created preview-removed webhook-rejected.' },
  { key: 'NOTIFY_COOLDOWN', label: 'Repeat-alert cooldown (seconds)', group: 'Notifications', kind: 'text', pattern: int, placeholder: '3600', help: 'Minimum time between identical failure alerts.' },
  { key: 'RUN_LOG_RETENTION_DAYS', label: 'Run output kept (days)', group: 'Limits & retention', kind: 'text', pattern: int, placeholder: '30', help: 'Full output logs of deploys and other runs.' },
  { key: 'DB_SNAPSHOT_KEEP', label: 'Database snapshots per site', group: 'Limits & retention', kind: 'text', pattern: int, placeholder: '5', help: 'Local safety dumps before imports/restores.' },
  { key: 'UPLOADS_SNAPSHOT_KEEP', label: 'Files snapshots per site', group: 'Limits & retention', kind: 'text', pattern: int, placeholder: '3', help: 'Local hardlink snapshots before uploads/restores.' },
  { key: 'WEB_IMPORT_MAX_MB', label: 'Largest database import (MB)', group: 'Limits & retention', kind: 'text', pattern: int, placeholder: '2048', help: 'Largest dump the web UI accepts.' },
  { key: 'WEB_UPLOAD_MAX_MB', label: 'Largest files upload (MB)', group: 'Limits & retention', kind: 'text', pattern: int, placeholder: '10240', help: 'Largest archive or folder the web UI accepts.' },
  { key: 'NODE_BUILD_TIMEOUT', label: 'Frontend build timeout (seconds)', group: 'Limits & retention', kind: 'text', pattern: int, placeholder: '1200', help: 'A frontend build running longer is stopped.' },
  { key: 'NODE_BUILD_MEMORY_MAX', label: 'Frontend build memory cap', group: 'Limits & retention', kind: 'text', pattern: /^([1-9][0-9]*[KMG]?)?$/, placeholder: '2G', help: 'Like 2G or 1536M. Empty: no cap.' },
];

export const serverConfigResponse = z.object({
  api_version: z.number(),
  file: z.string(),
  settings: z.array(
    z.object({ key: z.string(), value: z.string(), secret: z.boolean(), is_set: z.boolean(), explicit: z.boolean(), apply: z.enum(['deploy', 'now', 'cron', 'web']) }),
  ),
  readonly: z.record(z.string(), z.string()),
  backups_configured: z.boolean(),
});
export type ServerConfigResponse = z.infer<typeof serverConfigResponse>;

/** PUT .../config body. ddeploy re-validates every value; this only refuses early. */
export const serverConfigRequest = z.object({
  set: z
    .record(z.string(), z.string().max(500))
    .refine((o) => Object.keys(o).length > 0, 'nothing to change')
    .superRefine((o, ctx) => {
      for (const [k, v] of Object.entries(o)) {
        const def = SERVER_SETTINGS.find((s) => s.key === k);
        if (!def) ctx.addIssue({ code: 'custom', path: [k], message: `'${k}' can't be changed here` });
        else if (/[$`\\"'\r\n]/.test(v)) ctx.addIssue({ code: 'custom', path: [k], message: 'contains a character that isn\'t allowed' });
        else if (def.kind === 'bool' && v !== 'true' && v !== 'false') ctx.addIssue({ code: 'custom', path: [k], message: 'true or false' });
        else if (def.options && !def.options.includes(v)) ctx.addIssue({ code: 'custom', path: [k], message: `one of ${def.options.join(', ')}` });
        else if (def.pattern && !def.pattern.test(v.trim())) ctx.addIssue({ code: 'custom', path: [k], message: `invalid ${def.label.toLowerCase()}` });
      }
    }),
});
export type ServerConfigRequest = z.input<typeof serverConfigRequest>;

