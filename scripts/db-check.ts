import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
/**
 * A simple script to check if the database connection is working.
 * @returns Promise<void>
 */
async function main(): Promise<void> {
  await db.review.count(); // simple read
  console.log("OK");
}
main().finally(() => db.$disconnect());
