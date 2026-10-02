import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { Activity, FileText, HeartPulse, LayoutGrid, LogOut, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError, api, signOut, useMe } from '../lib/api.ts';
import { Button, ErrorBox, Spinner } from '../components/ui.tsx';

export function Root() {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  if (me.error instanceof ApiError && me.error.status === 401) return <SignIn />;
  if (me.error) return <ErrorBox error={me.error} title="Couldn't reach webddeploy" />;
  return <Shell>{<Outlet />}</Shell>;
}

function NavLink({ to, params, icon, children }: { to: string; params?: Record<string, string>; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      to={to}
      params={params}
      activeOptions={{ exact: to.endsWith('$server') }}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800"
      activeProps={{ className: 'bg-stone-200/80 text-stone-900 dark:bg-stone-800 dark:text-white' }}
    >
      {icon}
      {children}
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const me = useMe().data!;
  const params = useParams({ strict: false }) as { server?: string };
  const server = params.server ?? me.servers[0]?.id ?? 'local';
  const serverName = me.servers.find((s) => s.id === server)?.name ?? server;
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <Link to="/s/$server" params={{ server }} className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="size-6" />
            ddeploy
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300">{serverName}</span>
          </Link>
          <nav className="flex flex-1 flex-wrap items-center gap-1">
            <NavLink to="/s/$server" params={{ server }} icon={<LayoutGrid className="size-4" />}>Sites</NavLink>
            <NavLink to="/s/$server/status" params={{ server }} icon={<HeartPulse className="size-4" />}>Status</NavLink>
            <NavLink to="/s/$server/logs" params={{ server }} icon={<FileText className="size-4" />}>Logs</NavLink>
            <NavLink to="/activity" icon={<Activity className="size-4" />}>Activity</NavLink>
          </nav>
          <Link to="/s/$server/provision" params={{ server }}>
            <Button variant="primary"><Plus className="size-4" /> New project</Button>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            {me.picture && <img src={me.picture} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />}
            <span className="hidden text-stone-600 sm:inline dark:text-stone-300">{me.email}</span>
            <Button variant="ghost" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

function SignIn() {
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<{ google: boolean; dev: boolean }>('/auth/providers') });
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-6 text-center dark:border-stone-800 dark:bg-stone-900">
        <img src="/favicon.svg" alt="" className="mx-auto size-10" />
        <h1 className="mt-3 text-lg font-semibold">ddeploy</h1>
        <p className="mt-1 text-sm text-stone-500">Sign in with your work Google account.</p>
        <div className="mt-5 flex flex-col gap-2">
          {providers.data?.google !== false && (
            <a href={`/auth/login?return_to=${returnTo}`}>
              <Button variant="primary" className="w-full">Sign in with Google</Button>
            </a>
          )}
          {providers.data?.dev && (
            <a href={`/auth/dev-login?return_to=${returnTo}`}>
              <Button className="w-full">Development sign-in</Button>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
