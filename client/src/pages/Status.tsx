import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { countStatuses, type DoctorResponse } from '@webddeploy/shared';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Checks } from '../components/Checks.tsx';
import { Button, Card, ErrorBox, Spinner, StatusDot, cx } from '../components/ui.tsx';
import { api, keys, useDoctor } from '../lib/api.ts';
import { relativeTime } from '../lib/format.ts';
import { useSearchState } from '../lib/searchState.ts';

export function Status() {
  const { server } = useParams({ from: '/s/$server/status' });
  const doctor = useDoctor(server);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useSearchState<boolean>('all', false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(keys.doctor(server), await api<DoctorResponse>(`/api/servers/${server}/doctor?fresh=1`));
    } finally {
      setRefreshing(false);
    }
  };

  if (doctor.isPending) return <Spinner label="Running health checks…" />;
  if (doctor.error) return <ErrorBox error={doctor.error} title="Couldn't run doctor" />;
  const d = doctor.data;
  const c = countStatuses(d);
  const sites = showAll ? d.sites : d.sites.filter((s) => s.worst !== 'ok');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Status</h1>
          <p className="text-sm text-stone-500">
            {c.ok} ok · {c.warn} warn · {c.fail} fail · {c.off} off — checked {relativeTime(d.checked_at)}
          </p>
        </div>
        <Button onClick={() => void refresh()} busy={refreshing}>
          <RefreshCw className="size-4" aria-hidden /> Run checks now
        </Button>
      </div>
      <Card title={<span className="flex items-center gap-2"><StatusDot status={d.server.worst} /> Server</span>}>
        <Checks checks={d.server.checks} />
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h2 className="font-semibold">Sites ({d.sites.length})</h2>
        <label className="flex items-center gap-1.5 text-sm text-stone-600 dark:text-stone-300">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show healthy sites
        </label>
      </div>
      {sites.length === 0 && <Card className="p-4 text-sm text-stone-500">Every site is healthy.</Card>}
      {sites.map((s) => {
        const n = (st: string) => s.checks.filter((x) => x.status === st).length;
        const summary = [n('ok') && `${n('ok')} ok`, n('warn') && `${n('warn')} warn`, n('fail') && `${n('fail')} fail`].filter(Boolean).join(' · ');
        return (
          <Card
            key={s.name}
            className={cx('border-l-4', s.worst === 'fail' ? 'border-l-red-500' : s.worst === 'warn' ? 'border-l-amber-400' : 'border-l-emerald-500')}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <StatusDot status={s.worst} />
                <Link to="/s/$server/sites/$name" params={{ server, name: s.name }} search={{ tab: 'health' }} className="hover:underline">
                  {s.name}
                </Link>
                {s.preview && <span className="text-xs font-normal text-stone-500">preview of {s.preview.project}</span>}
                <span className="text-xs font-normal text-stone-500">{summary}</span>
              </span>
            }
          >
            <Checks checks={showAll ? s.checks : s.checks.filter((x) => x.status === 'warn' || x.status === 'fail')} />
          </Card>
        );
      })}
    </div>
  );
}
