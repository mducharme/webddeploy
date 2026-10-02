import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// The router restores scroll positions; jsdom doesn't implement scrolling.
window.scrollTo = () => {};
