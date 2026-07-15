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

import {
  type CheckResult,
  estimateTolerance,
  expectedEstimateMins,
  spread,
  statedSessionMins,
  withinTolerance,
} from "./assert";
import type { LiveContext } from "./context";

/** One assertion check with expected/actual values, hardcoded - no network. */
interface SelfCase {
  name: string;
  got: number | boolean;
  want: number | boolean;
}

/** Raw results for one case across N runs. */
interface RawRun {
  id: string;
  kind: "estimate-single" | "estimate-multi" | "parse";
  benchmarkLabel?: string;
  statedRanges?: { startTime: string; endTime: string }[];
  durations: number[];
  first: unknown;
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
    {
      name: "session mins simple",
      got: statedSessionMins([{ startTime: "09:00", endTime: "11:00" }]),
      want: 120,
    },
    {
      name: "session mins overnight",
      got: statedSessionMins([{ startTime: "23:00", endTime: "01:00" }]),
      want: 120,
    },
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
 * Runs every case `runs` times and collects the numeric result each time
 * (estimatedMins for estimate cases, durationMins for parse cases).
 * @param url - Server base URL.
 * @param adminSecret - Admin secret for both routes.
 * @param runs - Repeat count per case (reproducibility).
 * @returns Raw runs plus the live context used to build expectations.
 */
async function collectRaw(
  url: string,
  adminSecret: string,
  runs: number,
): Promise<{ ctx: LiveContext; raw: RawRun[] }> {
  const { loadLiveContext } = await import("./context");
  const { callEstimate, callParseJob } = await import("./client");
  const { PARSE_CASES, MULTI_ESTIMATE_CASES } = await import("./cases");
  const ctx = await loadLiveContext();
  const raw: RawRun[] = [];

  // Single-task estimate probes generated from live benchmarks.
  for (const b of ctx.benchmarks) {
    const durations: number[] = [];
    let first: unknown = null;
    for (let i = 0; i < runs; i++) {
      const r = await callEstimate(url, adminSecret, `Just ${b.label.toLowerCase()}, nothing else`);
      durations.push(r.estimatedMins);
      if (i === 0) first = r;
    }
    raw.push({
      id: `est-${b.label}`,
      kind: "estimate-single",
      benchmarkLabel: b.label,
      durations,
      first,
    });
  }

  // Multi-task estimate cases (report-only drift).
  for (const c of MULTI_ESTIMATE_CASES) {
    const durations: number[] = [];
    let first: unknown = null;
    for (let i = 0; i < runs; i++) {
      const r = await callEstimate(url, adminSecret, c.description);
      durations.push(r.estimatedMins);
      if (i === 0) first = r;
    }
    raw.push({ id: c.id, kind: "estimate-multi", durations, first });
  }

  // Parse cases (exact stated-time assertion).
  for (const c of PARSE_CASES) {
    const durations: number[] = [];
    let first: unknown = null;
    for (let i = 0; i < runs; i++) {
      const r = await callParseJob(url, adminSecret, c.input);
      durations.push(r.durationMins ?? -1);
      if (i === 0) first = r;
    }
    raw.push({ id: c.id, kind: "parse", statedRanges: c.statedRanges, durations, first });
  }

  return { ctx, raw };
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

    // Family 3 report-only: multi-task estimate printed for eyeballing.
    if (r.kind === "estimate-multi") {
      out.push({
        id: r.id,
        family: "drift",
        label: `multi-task estimate ${r.id}`,
        status: "info",
        detail: `estimatedMins=${first} (review vs your benchmarks)`,
      });
    }

    // Family 1: parse-job must use the stated times exactly.
    if (r.kind === "parse" && r.statedRanges) {
      const expected = statedSessionMins(r.statedRanges);
      const ok = first === expected;
      out.push({
        id: r.id,
        family: "context",
        label: `parse durationMins ${r.id}`,
        status: ok ? "pass" : "fail",
        detail: `got ${first}, expected exactly ${expected}`,
      });
    }

    // Family 2: reproducibility across runs.
    const sp = spread(r.durations);
    const tol = r.kind === "parse" ? 0 : 2 * inc;
    out.push({
      id: r.id,
      family: "reproducibility",
      label: `reproducibility ${r.id}`,
      status: sp <= tol ? "pass" : "fail",
      detail: `spread ${sp} over [${r.durations.join(", ")}], tol ${tol}`,
    });
  }
  return out;
}

/**
 * Prints checks grouped by family with a pass/fail/skip/info icon.
 * @param checks - Evaluated checks.
 */
function printReport(checks: CheckResult[]): void {
  const families: CheckResult["family"][] = ["context", "reproducibility", "drift"];
  const titles: Record<CheckResult["family"], string> = {
    context: "1. Each model uses ALL context",
    reproducibility: "2. Reproducibility",
    drift: "3. Public estimate vs benchmarks (report-only; benchmark-vs-history is out of scope)",
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
  const { ctx, raw } = await collectRaw(url, adminSecret, runs);
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
  const calls = raw.length * runs;
  console.log(`\n${raw.length} cases, ${calls} paid calls. Artifact: ${artifact}`);
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
})();
