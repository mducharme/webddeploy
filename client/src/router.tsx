import { Navigate, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { ErrorBox } from './components/ui.tsx';
import { useMe } from './lib/api.ts';
import { ActivityPage } from './pages/Activity.tsx';
import { BackupsPage } from './pages/BackupsPage.tsx';
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
const fleetRoute = createRoute({ getParentRoute: () => serverRoute, path: '/', component: Fleet });
const siteRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: 'sites/$name',
  validateSearch: z.object({ tab: z.enum(SITE_TABS).default('overview').catch('overview') }),
  component: SitePage,
});
const runRoute = createRoute({ getParentRoute: () => serverRoute, path: 'runs/$id', component: RunPage });
const statusRoute = createRoute({ getParentRoute: () => serverRoute, path: 'status', component: Status });
const logsRoute = createRoute({
  getParentRoute: () => serverRoute,
  path: 'logs',
  validateSearch: z.object({ name: z.string().optional() }),
  component: Logs,
});
const backupsRoute = createRoute({ getParentRoute: () => serverRoute, path: 'backups', component: BackupsPage });
const provisionRoute = createRoute({ getParentRoute: () => serverRoute, path: 'provision', component: Provision });
const activityRoute = createRoute({ getParentRoute: () => rootRoute, path: 'activity', component: ActivityPage });

export const routeTree = rootRoute.addChildren([
  indexRoute,
  serverRoute.addChildren([fleetRoute, siteRoute, runRoute, statusRoute, logsRoute, backupsRoute, provisionRoute]),
  activityRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
