// scripts/smoke-test.ts
/**
 * @file smoke-test.ts
 * @description Optionally builds the Next.js app, starts it, then visits every
 * public page with Puppeteer to collect console errors and navigation timing.
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts              # build → start → test
 *   npx tsx scripts/smoke-test.ts --skip-build # start → test (reuse existing .next)
 *   npx tsx scripts/smoke-test.ts --port=3001
 *
 * Exit codes:
 *   0  all pages loaded without errors
 *   1  one or more pages had console errors or failed to load
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import puppeteer, { type Browser } from "puppeteer";

/* ------------------------------------------------------------------ types */

interface PageResult {
  path: string;
  name: string;
  status: "pass" | "fail" | "error";
  ttfbMs: number | null;
  fcpMs: number | null;
  loadMs: number | null;
  errors: string[];
}

interface PageSpec {
  path: string;
  name: string;
  /** Console error substrings to ignore for this page (expected errors). */
  ignoreErrors?: string[];
}

/* --------------------------------------------------------------- constants */

const PAGES: PageSpec[] = [
  { path: "/", name: "Home" },
  { path: "/booking", name: "Booking" },
  {
    path: "/booking/cancel",
    name: "Booking Cancel (no token)",
    // Client fires cancel API immediately — no-token 400 is expected
    ignoreErrors: ["Missing cancel token", "Could not cancel"],
  },
  { path: "/booking/success", name: "Booking Success (no token)" },
  { path: "/reviews", name: "Reviews" },
  {
    path: "/review",
    name: "Review (no token)",
  },
  { path: "/services", name: "Services" },
  { path: "/about", name: "About" },
  { path: "/contact", name: "Contact" },
  { path: "/faq", name: "FAQ" },
  { path: "/pricing", name: "Pricing" },
];

/** Warn (but don't fail) when TTFB exceeds this on a local production server. */
const TTFB_WARN_MS = 1_500;

/** Fail when TTFB exceeds this — something is clearly broken. */
const TTFB_FAIL_MS = 10_000;

/* ---------------------------------------------------------------- helpers */

/**
 * Parses `--flag` and `--flag=value` CLI arguments.
 * @returns Parsed flags.
 */
function parseArgs(): { skipBuild: boolean; port: number } {
  const args = process.argv.slice(2);
  let skipBuild = false;
  let port = 3000;

  for (const arg of args) {
    if (arg === "--skip-build") skipBuild = true;
    else if (arg.startsWith("--port=")) port = parseInt(arg.slice(7), 10);
  }

  return { skipBuild, port };
}

/**
 * Runs `next build` synchronously, streaming output to the terminal.
 */
function runBuild(): void {
  console.log("\n▶ Building…\n");
  execSync("npm run build", { stdio: "inherit" });
  console.log("\n✓ Build complete\n");
}

/**
 * Spawns `next start` on the given port and returns the child process.
 * @param port - Port to listen on.
 * @returns Spawned child process.
 */
function startServer(port: number): ChildProcess {
  console.log(`▶ Starting server on port ${port}…`);
  return spawn("npx", ["next", "start", "-p", String(port)], {
    stdio: "pipe",
    shell: true,
  });
}

/**
 * Polls the server root until it responds or the timeout elapses.
 * @param port - Port the server is listening on.
 * @param timeoutMs - Maximum wait time in milliseconds.
 */
async function waitForServer(port: number, timeoutMs = 30_000): Promise<void> {
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (res.status < 500) {
        console.log(`✓ Server ready at ${url}\n`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`Server did not respond within ${timeoutMs / 1000}s`);
}

/**
 * Visits a page with Puppeteer, collecting timing metrics and console errors.
 * @param browser - Puppeteer browser instance.
 * @param baseUrl - Server base URL.
 * @param spec - Page specification.
 * @returns Result for the page.
 */
async function checkPage(browser: Browser, baseUrl: string, spec: PageSpec): Promise<PageResult> {
  const url = `${baseUrl}${spec.path}`;
  const errors: string[] = [];

  const page = await browser.newPage();

  try {
    // Capture console errors, filtering out expected ones
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      const ignored = spec.ignoreErrors?.some((s) => text.includes(s)) ?? false;
      if (!ignored) errors.push(text);
    });

    // Capture unhandled page errors
    page.on("pageerror", (err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      const ignored = spec.ignoreErrors?.some((s) => text.includes(s)) ?? false;
      if (!ignored) errors.push(`[pageerror] ${text}`);
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });

    // Navigation timing
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      const paintEntries = performance.getEntriesByType("paint");
      const fcp = paintEntries.find((e) => e.name === "first-contentful-paint");

      if (!nav) return { ttfb: null, fcp: null, load: null };

      return {
        ttfb: Math.round(nav.responseStart - nav.requestStart),
        fcp: fcp ? Math.round(fcp.startTime) : null,
        load: Math.round(nav.loadEventEnd - nav.requestStart),
      };
    });

    const ttfbMs = timing.ttfb;
    const failed = errors.length > 0 || (ttfbMs !== null && ttfbMs > TTFB_FAIL_MS);

    return {
      path: spec.path,
      name: spec.name,
      status: failed ? "fail" : "pass",
      ttfbMs,
      fcpMs: timing.fcp,
      loadMs: timing.load,
      errors,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      path: spec.path,
      name: spec.name,
      status: "error",
      ttfbMs: null,
      fcpMs: null,
      loadMs: null,
      errors: [`Failed to load page: ${message}`],
    };
  } finally {
    await page.close();
  }
}

/**
 * Formats a millisecond value with a warning indicator if it exceeds the threshold.
 * @param ms - Value in milliseconds (or null).
 * @returns Formatted string.
 */
function fmtMs(ms: number | null): string {
  if (ms === null) return "  —  ";
  const s = `${ms}ms`.padStart(7);
  return ms > TTFB_WARN_MS ? `${s} ⚠` : s;
}

/**
 * Prints a results table to stdout.
 * @param results - Page results to display.
 */
function printTable(results: PageResult[]): void {
  const col1 = Math.max(...results.map((r) => r.name.length), 4) + 2;

  const header =
    "  Status  " +
    "Name".padEnd(col1) +
    " TTFB".padStart(9) +
    "  FCP".padStart(9) +
    "  Load".padStart(9);

  console.log("\n" + header);
  console.log("─".repeat(header.length));

  for (const r of results) {
    const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "!";
    const color = r.status === "pass" ? "\x1b[32m" : r.status === "fail" ? "\x1b[31m" : "\x1b[33m";
    const reset = "\x1b[0m";

    console.log(
      `  ${color}${icon}${reset}       ` +
        r.name.padEnd(col1) +
        fmtMs(r.ttfbMs).padStart(9) +
        fmtMs(r.fcpMs).padStart(9) +
        fmtMs(r.loadMs).padStart(9),
    );

    for (const e of r.errors) {
      console.log(`           ${"\x1b[31m"}  ↳ ${e}${"\x1b[0m"}`);
    }
  }

  console.log("─".repeat(header.length));
}

/* ------------------------------------------------------------------ main */

(async () => {
  const { skipBuild, port } = parseArgs();
  const baseUrl = `http://localhost:${port}`;
  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  let exitCode = 0;

  try {
    if (!skipBuild) runBuild();

    server = startServer(port);

    server.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) process.stderr.write(`  [server] ${line}\n`);
    });

    await waitForServer(port);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    console.log(`Checking ${PAGES.length} pages…\n`);

    const results: PageResult[] = [];

    for (const spec of PAGES) {
      process.stdout.write(`  Loading ${spec.path}…`);
      const result = await checkPage(browser, baseUrl, spec);
      results.push(result);
      const icon = result.status === "pass" ? "✓" : "✗";
      process.stdout.write(`\r  ${icon} ${spec.path.padEnd(40)} ${result.ttfbMs ?? "—"}ms TTFB\n`);
    }

    printTable(results);

    const failed = results.filter((r) => r.status !== "pass");

    if (failed.length === 0) {
      console.log(`\n✓ All ${results.length} pages passed\n`);
    } else {
      console.log(`\n✗ ${failed.length} page(s) failed\n`);
      exitCode = 1;
    }
  } catch (err) {
    console.error("\nFatal error:", err);
    exitCode = 1;
  } finally {
    await browser?.close();
    server?.kill("SIGTERM");
  }

  process.exit(exitCode);
})();
