import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFleetLayout } from '../src/pages/Fleet.tsx';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('homepage layout', () => {
  it('table by default; cards remembered for the next visit', () => {
    const first = renderHook(() => useFleetLayout());
    expect(first.result.current[0]).toBe('table');
    act(() => first.result.current[1]('cards'));
    expect(first.result.current[0]).toBe('cards');
    expect(renderHook(() => useFleetLayout()).result.current[0]).toBe('cards');
  });

  it('works without storage (private mode): just this visit', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const h = renderHook(() => useFleetLayout());
    expect(h.result.current[0]).toBe('table');
    act(() => h.result.current[1]('cards'));
    expect(h.result.current[0]).toBe('cards');
  });
});
