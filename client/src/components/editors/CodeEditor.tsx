// Other config files (PHP, YAML, env, ini, text): CodeMirror with syntax
// colors, line numbers, bracket matching and folding. Loaded only when such
// a file is opened (React.lazy).
import { php } from '@codemirror/lang-php';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup, EditorView } from 'codemirror';
import { useEffect, useRef } from 'react';

export type CodeFormat = 'yaml' | 'php' | 'env' | 'ini' | 'text';

const languageFor = (format: CodeFormat) => {
  switch (format) {
    case 'php':
      return [php()];
    case 'yaml':
      return [yaml()];
    case 'env':
    case 'ini':
      return [StreamLanguage.define(properties)];
    default:
      return [];
  }
};

export default function CodeEditor({ value, onChange, format, label }: { value: string; onChange: (text: string) => void; format: CodeFormat; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      doc: value,
      extensions: [
        basicSetup,
        oneDark,
        ...languageFor(format),
        EditorView.contentAttributes.of({ 'aria-label': label }),
        EditorView.theme({ '&': { height: '28rem', fontSize: '12px' }, '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) latest.current(u.state.doc.toString());
        }),
      ],
    });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);

  // Outside changes (Discard, Reload, Restore) replace the document.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="overflow-hidden rounded-md border border-stone-700" data-testid="code-editor" />;
}
