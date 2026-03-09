import { describe, it, expect } from "vitest";
import { createMockPrisma } from "./mockPrisma";

// Integration test for mockPrisma utility

describe("mockPrisma integration", () => {
  it("should allow chaining and return values", async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 1, name: "Test User" });
    const result = await prisma.user.findUnique({ where: { id: 1 } });
    expect(result).toEqual({ id: 1, name: "Test User" });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});
