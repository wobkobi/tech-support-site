import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const TEXTS = [
  "Clear, patient, and fast. Fixed my Wi-Fi and set up backups.",
  "Explained everything in plain terms. Laptop is snappy again.",
  "Recovered my photos and organised them neatly.",
  "Sorted email issues across phone and PC.",
  "Honest advice. No upsell. Left clear notes.",
  "Printer nightmare finally solved.",
];

/**
 * Unseed the database by deleting the seeded reviews.
 */
async function main(): Promise<void> {
  const res = await prisma.review.deleteMany({
    where: { text: { in: TEXTS } },
  });
  console.log(`Deleted ${res.count} seeded reviews`);
}
main().finally(() => prisma.$disconnect());
