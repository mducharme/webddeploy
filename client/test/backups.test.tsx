import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { backupsResponse, type BackupsResponse, type Me, type Role } from '@webddeploy/shared';
import { render, screen } from '@testing-library/react';
import fixture from '../../shared/test/fixtures/backups.json';
import { describe, expect, it } from 'vitest';
import { keys } from '../src/lib/api.ts';
import { BackupsTab, hasAnyBackup } from '../src/pages/BackupsTab.tsx';

const real = backupsResponse.parse(fixture);

/** The real fixture with nothing in object storage yet (a new site). */
function empty(over: Partial<{ dbEnabled: boolean; filesEnabled: boolean }> = {}): BackupsResponse {
  return {
    ...real,
    error: null,
    database: { ...real.database, enabled: over.dbEnabled ?? true, schedule: '23 * * * *', dumps: [], last_run: null },
    uploads: { ...real.uploads, enabled: over.filesEnabled ?? true, schedule: '17 * * * *', versions: [], last_run: null, mirror: real.uploads.mirror.map((m) => ({ ...m, files: 0, bytes: 0 })) },
  };
}

async function show(b: BackupsResponse, role: Role) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const me: Me = { email: 'x@example.com', name: null, picture: null, role, servers: [{ id: 'local', name: 'local' }] };
  qc.setQueryData(keys.me, me);
  qc.setQueryData(keys.backups('local', 'testsite'), b);
  const root = createRootRoute({ component: () => <BackupsTab server="local" name="testsite" /> });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: () => null });
  const router = createRouter({ routeTree: root.addChildren([any]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router as never} /></QueryClientProvider>);
  await screen.findByText(/Database dumps/);
}

describe('backups before the first one', () => {
  it('hasAnyBackup', () => {
    expect(hasAnyBackup(real)).toBe(true);
    expect(hasAnyBackup(empty())).toBe(false);
  });

  it('says none were made yet — not an error — and offers to start, for admins', async () => {
    await show(empty(), 'admin');
    expect(screen.getByText('No backups yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Automatic backups will run the database hourly at :23, files hourly at :17, or start the first one now/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back up the database/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back up the files/ })).toBeTruthy();
    expect(screen.getByText('No database backup yet. The first automatic one runs hourly at :23.')).toBeTruthy();
    expect(screen.getAllByText(/not backed up yet/).length).toBe(real.uploads.mirror.length);
    // the card is the one place to start: no duplicate buttons below it
    expect(screen.getAllByRole('button', { name: /Back up/ }).length).toBe(2);
    expect(screen.queryByRole('button', { name: /Restore folder/ })).toBeNull();
  });

  it('viewers get the explanation without buttons', async () => {
    await show(empty(), 'viewer');
    expect(screen.getByText('No backups yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Back up/ })).toBeNull();
  });

  it('only offers what is turned on', async () => {
    await show(empty({ filesEnabled: false }), 'admin');
    expect(screen.getByRole('button', { name: /Back up the database/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Back up the files/ })).toBeNull();
  });

  it('when both are off, points super-admins to server settings', async () => {
    await show(empty({ dbEnabled: false, filesEnabled: false }), 'superadmin');
    expect(screen.getByText(/Automatic backups are off on this server/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /server settings/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Back up the/ })).toBeNull();
  });

  it('a site with backups shows no "none yet" card', async () => {
    await show(real, 'admin');
    expect(screen.queryByText('No backups yet')).toBeNull();
  });

  it('dumps but no files yet: the files section offers one button', async () => {
    const b = empty();
    await show({ ...b, database: { ...b.database, dumps: real.database.dumps } }, 'admin');
    expect(screen.queryByText('No backups yet')).toBeNull();
    expect(screen.getByText(/A files backup copies every upload folder/)).toBeTruthy();
  });
});
