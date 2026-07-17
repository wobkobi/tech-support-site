// scripts/calibrate-benchmarks.ts
// Read-only report of what jobs ACTUALLY took, from real invoices, so the public
// estimator's benchmark numbers can be judged against reality.
// No AI, no API calls, no writes. Run: npm run calibrate
//
// It reports; it does NOT conclude. Two limits are deliberate and load-bearing:
//   1. Task tags are coarse - "Laptop setup" covers a 15-min account fix AND a
//      90-min new-laptop build - so a tag's median is NOT a benchmark's truth.
//      The benchmarks are printed alongside for pairing BY EYE; auto-pairing
//      them produced confident nonsense and was removed.
//   2. LineItem stores qty with no unit, so a part (qty=1 = one cable) looks
//      identical to an hour of labour. A line counts as labour only when its
//      unitPrice matches a live hourly rate; everything else is excluded and
//      listed, so exclusions stay visible instead of silently skewing the maths.

import { prisma } from "@/shared/lib/prisma";
import { loadLiveContext, type LiveContext } from "./eval-ai/context";

/** One real billed labour line, normalised to minutes. */
interface LabourLine {
  invoice: string;
  task: string;
  mins: number;
  /** True when this line shared its invoice with other labour lines (a stacked job). */
  stacked: boolean;
}

/**
 * Median of a numeric list (0 when empty).
 * @param xs - Values.
 * @returns The median value.
 */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * The task key of a composed invoice description: the "<Device> <action>" head
 * before the " - <details>" tail (see composeDescription in business.ts).
 * Case-folded, because the live data holds case-drifted duplicates ("External
 * storage" vs "External Storage") that would otherwise split one group in two.
 * @param description - Raw invoice line description.
 * @returns The task head, trimmed and case-folded for grouping.
 */
function taskKey(description: string): string {
  const head = description.split(" - ")[0].trim();
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
}

/**
 * Every hourly price a labour line could plausibly carry: each base rate, plus
 * each base combined with one modifier delta. Used to tell labour from parts,
 * since the line records no unit of its own.
 * @param ctx - Live context carrying the rate rows.
 * @returns Sorted list of plausible hourly unit prices.
 */
function plausibleHourlyRates(ctx: LiveContext): number[] {
  const bases = ctx.rates.map((r) => r.ratePerHour).filter((r): r is number => r !== null);
  const deltas = ctx.rates.map((r) => r.hourlyDelta).filter((d): d is number => d !== null);
  const out = new Set<number>(bases);
  for (const b of bases) for (const d of deltas) out.add(b + d);
  return [...out].sort((a, b) => a - b);
}

/**
 * Builds and prints the report.
 */
async function main(): Promise<void> {
  const ctx = await loadLiveContext();
  const rates = plausibleHourlyRates(ctx);
  /**
   * Whether a line's unit price matches a live hourly rate (so it is labour,
   * not a part). Parts and labour are otherwise indistinguishable on a LineItem.
   * @param unitPrice - The line's unit price.
   * @returns True when the price matches a plausible hourly rate.
   */
  const isHourly = (unitPrice: number): boolean => rates.some((r) => Math.abs(r - unitPrice) < 0.5);

  const invoices = await prisma.invoice.findMany({
    where: { status: { not: "VOIDED" } },
    select: { number: true, lineItems: true },
  });

  const lines: LabourLine[] = [];
  const jobTotals: { mins: number; taskCount: number }[] = [];
  const excluded: { description: string; qty: number; unitPrice: number }[] = [];

  for (const inv of invoices) {
    const labour = (inv.lineItems ?? []).filter((l) => {
      if (l.qty <= 0) return false;
      if (/^travel/i.test(l.description) || !isHourly(l.unitPrice)) {
        excluded.push({ description: l.description, qty: l.qty, unitPrice: l.unitPrice });
        return false;
      }
      return true;
    });
    if (labour.length === 0) continue;
    const stacked = labour.length > 1;
    let total = 0;
    for (const l of labour) {
      const mins = Math.round(l.qty * 60);
      total += mins;
      lines.push({ invoice: inv.number, task: taskKey(l.description), mins, stacked });
    }
    jobTotals.push({ mins: total, taskCount: labour.length });
  }

  const byTask = new Map<string, LabourLine[]>();
  for (const l of lines) byTask.set(l.task, [...(byTask.get(l.task) ?? []), l]);
  const ranked = [...byTask.entries()].sort((a, b) => b[1].length - a[1].length);

  console.log(`\nHourly rates counted as labour: ${rates.map((r) => `$${r}`).join(", ")}`);
  console.log(`Labour lines: ${lines.length} across ${jobTotals.length} invoices`);
  console.log(`Excluded (travel / parts / non-hourly): ${excluded.length}`);
  for (const e of excluded.slice(0, 8)) {
    console.log(`   - qty ${e.qty} @ $${e.unitPrice}  ${e.description.slice(0, 58)}`);
  }
  if (excluded.length > 8) console.log(`   ... and ${excluded.length - 8} more`);

  // ---- A. What tasks ACTUALLY take -------------------------------------
  console.log(`\n=== A. Actual minutes per task (labour only) ===`);
  console.log(`  A small n is an anecdote, not an average, and one tag mixes different jobs -`);
  console.log(`  read the range, not just the median.`);
  console.log(
    `\n  ${"task".padEnd(36)} ${"n".padStart(3)} ${"median".padStart(7)} ${"range".padStart(11)}`,
  );
  for (const [task, ls] of ranked) {
    const mins = ls.map((l) => l.mins);
    const range = `${Math.min(...mins)}-${Math.max(...mins)}`;
    console.log(
      `  ${task.padEnd(36)} ${String(ls.length).padStart(3)} ${String(median(mins)).padStart(7)} ${range.padStart(11)}`,
    );
  }

  // ---- B. The numbers the public is quoted on --------------------------
  console.log(`\n=== B. Your benchmarks (what the public estimator quotes from) ===`);
  console.log(`  Pair these against section A yourself - the tags and these labels describe`);
  console.log(`  different things, so any automatic pairing would be guesswork.`);
  for (const b of ctx.benchmarks) {
    console.log(`  ${b.label.padEnd(48)} ${String(b.mins).padStart(4)}m`);
  }

  // ---- C. Does the stacking discount exist in reality? ------------------
  console.log(`\n=== C. Stacking: does a task shrink when done alongside others? ===`);
  console.log(`  The estimator bills extra tasks at ~50% (background ~15-25%).`);
  let compared = 0;
  for (const [task, ls] of ranked) {
    const alone = ls.filter((l) => !l.stacked).map((l) => l.mins);
    const withOthers = ls.filter((l) => l.stacked).map((l) => l.mins);
    if (alone.length === 0 || withOthers.length === 0) continue;
    compared++;
    const a = median(alone);
    const s = median(withOthers);
    const pct = a > 0 ? Math.round(((s - a) / a) * 100) : 0;
    console.log(
      `  ${task.padEnd(36)} alone ${String(a).padStart(4)}m (n=${alone.length})  stacked ${String(s).padStart(4)}m (n=${withOthers.length})  ${pct >= 0 ? "+" : ""}${pct}%`,
    );
  }
  console.log(
    compared === 0
      ? `  (no task appears both alone and stacked - cannot judge)`
      : `  Contradictory rows, or n=1 either side, prove nothing.`,
  );

  // ---- D. Whole-job reality --------------------------------------------
  const single = jobTotals.filter((j) => j.taskCount === 1).map((j) => j.mins);
  const multi = jobTotals.filter((j) => j.taskCount > 1).map((j) => j.mins);
  console.log(`\n=== D. Whole-job actual totals (labour only) ===`);
  console.log(
    `  single-task jobs: n=${single.length}  median ${median(single)}m  range ${single.length ? `${Math.min(...single)}-${Math.max(...single)}` : "-"}`,
  );
  console.log(
    `  multi-task jobs:  n=${multi.length}  median ${median(multi)}m  range ${multi.length ? `${Math.min(...multi)}-${Math.max(...multi)}` : "-"}`,
  );
  console.log(
    `\n  These two medians are the most robust numbers here - they need no tag/benchmark\n  pairing. A public estimate for a typical multi-task job should land near ${median(multi)}m.\n`,
  );
}

main()
  .catch((e: unknown) => {
    console.error("calibrate failed:", e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
