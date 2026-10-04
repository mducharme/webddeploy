import { ArrowDownToLine, CircleAlert } from 'lucide-react';
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

/**
 * A terminal-style output pane. Sticks to the bottom while new text
 * arrives, unless the reader has scrolled up to look at something.
 * Error lines are highlighted, with a jump to the first one; warnings are
 * amber; [info] and [ok] tags are colored.
 */
export function LogView({ text, placeholder = 'No output yet.', className }: { text: string; placeholder?: string; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const firstError = useRef<HTMLSpanElement | null>(null);
  const [stick, setStick] = useState(true);
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

  return (
    <div className="relative">
      <pre
        ref={ref}
        data-testid="log-view"
        onScroll={(e) => {
          const el = e.currentTarget;
          setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        className={cx(
          'h-[60vh] min-h-64 overflow-auto whitespace-pre-wrap break-words bg-stone-950 p-4 font-mono text-xs leading-relaxed text-stone-200',
          className,
        )}
      >
        {text ? nodes : <span className="text-stone-500">{placeholder}</span>}
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
