import { describe, expect, it } from 'vitest';
import { hintFor, hintForStatus } from '../src/index.ts';

describe('hints for errors', () => {
  it.each([
    ['Failed to copy: AccessDenied: Access Denied.', 'backup key'],
    ['upload to ddeploy-test failed: Attempt 3/3 failed with 1 errors and: Forbidden: Forbidden', 'backup key'],
    ['git@github.com: Permission denied (publickey).', 'deploy key'],
    ['write error: No space left on device', 'disk space'],
    ['PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted', 'memory'],
    ['npm ERR! code ELIFECYCLE', 'frontend build'],
    ['sudo: a password is required', 'init-web'],
    ["can't reach old.example.com:22", 'firewall'],
  ])('%s', (message, expected) => {
    const h = hintFor(message);
    expect(h).not.toBeNull();
    expect(`${h!.cause} ${h!.next}`.toLowerCase()).toContain(expected.toLowerCase());
  });

  it('nothing for an unknown message', () => expect(hintFor('something odd happened')).toBeNull());

  it.each([
    [null, null, 'didn’t answer'],
    [401, 'unauthenticated', 'Sign in'],
    [403, 'forbidden', 'super-admin'],
    [504, 'timeout', 'too long'],
    [502, 'unavailable', 'init-web'],
  ] as const)('status %s / %s', (status, code, expected) => {
    const h = hintForStatus(status, code);
    expect(`${h!.cause} ${h!.next}`).toContain(expected);
  });

  it('no hint for a plain validation error', () => expect(hintForStatus(400, 'bad_request')).toBeNull());
});
