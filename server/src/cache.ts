// A small stale-while-revalidate cache for slow ddeploy reads (`sites`
// and `doctor` spawn dozens of yq processes per site): a fresh value is
// served as is, a stale one is served immediately while one refresh runs
// in the background, and concurrent misses share one load.
interface Entry<T> {
  value?: T;
  at: number;
  inflight?: Promise<T>;
}

export class SwrCache {
  private entries = new Map<string, Entry<unknown>>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>, opts: { fresh?: boolean } = {}): Promise<T> {
    const e = this.entries.get(key) as Entry<T> | undefined;
    const age = e && e.value !== undefined ? this.now() - e.at : Infinity;
    if (!opts.fresh && e?.value !== undefined && age <= ttlMs) return e.value;
    if (!opts.fresh && e?.value !== undefined) {
      void this.refresh(key, load).catch(() => {});
      return e.value;
    }
    return this.refresh(key, load);
  }

  private refresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    const e = (this.entries.get(key) as Entry<T> | undefined) ?? { at: 0 };
    if (e.inflight) return e.inflight;
    const p = load().then(
      (value) => {
        this.entries.set(key, { value, at: this.now() });
        return value;
      },
      (err: unknown) => {
        const cur = this.entries.get(key);
        if (cur) delete cur.inflight;
        throw err;
      },
    );
    e.inflight = p;
    this.entries.set(key, e);
    return p;
  }

  /** Drops every key starting with prefix. */
  invalidate(prefix: string): void {
    for (const k of this.entries.keys()) if (k.startsWith(prefix)) this.entries.delete(k);
  }
}

/**
 * Coalesces identical polls: several browser tabs following the same log
 * or run ask ddeploy once per window, not once each. Exact reads only —
 * keys include the offset, so nobody gets bytes they didn't ask for.
 */
export class PollCoalescer {
  private entries = new Map<string, { at: number; value: Promise<unknown> }>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get<T>(key: string, windowMs: number, load: () => Promise<T>): Promise<T> {
    const t = this.now();
    const e = this.entries.get(key);
    if (e && t - e.at < windowMs) return e.value as Promise<T>;
    const value = load();
    this.entries.set(key, { at: t, value });
    value.catch(() => this.entries.delete(key));
    if (this.entries.size > 500) {
      for (const [k, v] of this.entries) if (t - v.at > windowMs * 10) this.entries.delete(k);
    }
    return value;
  }
}
