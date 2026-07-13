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
  estimateTolerance,
  expectedEstimateMins,
  spread,
  statedSessionMins,
  withinTolerance,
} from "./assert";

/** One assertion check with expected/actual values, hardcoded - no network. */
interface SelfCase {
  name: string;
  got: number | boolean;
  want: number | boolean;
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

(async () => {
  const { selfTest } = parseArgs();
  if (selfTest) {
    process.exit(runSelfTest());
  }
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error("ADMIN_SECRET not set in .env.local - required for the harness.");
    process.exit(1);
  }
  const { probe, url, showContext } = parseArgs();
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
  console.log("Full run not implemented yet.");
  process.exit(0);
})();
