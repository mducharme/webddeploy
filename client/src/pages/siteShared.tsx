import { useNavigate } from '@tanstack/react-router';
import { Rocket, Undo2 } from 'lucide-react';
import type { DeployCheckResponse } from '@webddeploy/shared';
import { useState } from 'react';
import { ConfirmButton, InlineError, Mono } from '../components/ui.tsx';
import { useDeploy, useDeployCheck, useRollback } from '../lib/api.ts';
import { useCan } from '../lib/role.tsx';
import { shortSha } from '../lib/format.ts';

/** Deploy, then follow the new run. */
export function DeployNowButton({ server, name, label = 'Deploy', confirmLabel }: { server: string; name: string; label?: string; confirmLabel?: string }) {
  const deploy = useDeploy(server);
  const navigate = useNavigate();
  const [asked, setAsked] = useState(false);
  const check = useDeployCheck(server, name, asked);
  if (!useCan('admin')) return null;
  return (
    <span className="inline-flex flex-col items-end">
      <ConfirmButton
        label={label}
        confirmLabel={confirmLabel ?? `Deploy ${name}`}
        icon={<Rocket className="size-4" aria-hidden />}
        busy={deploy.isPending}
        onAsk={() => setAsked(true)}
        confirmNote={<DeployNote check={check.data} pending={check.isPending && asked} />}
        onConfirm={() => deploy.mutateAsync(name, { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } }) })}
      />
      {deploy.error && <InlineError error={deploy.error} className="mt-1 max-w-xs text-xs text-red-700" />}
    </span>
  );
}

/** What a deploy is about to change: "up to date" (a redeploy) or new commits. */
export function DeployNote({ check, pending }: { check?: DeployCheckResponse; pending: boolean }) {
  if (pending) return <>Checking the branch for new commits…</>;
  if (!check) return null;
  if (!check.reachable) return <>Couldn't reach the repository to compare — deploying anyway takes whatever is there.</>;
  if (check.up_to_date) {
    return <>{check.branch ?? 'The branch'} is up to date: <Mono>{shortSha(check.live_sha)}</Mono> is already live. Deploying again re-runs the build and hooks.</>;
  }
  return (
    <>
      {check.ahead != null ? `${check.ahead} new commit${check.ahead === 1 ? '' : 's'}` : 'New commits'} on {check.branch ?? 'the branch'}:{' '}
      <Mono>{shortSha(check.live_sha)}</Mono> → <Mono>{shortSha(check.remote_sha)}</Mono>
    </>
  );
}

/** Roll the site's code back to `sha` (code only: migrations aren't undone). */
export function RollbackButton({ server, name, sha, label }: { server: string; name: string; sha: string; label?: string }) {
  const rollback = useRollback(server);
  const navigate = useNavigate();
  if (!useCan('admin')) return null;
  return (
    <span className="inline-flex flex-col items-end">
      <ConfirmButton
        label={label ?? 'Roll back to this'}
        confirmLabel={`Roll back to ${shortSha(sha)}`}
        icon={<Undo2 className="size-4" aria-hidden />}
        busy={rollback.isPending}
        onConfirm={() =>
          rollback.mutateAsync({ site: name, body: { sha } }, { onSuccess: ({ run_id }) => void navigate({ to: '/s/$server/runs/$id', params: { server, id: run_id } }) })
        }
      />
      {rollback.error && <InlineError error={rollback.error} className="mt-1 max-w-xs text-xs text-red-700" />}
    </span>
  );
}
