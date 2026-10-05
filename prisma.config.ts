// prisma.config.ts
import { existsSync } from "node:fs";
import type { PrismaConfig } from "prisma";

// Load .env.local for Prisma CLI commands. With a config file Prisma skips its own
// .env loading. CI and Vercel have no .env.local (their env is already set), and
// loadEnvFile throws on a missing file, hence the check.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default {
  schema: "prisma/schema.prisma",
} satisfies PrismaConfig;
