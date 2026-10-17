// scripts/lib/harness.ts
// Pass/fail recording shared by the fixture checks (scripts/check-*.ts). Each assertion
// records rather than throws, so every case runs even after one fails, and finish()
// turns the tally into the exit code run-checks.ts reads.

let failures = 0;

/**
 * Compares a value against its expectation by JSON, so arrays and plain objects compare
 * by content.
 * @param label - Human-readable case name.
 * @param actual - What the call produced.
 * @param expected - What it should have produced.
 */
export function expectEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  PASS  ${label} > ${a}`);
  } else {
    console.error(`  FAIL  ${label} > expected ${e}, got ${a}`);
    failures++;
  }
}

/**
 * Records a yes/no assertion.
 * @param label - Human-readable case name.
 * @param ok - Whether the case passed.
 * @param detail - Extra output shown on failure.
 */
export function expect(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
    failures++;
  }
}

/** Prints the tally and exits, non-zero when any assertion failed. */
export function finish(): never {
  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
