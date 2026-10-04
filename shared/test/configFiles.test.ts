import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configFileResponse, configFilesResponse, patterns } from '../src/index.ts';

const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));

describe('config files', () => {
  it('real ddeploy output parses', () => {
    const list = configFilesResponse.parse(fixture('config-files'));
    expect(list.files.map((f) => f.path)).toEqual(['config/app.json', 'wp-config.php']);
    const file = configFileResponse.parse(fixture('config-file'));
    expect(file.content.endsWith('\n')).toBe(true);
    expect(file.content.length).toBe(file.size);
    expect(file.versions.length).toBeGreaterThan(0);
  });

  it.each(['config/config.local.json', 'wp-config.php', '.env.local', 'app/etc/env.php'])('path %s accepted', (p) => expect(patterns.configFile.test(p)).toBe(true));
  it.each(['/etc/passwd', '../x', 'config/../../etc', 'a b', 'x;y', ''])('path %j refused', (p) => expect(patterns.configFile.test(p)).toBe(false));
});
