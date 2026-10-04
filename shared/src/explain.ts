// Known failure patterns, from ddeploy's API errors and from what failed
// runs print, with what to do about them. Shown under the raw message
// (which stays visible: these are hints, not a replacement).

export interface Hint {
  /** One line: what this most likely means. */
  cause: string;
  /** What to do next. */
  next: string;
}

const PATTERNS: Array<{ test: RegExp; hint: Hint }> = [
  {
    // AWS/DigitalOcean say AccessDenied; MinIO and others, through rclone, "Forbidden: Forbidden".
    test: /AccessDenied|SignatureDoesNotMatch|InvalidAccessKeyId|Forbidden: Forbidden|(to|of) \S+ failed: .*403/,
    hint: {
      cause: 'Object storage refused the backup key.',
      next: 'Check BACKUP_ACCESS_KEY / BACKUP_SECRET_KEY in the credentials file, and that the key can list, read, write and delete in the bucket.',
    },
  },
  {
    test: /NoSuchBucket|bucket does not exist/i,
    hint: { cause: "The backup bucket doesn't exist.", next: 'Create it with your storage provider (ddeploy never creates buckets), or fix BACKUP_BUCKET.' },
  },
  {
    test: /Permission denied \(publickey/,
    hint: {
      cause: 'An SSH server refused this server’s key.',
      next: 'For a git repository: add the deploy key (GIT_DEPLOY_KEY’s .pub) to the repository or a machine user. For “Copy from another server”: add the fetch key line to authorized_keys there.',
    },
  },
  {
    test: /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/,
    hint: { cause: 'The remote server’s SSH host key isn’t known, or changed.', next: 'If it was reinstalled, forget the old key and confirm the new one; otherwise find out why it changed.' },
  },
  {
    test: /No space left on device|not enough free disk space/i,
    hint: { cause: 'The server is out of disk space.', next: 'Free some space (old releases, logs, snapshots), then try again. The Status page shows disk use.' },
  },
  {
    test: /Could not resolve host|Name or service not known|Temporary failure in name resolution/,
    hint: { cause: 'A hostname couldn’t be resolved.', next: 'Check the address for typos, and that the server’s DNS works.' },
  },
  {
    test: /Connection timed out|Connection refused|No route to host|can't reach/i,
    hint: { cause: 'A remote service didn’t answer.', next: 'Check it’s up, and that its firewall lets this server in.' },
  },
  {
    test: /Allowed memory size of \d+ bytes exhausted|JavaScript heap out of memory|Killed\b.*(npm|node|composer)|exit 137/,
    hint: { cause: 'A build ran out of memory.', next: 'Raise the limit (Server settings → Frontend build memory cap, or composer’s memory_limit), or the server’s memory.' },
  },
  {
    test: /npm ERR!|ERR_PNPM|yarn error|error during build/i,
    hint: { cause: 'The frontend build failed.', next: 'The first error in the output usually names the file; reproduce with the same Node version locally.' },
  },
  {
    test: /Your requirements could not be resolved|composer\.lock.*not up to date|Problem \d+\s/,
    hint: { cause: 'Composer couldn’t install the dependencies.', next: 'Usually a composer.lock out of date with composer.json, or a PHP version/extension mismatch: run composer update locally and commit the lock file.' },
  },
  {
    test: /is locked|another run is in progress|lock held/i,
    hint: { cause: 'Something else is running on this site.', next: 'Wait for it to finish (the top bar shows what’s running), then try again.' },
  },
  {
    test: /a password is required|sudo: a terminal is required|not in the sudoers/,
    hint: { cause: 'The web UI isn’t allowed to run ddeploy.', next: 'Run “ddeploy init-web” on the server: it installs the sudo rule for the web UI’s user.' },
  },
  {
    test: /api_version|upgrade webddeploy|unknown api verb/i,
    hint: { cause: 'ddeploy and the web UI are different versions.', next: 'Update both: git pull in ddeploy’s checkout, and reinstall webddeploy (deploy/install.sh).' },
  },
];

/** A hint for an error or failed-run message, if it matches something known. */
export function hintFor(message: string | null | undefined): Hint | null {
  if (!message) return null;
  return PATTERNS.find((p) => p.test.test(message))?.hint ?? null;
}

/**
 * A hint for an API error, from its HTTP status and code (when the message
 * itself says nothing known).
 */
export function hintForStatus(status: number | null, code: string | null): Hint | null {
  if (status === null) return { cause: 'The web UI’s server didn’t answer.', next: 'Check your connection; if it persists, the webddeploy service may be down (systemctl status webddeploy).' };
  if (status === 401) return { cause: 'Your session ended.', next: 'Sign in again.' };
  if (status === 403) return { cause: 'Your role doesn’t allow this.', next: 'Ask a super-admin (Admin → Users) if you need it.' };
  if (code === 'timeout') return { cause: 'ddeploy took too long to answer.', next: 'The server may be busy (a deploy, a backup): try again in a moment.' };
  if (code === 'unavailable') return { cause: 'The web UI couldn’t run ddeploy.', next: 'Check “ddeploy doctor” on the server; “ddeploy init-web” reinstalls what the web UI needs.' };
  if (code === 'incompatible') return { cause: 'ddeploy and the web UI are different versions.', next: 'Update both.' };
  if (status >= 500) return { cause: 'Something failed on the server.', next: 'Try again; if it keeps failing, the webddeploy service log has details (journalctl -u webddeploy).' };
  return null;
}
