import type { DoctorCheck } from '@webddeploy/shared';
import { Empty, StatusDot } from './ui.tsx';

export function Checks({ checks }: { checks: DoctorCheck[] }) {
  if (checks.length === 0) return <Empty>No checks.</Empty>;
  return (
    <ul className="divide-y divide-stone-100 dark:divide-stone-800">
      {checks.map((c, i) => (
        <li key={`${c.check}-${i}`} className="flex items-start gap-3 px-4 py-2 text-sm">
          <span className="mt-1.5">
            <StatusDot status={c.status} />
          </span>
          <span className="w-44 shrink-0 font-medium">{c.check}</span>
          <span className="min-w-0 break-words text-stone-600 dark:text-stone-400">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}
