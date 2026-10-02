#!/usr/bin/env node
// Stands in for `provision.sh` in connector tests: `fake-ddeploy.mjs api
// <verb> ...` prints the matching real fixture from shared/test/fixtures.
// FAKE_DDEPLOY_MODE switches to failure modes.
import { readFileSync } from 'node:fs';

const [, , api, verb, ...rest] = process.argv;
const fixture = (n) => readFileSync(new URL(`../../shared/test/fixtures/${n}.json`, import.meta.url), 'utf8');
const mode = process.env.FAKE_DDEPLOY_MODE ?? '';

if (api !== 'api') { process.stderr.write('expected api\n'); process.exit(2); }
if (mode === 'garbage') { process.stdout.write('not json at all\n'); process.stderr.write('[error] something exploded\n'); process.exit(1); }
if (mode === 'hang') { setTimeout(() => {}, 60_000); }
else if (mode === 'echo') { process.stdout.write(JSON.stringify({ api_version: 1, argv: process.argv.slice(2) }) + '\n'); }
else if (verb === 'site' && rest[0] === 'nope') { process.stdout.write(fixture('error-not-found')); process.exit(1); }
else if (verb === 'run' && rest[0] === 'start') { process.stdout.write('{"api_version":1,"run_id":"20261002T130000Z-aaaaaa"}\n'); }
else {
  const map = { info: 'info', sites: 'sites', site: 'site', events: 'events', previews: 'previews', doctor: 'doctor', logs: rest.length ? 'log-testsite' : 'logs', 'inspect-repo': 'inspect' };
  const name = map[verb];
  if (!name) { process.stdout.write(JSON.stringify({ api_version: 1, error: { code: 'unknown_verb', message: `unknown api verb '${verb}'` } }) + '\n'); process.exit(1); }
  process.stdout.write(JSON.stringify(JSON.parse(fixture(name))) + '\n');
}
