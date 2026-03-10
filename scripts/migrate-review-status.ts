// scripts/migrate-review-status.ts
/**
 * @file migrate-review-status.ts
 * @description One-time migration: converts old Review documents that used an `approved`
 * boolean field to the current `status` enum (pending | approved | revoked).
 *
 * Old schema: { approved: boolean, ...no status field }
 * New schema: { status: "pending" | "approved" | "revoked" }
 *
 * Run with: npx tsx scripts/migrate-review-status.ts
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

interface LegacyReview {
  _id: { $oid: string };
  approved?: boolean;
  status?: string;
}

/**
 * Main migration function: finds all reviews without a `status` field, determines the new status
 */
async function main(): Promise<void> {
  // findRaw returns the raw MongoDB documents, including fields not in the Prisma schema
  const raw = await db.review.findRaw({
    filter: { status: { $exists: false } },
  });

  const docs = raw as unknown as LegacyReview[];

  if (docs.length === 0) {
    console.log("No legacy reviews found — nothing to migrate.");
    return;
  }

  console.log(`Found ${docs.length} legacy review(s) to migrate.`);

  let migrated = 0;
  let failed = 0;

  for (const doc of docs) {
    const id = doc._id.$oid;
    const newStatus = doc.approved === true ? "approved" : "pending";

    try {
      await db.review.update({
        where: { id },
        data: { status: newStatus },
      });
      console.log(`  ✓ ${id} → ${newStatus} (was approved=${doc.approved ?? "missing"})`);
      migrated++;
    } catch (err) {
      console.error(`  ✗ ${id} failed:`, err);
      failed++;
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Failed: ${failed}`);
}

main().finally(() => db.$disconnect());
