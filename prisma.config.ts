// prisma.config.ts
import { config } from "dotenv";
import type { PrismaConfig } from "prisma";

// Load .env.local for Prisma CLI commands
config({ path: ".env.local" });

export default {
  schema: "prisma/schema.prisma",
} satisfies PrismaConfig;
