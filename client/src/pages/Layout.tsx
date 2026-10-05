import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useParams } from '@tanstack/react-router';
import { Activity, Archive, ChevronDown, FileText, HeartPulse, LayoutGrid, LogOut, Menu as MenuIcon, Plus, Settings2, Users, X } from 'lucide-react';
import { ROLE_LABELS } from '@webddeploy/shared';
import { Can } from '../lib/role.tsx';
import { RunningIndicator } from '../components/RunningIndicator.tsx';
import { Toaster } from '../components/Toaster.tsx';
import { useLiveStream } from '../lib/live.ts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, signOut, useMe } from '../lib/api.ts';
import { Button, ErrorBox, Spinner } from '../components/ui.tsx';

export function Root() {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  if (me.error instanceof ApiError && me.error.status === 401) return <SignIn />;
  if (me.error) return <ErrorBox error={me.error} title="Couldn't reach webddeploy" />;
  return <Shell>{<Outlet />}</Shell>;
}

function NavLink({ to, params, icon, children, block, onClick }: { to: string; params?: Record<string, string>; icon: ReactNode; children: ReactNode; block?: boolean; onClick?: () => void }) {
  return (
    <Link
      to={to}
      params={params}
      onClick={onClick}
      activeOptions={{ exact: to.endsWith('$server') }}
      className={`${block ? 'flex w-full px-3 py-2' : 'inline-flex px-2.5 py-1.5'} items-center gap-1.5 rounded-md text-sm text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800`}
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
  useLiveStream(server);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto flex max-w-7xl items-center gap-x-4 px-4 py-2">
          <Link to="/s/$server" params={{ server }} className="flex min-w-0 items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="size-6" />
            ddeploy
            <span className="truncate rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-600 dark:bg-stone-800 dark:text-stone-300">{serverName}</span>
          </Link>
          {/* Laptop and up: everything in one line. */}
          <nav className="hidden flex-1 items-center gap-1 lg:flex">
            <NavLinks server={server} />
            <Can role="superadmin"><AdminMenu server={server} /></Can>
          </nav>
          <span className="ml-auto lg:ml-0"><RunningIndicator server={server} /></span>
          <Can role="admin">
            <Link to="/s/$server/provision" params={{ server }} className="hidden shrink-0 lg:block">
              <Button variant="primary" className="whitespace-nowrap"><Plus className="size-4" /> New site</Button>
            </Link>
          </Can>
          <div className="hidden items-center gap-2 text-sm lg:flex">
            {me.picture && <img src={me.picture} alt="" className="size-7 rounded-full" referrerPolicy="no-referrer" />}
            <span className="hidden text-stone-600 2xl:inline dark:text-stone-300">{me.email}</span>
            <span title={me.email} className="whitespace-nowrap rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">{ROLE_LABELS[me.role]}</span>
            <Button variant="ghost" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
          {/* Phones and tablets: a menu. */}
          <Button variant="ghost" className="lg:hidden" aria-expanded={menuOpen} aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? <X className="size-5" /> : <MenuIcon className="size-5" />}
          </Button>
        </div>
        {menuOpen && (
          <div className="border-t border-stone-200 px-4 py-2 lg:hidden dark:border-stone-800" data-testid="mobile-menu">
            <nav className="flex flex-col">
              <NavLinks server={server} block onClick={() => setMenuOpen(false)} />
              <Can role="superadmin">
                <NavLink to="/s/$server/server-settings" params={{ server }} icon={<Settings2 className="size-4" />} block onClick={() => setMenuOpen(false)}>Server settings</NavLink>
                <NavLink to="/admin/users" icon={<Users className="size-4" />} block onClick={() => setMenuOpen(false)}>Users</NavLink>
              </Can>
            </nav>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-2 text-sm dark:border-stone-800">
              <Can role="admin">
                <Link to="/s/$server/provision" params={{ server }} onClick={() => setMenuOpen(false)}>
                  <Button variant="primary"><Plus className="size-4" /> New site</Button>
                </Link>
              </Can>
              <span className="min-w-0 flex-1 truncate text-stone-600 dark:text-stone-300">{me.email} · {ROLE_LABELS[me.role]}</span>
              <Button variant="ghost" onClick={() => void signOut()}><LogOut className="size-4" /> Sign out</Button>
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      <Toaster />
    </div>
  );
}

function NavLinks({ server, block, onClick }: { server: string; block?: boolean; onClick?: () => void }) {
  return (
    <>
      <NavLink to="/s/$server" params={{ server }} icon={<LayoutGrid className="size-4" />} block={block} onClick={onClick}>Sites</NavLink>
      <NavLink to="/s/$server/status" params={{ server }} icon={<HeartPulse className="size-4" />} block={block} onClick={onClick}>Status</NavLink>
      <NavLink to="/s/$server/logs" params={{ server }} icon={<FileText className="size-4" />} block={block} onClick={onClick}>Logs</NavLink>
      <NavLink to="/s/$server/backups" params={{ server }} icon={<Archive className="size-4" />} block={block} onClick={onClick}>Backups</NavLink>
      <NavLink to="/activity" icon={<Activity className="size-4" />} block={block} onClick={onClick}>Activity</NavLink>
    </>
  );
}

/** Super-admin pages, folded into one menu to keep the bar on one line. */
function AdminMenu({ server }: { server: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item = 'flex items-center gap-2 px-3 py-2 text-sm hover:bg-stone-100 dark:hover:bg-stone-800';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800"
      >
        <Settings2 className="size-4" /> Admin <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-20 mt-1 w-48 overflow-hidden rounded-md border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
          <Link to="/s/$server/server-settings" params={{ server }} className={item} onClick={() => setOpen(false)} role="menuitem">
            <Settings2 className="size-4" /> Server settings
          </Link>
          <Link to="/admin/users" className={item} onClick={() => setOpen(false)} role="menuitem">
            <Users className="size-4" /> Users
          </Link>
        </div>
      )}
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
