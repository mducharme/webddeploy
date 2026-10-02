import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { countStatuses, type DoctorResponse } from '@webddeploy/shared';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Checks } from '../components/Checks.tsx';
import { Button, Card, ErrorBox, Spinner, StatusDot } from '../components/ui.tsx';
import { api, keys, useDoctor } from '../lib/api.ts';
import { relativeTime } from '../lib/format.ts';

export function Status() {
  const { server } = useParams({ from: '/s/$server/status' });
  const doctor = useDoctor(server);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);

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
      <Card
        title={`Sites (${d.sites.length})`}
        actions={
          <label className="flex items-center gap-1.5 text-sm text-stone-600 dark:text-stone-300">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show healthy sites
          </label>
        }
      >
        {sites.length === 0 && <p className="p-4 text-sm text-stone-500">Every site is healthy.</p>}
        <div className="divide-y divide-stone-200 dark:divide-stone-800">
          {sites.map((s) => (
            <div key={s.name}>
              <div className="flex items-center gap-2 bg-stone-50 px-4 py-2 dark:bg-stone-900/60">
                <StatusDot status={s.worst} />
                <Link to="/s/$server/sites/$name" params={{ server, name: s.name }} search={{ tab: 'health' }} className="font-medium hover:underline">
                  {s.name}
                </Link>
                {s.preview && <span className="text-xs text-stone-500">preview of {s.preview.project}</span>}
              </div>
              <Checks checks={showAll ? s.checks : s.checks.filter((x) => x.status === 'warn' || x.status === 'fail')} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
