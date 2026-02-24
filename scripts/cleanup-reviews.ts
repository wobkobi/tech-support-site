// scripts/cleanup-reviews.ts
/**
 * @file cleanup-reviews.ts
 * @description Removes known dummy seed reviews from the database.
 * Run with: npx tsx scripts/cleanup-reviews.ts
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const DUMMY_TEXTS = [
  "Clear, patient, and fast. Fixed my Wi-Fi and set up backups.",
  "Explained everything in plain terms. Laptop is snappy again.",
  "Recovered my photos and organised them neatly.",
  "Sorted email issues across phone and PC.",
  "Honest advice. No upsell. Left clear notes.",
  "Printer nightmare finally solved.",
];

await prisma.review.deleteMany({ where: { text: { in: DUMMY_TEXTS } } });
await prisma.$disconnect();
