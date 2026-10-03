import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Most tests run in jsdom; a few (test/tar.test.ts) run in plain Node.
if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
  // The router restores scroll positions; jsdom doesn't implement scrolling.
  window.scrollTo = () => {};
}
