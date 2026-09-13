// scripts/smoke-test.ts
// Optionally builds the Next.js app, starts it, then visits every page with Puppeteer to
// collect failed responses, console errors and navigation timing. Each page must also end
// on the URL it asked for and render no leaked raw values (NaN, undefined); the 404 page
// and the public JSON endpoints are checked alongside.
//
// Usage:
//   npx tsx scripts/smoke-test.ts              # build > start > test
//   npx tsx scripts/smoke-test.ts --skip-build # start > test (reuse existing .next)
//   npx tsx scripts/smoke-test.ts --port=3001
//   npx tsx scripts/smoke-test.ts --base-url=https://deploy.example.com
//     # test a deployed URL, no local build or server (--url is an alias)
//
// Secrets: ADMIN_SECRET unlocks admin pages (remotely it must match the DEPLOYED value) and
// VERCEL_AUTOMATION_BYPASS_SECRET clears the Deployment Protection wall. Both go ONLY to
// the target's own origin via request interception, never to third-party hosts (maps,
// fonts, the Meta pixel). The bypass is also primed as a session cookie before any page is
// measured (see primeBypassCookie), since headers alone leave redirected sub-resources
// looping through SSO.
//
// Exit codes:
//   0  every page and endpoint passed
//   1  a check failed, or the arguments were invalid

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
  /** Console-text or resource-URL substrings to ignore for this page (expected errors). */
  ignoreErrors?: string[];
  /** When true, attach the X-Admin-Secret header for puppeteer requests. */
  isAdmin?: boolean;
  /** Text the rendered page must contain. */
  mustContain?: string[];
  /** The status the document itself must answer (the 404 page); under 400 by default. */
  expectStatus?: number;
}

/** A public JSON endpoint fetched directly; each must answer 200 with a JSON object. */
interface ApiCheck {
  path: string;
  /** The body must carry `ok: true`. */
  okFlag?: boolean;
  /** A top-level field that must be an array (possibly empty). */
  arrayField?: string;
}

/**
 * Auth context when testing a deployed URL (`--base-url`). Headers here are attached
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
 * Console-error substrings ignored on EVERY page: CSP violations that can fire on any
 * route, unlike the per-page ignoreErrors overrides. Both are the CSP working, not a
 * page defect.
 *
 * - connect.facebook.net: the Meta pixel detects Puppeteer as bot traffic and tries to
 *   beacon its own error log there, which the CSP blocks. It fires on random pages.
 * - vercel.live: Vercel injects its toolbar (vercel.live/_next-live/feedback/feedback.js)
 *   into preview deployments and the production CSP doesn't allow that host, so every
 *   preview page logs it. Production never carries the script.
 */
const IGNORE_CONSOLE_GLOBAL = ["connect.facebook.net", "vercel.live"];

/**
 * Pages auto-discovery can't produce. A path that matches no route must answer a real
 * 404 with the themed not-found page, not a 200 soft-404 or a crash. The message line
 * is randomised, so only the fixed heading and button copy are asserted.
 */
const EXTRA_PAGES: ReadonlyArray<PageSpec> = [
  {
    path: "/smoke-test-missing-page",
    name: "404 page",
    expectStatus: 404,
    mustContain: ["Well, this is awkward", "Take me home"],
  },
];

/**
 * Text that must never appear in a rendered page: a formatter or template that leaked
 * a raw value. Checked against `document.body.innerText`, so script bundles and input
 * values don't count. Case-sensitive, so ordinary prose won't trip "NaN".
 */
const FORBIDDEN_TEXT: ReadonlyArray<string> = [
  "NaN",
  "undefined",
  "Invalid Date",
  "[object Object]",
];

/**
 * Public endpoints the booking flow and marketing pages read. Array fields may be
 * empty: rates fall back to hardcoded defaults, and days is empty while bookings are
 * paused, so only the shape is asserted.
 */
const API_CHECKS: ReadonlyArray<ApiCheck> = [
  { path: "/api/health", okFlag: true },
  { path: "/api/promos/active", okFlag: true },
  { path: "/api/pricing/rates", okFlag: true, arrayField: "rates" },
  { path: "/api/reviews", arrayField: "reviews" },
  { path: "/api/booking/days", arrayField: "days" },
];

/**
 * Chrome echoes every 4xx/5xx sub-resource as a console error starting with this. The
 * response handler already records those with the real URL, so an echo only counts
 * when no response event was seen for its URL (browser-initiated fetches such as the
 * manifest can bypass page response events).
 */
const STATUS_ECHO_PREFIX = "Failed to load resource: the server responded with a status of";

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
 * Title-cases every segment of a route for the default display name.
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
 * Prints a CLI usage error and exits with code 1.
 * @param message - What was wrong with the arguments.
 */
function usageError(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/**
 * Parses the CLI arguments: `--skip-build`, plus `--port` and `--base-url` (alias
 * `--url`, matching the other scripts) in both `--flag=value` and `--flag value` form.
 *
 * An unknown flag or a bad value exits with a message instead of being ignored. A
 * misspelt target flag or an empty `--base-url=` would otherwise start a full local
 * build when a deployment was meant, and a schemeless URL would throw from `new URL`
 * outside main's try block as an unhandled rejection.
 * @returns Parsed flags. `port` is `null` when not specified - caller should
 *   call {@link getFreePort} to pick an available port automatically. `url` is
 *   the deployed target for remote mode, or `null` for the local build+server run.
 */
function parseArgs(): { skipBuild: boolean; port: number | null; url: string | null } {
  const args = process.argv.slice(2);
  let skipBuild = false;
  let port: number | null = null;
  let url: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);

    if (flag === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (flag !== "--port" && flag !== "--base-url" && flag !== "--url") {
      usageError(`Unknown argument: ${arg}`);
    }

    // The value follows "=" or is the next argument.
    const raw = eq === -1 ? (args[++i] ?? "") : arg.slice(eq + 1);
    if (flag === "--port") {
      // Number, not parseInt: parseInt("3001abc") quietly yields 3001.
      const parsed = Number(raw);
      if (raw === "" || !Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        usageError(`--port must be a whole number from 1 to 65535, got "${raw}"`);
      }
      port = parsed;
    } else {
      let parsed: URL | null = null;
      try {
        parsed = new URL(raw);
      } catch {
        // Reported below alongside the wrong-scheme case.
      }
      if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
        usageError(`${flag} needs a full http(s) URL, got "${raw}"`);
      }
      url = raw;
    }
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
 * Whether a request URL shares an origin (scheme + host + port) with the target
 * server. Used to scope auth headers so they never ride along on cross-origin
 * requests (maps, fonts, the Meta pixel).
 * @param requestUrl - The outgoing request URL.
 * @param origin - The target origin to match against.
 * @returns True when the origins match; false for a blank or unparsable URL.
 */
function isSameOrigin(requestUrl: string, origin: string): boolean {
  try {
    return new URL(requestUrl).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Establishes the Vercel Deployment Protection bypass cookie for the whole
 * browser session.
 *
 * The per-request headers attached in {@link checkPage} cover requests the
 * interceptor sees as same-origin, but that is not every request the browser
 * makes. A same-origin request that 302s out to the Vercel SSO host returns as
 * a cross-origin request, which is deliberately left unauthenticated so the
 * admin secret cannot leak; SSO then bounces it back to the deployment origin
 * and the chain repeats until Chrome aborts with ERR_TOO_MANY_REDIRECTS. That
 * shows up as a sub-resource failure on a page whose document loaded fine.
 *
 * Hitting the origin once with the bypass supplied as query parameters plus
 * `x-vercel-set-bypass-cookie` sets the `_vercel_jwt` cookie, which then rides
 * every later request that sends credentials, however it was initiated. The web
 * manifest is fetched without credentials, so it still loops; {@link checkPage}
 * filters that one case.
 * @param browser - Puppeteer browser instance.
 * @param remote - Remote-deployment auth context.
 */
async function primeBypassCookie(browser: Browser, remote: RemoteAuth): Promise<void> {
  if (!remote.bypassSecret) return;

  const primeUrl =
    `${remote.baseUrl}/?x-vercel-protection-bypass=${encodeURIComponent(remote.bypassSecret)}` +
    `&x-vercel-set-bypass-cookie=true`;

  const page = await browser.newPage();
  try {
    await page.goto(primeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const cookies = await browser.cookies();
    const primed = cookies.some((c) => c.name === "_vercel_jwt");
    console.log(
      primed
        ? "  Deployment Protection bypass cookie set.\n"
        : "  (no bypass cookie returned - Deployment Protection may be off)\n",
    );
  } finally {
    await page.close();
  }
}

/**
 * Visits a page with Puppeteer and fails it on a 4xx/5xx response, a console or page
 * error, a wrong document status, landing on a different URL, or leaked raw values in
 * the rendered text. Also collects TTFB, FCP and load timing.
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
    // Attach secrets through interception scoped to the target origin, locally too:
    // setExtraHTTPHeaders is page-wide and would send them to Google Maps, fonts and the
    // Meta pixel. The bypass rides every origin request (public pages sit behind SSO too);
    // the admin secret rides admin specs only.
    const origin = remote?.origin ?? new URL(baseUrl).origin;
    const bypassSecret = remote?.bypassSecret ?? null;
    const localAdminSecret = process.env.ADMIN_SECRET || null;
    const adminSecret = spec.isAdmin ? (remote ? remote.adminSecret : localAdminSecret) : null;
    if (bypassSecret || adminSecret) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const headers = { ...req.headers() };
        if (isSameOrigin(req.url(), origin)) {
          if (bypassSecret) {
            headers["x-vercel-protection-bypass"] = bypassSecret;
            headers["x-vercel-set-bypass-cookie"] = "true";
          }
          if (adminSecret) headers["x-admin-secret"] = adminSecret;
        }
        // Request already handled/aborted (redirects can race) - ignore.
        void req.continue({ headers }).catch(() => undefined);
      });
    }

    // URLs that produced a 4xx/5xx response event, so the console echo of the same
    // failure can be dropped instead of double-counted.
    const failedResponseUrls = new Set<string>();
    const statusEchoes: { text: string; locUrl: string }[] = [];

    // Track 4xx/5xx responses by URL so known-missing local endpoints can be filtered
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400) return;
      const resUrl = response.url();
      failedResponseUrls.add(resUrl);
      // The 404 spec's own document is meant to answer 404; its status is asserted
      // after navigation instead.
      if (spec.expectStatus === status && response.request().resourceType() === "document") {
        return;
      }
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

    // React 19 hydration mismatches, error-boundary logging and app-level console.error
    // land on this channel, not pageerror, so a page can pass the checks above and still
    // be broken. The same known-missing URLs and per-page ignores are filtered.
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      const locUrl = msg.location().url ?? "";
      if (IGNORE_404_URLS.some((s) => text.includes(s) || locUrl.includes(s))) return;
      if (IGNORE_CONSOLE_GLOBAL.some((s) => text.includes(s) || locUrl.includes(s))) return;
      if (spec.ignoreErrors?.some((s) => text.includes(s) || locUrl.includes(s)) ?? false) return;
      // Deployment Protection loops the web manifest on a protected remote: the browser
      // fetches it with credentials omitted (so the primed cookie never rides) and outside
      // reliable interception. Limited to *.webmanifest so a real redirect loop on any
      // other same-origin resource still fails the run.
      if (
        remote?.bypassSecret &&
        text.includes("ERR_TOO_MANY_REDIRECTS") &&
        isSameOrigin(locUrl, remote.origin) &&
        new URL(locUrl).pathname.endsWith(".webmanifest")
      ) {
        return;
      }
      // Status echoes are resolved after navigation, once every response event is in.
      if (text.startsWith(STATUS_ECHO_PREFIX) && locUrl) {
        statusEchoes.push({ text, locUrl });
        return;
      }
      // Include the resource URL: "Failed to load resource" on its own names no
      // culprit, which makes sub-resource failures undiagnosable from CI logs.
      errors.push(locUrl ? `[console] ${text} (${locUrl})` : `[console] ${text}`);
    });

    const docResponse = await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });

    // Keep only the status echoes the response handler never saw.
    for (const echo of statusEchoes) {
      if (!failedResponseUrls.has(echo.locUrl)) {
        errors.push(`[console] ${echo.text} (${echo.locUrl})`);
      }
    }

    const docStatus = docResponse?.status() ?? null;
    if (spec.expectStatus !== undefined && docStatus !== spec.expectStatus) {
      errors.push(`document answered HTTP ${docStatus ?? "none"}, expected ${spec.expectStatus}`);
    }

    // Where the browser ended up: a server redirect (an admin page bouncing to
    // /admin/login) or a client-side router.replace never shows in the document status.
    const landed = new URL(page.url());
    const finalPath = `${landed.pathname}${landed.search}`;
    if (finalPath !== spec.path) errors.push(`landed on ${finalPath}, expected ${spec.path}`);

    // Rendered text only: leaked raw values anywhere, plus the page's required copy.
    const pageText = await page.evaluate(() => document.body.innerText);
    for (const bad of FORBIDDEN_TEXT) {
      if (pageText.includes(bad)) errors.push(`page text contains "${bad}"`);
    }
    for (const needed of spec.mustContain ?? []) {
      if (!pageText.includes(needed)) errors.push(`page text lacks "${needed}"`);
    }

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
 * Fetches each {@link API_CHECKS} endpoint directly and reports it like a page: HTTP
 * 200 with a JSON object, `ok: true` and array fields where expected. Only the bypass
 * header is sent (these routes are public), and only to the deployment origin.
 * @param baseUrl - Server base URL.
 * @param remote - Remote-deployment auth context, or null for the local server.
 * @returns One result per endpoint.
 */
async function checkApis(baseUrl: string, remote: RemoteAuth | null): Promise<PageResult[]> {
  const headers: Record<string, string> = remote?.bypassSecret
    ? { "x-vercel-protection-bypass": remote.bypassSecret }
    : {};
  const results: PageResult[] = [];

  for (const check of API_CHECKS) {
    const errors: string[] = [];
    const started = Date.now();
    let ttfbMs: number | null = null;
    try {
      const res = await fetch(`${baseUrl}${check.path}`, {
        headers,
        // A protected deployment answers an SSO redirect; following it would parse
        // the login HTML and hide the real cause behind a JSON error.
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      ttfbMs = Date.now() - started;
      if (res.status !== 200) {
        errors.push(`HTTP ${res.status}`);
      } else {
        const body: unknown = await res.json();
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          errors.push("expected a JSON object");
        } else {
          const record = body as Record<string, unknown>;
          if (check.okFlag && record.ok !== true) errors.push("expected ok: true");
          if (check.arrayField && !Array.isArray(record[check.arrayField])) {
            errors.push(`expected "${check.arrayField}" to be an array`);
          }
        }
      }
    } catch (err: unknown) {
      errors.push(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    results.push({
      path: check.path,
      name: `API ${check.path}`,
      status: errors.length === 0 ? "pass" : "fail",
      ttfbMs,
      fcpMs: null,
      loadMs: null,
      errors,
    });
  }

  return results;
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
    const colour = r.status === "pass" ? "\x1b[32m" : r.status === "fail" ? "\x1b[31m" : "\x1b[33m";
    const reset = "\x1b[0m";

    console.log(
      `  ${colour}${icon}${reset}       ` +
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

    // Clear the Deployment Protection wall for the whole session before any
    // page is measured; per-request headers alone leave redirected sub-resources
    // looping through SSO.
    if (remote) await primeBypassCookie(browser, remote);

    // Auto-discover every page.tsx under src/app; route groups stripped,
    // dynamic segments skipped, admin routes split out. New pages get tested
    // automatically - no manual list to maintain.
    const { publicPages, adminPages } = discoverPages();

    // Admin pages need ADMIN_SECRET, which rides along as the X-Admin-Secret header
    // (attached inside checkPage). Without it the proxy redirects every admin page to
    // /admin/login, which would just measure the login page repeatedly.
    const adminToken = process.env.ADMIN_SECRET;
    const adminPagesAuthed: PageSpec[] = adminToken
      ? adminPages.map((spec) => ({ ...spec, isAdmin: true }))
      : [];
    if (!adminToken && adminPages.length > 0) {
      console.log(`  (ADMIN_SECRET not set - skipping ${adminPages.length} admin pages)\n`);
    }

    const allPages = [...publicPages, ...EXTRA_PAGES, ...adminPagesAuthed];
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

    console.log(`\nChecking ${API_CHECKS.length} API endpoints…\n`);
    const apiResults = await checkApis(baseUrl, remote);
    for (const result of apiResults) {
      const icon = result.status === "pass" ? "✓" : "✗";
      console.log(`  ${icon} ${result.path.padEnd(40)} ${result.ttfbMs ?? "-"}ms`);
    }
    results.push(...apiResults);

    // Report results and set the exit code
    printTable(results);

    const failed = results.filter((r) => r.status !== "pass");

    if (failed.length === 0) {
      console.log(`\n✓ All ${results.length} checks passed\n`);
    } else {
      console.log(`\n✗ ${failed.length} check(s) failed\n`);
      exitCode = 1;
    }
  } catch (err) {
    console.error("\nFatal error:", err);
    exitCode = 1;
  } finally {
    await browser?.close();
    if (server?.pid) {
      // On Windows SIGTERM doesn't reach child processes, so taskkill the whole tree to
      // release the Prisma DLL before npm can update it. Flags take a single slash:
      // execSync runs through cmd.exe, which rejects the Git Bash `//F` spelling as an
      // invalid option. On other platforms taskkill is absent and SIGTERM does the job.
      try {
        execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
      } catch {
        server.kill("SIGTERM");
      }
    }
  }

  process.exit(exitCode);
})();
