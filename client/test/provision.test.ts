import type { InspectRepoResponse } from '@webddeploy/shared';
import { describe, expect, it } from 'vitest';
import { emptyForm, toRequest, validate, type ProvisionForm } from '../src/pages/Provision.tsx';

const form = (o: Partial<ProvisionForm>): ProvisionForm => ({ ...emptyForm, name: 'client', repo_url: 'git@github.com:org/client.git', ...o });
const inspect = (o: Partial<InspectRepoResponse> = {}): InspectRepoResponse => ({
  api_version: 1,
  url: 'git@github.com:org/client.git',
  reachable: true,
  default_branch: 'main',
  branches: ['main'],
  branch: 'main',
  detected: { ddev: { name: 'client', php_version: '8.3', docroot: 'web', nodejs_version: null }, ddeploy_config: false, cms: null, cms_docroot: null, package_json: false, nvmrc: null, composer_json: true },
  requires: { php: false },
  ...o,
});

describe('provision form', () => {
  it('turns lists and tri-states into a request', () => {
    expect(toRequest(form({ hostnames: 'a, b  c', auth: 'off', build: 'on' }))).toMatchObject({
      hostnames: ['a', 'b', 'c'],
      auth: false,
      build: true,
      php: null,
    });
  });

  it('is valid when the name matches .ddev', () => {
    expect(validate(form({}), inspect(), [])).toEqual({});
  });

  it("refuses a name that doesn't match the repository's .ddev name (ddeploy would fail)", () => {
    expect(validate(form({ name: 'other' }), inspect(), []).name).toContain("named 'client'");
  });

  it('refuses a name that already exists', () => {
    expect(validate(form({}), inspect(), ['client']).name).toContain('already exists');
  });

  it('requires PHP when the repository has no .ddev config', () => {
    const r = inspect({ detected: { ...inspect().detected!, ddev: null }, requires: { php: true } });
    expect(validate(form({}), r, []).php).toBeTruthy();
    expect(validate(form({ php: '8.3' }), r, [])).toEqual({});
  });

  it('reports invalid fields', () => {
    const errors = validate(form({ name: 'Bad Name', hostnames: 'bad;host' }), null, []);
    expect(Object.keys(errors).sort()).toEqual(['hostnames', 'name']);
  });
});
