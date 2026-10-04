import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { siteNamesResponse } from '../src/index.ts';

describe('site-names', () => {
  it('real ddeploy output parses', () => {
    const r = siteNamesResponse.parse(JSON.parse(readFileSync(new URL('./fixtures/site-names.json', import.meta.url), 'utf8')));
    expect(r.sites[0]).toEqual({ name: 'testsite', preview: null });
  });
});
