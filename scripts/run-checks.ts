// scripts/run-checks.ts
// Runs the offline fixture checks (scripts/check-*.ts) in parallel, one line each plus
// full output for failures.
// Usage:
//   npm test                      # every check
//   npm test -- promo-pricing     # an exact name runs just that check
//   npm test -- promo             # anything else runs every check containing it
//   npm test -- tax trips         # several filters combine
//   npm test -- --list            # the check names
// A check's name is its filename minus "check-" and ".ts"; new files need no registration.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TSX_CLI = fileURLToPath(import.meta.resolve("tsx/cli"));

// These import a module behind `server-only`, which throws under the default export
// condition and is empty under `react-server`, the condition Next builds with.
const REACT_SERVER = new Set(["email-render", "invoice-pdf", "mailing", "social", "tax-load"]);

interface CheckResult {
  name: string;
  ok: boolean;
  ms: number;
  output: string;
}

/**
 * Every check name, from the scripts/check-*.ts filenames.
 * @returns Names in alphabetical order.
 */
function allChecks(): string[] {
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => /^check-.+\.ts$/.test(f))
    .map((f) => f.slice("check-".length, -".ts".length))
    .sort();
}

/**
 * Runs one check in its own tsx process, capturing stdout and stderr together.
 * @param name - Check name (filename without the prefix and extension).
 * @returns Pass/fail, duration and the captured output.
 */
function runCheck(name: string): Promise<CheckResult> {
  const args = [TSX_CLI];
  if (REACT_SERVER.has(name)) args.push("--conditions=react-server");
  args.push(path.join(SCRIPTS_DIR, `check-${name}.ts`));
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("close", (code) =>
      resolve({ name, ok: code === 0, ms: Date.now() - started, output }),
    );
    child.on("error", (err) =>
      resolve({ name, ok: false, ms: Date.now() - started, output: String(err) }),
    );
  });
}

/**
 * Picks the checks to run from the CLI filters, runs them a few at a time and reports.
 */
async function main(): Promise<void> {
  const all = allChecks();
  const filters = process.argv.slice(2);
  if (filters.includes("--list")) {
    console.log(all.join("\n"));
    return;
  }

  /**
   * Checks one filter selects: an exact name selects only itself, else every name containing it.
   * @param f - One CLI filter.
   * @returns The matching check names.
   */
  const matches = (f: string): string[] =>
    all.includes(f) ? [f] : all.filter((n) => n.includes(f));
  const selected = filters.length
    ? all.filter((n) => filters.some((f) => matches(f).includes(n)))
    : all;
  if (selected.length === 0) {
    console.error(`No check matches ${filters.join(", ")}. Checks:\n  ${all.join("\n  ")}`);
    process.exit(1);
  }

  const started = Date.now();
  const width = Math.max(...selected.map((n) => n.length));
  const results: CheckResult[] = [];
  const queue = [...selected];
  // Each check is its own tsx process, so cap the pool at the core count.
  const workers = Math.max(1, Math.min(queue.length, os.availableParallelism()));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let name = queue.shift(); name; name = queue.shift()) {
        const result = await runCheck(name);
        results.push(result);
        const secs = (result.ms / 1000).toFixed(1).padStart(5);
        console.log(`${result.ok ? "PASS" : "FAIL"}  ${name.padEnd(width)}  ${secs}s`);
      }
    }),
  );

  const failed = results.filter((r) => !r.ok).sort((a, b) => a.name.localeCompare(b.name));
  for (const r of failed) {
    console.log(`\n---- ${r.name} ----\n${r.output.trimEnd()}`);
  }
  const total = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${results.length} checks: ${results.length - failed.length} passed, ${failed.length} failed (${total}s)`,
  );
  process.exit(failed.length ? 1 : 0);
}

void main();
