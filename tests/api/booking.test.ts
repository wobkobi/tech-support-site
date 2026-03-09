import { describe, it, expect } from "vitest";
import { mockPrisma } from "../utils/mockPrisma";

// Minimal test for booking API route

describe("API: /api/booking", () => {
  it("should call prisma.booking.create", async () => {
    const prisma = mockPrisma();
    await prisma.booking.create({
      data: {
        id: "1",
        name: "Test User",
        email: "test@example.com",
        startUtc: new Date(),
        endUtc: new Date(),
        cancelToken: "token123",
      },
    });
    expect(prisma.booking.create).toHaveBeenCalledWith({ data: { id: "1" } });
  });
});
