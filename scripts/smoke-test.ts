// scripts/smoke-test.ts
// Builds and starts the app (or targets a deployment), then visits every page with Puppeteer
// for failed responses, console errors, wrong final URLs, leaked raw values and timing.
// Usage:
//   npx tsx scripts/smoke-test.ts              # build > start > test
//   npx tsx scripts/smoke-test.ts --skip-build # start > test (reuse existing .next)
//   npx tsx scripts/smoke-test.ts --port=3001
//   npx tsx scripts/smoke-test.ts --base-url=https://deploy.example.com
//     # test a deployed URL, no local build or server (--url is an alias)
// Secrets: ADMIN_SECRET (must match the deployed value) and VERCEL_AUTOMATION_BYPASS_SECRET,
// sent only to the target origin.
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
 * Auth context for a deployed URL; headers go only to {@link RemoteAuth.origin}.
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
 * Per-route overrides for auto-discovered pages, keyed by URL path.
 */
const PAGE_OVERRIDES: Record<string, { name?: string; ignoreErrors?: string[] }> = {
  "/": { name: "Home" },
  "/areas": {
    name: "Areas",
    ignoreErrors: ["maps.googleapis.com", "google.maps.places.Autocomplete"],
  },
  "/booking/cancel": {
    // With no token the page renders "Missing cancel token." without any fetch.
    name: "Booking Cancel (no token)",
  },
  "/booking/success": { name: "Booking Success (no token)" },
  "/review": { name: "Review (no token)" },
  "/poster": { name: "Poster (marketing print)" },
  "/admin": { name: "Admin Dashboard" },
  "/admin/business": { name: "Admin Business Overview" },
  "/admin/business/calculator": {
    name: "Admin Calculator",
    // Maps key restrictions can 4xx locally; the widget logs an expected deprecation warning.
    ignoreErrors: ["maps.googleapis.com", "google.maps.places.Autocomplete"],
  },
};

/**
 * Discovered paths to skip: internal-only surfaces or routes needing sample data.
 */
const SKIP_PATHS: ReadonlySet<string> = new Set([]);

/**
 * Path prefixes considered admin; their specs get the X-Admin-Secret header.
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
 * URL substrings expected to 404 locally (Vercel-only Analytics and Speed Insights).
 */
const IGNORE_404_URLS = ["/_vercel/insights/", "/_vercel/speed-insights/"];

/**
 * Console-error substrings ignored on every page: expected CSP/CORS blocks, not page defects.
 * - connect.facebook.net: the Meta pixel's bot-traffic error beacon.
 * - vercel.live: the preview-only Vercel toolbar.
 * - tags.tiqcdn.com/dle/: Thryv's settings file, served without CORS headers.
 */
const IGNORE_CONSOLE_GLOBAL = ["connect.facebook.net", "vercel.live", "tags.tiqcdn.com/dle/"];

/**
 * Pages auto-discovery can't produce. An unknown path must answer a real themed 404; its
 * client-rendered path proves hydration finished.
 */
const EXTRA_PAGES: ReadonlyArray<PageSpec> = [
  {
    path: "/smoke-test-missing-page",
    name: "404 page",
    expectStatus: 404,
    mustContain: ["Page not found", "Back to home", "/smoke-test-missing-page"],
  },
  // The review-ask stop page is a [token] route; "preview" is its no-op token.
  {
    path: "/review-asks/stop/preview",
    name: "Review asks stop (preview)",
    mustContain: ["Review requests", "link from a preview email"],
  },
];

/**
 * Leaked raw values that must never appear in `document.body.innerText` (case-sensitive).
 */
const FORBIDDEN_TEXT: ReadonlyArray<string> = [
  "NaN",
  "undefined",
  "Invalid Date",
  "[object Object]",
];

/**
 * Public endpoints the booking flow and marketing pages read; only the shape is asserted.
 */
const API_CHECKS: ReadonlyArray<ApiCheck> = [
  { path: "/api/health", okFlag: true },
  { path: "/api/promos/active", okFlag: true },
  { path: "/api/pricing/rates", okFlag: true, arrayField: "rates" },
  { path: "/api/reviews", arrayField: "reviews" },
];

/**
 * Prefix of Chrome's console echo of a 4xx/5xx sub-resource; it only counts when no
 * response event was seen for that URL.
 */
const STATUS_ECHO_PREFIX = "Failed to load resource: the server responded with a status of";

/* ---------------------------------------------------------------- helpers */

/**
 * Turns every App Router page into a route: groups stripped, dynamic segments and
 * {@link SKIP_PATHS} skipped, names from {@link PAGE_OVERRIDES} where given.
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
 * Resolves to a free OS-chosen TCP port.
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
 * Parses `--skip-build`, `--port` and `--base-url` (alias `--url`); an unknown flag or
 * bad value exits rather than silently starting a local build.
 * @returns Parsed flags; `port` null means use {@link getFreePort}, `url` null means local.
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
 * Spawns `next start` on the given port.
 * @param port - Port to listen on.
 * @returns Spawned child process.
 */
function startServer(port: number): ChildProcess {
  console.log(`▶ Starting server on port ${port}…`);
  // Run the Next.js bin through Node so no shell is needed on any platform.
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
 * Whether a request URL shares the target's origin, to scope auth headers.
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
 * Sets the Vercel bypass `_vercel_jwt` cookie for the whole session. Headers alone miss
 * requests that bounce via SSO and loop to ERR_TOO_MANY_REDIRECTS; the uncredentialed
 * web manifest still loops and {@link checkPage} filters it.
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
 * Visits a page and fails it on bad responses, console/page errors, a wrong status or
 * final URL, or leaked raw values; collects timing.
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
    // Attach secrets via origin-scoped interception (setExtraHTTPHeaders would leak them).
    // The bypass goes on every origin request, the admin secret on admin specs only.
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

    // 4xx/5xx URLs already recorded, so their console echo isn't double-counted.
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

    // Hydration mismatches and app console.error land here, not on pageerror.
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      const locUrl = msg.location().url ?? "";
      if (IGNORE_404_URLS.some((s) => text.includes(s) || locUrl.includes(s))) return;
      if (IGNORE_CONSOLE_GLOBAL.some((s) => text.includes(s) || locUrl.includes(s))) return;
      if (spec.ignoreErrors?.some((s) => text.includes(s) || locUrl.includes(s)) ?? false) return;
      // The uncredentialed web manifest loops on a protected remote; only *.webmanifest is excused.
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
      // Include the resource URL so the failure is diagnosable from CI logs.
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

    // Final URL catches redirects the document status doesn't show.
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
 * Fetches each {@link API_CHECKS} endpoint and expects 200 JSON with `ok: true` and the
 * expected array fields.
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
        // Don't follow an SSO redirect, or the login HTML hides the real cause.
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

  // Remote mode: test a deployed URL, skipping the local build and server.
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

    // Clear Deployment Protection for the whole session before measuring.
    if (remote) await primeBypassCookie(browser, remote);

    // Auto-discover every page.tsx under src/app.
    const { publicPages, adminPages } = discoverPages();

    // Admin pages need ADMIN_SECRET, else every one redirects to /admin/login.
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
      // \x1b[2K clears the line so no fragments of the longer message remain.
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
      // Windows SIGTERM misses child processes, so taskkill the tree to free the Prisma DLL.
      // Single-slash flags: execSync runs through cmd.exe, which rejects `//F`.
      try {
        execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: "ignore" });
      } catch {
        server.kill("SIGTERM");
      }
    }
  }

  process.exit(exitCode);
})();
