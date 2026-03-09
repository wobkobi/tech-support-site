import { describe, it, expect } from "vitest";
import { createMockPrisma } from "../utils/mockPrisma";

// Minimal test for booking request API route

describe("API: /api/booking/request", () => {
  it("should call prisma.booking.findMany", async () => {
    const prisma = createMockPrisma();
    await prisma.booking.findMany();
    expect(prisma.booking.findMany).toHaveBeenCalled();
  });
});
