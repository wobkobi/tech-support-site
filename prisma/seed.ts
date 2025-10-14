// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const SEED = [
  {
    text: "Clear, patient, and fast. Fixed my Wi-Fi and set up backups.",
    firstName: "Alice",
    lastName: "Ngata",
    isAnonymous: false,
    approved: true,
  },
  {
    text: "Explained everything in plain terms. Laptop is snappy again.",
    firstName: "Ben",
    lastName: "Kaur",
    isAnonymous: false,
    approved: true,
  },
  {
    text: "Recovered my photos and organised them neatly.",
    firstName: "Chloe",
    lastName: "Rangi",
    isAnonymous: false,
    approved: true,
  },
  {
    text: "Sorted email issues across phone and PC.",
    firstName: "Daniel",
    lastName: "Li",
    isAnonymous: false,
    approved: false,
  },
  {
    text: "Honest advice. No upsell. Left clear notes.",
    firstName: "Ella",
    lastName: "Patel",
    isAnonymous: false,
    approved: false,
  },
  {
    text: "Printer nightmare finally solved.",
    firstName: "",
    lastName: "",
    isAnonymous: true,
    approved: true,
  },
  {
    text: "Printer nightmare finally solved.",
    firstName: "",
    lastName: "",
    isAnonymous: true,
    approved: true,
  },
];

/**
 * Seed the database with initial reviews.
 */
async function main(): Promise<void> {
  await prisma.review.createMany({ data: SEED });
}
main().finally(() => prisma.$disconnect());
