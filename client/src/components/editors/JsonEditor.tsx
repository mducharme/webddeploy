// JSON files: a tree view (edit values, add, remove and move keys without
// thinking about commas) and a colored text view, from vanilla-jsoneditor.
// Loaded only when a JSON file is opened (React.lazy).
import 'vanilla-jsoneditor/themes/jse-theme-dark.css';
import { createJSONEditor, type Content, type JsonEditor as Editor } from 'vanilla-jsoneditor';
import { useEffect, useRef } from 'react';

/** The editor's content as text, indented like the file it came from. */
export function contentToText(content: Content, indent: number): string {
  if ('text' in content && typeof content.text === 'string') return content.text;
  return `${JSON.stringify((content as { json: unknown }).json, null, indent)}\n`;
}

export default function JsonEditor({ value, onChange, indent }: { value: string; onChange: (text: string) => void; indent: number }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  // What the editor last told us: an outside change (Discard, Reload) is anything else.
  const emitted = useRef(value);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    editor.current = createJSONEditor({
      target: host.current!,
      props: {
        content: { text: value },
        mode: 'tree' as never,
        mainMenuBar: true,
        navigationBar: true,
        onChange: (content: Content) => {
          const text = contentToText(content, indent);
          emitted.current = text;
          latest.current(text);
        },
      },
    });
    return () => {
      void editor.current?.destroy();
      editor.current = null;
    };
    // Created once per file; later values are pushed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editor.current && value !== emitted.current) {
      emitted.current = value;
      void editor.current.update({ text: value });
    }
  }, [value]);

  return (
    <div
      ref={host}
      className="jse-theme-dark h-[28rem] overflow-hidden rounded-md"
      // The menu bar in the app's teal; on the element, so the theme's stylesheet (loaded later) can't override it.
      style={{ '--jse-theme-color': '#0f766e', '--jse-theme-color-highlight': '#115e59' } as React.CSSProperties}
      data-testid="json-editor"
    />
  );
}
