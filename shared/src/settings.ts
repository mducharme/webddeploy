// The site settings the web UI can change — ddeploy's `api settings`
// allowlist (lib/cmd_api.sh API_SETTING_KEYS), with what a form needs to
// render and check each one. ddeploy re-validates everything.
import { z } from 'zod';
import { patterns } from './ddeploy.ts';

export type SettingKind = 'bool' | 'text' | 'list';

export interface SettingDef {
  key: string;
  label: string;
  kind: SettingKind;
  help: string;
  group: 'Access' | 'Hostnames' | 'Performance' | 'Security' | 'Build' | 'Backups' | 'Previews';
  /** Each value (each item, for lists) must match. */
  pattern?: RegExp;
  placeholder?: string;
}

export const SETTINGS: readonly SettingDef[] = [
  { key: 'basic_auth', label: 'Basic auth', kind: 'bool', group: 'Access', help: 'Password-protect the site with the server-wide basic-auth credentials.' },
  { key: 'auth_exempt_paths', label: 'Paths without basic auth', kind: 'list', group: 'Access', pattern: /^\/[A-Za-z0-9/_.~-]*$/, placeholder: '/webhook /api/health', help: 'URL path prefixes that skip basic auth (absolute paths).' },
  { key: 'additional_hostnames', label: 'Extra hostnames', kind: 'list', group: 'Hostnames', pattern: patterns.hostname, placeholder: 'alt-name', help: 'Each becomes <name>.<base domain>, on the wildcard certificate.' },
  { key: 'additional_fqdns', label: 'Custom domains', kind: 'list', group: 'Hostnames', pattern: patterns.hostname, placeholder: 'www.client.com', help: "The site's own domains. DNS must point at this server first: the certificate is issued over HTTP-01 on deploy." },
  { key: 'client_max_body_size', label: 'Max upload size', kind: 'text', group: 'Performance', pattern: /^[0-9]+[kKmMgG]?$/, placeholder: '64m', help: "nginx's request body limit, e.g. 64m or 1g." },
  { key: 'fpm_max_children', label: 'PHP-FPM workers', kind: 'text', group: 'Performance', pattern: /^[1-9][0-9]{0,2}$/, placeholder: '5', help: 'Concurrent PHP requests this site can serve (1–999).' },
  { key: 'static_cache', label: 'Static file cache', kind: 'text', group: 'Performance', pattern: /^[1-9][0-9]{0,3}[smhd]$/, placeholder: '30d', help: 'Browser cache lifetime for css/js/images/fonts, e.g. 30d. Empty: off.' },
  { key: 'security_headers', label: 'Security headers', kind: 'bool', group: 'Security', help: 'nosniff, Referrer-Policy and X-Frame-Options: SAMEORIGIN.' },
  { key: 'deny_php_in_uploads', label: 'Block PHP in upload dirs', kind: 'bool', group: 'Security', help: 'Refuse to execute .php files under the upload directories.' },
  { key: 'deny_php_paths', label: 'Other paths that never run PHP', kind: 'list', group: 'Security', pattern: /^\/[A-Za-z0-9/_.~-]*$/, placeholder: '/media', help: 'Extra URL path prefixes where PHP is refused.' },
  { key: 'nodejs_version', label: 'Node version', kind: 'text', group: 'Build', pattern: patterns.node, placeholder: '22', help: 'Pins the Node version for the frontend build (22, 22.11.0, lts/*).' },
  { key: 'build', label: 'Frontend build', kind: 'bool', group: 'Build', help: "Run the repository's frontend build on deploy." },
  { key: 'composer_dev', label: 'Composer dev packages', kind: 'bool', group: 'Build', help: 'Keep require-dev packages in the default composer install.' },
  { key: 'db_backup_retention_days', label: 'DB backup retention (days)', kind: 'text', group: 'Backups', pattern: /^[1-9][0-9]{0,3}$/, placeholder: '7', help: 'How long nightly database backups are kept.' },
  { key: 'backup_exclude', label: 'Excluded from uploads backup', kind: 'list', group: 'Backups', pattern: /^[^\s]+$/, placeholder: 'cache/**', help: 'rclone --exclude patterns.' },
  { key: 'preview_branches', label: 'Preview branches', kind: 'list', group: 'Previews', pattern: /^[A-Za-z0-9._/*?@+-]+$/, placeholder: 'feature/*', help: 'Branches that get a preview on push, no PR needed.' },
];

export const SETTING_KEYS: ReadonlySet<string> = new Set(SETTINGS.map((s) => s.key));

export const settingsRequest = z
  .object({
    /** Scalars as strings ("true"/"false" for bools), lists as arrays. */
    set: z.record(z.string(), z.union([z.string().trim(), z.array(z.string().trim().min(1)).max(50)])).default({}),
    unset: z.array(z.string()).default([]),
    /** A branch name to track, null to go back to the repository default, absent to leave it. */
    branch: z.string().trim().regex(patterns.branch).nullable().optional(),
  })
  .superRefine((req, ctx) => {
    for (const [key, value] of Object.entries(req.set)) {
      const def = SETTINGS.find((s) => s.key === key);
      if (!def) {
        ctx.addIssue({ code: 'custom', path: ['set', key], message: `'${key}' can't be changed here` });
        continue;
      }
      const values = Array.isArray(value) ? value : [value];
      if (def.kind === 'list' && !Array.isArray(value)) ctx.addIssue({ code: 'custom', path: ['set', key], message: 'expected a list' });
      if (def.kind !== 'list' && Array.isArray(value)) ctx.addIssue({ code: 'custom', path: ['set', key], message: 'expected a single value' });
      if (def.kind === 'bool' && !['true', 'false'].includes(String(value))) ctx.addIssue({ code: 'custom', path: ['set', key], message: 'true or false' });
      if (def.pattern && values.some((v) => !def.pattern!.test(v))) ctx.addIssue({ code: 'custom', path: ['set', key], message: `invalid ${def.label.toLowerCase()}` });
      if (values.some((v) => v.includes('"'))) ctx.addIssue({ code: 'custom', path: ['set', key], message: 'no double quotes' });
    }
    for (const key of req.unset) if (!SETTING_KEYS.has(key)) ctx.addIssue({ code: 'custom', path: ['unset'], message: `'${key}' can't be changed here` });
  });
export type SettingsRequest = z.input<typeof settingsRequest>;

/** PUT .../env body: values travel to ddeploy on stdin, never argv. */
export const envChangeRequest = z
  .object({
    set: z.record(z.string(), z.string()).default({}),
    unset: z.array(z.string()).default([]),
  })
  .superRefine((req, ctx) => {
    for (const [k, v] of Object.entries(req.set)) {
      if (!patterns.envKey.test(k)) ctx.addIssue({ code: 'custom', path: ['set', k], message: 'letters, digits and _ only, not starting with a digit' });
      if (/[\r\n]/.test(v)) ctx.addIssue({ code: 'custom', path: ['set', k], message: 'no line breaks' });
    }
    for (const k of req.unset) if (!patterns.envKey.test(k)) ctx.addIssue({ code: 'custom', path: ['unset'], message: `invalid key '${k}'` });
    if (!Object.keys(req.set).length && !req.unset.length) ctx.addIssue({ code: 'custom', path: [], message: 'nothing to change' });
  });
export type EnvChangeRequest = z.input<typeof envChangeRequest>;

/** Keys whose values are masked until revealed. Same heuristic as `ddeploy env --show`. */
export const SECRET_KEY = /PASS|SECRET|KEY|TOKEN|SALT|PRIVATE/i;

/** A dotenv value with whitespace that isn't quoted: phpdotenv refuses to load the file. */
export function needsQuotes(value: string): boolean {
  const v = value.trim();
  if (!/\s/.test(v)) return false;
  return !((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")));
}
