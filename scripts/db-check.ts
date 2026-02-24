// scripts/db-check.ts
/**
 * @file db-check.ts
 * @description Verifies the database connection by running a simple read query.
 * Run with: npx tsx scripts/db-check.ts
 */

import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

/**
 * Checks the database connection by running a simple read query.
 * @returns Promise that resolves when the connection check succeeds.
 */
async function main(): Promise<void> {
  await db.review.count(); // simple read
  console.log("OK");
}
main().finally(() => db.$disconnect());
