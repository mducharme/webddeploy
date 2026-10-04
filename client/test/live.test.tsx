import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { Run } from '@webddeploy/shared';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { RunningIndicator } from '../src/components/RunningIndicator.tsx';
import { Toaster, clearToasts, toast } from '../src/components/Toaster.tsx';
import { ErrorBox } from '../src/components/ui.tsx';
import { ApiError, keys } from '../src/lib/api.ts';
import { applyLive, finishedToast, liveKey } from '../src/lib/live.ts';

const run = (o: Partial<Run>): Run =>
  ({ run_id: '20261003T100000Z-aaaaaa', site: 'candiac', kind: 'deploy', phase: 'running', trigger: 'web (a@b.c)', started_at: new Date().toISOString(), finished_at: null, error: null, subject: null, ...o }) as Run;

function withRouter(ui: React.ReactNode, qc = new QueryClient()) {
  const root = createRootRoute({ component: () => <QueryClientProvider client={qc}>{ui}</QueryClientProvider> });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: () => null });
  const router = createRouter({ routeTree: root.addChildren([any]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  return render(<RouterProvider router={router as never} />);
}

beforeEach(() => clearToasts());

describe('finished runs', () => {
  it('success', () => expect(finishedToast(run({ phase: 'succeeded' }))).toMatchObject({ tone: 'success', message: 'Deploy candiac succeeded' }));
  it('failure, with what to do', () => {
    const t = finishedToast(run({ phase: 'failed', kind: 'backup-database', error: 'Failed to copy: AccessDenied: Access Denied.' }));
    expect(t).toMatchObject({ tone: 'error', message: 'Database backup candiac failed' });
    expect(t.detail).toContain('AccessDenied');
    expect(t.detail).toContain('BACKUP_ACCESS_KEY');
  });
});

describe('applyLive', () => {
  it('keeps the running list, refreshes what changed, toasts what finished', async () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.sites('local'), { sites: [] });
    applyLive(qc, 'local', { running: [run({})], finished: [], changed_sites: [] }, '/s/local');
    expect(qc.getQueryData(liveKey('local'))).toHaveLength(1);
    expect(qc.getQueryState(keys.sites('local'))?.isInvalidated).toBe(false);

    withRouter(<Toaster />);
    act(() => applyLive(qc, 'local', { running: [], finished: [run({ phase: 'succeeded' })], changed_sites: ['candiac'] }, '/s/local'));
    expect(qc.getQueryData(liveKey('local'))).toEqual([]);
    expect(qc.getQueryState(keys.sites('local'))?.isInvalidated).toBe(true);
    expect(await screen.findByText('Deploy candiac succeeded')).toBeInTheDocument();
    expect(screen.getByText('View the run')).toBeInTheDocument();
  });

  it("no toast when that run's own page is open", async () => {
    withRouter(<Toaster />);
    act(() => applyLive(new QueryClient(), 'local', { running: [], finished: [run({ phase: 'succeeded' })], changed_sites: [] }, '/s/local/runs/20261003T100000Z-aaaaaa'));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/succeeded/)).toBeNull();
  });
});

describe('RunningIndicator', () => {
  it('hidden when nothing runs, a count when something does', async () => {
    const qc = new QueryClient();
    const { rerender } = withRouter(<RunningIndicator server="local" />, qc);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('running-indicator')).toBeNull();
    act(() => qc.setQueryData(liveKey('local'), [run({}), run({ run_id: '20261003T100001Z-bbbbbb', site: 'other' })]));
    expect(await screen.findByText('2 running')).toBeInTheDocument();
    void rerender;
  });
});

describe('toasts', () => {
  it('dismiss on click', async () => {
    withRouter(<Toaster />);
    act(() => void toast.success('Backup deleted'));
    expect(await screen.findByText('Backup deleted')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Dismiss' }).click());
    expect(screen.queryByText('Backup deleted')).toBeNull();
  });
});

describe('error hints', () => {
  it('a known message gets a next step', () => {
    render(<ErrorBox error={new ApiError(502, 'error', 'sudo: a password is required')} />);
    expect(screen.getByTestId('error-hint')).toHaveTextContent('init-web');
  });
  it('a status gets one when the message is unknown', () => {
    render(<ErrorBox error={new ApiError(403, 'forbidden', 'this needs the admin role')} />);
    expect(screen.getByTestId('error-hint')).toHaveTextContent('super-admin');
  });
  it('the network failing', () => {
    render(<ErrorBox error={new TypeError('Failed to fetch')} />);
    expect(screen.getByText("Couldn't reach the web UI's server")).toBeInTheDocument();
  });
  it('nothing extra for a plain validation error', () => {
    render(<ErrorBox error={new ApiError(400, 'bad_request', 'invalid branch name')} />);
    expect(screen.queryByTestId('error-hint')).toBeNull();
  });
});
