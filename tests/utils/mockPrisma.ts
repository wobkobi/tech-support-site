// tests/utils/mockPrisma.ts

import { vi } from "vitest";
import { type Mock } from "vitest";

/**
 * Returns a mocked Prisma-like object with all methods stubbed using Vitest's vi.fn().
 * @returns Mocked Prisma-like object
 */
export function mockPrisma(): {
  user: {
    findUnique: Mock;
    findMany: Mock;
    create: Mock;
    update: Mock;
    delete: Mock;
  };
  review: {
    findUnique: Mock;
    findMany: Mock;
    create: Mock;
    update: Mock;
    delete: Mock;
  };
  booking: {
    findUnique: Mock;
    findMany: Mock;
    findFirst: Mock;
    create: Mock;
    update: Mock;
    updateMany: Mock;
    delete: Mock;
  };
  reviewRequest: {
    findUnique: Mock;
    findMany: Mock;
    findFirst: Mock;
    create: Mock;
    update: Mock;
    updateMany: Mock;
    delete: Mock;
  };
  calendarEventCache: {
    findMany: Mock;
    deleteMany: Mock;
    upsert: Mock;
  };
} {
  return {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    review: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    booking: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    reviewRequest: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    calendarEventCache: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
  };
}

export { mockPrisma as createMockPrisma };
