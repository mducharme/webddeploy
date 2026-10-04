import { describe, expect, it } from 'vitest';
import { FakeConnector, fixture, json, makeApp } from './helpers.ts';

describe('/doctor?snapshot=1', () => {
  it("serves ddeploy's stored snapshot without running checks", async () => {
    const connector = new FakeConnector()
      .on('info', () => fixture('info-capabilities'))
      .on('doctor', (args) => (args[1] === '--snapshot' ? fixture('doctor-snapshot') : fixture('doctor')));
    const app = makeApp({ connector });
    const body = await json(await app.req('/api/servers/local/doctor?snapshot=1'));
    expect(body.sites[0]).toMatchObject({ name: 'testsite', checked_at: expect.any(String) });
    expect(connector.calls.filter((c) => c[0] === 'doctor')).toEqual([['doctor', '--snapshot']]);
  });

  it('runs the checks with an older ddeploy (no doctor_snapshot capability)', async () => {
    const app = makeApp();
    const body = await json(await app.req('/api/servers/local/doctor?snapshot=1'));
    expect(body.checked_at).toEqual(expect.any(String));
    expect(app.connector.calls.filter((c) => c[0] === 'doctor')).toEqual([['doctor']]);
  });
});
