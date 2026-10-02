import type { Run } from '@webddeploy/shared';
import { useEffect, useRef, useState } from 'react';

/** Strips ANSI escape sequences (a build tool that colors even when piped). */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '');
}

/** Output beyond this many characters is trimmed from the top. */
const MAX_TEXT = 2_000_000;

export interface StreamState {
  text: string;
  run: Run | null;
  ended: boolean;
  error: string | null;
  connected: boolean;
}

/**
 * Follows one of the server's SSE endpoints (run output or a log): `chunk`
 * events append text, `run` events carry a run's state, `end` closes. If
 * the connection drops it reconnects from the last byte offset received,
 * so nothing is shown twice.
 */
export function useOutputStream(url: string | null, opts: { resumable?: boolean } = {}): StreamState {
  const [state, setState] = useState<StreamState>({ text: '', run: null, ended: false, error: null, connected: false });
  const offset = useRef(0);

  useEffect(() => {
    setState({ text: '', run: null, ended: false, error: null, connected: false });
    offset.current = 0;
    if (!url) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    const connect = () => {
      const u = opts.resumable && offset.current > 0 ? `${url}${url.includes('?') ? '&' : '?'}offset=${offset.current}` : url;
      es = new EventSource(u);
      es.onopen = () => setState((s) => ({ ...s, connected: true, error: null }));
      es.addEventListener('chunk', (e) => {
        const d = JSON.parse((e as MessageEvent<string>).data) as { text: string; next_offset: number; rotated: boolean };
        offset.current = d.next_offset;
        setState((s) => {
          let text = (d.rotated ? '' : s.text) + stripAnsi(d.text);
          if (text.length > MAX_TEXT) text = text.slice(text.length - MAX_TEXT);
          return { ...s, text };
        });
      });
      es.addEventListener('run', (e) => {
        const run = JSON.parse((e as MessageEvent<string>).data) as Run;
        setState((s) => ({ ...s, run }));
      });
      es.addEventListener('end', () => {
        done = true;
        es?.close();
        setState((s) => ({ ...s, ended: true, connected: false }));
      });
      es.onerror = (e) => {
        const msg = (e as MessageEvent<string>).data;
        es?.close();
        setState((s) => ({ ...s, connected: false, error: msg ? (JSON.parse(msg) as { message: string }).message : null }));
        // A plain log stream restarting from its tail would duplicate text.
        if (!done && opts.resumable) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      done = true;
      clearTimeout(retry);
      es?.close();
    };
  }, [url, opts.resumable]);

  return state;
}
