// scripts/eval-ai/index.ts
// On-demand eval harness for the two AI routes. Black-box tests estimate-duration
// and parse-job against a running dev server. Run with `npm run eval:ai` (needs
// `npm run dev` in another terminal). `--self-test` runs the network-free
// pure-logic checks only.
//
// Usage:
//   npm run eval:ai -- --self-test        # pure checks, no server, no API calls
//   npm run eval:ai                       # full run against http://localhost:3000
//   npm run eval:ai -- --url=http://localhost:3001
//   npm run eval:ai -- --runs=3           # repeat each case 3x for reproducibility

import { clampBillableMins, MAX_JOB_MINS } from "@/features/business/lib/pricing-policy";
import { calcSessionMins } from "@/features/business/lib/time-parse";
import {
  type CheckResult,
  estimateTolerance,
  expectedEstimateMins,
  spread,
  withinTolerance,
} from "./assert";
import type { LiveContext } from "./context";

/** One assertion check with expected/actual values, hardcoded - no network. */
interface SelfCase {
  name: string;
  got: number | boolean | null;
  want: number | boolean | null;
}

/** Raw results for one case across N runs. */
interface RawRun {
  id: string;
  kind: "estimate-single" | "estimate-multi" | "parse" | "cross-route";
  benchmarkLabel?: string;
  /** Raw input text (parse + cross-route) - the auditor re-derives the canonical duration from it. */
  input?: string;
  /** Parse cases: "exact" hard-asserts, "info" is report-only. */
  expectMode?: "exact" | "info";
  /** Cross-route cases: the parse-job durationMins for the same input. */
  parseMins?: number;
  durations: number[];
  first: unknown;
  /** Set when the case could not complete; reported as a hard fail, no checks run. */
  error?: string;
}

/**
 * Runs the network-free pure-logic checks and reports pass/fail.
 * @returns Process exit code (0 all pass, 1 any fail).
 */
function runSelfTest(): number {
  const cases: SelfCase[] = [
    { name: "estimate snaps to benchmark", got: expectedEstimateMins(45, 30, 15), want: 45 },
    { name: "estimate floors to min-billable", got: expectedEstimateMins(10, 30, 15), want: 30 },
    { name: "estimate caps at ceiling", got: expectedEstimateMins(500, 30, 15), want: 480 },
    { name: "tolerance is >=1 increment", got: estimateTolerance(45, 15), want: 15 },
    { name: "within tolerance true", got: withinTolerance(88, 90, 15), want: true },
    { name: "within tolerance false", got: withinTolerance(70, 90, 15), want: false },
    { name: "spread of identical is 0", got: spread([90, 90, 90]), want: 0 },
    { name: "spread reports range", got: spread([90, 105]), want: 15 },
    // Canonical time-parse truths (human-verified) - the auditor's independent
    // correctness, NOT a mirror of route output.
    { name: "canonical 9am-5pm", got: calcSessionMins("9am-5pm\nx"), want: 480 },
    { name: "canonical bare 9-5 is 8h", got: calcSessionMins("9-5\nx"), want: 480 },
    { name: "canonical 9-11am", got: calcSessionMins("9-11am\nx"), want: 120 },
    { name: "canonical overnight 11pm-1am", got: calcSessionMins("11pm-1am\nx"), want: 120 },
    { name: "canonical noon boundary 12am-12pm", got: calcSessionMins("12am-12pm\nx"), want: 720 },
    { name: "canonical 'to' separator", got: calcSessionMins("9 to 11am\nx"), want: 120 },
    { name: "canonical space separator", got: calcSessionMins("9 11am\nx"), want: 120 },
    {
      name: "canonical non-digit-led is null",
      got: calcSessionMins("fix wifi 9-11am"),
      want: null,
    },
    // Shared clamp truths.
    { name: "clamp caps at ceiling", got: clampBillableMins(500, 15, 5, 480), want: 480 },
    { name: "clamp floors zero to min", got: clampBillableMins(0, 15, 5), want: 15 },
    { name: "clamp survives zero increment", got: clampBillableMins(47, 15, 0), want: 45 },
  ];
  let failed = 0;
  for (const c of cases) {
    const ok = c.got === c.want;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${c.name} (got ${c.got}, want ${c.want})`,
    );
  }
  console.log(
    failed === 0
      ? `\n✓ ${cases.length} self-tests passed\n`
      : `\n✗ ${failed} self-test(s) failed\n`,
  );
  return failed === 0 ? 0 : 1;
}

/**
 * Parses `--flag=value` / `--flag` CLI arguments.
 * @returns Parsed flags with defaults applied.
 */
function parseArgs(): {
  selfTest: boolean;
  url: string;
  runs: number;
  probe: boolean;
  showContext: boolean;
} {
  const args = process.argv.slice(2);
  let selfTest = false;
  let url = "http://localhost:3000";
  let runs = 2;
  let probe = false;
  let showContext = false;
  for (const arg of args) {
    if (arg === "--self-test") selfTest = true;
    else if (arg.startsWith("--url=")) url = arg.slice(6);
    else if (arg.startsWith("--runs=")) runs = Math.max(1, parseInt(arg.slice(7), 10) || 1);
    else if (arg === "--probe") probe = true;
    else if (arg === "--show-context") showContext = true;
  }
  return { selfTest, url, runs, probe, showContext };
}

/**
 * Runs one case `runs` times, collecting the measured number each run and the
 * first run's full result. Shared by all three case kinds so the collection
 * loop is written once.
 * @param runs - Repeat count for this case (reproducibility).
 * @param call - Makes one call, returning the number to track and the raw result.
 * @returns The per-run numbers and the first run's raw result.
 */
async function runCase(
  runs: number,
  call: () => Promise<{ value: number; result: unknown }>,
): Promise<{ durations: number[]; first: unknown }> {
  const durations: number[] = [];
  let first: unknown = null;
  for (let i = 0; i < runs; i++) {
    const { value, result } = await call();
    durations.push(value);
    if (i === 0) first = result;
  }
  return { durations, first };
}

/**
 * Runs every case `runs` times and collects the numeric result each time
 * (estimatedMins for estimate cases, durationMins for parse cases). Prints a
 * live single-line progress counter so a multi-minute run does not look hung.
 * @param url - Server base URL.
 * @param adminSecret - Admin secret for both routes.
 * @param runs - Repeat count per case (reproducibility).
 * @returns Raw runs plus the live context used to build expectations.
 */
async function collectRaw(
  url: string,
  adminSecret: string,
  runs: number,
): Promise<{ ctx: LiveContext; raw: RawRun[]; aborted: boolean }> {
  const { loadLiveContext } = await import("./context");
  const { callEstimate, callParseJob } = await import("./client");
  const { PARSE_CASES, ESTIMATE_CASES, CROSS_ROUTE_CASES } = await import("./cases");

  process.stdout.write("Loading live context (settings, rates, templates)...\n");
  const ctx = await loadLiveContext();
  const raw: RawRun[] = [];

  const total =
    ctx.benchmarks.length + ESTIMATE_CASES.length + PARSE_CASES.length + CROSS_ROUTE_CASES.length;
  console.log(
    `Running ${total} cases x ${runs} run(s) = ${total * runs} paid calls. This takes a few minutes.\n`,
  );

  let done = 0;
  /**
   * Overwrites one status line (\r + clear-line) with the case about to run, so
   * progress does not scroll a line per case.
   * @param id - The case id currently being collected.
   */
  const tick = (id: string): void => {
    done++;
    process.stdout.write(`\r\x1b[2K  [${done}/${total}] ${id}`);
  };

  // One errored case must not discard the run's completed paid calls: record
  // it and carry on. Three consecutive errors mean the upstream API is down
  // (dead key, exhausted quota) - abort then, keeping everything collected.
  const MAX_CONSECUTIVE_ERRORS = 3;
  let consecutiveErrors = 0;
  let aborted = false;

  /**
   * Runs one case's collector, recording an error entry instead of throwing.
   * @param id - Case id.
   * @param kind - Case kind for the raw error entry.
   * @param fn - Collector that pushes the case's raw entry on success.
   */
  const tryCase = async (
    id: string,
    kind: RawRun["kind"],
    fn: () => Promise<void>,
  ): Promise<void> => {
    try {
      await fn();
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      const message = (err instanceof Error ? err.message : String(err)).split("\n")[0];
      raw.push({ id, kind, durations: [], first: null, error: message });
      process.stdout.write(`\r\x1b[2K  \x1b[31m✗\x1b[0m ${id} errored - continuing\n`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) aborted = true;
    }
  };

  // Single-task estimate probes generated from live benchmarks.
  for (const b of ctx.benchmarks) {
    if (aborted) break;
    const id = `est-${b.label}`;
    tick(id);
    await tryCase(id, "estimate-single", async () => {
      const { durations, first } = await runCase(runs, async () => {
        const r = await callEstimate(
          url,
          adminSecret,
          `Just ${b.label.toLowerCase()}, nothing else`,
        );
        return { value: r.estimatedMins, result: r };
      });
      raw.push({ id, kind: "estimate-single", benchmarkLabel: b.label, durations, first });
    });
  }

  // Authored estimate cases (report-only drift + reproducibility).
  for (const c of ESTIMATE_CASES) {
    if (aborted) break;
    tick(c.id);
    await tryCase(c.id, "estimate-multi", async () => {
      const { durations, first } = await runCase(runs, async () => {
        const r = await callEstimate(url, adminSecret, c.description);
        return { value: r.estimatedMins, result: r };
      });
      raw.push({ id: c.id, kind: "estimate-multi", durations, first });
    });
  }

  // Parse cases (canonical stated-time assertion, or report-only for "info").
  for (const c of PARSE_CASES) {
    if (aborted) break;
    tick(c.id);
    await tryCase(c.id, "parse", async () => {
      const { durations, first } = await runCase(runs, async () => {
        const r = await callParseJob(url, adminSecret, c.input);
        return { value: r.durationMins ?? -1, result: r };
      });
      raw.push({
        id: c.id,
        kind: "parse",
        input: c.input,
        expectMode: c.expectMode ?? "exact",
        durations,
        first,
      });
    });
  }

  // Cross-route: same job to BOTH routes (once each) so the report can compare
  // the public benchmark estimate against the admin stated-time duration.
  for (const c of CROSS_ROUTE_CASES) {
    if (aborted) break;
    tick(c.id);
    await tryCase(c.id, "cross-route", async () => {
      const est = await callEstimate(url, adminSecret, c.input);
      const job = await callParseJob(url, adminSecret, c.input);
      raw.push({
        id: c.id,
        kind: "cross-route",
        input: c.input,
        durations: [est.estimatedMins],
        parseMins: job.durationMins ?? -1,
        first: est,
      });
    });
  }

  process.stdout.write("\r\x1b[2K"); // clear the progress line before the report
  return { ctx, raw, aborted };
}

/**
 * Turns raw runs into reported checks across the three families: context
 * (hard, gates the exit code), reproducibility (soft, reported), and drift
 * (info-only).
 * @param ctx - Live context used to build expectations.
 * @param raw - Collected raw runs.
 * @returns Ordered check results.
 */
function evaluate(ctx: LiveContext, raw: RawRun[]): CheckResult[] {
  const out: CheckResult[] = [];
  const inc = ctx.incrementMins;

  for (const r of raw) {
    // Errored case: surface as a hard fail so it can't pass silently, then
    // skip the family checks (there are no durations to evaluate).
    if (r.error) {
      out.push({
        id: r.id,
        family: "context",
        label: `${r.kind} ${r.id}`,
        status: "fail",
        detail: `case errored: ${r.error}`,
      });
      continue;
    }
    const first = r.durations[0];

    // Family 1: single-task estimate must reflect the live benchmark.
    if (r.kind === "estimate-single") {
      const bench = ctx.benchmarks.find((b) => b.label === r.benchmarkLabel);
      if (bench) {
        const expected = expectedEstimateMins(bench.mins, ctx.minBillableMins, inc);
        const tol = estimateTolerance(expected, inc);
        const ok = withinTolerance(first, expected, tol);
        out.push({
          id: r.id,
          family: "context",
          label: `estimate "${r.benchmarkLabel}"`,
          status: ok ? "pass" : "fail",
          detail: `got ${first}, expected ${expected} +/-${tol}`,
        });
      }
    }

    // Family 3 report-only: authored estimate printed for eyeballing.
    if (r.kind === "estimate-multi") {
      out.push({
        id: r.id,
        family: "drift",
        label: `estimate ${r.id}`,
        status: "info",
        detail: `estimatedMins=${first} (review vs your benchmarks)`,
      });
    }

    // Family 1: parse-job must use the canonical stated times exactly ("exact"),
    // or just report what came back ("info" - no pre-compute / model-estimated).
    if (r.kind === "parse") {
      const canonical = calcSessionMins(r.input ?? "");
      if (r.expectMode === "info") {
        out.push({
          id: r.id,
          family: "context",
          label: `parse ${r.id} (info)`,
          status: "info",
          detail:
            canonical === null
              ? `durationMins=${first} (no pre-compute; model-estimated)`
              : `durationMins=${first} (canonical ${canonical})`,
        });
      } else {
        out.push({
          id: r.id,
          family: "context",
          label: `parse durationMins ${r.id}`,
          status: first === canonical ? "pass" : "fail",
          detail: `got ${first}, expected exactly ${canonical}`,
        });
      }
    }

    // Cross-route (report-only): public benchmark estimate vs admin stated-time
    // duration for the same job, with the canonical stated total for reference.
    if (r.kind === "cross-route") {
      const canonical = calcSessionMins(r.input ?? "");
      const stated =
        canonical === null
          ? null
          : clampBillableMins(canonical, ctx.minBillableMins, inc, MAX_JOB_MINS);
      const estMins = r.durations[0];
      const parseMins = r.parseMins ?? -1;
      out.push({
        id: r.id,
        family: "cross-route",
        label: `cross-route ${r.id}`,
        status: "info",
        detail: `estimate=${estMins} vs parse=${parseMins} (stated ${stated}) delta=${estMins - parseMins}`,
      });
    }

    // Family 2: reproducibility across runs (skip cross-route, which runs once).
    // Only deterministic exact-parse cases hold a zero-spread bar; model-estimated
    // cases get the lenient increment-based tolerance.
    if (r.kind !== "cross-route") {
      const sp = spread(r.durations);
      const tol = r.kind === "parse" && r.expectMode !== "info" ? 0 : 2 * inc;
      out.push({
        id: r.id,
        family: "reproducibility",
        label: `reproducibility ${r.id}`,
        status: sp <= tol ? "pass" : "fail",
        detail: `spread ${sp} over [${r.durations.join(", ")}], tol ${tol}`,
      });
    }
  }
  return out;
}

/**
 * Prints checks grouped by family with a pass/fail/skip/info icon.
 * @param checks - Evaluated checks.
 */
function printReport(checks: CheckResult[]): void {
  const families: CheckResult["family"][] = ["context", "reproducibility", "drift", "cross-route"];
  const titles: Record<CheckResult["family"], string> = {
    context: "1. Each model uses ALL context",
    reproducibility: "2. Reproducibility",
    drift: "3. Public estimate vs benchmarks (report-only)",
    "cross-route":
      "4. Cross-route drift (report-only): public estimate vs admin stated-time duration",
  };
  for (const fam of families) {
    const rows = checks.filter((c) => c.family === fam);
    if (rows.length === 0) continue;
    console.log(`\n${titles[fam]}`);
    for (const c of rows) {
      const icon =
        c.status === "pass"
          ? "\x1b[32m✓\x1b[0m"
          : c.status === "fail"
            ? "\x1b[31m✗\x1b[0m"
            : c.status === "skip"
              ? "\x1b[33m-\x1b[0m"
              : "\x1b[36m•\x1b[0m";
      console.log(`  ${icon} ${c.label} - ${c.detail}`);
    }
  }
}

(async () => {
  const { selfTest, probe, url, showContext, runs } = parseArgs();
  if (selfTest) {
    process.exit(runSelfTest());
  }
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error("ADMIN_SECRET not set in .env.local - required for the harness.");
    process.exit(1);
  }
  try {
    if (probe) {
      const { callEstimate, callParseJob } = await import("./client");
      const est = await callEstimate(url, adminSecret, "Set up a new printer");
      console.log("estimate:", est.estimatedMins, "min,", est.tasks.length, "task(s)");
      const job = await callParseJob(url, adminSecret, "Set up a new laptop, 9-11am");
      console.log("parse:", job.durationMins, "min,", job.tasks?.length ?? 0, "task(s)");
      process.exit(0);
    }
    if (showContext) {
      const { loadLiveContext } = await import("./context");
      const ctx = await loadLiveContext();
      console.log(
        `benchmarks: ${ctx.benchmarks.length}, rates: ${ctx.rates.length}, templates: ${ctx.templates.length}`,
      );
      console.log(`minBillable: ${ctx.minBillableMins}m, increment: ${ctx.incrementMins}m`);
      for (const b of ctx.benchmarks) console.log(`  - ${b.label}: ${b.mins}m`);
      process.exit(0);
    }
    const started = new Date().toISOString();
    const { ctx, raw, aborted } = await collectRaw(url, adminSecret, runs);
    const checks = evaluate(ctx, raw);
    printReport(checks);

    const fs = await import("fs");
    const path = await import("path");
    const dir = path.join("docs", "eval-ai");
    fs.mkdirSync(dir, { recursive: true });
    const artifact = path.join(dir, `run-${started.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(artifact, JSON.stringify({ started, runs, checks, raw }, null, 2));

    // Only the deterministic context asserts (stated-time exactness, min-billable
    // floor, increment) gate the exit code. Reproducibility is a soft, reported
    // signal - a hosted LLM is never bit-for-bit reproducible, so a run-to-run
    // spread is surfaced as a warning, not a build failure.
    const contextFailed = checks.filter((c) => c.status === "fail" && c.family === "context");
    const reproFailed = checks.filter((c) => c.status === "fail" && c.family === "reproducibility");
    const completed = raw.filter((r) => !r.error);
    const calls = completed.length * runs;
    console.log(
      `\n${completed.length}/${raw.length} cases completed, ~${calls} paid calls. Artifact: ${artifact}`,
    );
    if (aborted) {
      console.log(
        `\n\x1b[33m⚠ run aborted early after repeated consecutive case errors (${raw.filter((r) => r.error).length} errored total) - upstream API likely rate-limited or out of quota. Completed cases are reported above and saved in the artifact.\x1b[0m`,
      );
    }
    if (reproFailed.length > 0) {
      console.log(
        `\n\x1b[33m⚠ ${reproFailed.length} reproducibility warning(s) - same input varied across runs (model non-determinism, not a gate).\x1b[0m`,
      );
    }
    console.log(
      contextFailed.length === 0
        ? `\n\x1b[32m✓ all hard (context) assertions passed\x1b[0m\n`
        : `\n\x1b[31m✗ ${contextFailed.length} hard (context) assertion(s) failed\x1b[0m\n`,
    );
    process.exit(contextFailed.length === 0 ? 0 : 1);
  } catch (err) {
    // Print the diagnostic message the client built (route, status, hint) as a
    // single clean line - no stack trace - then exit non-zero. Catching here
    // also avoids the abrupt unhandled-rejection teardown that trips a libuv
    // assertion on Windows.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n\x1b[31m✗ eval run failed\x1b[0m\n  ${message}\n`);
    process.exit(1);
  }
})();
