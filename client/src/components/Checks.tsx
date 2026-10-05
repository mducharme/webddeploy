import { Link } from '@tanstack/react-router';
import type { DoctorCheck, DoctorSee } from '@webddeploy/shared';
import { ArrowRight } from 'lucide-react';
import { Empty, StatusDot } from './ui.tsx';

/** Where a check points, as a link: the log filtered to the error, the run at its failed step, the site tab. */
export function SeeLink({ see, server, site }: { see: DoctorSee; server: string; site?: string }) {
  const cls = 'inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-300 px-2 py-0.5 text-xs font-medium text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800';
  if (see.type === 'log') {
    return (
      <Link to="/s/$server/logs" params={{ server }} search={{ name: see.log, find: see.find ?? undefined }} className={cls} data-testid="see-link">
        {see.find ? 'Show in the log' : 'Open the log'} <ArrowRight className="size-3" aria-hidden />
      </Link>
    );
  }
  if (see.type === 'run') {
    return (
      <Link to="/s/$server/runs/$id" params={{ server, id: see.run_id }} search={{ step: see.step ?? undefined }} className={cls} data-testid="see-link">
        {see.step ? 'Open the failed step' : 'Open the run'} <ArrowRight className="size-3" aria-hidden />
      </Link>
    );
  }
  if (!site) return null;
  return (
    <Link to="/s/$server/sites/$name" params={{ server, name: site }} search={{ tab: see.tab as never }} className={cls} data-testid="see-link">
      Open <ArrowRight className="size-3" aria-hidden />
    </Link>
  );
}

export function Checks({ checks, server, site }: { checks: DoctorCheck[]; server?: string; site?: string }) {
  if (checks.length === 0) return <Empty>No checks.</Empty>;
  return (
    <ul className="divide-y divide-stone-100 dark:divide-stone-800">
      {checks.map((c, i) => (
        <li key={`${c.check}-${i}`} className="flex items-start gap-3 px-4 py-2 text-sm">
          <span className="mt-1.5">
            <StatusDot status={c.status} />
          </span>
          <span className="w-44 shrink-0 font-medium">{c.check}</span>
          <span className="min-w-0 flex-1 break-words text-stone-600 dark:text-stone-400">{c.detail}</span>
          {c.see && server && c.status !== 'ok' && <SeeLink see={c.see} server={server} site={site} />}
        </li>
      ))}
    </ul>
  );
}
