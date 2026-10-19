// src/shared/lib/server-timing.ts
// Server-Timing collector: routes emit a header via toHeader; server components log instead.

/** One recorded span: a token-safe name and its duration in milliseconds. */
interface TimingSpan {
  /** Header-safe metric name. */
  name: string;
  /** Duration in milliseconds, rounded to 0.1ms. */
  durationMs: number;
}

/**
 * Replaces characters invalid in a Server-Timing metric name, so labels can't break the header.
 * @param name - Raw span label.
 * @returns Token-safe name.
 */
function toToken(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Collects durations for one request; create one per request so spans never bleed across. */
export class ServerTimer {
  private readonly spans: TimingSpan[] = [];

  /**
   * Records a pre-measured span.
   * @param name - Span label; non-token characters are replaced for header safety.
   * @param durationMs - Duration in milliseconds.
   */
  mark(name: string, durationMs: number): void {
    this.spans.push({ name: toToken(name), durationMs: Math.round(durationMs * 10) / 10 });
  }

  /**
   * Times an async operation as a span, recorded even when it throws.
   * @param name - Span label.
   * @param fn - The async operation to measure.
   * @returns Whatever the operation resolves to.
   */
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.mark(name, performance.now() - start);
    }
  }

  /**
   * Serialises the collected spans as a `Server-Timing` header value.
   * @returns Header value (e.g. `db;dur=12.3, identity;dur=4.1`), or "" when empty.
   */
  toHeader(): string {
    return this.spans.map((s) => `${s.name};dur=${s.durationMs}`).join(", ");
  }

  /**
   * Logs the spans, for server components that can't set headers. No-op when empty.
   * @param label - Prefix identifying the page/handler in the log line.
   */
  log(label = "server-timing"): void {
    if (this.spans.length === 0) return;
    const parts = this.spans.map((s) => `${s.name}=${s.durationMs}ms`).join("  ");
    console.log(`[${label}] ${parts}`);
  }
}
