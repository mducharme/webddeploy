// JSON files: vanilla-jsoneditor's text view — syntax colors, folding,
// inline errors, Format / Compact / Repair, search. Text only (no tree or
// table view): what's saved is exactly what was typed. Loaded only when a
// JSON file is opened (React.lazy).
import 'vanilla-jsoneditor/themes/jse-theme-dark.css';
import { createJSONEditor, type Content, type JsonEditor as Editor, type MenuItem } from 'vanilla-jsoneditor';
import { useEffect, useRef } from 'react';

/** The editor's content as text (in text mode it always is; json only if a mode switch slipped through). */
export function contentToText(content: Content): string {
  if ('text' in content && typeof content.text === 'string') return content.text;
  return `${JSON.stringify((content as { json: unknown }).json, null, 2)}\n`;
}

/** The menu without the text / tree / table switch (and the separator it leaves). */
export function withoutModeSwitch(items: MenuItem[]): MenuItem[] {
  const kept = items.filter((i) => !('className' in i && typeof i.className === 'string' && i.className.includes('jse-group-button')));
  while (kept[0]?.type === 'separator') kept.shift();
  return kept;
}

export default function JsonEditor({ value, onChange }: { value: string; onChange: (text: string) => void }) {
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
        mode: 'text' as never,
        mainMenuBar: true,
        onRenderMenu: withoutModeSwitch,
        onChange: (content: Content) => {
          const text = contentToText(content);
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
