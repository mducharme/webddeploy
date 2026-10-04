import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LogView, filterLines, localizeTimestamps } from '../src/components/LogView.tsx';

describe('log tools', () => {
  it('filters lines, case-insensitively, with counts', () => {
    const r = filterLines('a ok\nb ERROR x\nc error y\n', 'error');
    expect(r).toEqual({ text: 'b ERROR x\nc error y\n', shown: 2, total: 3 });
    expect(filterLines('a\nb\n', '')).toEqual({ text: 'a\nb\n', shown: 2, total: 2 });
    expect(filterLines('a\nb\n', 'zzz').text).toBe('');
  });

  it('shows UTC line timestamps in local time (only at the start of a line)', () => {
    process.env.TZ = 'America/Toronto';
    const out = localizeTimestamps('2026-10-04T03:38:19Z [info] x\nsee 2026-10-04T03:38:19Z later\n');
    expect(out.split('\n')[0]).toBe('2026-10-03 23:38:19 [info] x');
    expect(out.split('\n')[1]).toBe('see 2026-10-04T03:38:19Z later');
  });

  it('the toolbar filters what is shown', () => {
    render(<LogView text={'2026-10-04T03:38:19Z [info] start\n2026-10-04T03:38:20Z [error] boom\n'} />);
    fireEvent.change(screen.getByLabelText('Filter lines'), { target: { value: 'boom' } });
    expect(screen.getByText('1 of 2 lines')).toBeInTheDocument();
    expect(screen.getByTestId('log-view')).not.toHaveTextContent('start');
    fireEvent.change(screen.getByLabelText('Filter lines'), { target: { value: 'nope' } });
    expect(screen.getByTestId('log-view')).toHaveTextContent('No line contains “nope”.');
  });

  it('offers local time only when there are UTC timestamps', () => {
    const { rerender } = render(<LogView text={'2026-10-04T03:38:19Z x\n'} />);
    expect(screen.getByRole('button', { name: /UTC/ })).toBeInTheDocument();
    rerender(<LogView text={'no timestamps here\n'} />);
    expect(screen.queryByRole('button', { name: /UTC|Local time/ })).toBeNull();
  });
});

import { ConfirmButton } from '../src/components/ui.tsx';

describe('ConfirmButton with typeToConfirm', () => {
  it('needs the name typed before it confirms', () => {
    let done = 0;
    render(<ConfirmButton label="Restore" confirmLabel="Replace the database" typeToConfirm="candiac" onConfirm={() => void done++} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    const confirm = screen.getByRole('button', { name: 'Replace the database' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type candiac to confirm'), { target: { value: 'candia' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type candiac to confirm'), { target: { value: 'candiac' } });
    fireEvent.click(confirm);
    expect(done).toBe(1);
  });
  it('without it: two clicks, as before', () => {
    let done = 0;
    render(<ConfirmButton label="Delete" confirmLabel="Delete this dump" onConfirm={() => void done++} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this dump' }));
    expect(done).toBe(1);
  });
});
