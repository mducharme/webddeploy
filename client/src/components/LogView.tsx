import { ArrowDownToLine, CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './ui.tsx';

export type Segment = { kind: 'text' | 'error' | 'warn'; text: string };

/**
 * Splits output into runs of plain lines and single [error]/[warn] lines,
 * so highlighting costs a few nodes, not one per line of a long build.
 */
export function segment(text: string): Segment[] {
  const out: Segment[] = [];
  let plain = '';
  for (const line of text.split(/(?<=\n)/)) {
    const kind = /^\[error\]/.test(line) ? 'error' : /^\[warn\]/.test(line) ? 'warn' : 'text';
    if (kind === 'text') {
      plain += line;
      continue;
    }
    if (plain) out.push({ kind: 'text', text: plain });
    plain = '';
    out.push({ kind, text: line });
  }
  if (plain) out.push({ kind: 'text', text: plain });
  return out;
}

/**
 * A terminal-style output pane. Sticks to the bottom while new text
 * arrives, unless the reader has scrolled up to look at something.
 * [error] and [warn] lines are highlighted, with a jump to the first error.
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
