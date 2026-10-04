import { describe, expect, it } from 'vitest';
import { formatJson, localCheck } from '../src/pages/ConfigFiles.tsx';

describe('config file editor', () => {
  it('checks JSON in the browser', () => {
    expect(localCheck('{"a": 1}', 'json')).toBeNull();
    expect(localCheck('{"a": }', 'json')).toMatch(/^invalid JSON/);
  });
  it('leaves other formats to ddeploy', () => expect(localCheck('<?php oops', 'php')).toBeNull());
  it('formats JSON, keeping the file’s indentation', () => {
    expect(formatJson('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n');
    expect(formatJson('{\n    "a":1}')).toBe('{\n    "a": 1\n}\n');
  });
});
