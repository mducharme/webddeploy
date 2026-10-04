import type { MenuItem } from 'vanilla-jsoneditor';
import { describe, expect, it } from 'vitest';
import { contentToText, withoutModeSwitch } from '../src/components/editors/JsonEditor.tsx';

describe('JSON editor (text only)', () => {
  it('drops the text / tree / table switch and the separator after it', () => {
    const items = [
      { type: 'button', text: 'text', className: 'jse-group-button jse-first', onClick: () => {} },
      { type: 'button', text: 'tree', className: 'jse-group-button', onClick: () => {} },
      { type: 'button', text: 'table', className: 'jse-group-button jse-last', onClick: () => {} },
      { type: 'separator' },
      { type: 'button', text: '', title: 'Format', className: 'jse-format', onClick: () => {} },
    ] as unknown as MenuItem[];
    expect(withoutModeSwitch(items).map((i) => ('title' in i ? i.title : i.type))).toEqual(['Format']);
  });

  it('text content comes back exactly as typed', () => {
    expect(contentToText({ text: '{ "a":1 }' })).toBe('{ "a":1 }');
  });
});
