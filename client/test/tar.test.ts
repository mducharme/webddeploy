// @vitest-environment node
// The tar the browser builds must be readable by real tar implementations:
// checked with the system's tar and Python's tarfile (what ddeploy's
// extractor uses).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commonTop, fromFiles, withoutTop } from '../src/lib/pickFiles.ts';
import { buildTar, cleanPath } from '../src/lib/tar.ts';

async function writeTar(entries: Parameters<typeof buildTar>[0]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tar-'));
  const path = join(dir, 'out.tar');
  writeFileSync(path, Buffer.from(await buildTar(entries).arrayBuffer()));
  return path;
}

const pyList = (path: string): Array<[string, number, string]> =>
  JSON.parse(
    execFileSync('python3', ['-c', 'import tarfile,json,sys; t=tarfile.open(sys.argv[1]); print(json.dumps([[m.name, m.size, t.extractfile(m).read().decode("utf-8","replace")] for m in t if m.isfile()]))', path]).toString(),
  );

describe('buildTar', () => {
  const long = `${'deep/'.repeat(30)}file.txt`;
  const unicode = 'photos/été à Montréal — ✓.jpg';
  const entries = [
    { path: 'a.txt', file: new Blob(['hello']) },
    { path: 'sub/dir/b.bin', file: new Blob([new Uint8Array(1000).fill(7)]) },
    { path: long, file: new Blob(['long name']) },
    { path: unicode, file: new Blob(['unicode name']) },
    { path: 'empty.txt', file: new Blob([]) },
  ];

  it('is read correctly by Python tarfile, long and unicode names included', async () => {
    const list = pyList(await writeTar(entries));
    expect(list.map(([n]) => n)).toEqual(['a.txt', 'sub/dir/b.bin', long, unicode, 'empty.txt']);
    expect(list[0]).toEqual(['a.txt', 5, 'hello']);
    expect(list[1]![1]).toBe(1000);
    expect(list[2]![2]).toBe('long name');
    expect(list[3]![2]).toBe('unicode name');
  });

  it('is read by the system tar', async () => {
    const out = execFileSync('tar', ['-tf', await writeTar(entries)]).toString().trim().split('\n');
    expect(out).toContain('a.txt');
    expect(out).toContain(long);
  });

  it('pads every member to 512 bytes and ends with two empty blocks', async () => {
    const bytes = readFileSync(await writeTar([{ path: 'x', file: new Blob(['abc']) }]));
    expect(bytes.length).toBe(512 + 512 + 1024);
    expect(bytes.subarray(1024).every((b) => b === 0)).toBe(true);
  });

  it('never writes unsafe paths', async () => {
    const list = pyList(await writeTar([
      { path: '../escape.txt', file: new Blob(['x']) },
      { path: '/abs.txt', file: new Blob(['y']) },
      { path: './ok/./x.txt', file: new Blob(['z']) },
    ]));
    expect(list.map(([n]) => n)).toEqual(['abs.txt', 'ok/x.txt']);
  });
});

describe('cleanPath', () => {
  it.each([
    ['a/b.txt', 'a/b.txt'],
    ['a\\b.txt', 'a/b.txt'],
    ['/x/y', 'x/y'],
    ['a/../b', null],
    ['', null],
    ['bad\nname', null],
  ])('%j -> %j', (input, expected) => expect(cleanPath(input)).toBe(expected));
});

describe('picked files', () => {
  const file = (name: string, rel = '') => Object.assign(new File(['x'], name), { webkitRelativePath: rel });

  it('a single archive is sent as is', () => {
    expect(fromFiles([file('site-uploads.tar.gz')])).toMatchObject({ kind: 'archive' });
    expect(fromFiles([file('export.ZIP')])).toMatchObject({ kind: 'archive' });
  });

  it('a picked folder becomes a file list, junk dropped, with its top folder', () => {
    const p = fromFiles([file('a.jpg', 'uploads/a.jpg'), file('b.jpg', 'uploads/2024/b.jpg'), file('.DS_Store', 'uploads/.DS_Store')]);
    expect(p).toMatchObject({ kind: 'files', topFolder: 'uploads' });
    if (p?.kind !== 'files') throw new Error('expected files');
    expect(p.entries.map((e) => e.path)).toEqual(['uploads/a.jpg', 'uploads/2024/b.jpg']);
    expect(withoutTop(p.entries, 'uploads').map((e) => e.path)).toEqual(['a.jpg', '2024/b.jpg']);
  });

  it('loose files have no top folder', () => {
    expect(commonTop([{ path: 'a.jpg', file: new Blob() }, { path: 'x/b.jpg', file: new Blob() }])).toBeNull();
  });

  it('an archive inside a folder is just a file', () => {
    expect(fromFiles([file('old.zip', 'uploads/old.zip')])).toMatchObject({ kind: 'files' });
  });
});

describe('dropped folders', () => {
  // A minimal stand-in for the browser's FileSystemEntry tree, with
  // readEntries returning batches like Chrome does.
  type FakeEntry = { isFile: boolean; isDirectory: boolean; fullPath: string; file?: (ok: (f: File) => void) => void; createReader?: () => { readEntries: (ok: (e: FakeEntry[]) => void) => void } };
  const fileEntry = (fullPath: string): FakeEntry => ({ isFile: true, isDirectory: false, fullPath, file: (ok) => ok(new File(['x'], fullPath.split('/').pop()!)) });
  const dirEntry = (fullPath: string, children: FakeEntry[], batch = 2): FakeEntry => ({
    isFile: false,
    isDirectory: true,
    fullPath,
    createReader: () => {
      let i = 0;
      return { readEntries: (ok) => { ok(children.slice(i, i + batch)); i += batch; } };
    },
  });

  it('walks nested folders, across readEntries batches, skipping junk', async () => {
    const { fromDrop } = await import('../src/lib/pickFiles.ts');
    const root = dirEntry('/uploads', [
      fileEntry('/uploads/a.jpg'),
      fileEntry('/uploads/.DS_Store'),
      dirEntry('/uploads/2024', [fileEntry('/uploads/2024/b.jpg'), fileEntry('/uploads/2024/c.jpg'), fileEntry('/uploads/2024/d.jpg')]),
    ]);
    const dt = { items: [{ kind: 'file', webkitGetAsEntry: () => root }], files: [] } as unknown as DataTransfer;
    const picked = await fromDrop(dt);
    expect(picked).toMatchObject({ kind: 'files', topFolder: 'uploads' });
    if (picked?.kind !== 'files') throw new Error('expected files');
    expect(picked.entries.map((e) => e.path).sort()).toEqual(['uploads/2024/b.jpg', 'uploads/2024/c.jpg', 'uploads/2024/d.jpg', 'uploads/a.jpg']);
  });
});
