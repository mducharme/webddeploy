import { Navigate, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { ErrorBox } from './components/ui.tsx';
import { useMe } from './lib/api.ts';
import { ActivityPage } from './pages/Activity.tsx';
import { BackupsPage } from './pages/BackupsPage.tsx';
import { ServerSettingsPage } from './pages/ServerSettingsPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';
import { Fleet } from './pages/Fleet.tsx';
import { Root } from './pages/Layout.tsx';
import { Logs } from './pages/Logs.tsx';
import { Provision } from './pages/Provision.tsx';
import { RunPage } from './pages/RunPage.tsx';
import { SITE_TABS, SitePage } from './pages/Site.tsx';
import { Status } from './pages/Status.tsx';

// Every page under a server lives at /s/<server-id>/..., matching the
// API's /api/servers/<id>/... — one server today, several later.
const rootRoute = createRootRoute({
  component: Root,
  notFoundComponent: () => <ErrorBox error="There's nothing at this address." title="Not found" />,
});

function Home() {
  const me = useMe();
  const first = me.data?.servers[0];
  return first ? <Navigate to="/s/$server" params={{ server: first.id }} replace /> : null;
}

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Home });
const serverRoute = createRoute({ getParentRoute: () => rootRoute, path: 's/$server' });
const fleetRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: '/',
  component: Fleet,
  validateSearch: z.object({
    q: z.string().optional().catch(undefined),
    view: z.enum(['all', 'attention', 'running']).optional().catch(undefined),
    previews: z.boolean().optional().catch(undefined),
  }),
});
const siteRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: 'sites/$name',
  validateSearch: z.object({ tab: z.enum(SITE_TABS).default('overview').catch('overview'), log: z.enum(['error', 'access']).optional().catch(undefined) }),
  component: SitePage,
});
const runRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: 'runs/$id',
  component: RunPage,
  // step: open the run on that step's output (doctor's "show me" links).
  validateSearch: z.object({ step: z.string().max(200).optional().catch(undefined) }),
});
const statusRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: 'status',
  component: Status,
  validateSearch: z.object({ all: z.boolean().optional().catch(undefined) }),
});
const logsRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: 'logs',
  // find: open the log already filtered to that text (doctor's "show me" links).
  validateSearch: z.object({ name: z.string().optional(), find: z.string().max(200).optional().catch(undefined) }),
  component: Logs,
});
const backupsRoute = createRoute({ getParentRoute: () => serverRoute, path: 'backups', component: BackupsPage });
const serverSettingsRoute = createRoute({ getParentRoute: () => serverRoute, path: 'server-settings', component: ServerSettingsPage });
const usersRoute = createRoute({ getParentRoute: () => rootRoute, path: 'admin/users', component: UsersPage });
const provisionRoute = createRoute({ getParentRoute: () => serverRoute, path: 'provision', component: Provision });
const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'activity',
  component: ActivityPage,
  validateSearch: z.object({
    tab: z.enum(['all', 'web']).optional().catch(undefined),
    site: z.string().optional().catch(undefined),
    source: z.enum(['web', 'webhook', 'schedule', 'manual']).optional().catch(undefined),
    failed: z.boolean().optional().catch(undefined),
  }),
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  serverRoute.addChildren([fleetRoute, siteRoute, runRoute, statusRoute, logsRoute, backupsRoute, serverSettingsRoute, provisionRoute]),
  activityRoute,
  usersRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
