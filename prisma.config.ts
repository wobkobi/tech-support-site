// prisma.config.ts
import type { PrismaConfig } from "prisma";
import { config } from "dotenv";

// Load .env.local for Prisma CLI commands
config({ path: ".env.local" });

export default {
  schema: "prisma/schema.prisma",
} satisfies PrismaConfig;
