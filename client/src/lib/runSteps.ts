// A run's output split on ddeploy's step markers ("==> [composer] Composer: install",
// possibly after a timestamp and [info]), so each step's own output can be shown.

const MARKER = /^(?:\S+ +)?(?:\[info\] +)?==> \[([a-z0-9-]+)\] (.*)$/;

export interface Section {
  /** "" for whatever came before the first step. */
  id: string;
  label: string;
  text: string;
}

export function splitBySteps(text: string): Section[] {
  const out: Section[] = [{ id: '', label: 'Before the first step', text: '' }];
  for (const line of text.split(/(?<=\n)/)) {
    const m = MARKER.exec(line.replace(/\n$/, ''));
    if (m) out.push({ id: m[1]!, label: m[2]!, text: line });
    else out[out.length - 1]!.text += line;
  }
  return out.filter((s) => s.id || s.text.trim());
}

/** The section of the step with this label (the last one, if a label repeats). */
export function sectionFor(sections: readonly Section[], label: string | null | undefined): Section | undefined {
  if (!label) return undefined;
  return [...sections].reverse().find((s) => s.label === label);
}

/** The last `n` meaningful lines of a section: where the real error almost always is. */
export function tail(text: string, n = 20): string {
  return text
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim() && !MARKER.test(l))
    .slice(-n)
    .join('\n');
}
