// src/shared/lib/server-timing.ts
/**
 * @description Lightweight Server-Timing collector for locating slow server
 * work. Route handlers can emit the collected spans as a `Server-Timing`
 * response header (visible in the browser Network tab's Timing panel) via
 * {@link ServerTimer.toHeader}; server components, which cannot set response
 * headers, call {@link ServerTimer.log} to print the breakdown to the server
 * logs. Durations use the high-resolution `performance` clock.
 */

/** One recorded span: a token-safe name and its duration in milliseconds. */
interface TimingSpan {
  /** Header-safe metric name. */
  name: string;
  /** Duration in milliseconds, rounded to 0.1ms. */
  durationMs: number;
}

/**
 * Replaces characters that are not valid in a Server-Timing metric name with
 * underscores, so an arbitrary label can never produce a malformed header.
 * @param name - Raw span label.
 * @returns Token-safe name.
 */
function toToken(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * Collects named durations for one request or render. Create one per request -
 * it is not a singleton, so spans never bleed across concurrent invocations.
 */
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
   * Times an async operation, records it as a span, and returns its result. The
   * span is recorded even when the operation throws.
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
   * Prints the collected spans to the server logs - for server components,
   * which cannot attach a response header. No-op when nothing was recorded.
   * @param label - Prefix identifying the page/handler in the log line.
   */
  log(label = "server-timing"): void {
    if (this.spans.length === 0) return;
    const parts = this.spans.map((s) => `${s.name}=${s.durationMs}ms`).join("  ");
    console.log(`[${label}] ${parts}`);
  }
}
