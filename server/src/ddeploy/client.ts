// Typed wrapper over one server's `ddeploy api`: argument building and
// response validation in one place. Arguments built here are what reach
// root on the server; ddeploy re-validates every one of them.
import {
  SUPPORTED_API_VERSION,
  branchesResponse,
  commitsResponse,
  dbCredentialsResponse,
  dbInfoResponse,
  envResponse,
  runCancelResponse,
  doctorResponse,
  eventsResponse,
  infoResponse,
  inspectRepoResponse,
  logChunk,
  logsResponse,
  previewsResponse,
  provisionFlags,
  runShowResponse,
  runStartResponse,
  siteDetailResponse,
  sitesResponse,
  uploadsResponse,
  previewCreateFlags,
  type PreviewCreateRequest,
  type ProvisionRequestParsed,
} from '@webddeploy/shared';
import type { Readable } from 'node:stream';
import type { z } from 'zod';
import { DdeployError, type CallOptions, type Connector, type RawStream } from './connector.ts';

export interface ReadOptions {
  offset?: number;
  lines?: number;
}

function readArgs(o: ReadOptions): string[] {
  if (o.offset != null) return ['--offset', String(Math.max(0, Math.floor(o.offset)))];
  if (o.lines != null) return ['--lines', String(Math.max(1, Math.floor(o.lines)))];
  return [];
}

export interface EventFilter {
  site?: string;
  project?: string;
  run?: string;
  limit?: number;
}

export class DdeployClient {
  readonly connector: Connector;

  constructor(connector: Connector) {
    this.connector = connector;
  }

  private async call<T extends z.ZodType>(schema: T, args: string[], opts?: CallOptions): Promise<z.infer<T>> {
    const json = await this.connector.call(args, opts);
    const version = (json as { api_version?: unknown } | null)?.api_version;
    if (typeof version === 'number' && version > SUPPORTED_API_VERSION) {
      throw new DdeployError('incompatible', `ddeploy speaks api_version ${version}; this webddeploy supports ${SUPPORTED_API_VERSION} — upgrade webddeploy`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DdeployError(
        'incompatible',
        `unexpected response from ddeploy api ${args[0]}: ${issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid'} — are ddeploy and webddeploy versions compatible?`,
      );
    }
    return parsed.data;
  }

  info() {
    return this.call(infoResponse, ['info']);
  }

  sites() {
    return this.call(sitesResponse, ['sites'], { timeoutMs: 120_000 });
  }

  site(name: string) {
    return this.call(siteDetailResponse, ['site', name]);
  }

  events(f: EventFilter = {}) {
    const args = ['events'];
    if (f.site) args.push('--site', f.site);
    if (f.project) args.push('--project', f.project);
    if (f.run) args.push('--run', f.run);
    if (f.limit) args.push('--limit', String(f.limit));
    return this.call(eventsResponse, args);
  }

  previews(project: string) {
    return this.call(previewsResponse, ['previews', project]);
  }

  doctor(site?: string) {
    return this.call(doctorResponse, site ? ['doctor', site] : ['doctor'], { timeoutMs: 180_000 });
  }

  logs() {
    return this.call(logsResponse, ['logs']);
  }

  log(name: string, o: ReadOptions = {}) {
    return this.call(logChunk, ['logs', name, ...readArgs(o)]);
  }

  inspectRepo(url: string, branch?: string | null) {
    return this.call(inspectRepoResponse, ['inspect-repo', url, ...(branch ? ['--branch', branch] : [])], { timeoutMs: 180_000 });
  }

  startDeploy(site: string, actor: string) {
    return this.call(runStartResponse, ['run', 'start', 'deploy', site, '--actor', actor]);
  }

  startProvision(req: ProvisionRequestParsed, actor: string) {
    return this.call(runStartResponse, ['run', 'start', 'provision', req.name, req.repo_url, '--actor', actor, ...provisionFlags(req)]);
  }

  runShow(id: string) {
    return this.call(runShowResponse, ['run', 'show', id]);
  }

  runLog(id: string, o: ReadOptions = {}) {
    return this.call(logChunk, ['run', 'log', id, ...readArgs(o)]);
  }

  startRollback(site: string, actor: string, sha?: string | null) {
    return this.call(runStartResponse, ['run', 'start', 'rollback', site, ...(sha ? ['--sha', sha] : []), '--actor', actor]);
  }

  /** The dump goes to ddeploy's stdin; ddeploy spools, checks and imports it in a detached run. */
  startDbImport(site: string, actor: string, dump: Readable) {
    return this.call(runStartResponse, ['run', 'start', 'db-import', site, '--actor', actor], { stdin: dump, timeoutMs: 6 * 3600_000 });
  }

  startDbRestore(site: string, actor: string, snapshot: string) {
    return this.call(runStartResponse, ['run', 'start', 'db-restore', site, '--snapshot', snapshot, '--actor', actor]);
  }

  startDbSnapshot(site: string, actor: string) {
    return this.call(runStartResponse, ['run', 'start', 'db-snapshot', site, '--actor', actor]);
  }

  cancelRun(id: string, actor: string) {
    return this.call(runCancelResponse, ['run', 'cancel', id, '--actor', actor]);
  }

  env(site: string) {
    return this.call(envResponse, ['env', site]);
  }

  /** Values travel on stdin as KEY=value lines — never argv. */
  applyEnv(site: string, actor: string, set: Record<string, string>, unset: readonly string[]) {
    const stdin = Object.entries(set).map(([k, v]) => `${k}=${v}\n`).join('');
    return this.call(envResponse, ['env', site, '--apply', ...unset.flatMap((k) => ['--unset', k]), '--actor', actor], { stdin });
  }

  applySettings(site: string, actor: string, set: Record<string, string | string[]>, unset: readonly string[], branch?: string | null) {
    const args = ['settings', site];
    for (const [k, v] of Object.entries(set)) args.push('--set', `${k}=${Array.isArray(v) ? v.join(' ') : v}`);
    for (const k of unset) args.push('--unset', k);
    if (branch === null) args.push('--clear-branch');
    else if (branch) args.push('--branch', branch);
    args.push('--actor', actor);
    return this.call(siteDetailResponse, args);
  }

  branches(site: string) {
    return this.call(branchesResponse, ['branches', site]);
  }

  commits(site: string, from: string, to: string) {
    return this.call(commitsResponse, ['commits', site, from, to]);
  }

  dbInfo(site: string) {
    return this.call(dbInfoResponse, ['db', 'info', site]);
  }

  dbCredentials(site: string) {
    return this.call(dbCredentialsResponse, ['db', 'credentials', site]);
  }

  dbDump(site: string, snapshot?: string): Promise<RawStream> {
    return this.connector.stream(['db', 'dump', site, ...(snapshot ? ['--snapshot', snapshot] : [])]);
  }

  startPreviewCreate(project: string, actor: string, req: Required<Pick<PreviewCreateRequest, 'branch'>> & Parameters<typeof previewCreateFlags>[0]) {
    return this.call(runStartResponse, ['run', 'start', 'preview-create', project, '--branch', req.branch, ...previewCreateFlags(req), '--actor', actor]);
  }

  startPreviewDeploy(project: string, actor: string, branch: string) {
    return this.call(runStartResponse, ['run', 'start', 'preview-deploy', project, '--branch', branch, '--actor', actor]);
  }

  startPreviewRemove(project: string, actor: string, branch: string) {
    return this.call(runStartResponse, ['run', 'start', 'preview-remove', project, '--branch', branch, '--actor', actor]);
  }

  uploads(site: string) {
    return this.call(uploadsResponse, ['uploads', site], { timeoutMs: 90_000 });
  }

  /** The archive goes to ddeploy's stdin; it's checked and unpacked in a detached run. */
  startUploadsImport(site: string, actor: string, dir: string, mode: 'merge' | 'replace', archive: Readable) {
    return this.call(runStartResponse, ['run', 'start', 'uploads-import', site, '--dir', dir, '--mode', mode, '--actor', actor], {
      stdin: archive,
      timeoutMs: 6 * 3600_000,
    });
  }

  startUploadsRestore(site: string, actor: string, snapshot: string) {
    return this.call(runStartResponse, ['run', 'start', 'uploads-restore', site, '--snapshot', snapshot, '--actor', actor]);
  }

  startUploadsSnapshot(site: string, actor: string) {
    return this.call(runStartResponse, ['run', 'start', 'uploads-snapshot', site, '--actor', actor]);
  }

  uploadsDownload(site: string, dir: string): Promise<RawStream> {
    return this.connector.stream(['uploads', 'download', site, '--dir', dir]);
  }
}
