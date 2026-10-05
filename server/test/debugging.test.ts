import { describe, expect, it } from 'vitest';
import { VIEWER, json, makeApp } from './helpers.ts';

const site = '/api/servers/local/sites/testsite';

describe('debugging routes', () => {
  it('deploy-check, for viewers too', async () => {
    const { req, connector } = makeApp({ as: VIEWER });
    const r = await json(await req(`${site}/deploy-check`));
    expect(r.up_to_date).toBe(false);
    expect(connector.calls).toContainEqual(['deploy-check', 'testsite']);
  });

  it('errors, optionally since a time', async () => {
    const { req, connector } = makeApp();
    expect((await json(await req(`${site}/errors`))).groups[0].count).toBe(4);
    await req(`${site}/errors?since=2026-10-04T12:00:00Z`);
    expect(connector.calls).toContainEqual(['errors', 'testsite', '--since', '2026-10-04T12:00:00Z']);
  });

  it('refuses a malformed since without calling ddeploy', async () => {
    const { req, connector } = makeApp();
    expect((await req(`${site}/errors?since=yesterday`)).status).toBe(400);
    expect(connector.calls.some((c) => c[0] === 'errors')).toBe(false);
  });
});
