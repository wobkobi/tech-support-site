// scripts/drop-review-request.ts
/**
 * @file drop-review-request.ts
 * @description One-off cleanup: drops the retired `ReviewRequest` MongoDB
 * collection. Its send-state (reviewToken, reviewLinkSentAt/Mode/SubmittedAt) was
 * long ago migrated onto Contact by the idempotent auto-maintain shim, which is
 * being removed alongside this. Dry-run by default (prints the row count); pass
 * `--force` to actually drop.
 *
 * Run: dotenv -e .env.local -- tsx scripts/drop-review-request.ts [--force]
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Counts the ReviewRequest collection, then drops it when `--force` is passed.
 * @returns Promise that resolves when the check/drop completes.
 */
async function main(): Promise<void> {
  const force = process.argv.includes("--force");

  let count: number | null = null;
  try {
    const res = (await db.$runCommandRaw({ count: "ReviewRequest" })) as { n?: number };
    count = res.n ?? 0;
  } catch {
    console.log("ReviewRequest collection does not exist - nothing to drop.");
    return;
  }

  console.log(`ReviewRequest has ${count} document(s).`);

  if (!force) {
    console.log("Dry run. Re-run with --force to drop the collection.");
    return;
  }

  try {
    await db.$runCommandRaw({ drop: "ReviewRequest" });
    console.log("Dropped ReviewRequest.");
  } catch (err) {
    console.error("Failed to drop ReviewRequest:", err);
    process.exitCode = 1;
  }
}

main().finally(() => db.$disconnect());
