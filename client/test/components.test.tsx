import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import type { Run } from '@webddeploy/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RunTable } from '../src/components/RunTable.tsx';
import { ConfirmButton } from '../src/components/ui.tsx';

/** Renders inside a throwaway router, since RunTable renders Links. */
async function withRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => <>{ui}</> });
  const any = createRoute({ getParentRoute: () => root, path: '$', component: () => null });
  const router = createRouter({ routeTree: root.addChildren([any]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<RouterProvider router={router as never} />);
  await screen.findByRole('table').catch(() => undefined);
}

const run = (o: Partial<Run>): Run => ({
  run_id: '20261002T120000Z-aaaaaa', site: 'site', kind: 'deploy', phase: 'succeeded', trigger: 'web (alice@example.com)',
  started_at: '2026-10-02T12:00:00Z', finished_at: '2026-10-02T12:00:30Z', duration_s: 30,
  from_sha: null, to_sha: 'abcdef1234567', subject: 'Fix header', branch: 'main', project: null, error: null, ...o,
});

describe('RunTable', () => {
  it('shows who, what and the result', async () => {
    await withRouter(<RunTable server="local" repo="git@github.com:org/site.git" runs={[run({}), run({ run_id: 'x2', phase: 'failed', error: 'build broke', trigger: 'webhook [abc]' })]} />);
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('git push')).toBeInTheDocument(); // no pusher, no author: just "git push"
    expect(screen.getByText('build broke')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'abcdef1' })[0]).toHaveAttribute('href', 'https://github.com/org/site/commit/abcdef1234567');
  });

  it('a push names who pushed, or the commit author', async () => {
    await withRouter(
      <RunTable
        server="local"
        runs={[run({ run_id: 'p1', trigger: 'webhook [ab12] by octo-pusher' }), run({ run_id: 'p2', trigger: 'webhook [cd34]', author: 'Jane Dev' })]}
      />,
    );
    expect(screen.getByText('octo-pusher')).toBeInTheDocument();
    expect(screen.getByText('Jane Dev')).toBeInTheDocument();
    expect(screen.getAllByText('(git push)')).toHaveLength(2);
  });

  it('pages long histories', async () => {
    const runs = Array.from({ length: 30 }, (_, i) => run({ run_id: `20261002T1200${String(i).padStart(2, '0')}Z-aaaaaa` }));
    await withRouter(<RunTable server="local" runs={runs} pageSize={10} />);
    expect(screen.getAllByRole('row')).toHaveLength(11);
    await userEvent.click(screen.getByRole('button', { name: /show more \(20 older\)/i }));
    expect(screen.getAllByRole('row')).toHaveLength(31);
  });

  it('says so when empty', async () => {
    render(<RunTable server="local" runs={[]} empty="Nothing here." />);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  });
});

describe('ConfirmButton', () => {
  it('asks before acting, and can be cancelled', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Deploy" confirmLabel="Deploy site" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deploy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deploy site' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
