// src/shared/lib/prisma.ts
/**
 * @file prisma.ts
 * @description Prisma client singleton for server components and routes.
 */
import { PrismaClient } from "@prisma/client";

// Cache the Prisma client on globalThis so hot-reload in dev doesn't leak connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
