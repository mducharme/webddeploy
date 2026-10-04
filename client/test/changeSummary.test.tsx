import type { ServerConfigResponse } from '@webddeploy/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChangeSummary } from '../src/components/ChangeSummary.tsx';
import { envChanges, type EnvRow } from '../src/lib/envEdit.ts';
import { serverSettingChanges } from '../src/pages/ServerSettingsPage.tsx';

const row = (o: Partial<EnvRow>): EnvRow => ({ key: 'APP_NAME', original: 'old', masked: false, managed: false, length: 3, draft: null, deleted: false, isNew: false, ...o });

describe('reviewing changes before saving', () => {
  it('env: added, changed, removed; secrets masked', () => {
    const changes = envChanges(
      [row({ draft: 'new' }), row({ key: 'API_TOKEN', original: '', masked: true, draft: 's3cret' }), row({ key: 'OLD', deleted: true }), row({ key: 'NEW', original: null, isNew: true, draft: 'x' }), row({ key: 'SAME' })],
      (k) => /TOKEN|PASSWORD/.test(k),
    );
    expect(changes.map((c) => `${c.kind}:${c.label}`)).toEqual(['changed:APP_NAME', 'changed:API_TOKEN', 'removed:OLD', 'added:NEW']);
    render(<ChangeSummary changes={changes} note="PHP reads the .env on its next request" />);
    expect(screen.getByTestId('change-summary')).toHaveTextContent('4 changes to save');
    expect(screen.getByTestId('change-summary')).toHaveTextContent('APP_NAME: old → new');
    expect(screen.getByTestId('change-summary')).not.toHaveTextContent('s3cret');
  });

  it('server settings: when each applies, the webhook masked', () => {
    const config = {
      api_version: 1, file: '', readonly: {}, backups_configured: true,
      settings: [
        { key: 'FPM_MAX_CHILDREN', value: '5', secret: false, is_set: true, explicit: false, apply: 'deploy' },
        { key: 'NOTIFY_WEBHOOK', value: '', secret: true, is_set: true, explicit: true, apply: 'now' },
      ],
    } as ServerConfigResponse;
    const { list, note } = serverSettingChanges(config, { FPM_MAX_CHILDREN: '8', NOTIFY_WEBHOOK: 'https://hooks.example/x' });
    expect(list[0]).toMatchObject({ label: 'PHP-FPM workers per site', from: '5', to: '8' });
    expect(list[1]).toMatchObject({ secret: true });
    expect(note).toContain("each site's next deploy");
    expect(note).toContain('immediately');
  });

  it('nothing to show when nothing changed', () => {
    const { container } = render(<ChangeSummary changes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
