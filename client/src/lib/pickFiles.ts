// Turns what was dropped or picked into either one archive file (sent as
// is) or a list of files with their relative paths (packed into a tar).
import { cleanPath, type TarEntry } from './tar.ts';

export const ARCHIVE_RE = /\.(zip|tar|tgz|tar\.gz)$/i;
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export type Picked = { kind: 'archive'; file: File } | { kind: 'files'; entries: TarEntry[]; topFolder: string | null };

const isJunk = (path: string) => path.split('/').some((p) => JUNK.has(p) || p === '__MACOSX');

/** A single archive stays an archive; anything else becomes a file list. */
export function fromFiles(files: ReadonlyArray<File & { webkitRelativePath?: string }>): Picked | null {
  if (files.length === 1 && ARCHIVE_RE.test(files[0]!.name) && !files[0]!.webkitRelativePath) return { kind: 'archive', file: files[0]! };
  const entries: TarEntry[] = [];
  for (const f of files) {
    const path = cleanPath(f.webkitRelativePath || f.name);
    if (path && !isJunk(path)) entries.push({ path, file: f, mtime: f.lastModified / 1000 });
  }
  return entries.length ? { kind: 'files', entries, topFolder: commonTop(entries) } : null;
}

/** The one folder every entry is inside, if there is one. */
export function commonTop(entries: readonly TarEntry[]): string | null {
  let top: string | null = null;
  for (const e of entries) {
    const i = e.path.indexOf('/');
    if (i < 0) return null;
    const t = e.path.slice(0, i);
    if (top === null) top = t;
    else if (t !== top) return null;
  }
  return top;
}

/** Drops the shared top folder: "uploads/2024/a.jpg" -> "2024/a.jpg". */
export function withoutTop(entries: readonly TarEntry[], top: string): TarEntry[] {
  return entries.map((e) => ({ ...e, path: e.path.slice(top.length + 1) }));
}

// --- drag and drop (folders need the entries API) -------------------------

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (es: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

async function walk(entry: FsEntry, out: TarEntry[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((ok, err) => entry.file!(ok, err));
    const path = cleanPath(entry.fullPath);
    if (path && !isJunk(path)) out.push({ path, file, mtime: file.lastModified / 1000 });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries returns batches (about 100 in Chrome) until an empty one.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
      if (!batch.length) break;
      for (const child of batch) await walk(child, out);
    }
  }
}

export async function fromDrop(dt: DataTransfer): Promise<Picked | null> {
  const items = [...dt.items].filter((i) => i.kind === 'file');
  const roots = items
    .map((i) => (i.webkitGetAsEntry?.() ?? null) as unknown as FsEntry | null)
    .filter((e): e is FsEntry => e !== null);
  if (!roots.length) return fromFiles([...dt.files]);
  if (roots.length === 1 && roots[0]!.isFile && ARCHIVE_RE.test(roots[0]!.fullPath)) {
    return fromFiles([...dt.files]);
  }
  const entries: TarEntry[] = [];
  for (const root of roots) await walk(root, entries);
  return entries.length ? { kind: 'files', entries, topFolder: commonTop(entries) } : null;
}
