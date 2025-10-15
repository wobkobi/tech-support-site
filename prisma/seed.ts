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
  // dev safety: uncomment to block seeding in production
  // if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");

  // Start clean (Mongo-friendly)
  await prisma.review.deleteMany({});

  // Normalise payload
  const data = SEED.map((r) => {
    const isAnon = !!r.isAnonymous;
    const f = r.firstName ? r.firstName.trim() : null;
    const l = r.lastName ? r.lastName.trim() : null;
    return {
      text: r.text.trim(),
      isAnonymous: isAnon,
      firstName: isAnon ? null : f || null,
      lastName: isAnon ? null : l || null,
      approved: !!r.approved,
    };
  });

  await prisma.review.createMany({ data });
  console.log(`Seeded ${data.length} reviews`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });