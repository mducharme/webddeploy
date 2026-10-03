// Builds an uncompressed tar from files picked or dropped in the browser,
// so a whole folder goes up as one request (and through ddeploy's archive
// checks) instead of thousands.
//
// The result is a Blob whose parts are the original File objects between
// small headers: the browser reads each file from disk while sending, so
// a 10 GB folder never sits in memory. POSIX ustar headers, with a PAX
// extended header in front of any entry whose name doesn't fit ustar
// (longer than 100 bytes, or not ASCII) or whose size is 8 GB or more.

export interface TarEntry {
  /** Relative path inside the archive, '/'-separated. */
  path: string;
  file: Blob;
  /** Seconds since the epoch. */
  mtime?: number;
}

const BLOCK = 512;
const encoder = new TextEncoder();

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name: string, size: number, mtime: number, type: '0' | 'x'): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(BLOCK);
  const put = (s: string, at: number, len: number) => h.set(encoder.encode(s).subarray(0, len), at);
  put(name, 0, 100);
  put(octal(0o644, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(size < 8 ** 11 ? octal(size, 12) : octal(0, 12), 124, 12);
  put(octal(Math.max(0, Math.floor(mtime)), 12), 136, 12);
  put('        ', 148, 8);
  put(type, 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

function padding(size: number): Uint8Array<ArrayBuffer> {
  const rem = size % BLOCK;
  return new Uint8Array(rem === 0 ? 0 : BLOCK - rem);
}

/** One PAX record: "<len> <key>=<value>\n", where len counts the whole record. */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = encoder.encode(body).length + 1;
  while (String(len).length + encoder.encode(body).length !== len) len++;
  return `${len}${body}`;
}

function asciiName(path: string): string {
  // What ustar's own name field holds when PAX carries the real one.
  return path.replace(/[^\x20-\x7e]/g, '_').slice(-100);
}

/** Normalizes a picked/dropped path; null for one that can't be archived safely. */
export function cleanPath(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (parts.length === 0 || parts.some((p) => p === '..' || /[\0-\x1f]/.test(p))) return null;
  return parts.join('/');
}

export function buildTar(entries: readonly TarEntry[]): Blob {
  const parts: BlobPart[] = [];
  for (const e of entries) {
    const path = cleanPath(e.path);
    if (!path) continue;
    const size = e.file.size;
    const mtime = e.mtime ?? Date.now() / 1000;
    const bytes = encoder.encode(path);
    const needsPax = bytes.length > 100 || /[^\x20-\x7e]/.test(path) || size >= 8 ** 11;
    if (needsPax) {
      let records = paxRecord('path', path);
      if (size >= 8 ** 11) records += paxRecord('size', String(size));
      const data = encoder.encode(records) as Uint8Array<ArrayBuffer>;
      parts.push(header(`PaxHeader/${asciiName(path).slice(-90)}`, data.length, mtime, 'x'), data, padding(data.length));
    }
    parts.push(header(needsPax ? asciiName(path) : path, size, mtime, '0'), e.file, padding(size));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  return new Blob(parts, { type: 'application/x-tar' });
}
