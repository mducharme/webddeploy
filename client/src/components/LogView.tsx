import { ArrowDownToLine, CircleAlert, Clock, Download, Pause, Play, Search, WrapText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui.tsx';

export type Segment =
  | { kind: 'text' | 'error' | 'warn'; text: string }
  /** A line whose [tag] alone is colored: the text before it, the tag, the rest. */
  | { kind: 'info' | 'ok'; text: string; tagStart: number; tagEnd: number };

// "[tag]" at the start of a line, or after a timestamp (ddeploy's
// "2026-10-03T14:06:34Z [info]", nginx's "2026/10/03 15:59:24 [error]").
const TAG = /^(\s*(?:\S+ +){0,2}?)\[(error|err|crit|alert|emerg|fail|failed|warn|warning|info|notice|ok|pass)\]/i;
const KIND: Record<string, Segment['kind']> = {
  error: 'error', err: 'error', crit: 'error', alert: 'error', emerg: 'error', fail: 'error', failed: 'error',
  warn: 'warn', warning: 'warn',
  info: 'info', notice: 'info',
  ok: 'ok', pass: 'ok',
};
/** Past this many highlighted lines, [info]/[ok] stay plain: a huge build log stays fast. */
const MAX_TAGGED = 4000;

/**
 * Splits output into runs of plain lines and single highlighted lines, so
 * highlighting costs a node per highlighted line, not one per line.
 */
export function segment(text: string): Segment[] {
  const out: Segment[] = [];
  let plain = '';
  let tagged = 0;
  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain });
    plain = '';
  };
  for (const line of text.split(/(?<=\n)/)) {
    const m = TAG.exec(line);
    const kind = m ? KIND[m[2]!.toLowerCase()]! : 'text';
    if (kind === 'text' || ((kind === 'info' || kind === 'ok') && tagged >= MAX_TAGGED)) {
      plain += line;
      continue;
    }
    flush();
    if (kind === 'info' || kind === 'ok') {
      tagged++;
      const tagStart = m![1]!.length;
      out.push({ kind, text: line, tagStart, tagEnd: tagStart + m![2]!.length + 2 });
    } else {
      out.push({ kind, text: line });
    }
  }
  flush();
  return out;
}

/** Only the lines containing `query` (case-insensitive), and how many there were. */
export function filterLines(text: string, query: string): { text: string; shown: number; total: number } {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (!query.trim()) return { text, shown: lines.length, total: lines.length };
  const q = query.toLowerCase();
  const kept = lines.filter((l) => l.toLowerCase().includes(q));
  return { text: kept.length ? `${kept.join('\n')}\n` : '', shown: kept.length, total: lines.length };
}

/** ddeploy's UTC line timestamps ("2026-10-04T03:38:19Z") in the browser's time zone. */
export function localizeTimestamps(text: string): string {
  return text.replace(/^(\s*)(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/gm, (_, sp: string, iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return sp + iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${sp}${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  });
}

/**
 * A terminal-style output pane. Sticks to the bottom while new text
 * arrives, unless the reader has scrolled up to look at something.
 * Error lines are highlighted, with a jump to the first one; warnings are
 * amber; [info] and [ok] tags are colored.
 */
export function LogView({
  text: raw,
  placeholder = 'No output yet.',
  className,
  filename = 'output.log',
}: {
  text: string;
  placeholder?: string;
  className?: string;
  /** For the download button. */
  filename?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const firstError = useRef<HTMLSpanElement | null>(null);
  const [stick, setStick] = useState(true);
  const [query, setQuery] = useState('');
  const [wrap, setWrap] = useState(true);
  const [localTime, setLocalTime] = useState(false);
  const hasUtc = useMemo(() => /^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/m.test(raw.slice(0, 4000)), [raw]);
  const filtered = useMemo(() => filterLines(localTime ? localizeTimestamps(raw) : raw, query), [raw, query, localTime]);
  const text = filtered.text;
  const segments = useMemo(() => segment(text), [text]);
  const errors = segments.filter((s) => s.kind === 'error').length;

  useEffect(() => {
    const el = ref.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [text, stick]);

  let seenError = false;
  const nodes: ReactNode[] = segments.map((s, i) => {
    if (s.kind === 'text') return s.text;
    if (s.kind === 'info' || s.kind === 'ok') {
      return (
        <span key={i}>
          {s.text.slice(0, s.tagStart)}
          <span className={s.kind === 'ok' ? 'text-emerald-400' : 'text-sky-400'}>{s.text.slice(s.tagStart, s.tagEnd)}</span>
          {s.text.slice(s.tagEnd)}
        </span>
      );
    }
    const isFirst = s.kind === 'error' && !seenError;
    if (s.kind === 'error') seenError = true;
    return (
      <span
        key={i}
        ref={isFirst ? firstError : undefined}
        data-testid={s.kind === 'error' ? 'log-error' : 'log-warn'}
        className={s.kind === 'error' ? 'block bg-red-950/70 text-red-200' : 'block text-amber-300'}
      >
        {s.text}
      </span>
    );
  });

  const download = () => {
    const url = URL.createObjectURL(new Blob([raw], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const toggle = 'rounded px-2 py-1 text-xs hover:bg-stone-800';

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-800 bg-stone-900 px-3 py-1.5 text-stone-300" data-testid="log-toolbar">
        <span className="relative">
          <Search className="pointer-events-none absolute top-1.5 left-2 size-3.5 text-stone-500" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter lines"
            aria-label="Filter lines"
            className="w-48 rounded bg-stone-800 py-1 pr-2 pl-7 text-xs text-stone-100 placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-teal-600"
          />
        </span>
        {query.trim() && <span className="text-xs text-stone-400">{filtered.shown} of {filtered.total} lines</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {hasUtc && (
            <button type="button" aria-pressed={localTime} onClick={() => setLocalTime((v) => !v)} className={cx(toggle, localTime && 'bg-stone-800 text-teal-300')} title="ddeploy writes UTC; show your time zone instead">
              <Clock className="mr-1 inline size-3.5" aria-hidden />{localTime ? 'Local time' : 'UTC'}
            </button>
          )}
          <button type="button" aria-pressed={wrap} onClick={() => setWrap((v) => !v)} className={cx(toggle, wrap && 'bg-stone-800 text-teal-300')}>
            <WrapText className="mr-1 inline size-3.5" aria-hidden />Wrap
          </button>
          <button type="button" onClick={() => setStick((v) => !v)} className={toggle} title={stick ? 'Stop scrolling to new lines' : 'Scroll to new lines as they arrive'}>
            {stick ? <><Pause className="mr-1 inline size-3.5" aria-hidden />Pause</> : <><Play className="mr-1 inline size-3.5" aria-hidden />Follow</>}
          </button>
          <button type="button" onClick={download} disabled={!raw} className={cx(toggle, 'disabled:opacity-40')} title={`Download as ${filename}`}>
            <Download className="mr-1 inline size-3.5" aria-hidden />Download
          </button>
        </span>
      </div>
      <pre
        ref={ref}
        data-testid="log-view"
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        className={cx(
          'h-[60vh] min-h-64 overflow-auto bg-stone-950 p-4 font-mono text-xs leading-relaxed text-stone-200',
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
          className,
        )}
      >
        {text ? nodes : <span className="text-stone-500">{raw && query.trim() ? `No line contains “${query.trim()}”.` : placeholder}</span>}
      </pre>
      <div className="absolute bottom-3 right-5 flex gap-2">
        {errors > 0 && (
          <button
            type="button"
            onClick={() => {
              setStick(false);
              firstError.current?.scrollIntoView({ block: 'center' });
            }}
            className="inline-flex items-center gap-1 rounded-md bg-red-800 px-2 py-1 text-xs text-white shadow hover:bg-red-700"
          >
            <CircleAlert className="size-3.5" aria-hidden /> First error{errors > 1 ? ` (of ${errors})` : ''}
          </button>
        )}
        {!stick && (
          <button
            type="button"
            onClick={() => setStick(true)}
            className="inline-flex items-center gap-1 rounded-md bg-stone-800 px-2 py-1 text-xs text-stone-100 shadow hover:bg-stone-700"
          >
            <ArrowDownToLine className="size-3.5" aria-hidden /> Follow
          </button>
        )}
      </div>
    </div>
  );
}
