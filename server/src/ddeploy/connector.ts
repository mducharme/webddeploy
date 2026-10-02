// How the server reaches one ddeploy installation's `api` subcommand.
// Everything goes through Connector.call(args) -> parsed JSON, so where
// ddeploy runs (this box via sudo, a docker container in development, or
// later another box over SSH) is just a different command prefix.
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { apiErrorResponse } from '@webddeploy/shared';

export class DdeployError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'DdeployError';
  }
}

export interface CallOptions {
  timeoutMs?: number;
  /**
   * Fed to ddeploy's stdin. Secrets (.env values) and uploads (database
   * dumps) go this way: argv is visible to every user on the box via ps.
   */
  stdin?: string | Readable;
}

export interface RawStream {
  /** First bytes already checked: this is the payload, not an error. */
  stdout: Readable;
  /** Resolves when ddeploy exits 0; rejects otherwise (the payload is then truncated). */
  done: Promise<void>;
}

export interface Connector {
  call(args: readonly string[], opts?: CallOptions): Promise<unknown>;
  /** For verbs whose output isn't JSON (db dump). Errors before any payload still reject as DdeployError. */
  stream(args: readonly string[], opts?: { timeoutMs?: number }): Promise<RawStream>;
}

const MAX_STDOUT = 32 * 1024 * 1024;
const MAX_STDERR = 64 * 1024;

/**
 * Runs `<prefix...> api <args...>` with no shell: each argument is its
 * own argv entry, so nothing in it is ever interpreted. (An SSH
 * connector, where the remote side does use a shell, will need to quote
 * each argument — that's the one thing it adds.)
 */
export class CommandConnector implements Connector {
  readonly prefix: readonly string[];
  readonly defaultTimeoutMs: number;
  /**
   * The command hands its arguments to a remote shell (ssh joins argv
   * into one string): quote each one, so a value with spaces stays one
   * argument and nothing in it is interpreted. On by default when the
   * command is ssh.
   */
  readonly remoteShell: boolean;

  constructor(prefix: readonly string[], defaultTimeoutMs = 60_000, remoteShell?: boolean) {
    if (prefix.length === 0) throw new Error('empty ddeploy command');
    this.prefix = prefix;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.remoteShell = remoteShell ?? /(^|\/)ssh$/.test(prefix[0]!);
  }

  private argv(args: readonly string[]): string[] {
    const tail = ['api', ...args];
    return [...this.prefix.slice(1), ...(this.remoteShell ? tail.map(shellQuote) : tail)];
  }

  call(args: readonly string[], opts: CallOptions = {}): Promise<unknown> {
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const [cmd] = this.prefix;
    return new Promise((resolve, reject) => {
      const child = spawn(cmd!, this.argv(args), { stdio: [opts.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
      if (opts.stdin != null && child.stdin) {
        child.stdin.on('error', () => {}); // ddeploy may stop reading early (a refused upload)
        if (typeof opts.stdin === 'string') child.stdin.end(opts.stdin);
        else opts.stdin.on('error', () => child.kill('SIGTERM')).pipe(child.stdin);
      }
      const out: Buffer[] = [];
      let outLen = 0;
      let err = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      child.stdout!.on('data', (b: Buffer) => {
        outLen += b.length;
        if (outLen > MAX_STDOUT) child.kill('SIGTERM');
        else out.push(b);
      });
      child.stderr!.on('data', (b: Buffer) => {
        if (err.length < MAX_STDERR) err += b.toString('utf8');
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new DdeployError('unavailable', `couldn't run ddeploy (${cmd}): ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return reject(new DdeployError('timeout', `ddeploy api ${args[0] ?? ''} timed out after ${timeoutMs / 1000}s`));
        const text = Buffer.concat(out).toString('utf8').trim();
        let json: unknown;
        try {
          json = JSON.parse(text.slice(text.lastIndexOf('\n{') + 1));
        } catch {
          const hint = err.trim().split('\n').slice(-2).join(' ') || `exit ${code}`;
          return reject(new DdeployError('unavailable', `ddeploy api ${args[0] ?? ''} returned no JSON: ${hint}`));
        }
        const asError = apiErrorResponse.safeParse(json);
        if (asError.success) return reject(new DdeployError(asError.data.error.code, asError.data.error.message));
        if (code !== 0) return reject(new DdeployError('error', `ddeploy api ${args[0] ?? ''} exited ${code}`));
        resolve(json);
      });
    });
  }

  stream(args: readonly string[], opts: { timeoutMs?: number } = {}): Promise<RawStream> {
    const timeoutMs = opts.timeoutMs ?? 6 * 3600_000;
    const [cmd] = this.prefix;
    return new Promise((resolve, reject) => {
      const child = spawn(cmd!, this.argv(args), { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = '';
      let settled = false;
      const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
      child.stderr.on('data', (b: Buffer) => {
        if (err.length < MAX_STDERR) err += b.toString('utf8');
      });
      const exited = new Promise<number | null>((res) => child.on('close', (code) => { clearTimeout(timer); res(code); }));
      child.on('error', (e) => {
        if (!settled) {
          settled = true;
          reject(new DdeployError('unavailable', `couldn't run ddeploy (${cmd}): ${e.message}`));
        }
      });
      // Peek at the first chunk: a JSON error object means nothing was
      // streamed and the request can still fail cleanly.
      child.stdout.once('readable', async () => {
        const first = child.stdout.read() as Buffer | null;
        if (settled) return;
        settled = true;
        if (first === null || first.subarray(0, 1).toString() === '{') {
          const chunks: Buffer[] = first ? [first] : [];
          for await (const c of child.stdout) chunks.push(c as Buffer);
          const code = await exited;
          const parsed = apiErrorResponse.safeParse(safeJson(Buffer.concat(chunks).toString('utf8')));
          if (parsed.success) return reject(new DdeployError(parsed.data.error.code, parsed.data.error.message));
          return reject(new DdeployError('unavailable', `ddeploy api ${args[0] ?? ''} produced no output (exit ${code}): ${err.trim().split('\n').pop() ?? ''}`));
        }
        const stdout = Readable.from((async function* () {
          yield first;
          yield* child.stdout;
        })());
        resolve({
          stdout,
          done: exited.then((code) => {
            if (code !== 0) throw new DdeployError('error', `ddeploy api ${args[0] ?? ''} exited ${code}: ${err.trim().split('\n').pop() ?? ''}`);
          }),
        });
      });
    });
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s.trim());
  } catch {
    return null;
  }
}

/** POSIX single-quoting: safe for any byte sequence a remote sh will see. */
export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
