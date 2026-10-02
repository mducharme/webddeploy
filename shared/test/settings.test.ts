import { describe, expect, it } from 'vitest';
import { envChangeRequest, needsQuotes, settingsRequest } from '../src/index.ts';

describe('settingsRequest', () => {
  it('accepts valid scalar, bool and list values', () => {
    const r = settingsRequest.safeParse({ set: { client_max_body_size: '128m', basic_auth: 'true', additional_hostnames: ['alt', 'www2'] }, unset: ['static_cache'], branch: 'develop' });
    expect(r.success).toBe(true);
  });

  it.each([
    ['a key outside the allowlist', { set: { db_env_scheme: 'none' } }],
    ['unset outside the allowlist', { unset: ['persistent_files'] }],
    ['an invalid body size', { set: { client_max_body_size: '1;x' } }],
    ['a non-boolean bool', { set: { basic_auth: 'yes' } }],
    ['a list given as a string', { set: { additional_hostnames: 'alt' } }],
    ['an invalid hostname in a list', { set: { additional_hostnames: ['ok', 'bad host'] } }],
    ['a double quote', { set: { backup_exclude: ['a"b'] } }],
    ['an invalid branch', { branch: '-x' }],
  ])('rejects %s', (_, body) => {
    expect(settingsRequest.safeParse(body).success).toBe(false);
  });

  it('branch null means back to the repository default', () => {
    expect(settingsRequest.parse({ branch: null }).branch).toBeNull();
  });
});

describe('envChangeRequest', () => {
  it('accepts sets and unsets', () => {
    expect(envChangeRequest.safeParse({ set: { APP_NAME: '"My App"' }, unset: ['OLD_KEY'] }).success).toBe(true);
  });
  it.each([
    ['an invalid key', { set: { 'BAD-KEY': '1' } }],
    ['a newline in a value', { set: { A: 'x\ny' } }],
    ['an empty change', {}],
  ])('rejects %s', (_, body) => expect(envChangeRequest.safeParse(body).success).toBe(false));
});

describe('needsQuotes', () => {
  it.each([
    ['plain', false],
    ['My App', true],
    ['"My App"', false],
    ["'My App'", false],
    ['', false],
  ])('%s -> %s', (v, expected) => expect(needsQuotes(v)).toBe(expected));
});
