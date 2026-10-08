import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { workersResponse, type Me, type Role, type WorkersResponse } from '@webddeploy/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import fixture from '../../shared/test/fixtures/workers.json';
import { describe, expect, it, vi } from 'vitest';
import { keys } from '../src/lib/api.ts';
import { cronLabel } from '../src/lib/format.ts';
import { currentConfig, validateConfig } from '../src/pages/WorkersEditor.tsx';
import { WorkersTab } from '../src/pages/WorkersTab.tsx';

const real = workersResponse.parse(fixture);
const none: WorkersResponse = { ...real, framework: 'laravel', workers: [], schedules: [], sources: { workers: 'none', schedules: 'none' }, repo: { queue_workers: [], schedule: [] } };

async function show(d: WorkersResponse, role: Role = 'admin') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const me: Me = { email: 'x@example.com', name: null, picture: null, role, servers: [{ id: 'local', name: 'local' }] };
  qc.setQueryData(keys.me, me);
  qc.setQueryData(['workers', 'local', 'testsite'], d);
  const root = createRootRoute({ component: () => <WorkersTab server="local" name="testsite" /> });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: () => null });
  const router = createRouter({ routeTree: root.addChildren([any]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<QueryClientProvider client={qc}><RouterProvider router={router as never} /></QueryClientProvider>);
}

describe('workers: nothing set up yet', () => {
  it('explains both kinds and suggests the framework\'s commands, for admins', async () => {
    await show(none);
    await screen.findByTestId('workers-setup');
    expect(screen.getByText(/Suggested for Laravel/)).toBeTruthy();
    expect(screen.getByText('php artisan schedule:run')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review and set up' }));
    expect(await screen.findByTestId('workers-editor')).toBeTruthy();
    expect((screen.getByLabelText('Worker #0 command') as HTMLInputElement).value).toContain('queue:work');
    expect((screen.getByLabelText('Task #0: command') as HTMLInputElement).value).toBe('php artisan schedule:run');
    expect((screen.getByLabelText('Task #0: how often') as HTMLSelectElement).value).toBe('* * * * *');
  });

  it('viewers get the explanation only', async () => {
    await show(none, 'viewer');
    await screen.findByText(/runs no queue workers or scheduled tasks/);
    expect(screen.queryByTestId('workers-setup')).toBeNull();
  });

  it('older ddeploy (no server-side lists): the repository how-to, no editor', async () => {
    const { sources, server, repo, ...old } = none;
    void [sources, server, repo];
    await show(old);
    await screen.findByText(/runs no queue workers or scheduled tasks/);
    expect(screen.queryByRole('button', { name: /Add a queue worker/ })).toBeNull();
  });
});

describe('workers editor', () => {
  it('starts from what runs now, saying it comes from the repository', async () => {
    await show(real);
    fireEvent.click(await screen.findByRole('button', { name: /Edit workers & schedules/ }));
    expect((screen.getByLabelText('Worker #0 command') as HTMLInputElement).value).toBe('sleep 1000');
    expect(screen.getByText(/come from the repository/)).toBeTruthy();
  });

  it('a custom cron is checked as you type; save stays off until it is valid', async () => {
    await show(none);
    fireEvent.click(await screen.findByRole('button', { name: /Add a scheduled task/ }));
    fireEvent.change(screen.getByLabelText('Task #0: how often'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Task #0: cron expression'), { target: { value: 'nightly' } });
    fireEvent.change(screen.getByLabelText('Task #0: command'), { target: { value: 'php bin/cleanup.php' } });
    expect(screen.getByText(/minute hour day month weekday/)).toBeTruthy();
    const save = screen.getByRole('button', { name: /Save and apply now/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Task #0: cron expression'), { target: { value: '30 2 * * *' } });
    expect(screen.getByText(/daily at 02:30/)).toBeTruthy();
    expect(save.disabled).toBe(false);
  });

  it('saves with PUT and the lists as JSON', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...real, sources: { workers: 'server', schedules: 'server' } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await show(none);
    fireEvent.click(await screen.findByRole('button', { name: 'Review and set up' }));
    fireEvent.click(screen.getByRole('button', { name: /Save and apply now/ }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('/api/servers/local/sites/testsite/workers');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ queue_workers: ['php artisan queue:work --sleep=3 --tries=3 --max-time=3600'], schedule: [{ cron: '* * * * *', cmd: 'php artisan schedule:run' }] });
    fetch.mockRestore();
  });
});

describe('helpers', () => {
  it('currentConfig: the server lists when set, else the repository\'s', () => {
    expect(currentConfig(real).queue_workers).toEqual(['sleep 1000']);
    const srv: WorkersResponse = { ...real, sources: { workers: 'server', schedules: 'repo' }, server: { queue_workers: ['php worker.php'], schedule: [] } };
    expect(currentConfig(srv)).toMatchObject({ queue_workers: ['php worker.php'], schedule: real.repo!.schedule });
  });
  it('validateConfig keys errors by field', () => {
    expect(validateConfig({ queue_workers: ['ok', ''], schedule: [{ cron: 'x', cmd: 'y' }] })).toMatchObject({ 'queue_workers.1': expect.any(String), 'schedule.0.cron': expect.any(String) });
  });
  it.each([
    ['0 */6 * * *', 'every 6 hours, at :00'],
    ['0 3 * * 1', 'every Monday at 03:00 (server time)'],
  ])('cronLabel(%s)', (c, t) => expect(cronLabel(c)).toBe(t));
});
