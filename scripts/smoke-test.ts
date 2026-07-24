// scripts/smoke-test.ts
/**
 * @description Optionally builds the Next.js app, starts it, then visits every
 * public page with Puppeteer to collect console errors and navigation timing.
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts              # build > start > test
 *   npx tsx scripts/smoke-test.ts --skip-build # start > test (reuse existing .next)
 *   npx tsx scripts/smoke-test.ts --port=3001
 *   npx tsx scripts/smoke-test.ts --url=https://deploy.example.com  # test a deployed
 *                                              # URL (no local build/server)
 *
 * Remote (--url) auth: reads ADMIN_SECRET (must match the DEPLOYED environment's
 * value) for admin pages and VERCEL_AUTOMATION_BYPASS_SECRET for the Deployment
 * Protection wall. Both are sent ONLY to the deployment origin via request
 * interception, never to third-party hosts (maps, fonts, the Meta pixel).
 *
 * Exit codes:
 *   0  all pages loaded without errors
 *   1  one or more pages had console errors or failed to load
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
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
  /** When true, attach the X-Admin-Secret header for puppeteer requests. */
  isAdmin?: boolean;
}

/**
 * Auth context when testing a deployed URL (`--url`). Headers here are attached
 * ONLY to requests whose origin matches {@link RemoteAuth.origin}, via request
 * interception, so the admin secret never leaks to third-party hosts.
 */
interface RemoteAuth {
  /** Deployment base URL (trailing slash stripped). */
  baseUrl: string;
  /** Deployment origin (scheme + host) that auth headers are scoped to. */
  origin: string;
  /** Admin secret matching the deployed environment; attached to admin specs only. */
  adminSecret: string | null;
  /** Vercel "Protection Bypass for Automation" secret; attached to every origin request. */
  bypassSecret: string | null;
}

/* --------------------------------------------------------------- constants */

/**
 * Per-route overrides for auto-discovered pages. Keyed by the discovered URL
 * path. Anything not listed uses the auto-generated name and no ignores.
 */
const PAGE_OVERRIDES: Record<string, { name?: string; ignoreErrors?: string[] }> = {
  "/": { name: "Home" },
  "/booking/cancel": {
    // With no token the page early-returns before any fetch and just renders
    // the "Missing cancel token." message - no API call, no error to ignore.
    name: "Booking Cancel (no token)",
  },
  "/booking/success": { name: "Booking Success (no token)" },
  "/review": { name: "Review (no token)" },
  "/poster": { name: "Poster (marketing print)" },
  "/admin": { name: "Admin Dashboard" },
  "/admin/business": { name: "Admin Business Overview" },
  "/admin/business/calculator": {
    name: "Admin Calculator",
    // Maps API key restrictions can 4xx locally; legacy widget also logs a
    // deprecation warning that's expected.
    ignoreErrors: ["maps.googleapis.com", "google.maps.places.Autocomplete"],
  },
};

/**
 * Discovered URL paths to skip - internal-only surfaces, or routes that crash
 * without sample data the test can't fabricate. Dynamic routes (`[id]`) and
 * collisions are already filtered automatically; this is for everything else.
 */
const SKIP_PATHS: ReadonlySet<string> = new Set([]);

/**
 * Path prefixes considered admin. Marked specs get the X-Admin-Secret header
 * attached at request time (scripts and cron use the header path; the admin
 * UI uses the session cookie).
 */
const ADMIN_PREFIXES: ReadonlyArray<string> = ["/admin"];

/** App router page files - first match wins per directory. */
const PAGE_FILE_NAMES: ReadonlyArray<string> = ["page.tsx", "page.ts", "page.jsx", "page.js"];

/** Root of the App Router tree. */
const APP_DIR = path.join("src", "app");

/** Warn (but don't fail) when TTFB exceeds this on a local production server. */
const TTFB_WARN_MS = 1_500;

/** Fail when TTFB exceeds this - something is clearly broken. */
const TTFB_FAIL_MS = 10_000;

/**
 * URL substrings for resources that are expected to 404 locally.
 * Vercel Analytics and Speed Insights only exist on the Vercel platform.
 */
const IGNORE_404_URLS = ["/_vercel/insights/", "/_vercel/speed-insights/"];

/**
 * Console-error substrings ignored on EVERY page - third-party noise that can
 * fire on any route, unlike the per-page ignoreErrors overrides.
 * The Meta pixel detects Puppeteer as bot traffic and tries to beacon its own
 * error log to connect.facebook.net, which the site's CSP correctly blocks;
 * the browser then logs an informational CSP-violation message. That is the
 * CSP working, not a page defect - it flaked two pushes on different pages
 * before being ignored here.
 */
const IGNORE_CONSOLE_GLOBAL = ["connect.facebook.net"];

/* ---------------------------------------------------------------- helpers */

/**
 * Walks the App Router tree and turns every `page.{tsx,ts,jsx,js}` into a route.
 * - Route groups `(...)` are stripped from the URL.
 * - Dynamic segments `[id]`, `[...slug]` are skipped (no sample data to test).
 * - Paths in {@link SKIP_PATHS} are filtered out.
 * - Names default to a Title-Cased version of the path; {@link PAGE_OVERRIDES}
 *   supplies friendlier names + per-page ignoreErrors.
 * @returns Discovered routes split into public and admin.
 */
function discoverPages(): { publicPages: PageSpec[]; adminPages: PageSpec[] } {
  const publicPages: PageSpec[] = [];
  const adminPages: PageSpec[] = [];
  const seen = new Set<string>();

  /**
   * Recursive helper that records the route for any directory with a page file.
   * @param dir - Absolute filesystem path being inspected.
   * @param segments - URL segments accumulated from the App Router root.
   */
  const walk = (dir: string, segments: string[]): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // If this directory has a page file, record the route.
    const hasPage = entries.some((e) => e.isFile() && PAGE_FILE_NAMES.includes(e.name));
    if (hasPage) {
      // Strip route groups and skip dynamic segments.
      const cleanSegments = segments.filter((s) => !s.startsWith("("));
      const hasDynamic = cleanSegments.some((s) => s.includes("[") || s.includes("]"));
      if (!hasDynamic) {
        const route = "/" + cleanSegments.join("/");
        const normalised = route === "/" ? "/" : route.replace(/\/$/, "");
        if (!SKIP_PATHS.has(normalised) && !seen.has(normalised)) {
          seen.add(normalised);
          const override = PAGE_OVERRIDES[normalised] ?? {};
          const spec: PageSpec = {
            path: normalised,
            name: override.name ?? routeToName(normalised),
            ignoreErrors: override.ignoreErrors,
          };
          if (ADMIN_PREFIXES.some((p) => normalised === p || normalised.startsWith(`${p}/`))) {
            adminPages.push(spec);
          } else {
            publicPages.push(spec);
          }
        }
      }
    }

    // Recurse into subdirectories.
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("_")) continue; // Next.js private folders.
      walk(path.join(dir, entry.name), [...segments, entry.name]);
    }
  };

  walk(APP_DIR, []);

  publicPages.sort((a, b) => a.path.localeCompare(b.path));
  adminPages.sort((a, b) => a.path.localeCompare(b.path));
  return { publicPages, adminPages };
}

/**
 * Title-cases the final segment of a route for the default display name.
 * @param route - Discovered URL path (e.g. "/admin/business/calculator").
 * @returns Friendly name (e.g. "Admin Business Calculator", or "Home" for "/").
 */
function routeToName(route: string): string {
  if (route === "/") return "Home";
  return route
    .replace(/^\//, "")
    .split("/")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/**
 * Resolves to a free TCP port chosen by the OS, avoiding conflicts with any
 * already-running server (e.g. `next dev` on 3000).
 * @returns Available port number.
 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * Parses `--flag` and `--flag=value` CLI arguments.
 * @returns Parsed flags. `port` is `null` when not specified - caller should
 *   call {@link getFreePort} to pick an available port automatically. `url` is
 *   the deployed target for remote mode (accepts `--url=X` or `--url X`), or
 *   `null` for the local build+server run.
 */
function parseArgs(): { skipBuild: boolean; port: number | null; url: string | null } {
  const args = process.argv.slice(2);
  let skipBuild = false;
  let port: number | null = null;
  let url: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--skip-build") skipBuild = true;
    else if (arg.startsWith("--port=")) port = parseInt(arg.slice(7), 10);
    else if (arg.startsWith("--url=")) url = arg.slice(6);
    else if (arg === "--url") url = args[++i] ?? null;
  }

  return { skipBuild, port, url };
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
 * Spawns the production server (`next start`) on the given port and returns
 * the child process. Serves .next/ and public/ directly, so no asset copying
 * is needed.
 * @param port - Port to listen on.
 * @returns Spawned child process.
 */
function startServer(port: number): ChildProcess {
  console.log(`▶ Starting server on port ${port}…`);
  // Invoke the Next.js bin through the current Node executable so the spawn
  // works without a shell on Windows and Unix alike.
  return spawn(
    process.execPath,
    [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
    {
      stdio: "pipe",
      shell: false,
      env: { ...process.env, HOSTNAME: "localhost" },
    },
  );
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
 * Whether a request URL shares an origin (scheme + host + port) with the given
 * deployment origin. Used to scope auth headers so they never ride along on
 * cross-origin requests (maps, fonts, the Meta pixel).
 * @param requestUrl - The outgoing request URL.
 * @param origin - The deployment origin to match against.
 * @returns True when the origins match.
 */
function isSameOrigin(requestUrl: string, origin: string): boolean {
  try {
    return new URL(requestUrl).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Visits a page with Puppeteer, collecting timing metrics and console errors.
 * @param browser - Puppeteer browser instance.
 * @param baseUrl - Server base URL.
 * @param spec - Page specification.
 * @param remote - Remote-deployment auth context, or null for the local server.
 * @returns Result for the page.
 */
async function checkPage(
  browser: Browser,
  baseUrl: string,
  spec: PageSpec,
  remote: RemoteAuth | null,
): Promise<PageResult> {
  const url = `${baseUrl}${spec.path}`;
  const errors: string[] = [];

  const page = await browser.newPage();

  try {
    if (remote) {
      // Remote deployment: scope auth + Vercel protection-bypass headers to the
      // deployment origin via request interception, so the admin secret is
      // never sent to third-party hosts (maps, fonts, the Meta pixel). The
      // bypass header rides EVERY origin request (public pages sit behind the
      // SSO wall too); the admin secret only rides admin specs.
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const headers = { ...req.headers() };
        if (isSameOrigin(req.url(), remote.origin)) {
          if (remote.bypassSecret) {
            headers["x-vercel-protection-bypass"] = remote.bypassSecret;
            headers["x-vercel-set-bypass-cookie"] = "true";
          }
          if (spec.isAdmin && remote.adminSecret) {
            headers["x-admin-secret"] = remote.adminSecret;
          }
        }
        // Request already handled/aborted (redirects can race) - ignore.
        void req.continue({ headers }).catch(() => undefined);
      });
    } else if (spec.isAdmin) {
      // Local server (single origin): the proxy redirects unauthenticated
      // /admin/* to /admin/login, so attach the X-Admin-Secret header (accepted
      // by isAdminRequest alongside the cookie path) before navigation.
      const secret = process.env.ADMIN_SECRET;
      if (secret) await page.setExtraHTTPHeaders({ "x-admin-secret": secret });
    }

    // Track 4xx/5xx responses by URL so known-missing local endpoints can be filtered
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      const resUrl = response.url();
      if (IGNORE_404_URLS.some((s) => resUrl.includes(s))) return;
      if (spec.ignoreErrors?.some((s) => resUrl.includes(s)) ?? false) return;
      errors.push(`HTTP ${status}: ${resUrl}`);
    });

    // Capture unhandled JS errors
    page.on("pageerror", (err: unknown) => {
      const text = err instanceof Error ? err.message : String(err);
      if (spec.ignoreErrors?.some((s) => text.includes(s)) ?? false) return;
      errors.push(`[pageerror] ${text}`);
    });

    // Capture console.error output. React 19 hydration mismatches,
    // error-boundary logging, and app-level console.error land on this channel
    // (not pageerror), so a page can look fine to the checks above yet still be
    // broken. Filter the same known-missing URLs and per-page ignores.
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      const locUrl = msg.location().url ?? "";
      if (IGNORE_404_URLS.some((s) => text.includes(s) || locUrl.includes(s))) return;
      if (IGNORE_CONSOLE_GLOBAL.some((s) => text.includes(s) || locUrl.includes(s))) return;
      if (spec.ignoreErrors?.some((s) => text.includes(s) || locUrl.includes(s)) ?? false) return;
      errors.push(`[console] ${text}`);
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });

    // Navigation timing
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
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
  if (ms === null) return "  -  ";
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
  const { skipBuild, port: rawPort, url } = parseArgs();

  // Remote mode: test a deployed URL, skipping the local build + server. Auth
  // and protection-bypass secrets come from the environment and are scoped to
  // the deployment origin inside checkPage.
  const remote: RemoteAuth | null = url
    ? {
        baseUrl: url.replace(/\/$/, ""),
        origin: new URL(url).origin,
        adminSecret: process.env.ADMIN_SECRET ?? null,
        bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? null,
      }
    : null;

  const port = remote ? 0 : (rawPort ?? (await getFreePort()));
  const baseUrl = remote ? remote.baseUrl : `http://localhost:${port}`;
  let server: ChildProcess | null = null;
  let browser: Browser | null = null;
  let exitCode = 0;

  try {
    if (remote) {
      console.log(`▶ Remote target: ${baseUrl}\n`);
    } else {
      if (!skipBuild) runBuild();

      // Start the server and wait for readiness
      server = startServer(port);

      server.stderr?.on("data", (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line) process.stderr.write(`  [server] ${line}\n`);
      });

      await waitForServer(port);
    }

    // Launch the browser
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    // Auto-discover every page.tsx under src/app; route groups stripped,
    // dynamic segments skipped, admin routes split out. New pages get tested
    // automatically - no manual list to maintain.
    const { publicPages, adminPages } = discoverPages();

    // Admin pages are only included when ADMIN_SECRET is set; the secret rides
    // along as the X-Admin-Secret header (attached inside checkPage). Without
    // the secret the proxy redirects every admin page to /admin/login, which
    // would just measure the login page repeatedly - skip them instead.
    const adminToken = process.env.ADMIN_SECRET;
    const adminPagesAuthed: PageSpec[] = adminToken
      ? adminPages.map((spec) => ({ ...spec, isAdmin: true }))
      : [];
    if (!adminToken && adminPages.length > 0) {
      console.log(`  (ADMIN_SECRET not set - skipping ${adminPages.length} admin pages)\n`);
    }

    const allPages = [...publicPages, ...adminPagesAuthed];
    console.log(`Checking ${allPages.length} pages…\n`);

    // Visit each page and collect results
    const results: PageResult[] = [];

    for (const spec of allPages) {
      process.stdout.write(`  Loading ${spec.path}…`);
      const result = await checkPage(browser, baseUrl, spec, remote);
      results.push(result);
      const icon = result.status === "pass" ? "✓" : "✗";
      // \x1b[2K clears the entire line so the new (shorter) line doesn't leave
      // fragments of the longer "Loading..." message behind.
      process.stdout.write(
        `\r\x1b[2K  ${icon} ${spec.path.padEnd(40)} ${result.ttfbMs ?? "-"}ms TTFB\n`,
      );
    }

    // Report results and set the exit code
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
    if (server?.pid) {
      // On Windows, SIGTERM doesn't propagate to child processes - use taskkill to
      // kill the whole process tree so the Prisma DLL is released before npm can update it.
      try {
        execSync(`taskkill //F //T //PID ${server.pid}`, { stdio: "ignore" });
      } catch {
        server.kill("SIGTERM");
      }
    }
  }

  process.exit(exitCode);
})();
