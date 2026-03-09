import { describe, it, expect } from "vitest";
import { createMockPrisma } from "./mockPrisma";

// Minimal test for mockPrisma utility

describe("createMockPrisma", () => {
  it("should return a mock PrismaClient with stubbed methods", () => {
    const prisma = createMockPrisma();
    expect(typeof prisma.user.findUnique).toBe("function");
    expect(typeof prisma.review.create).toBe("function");
    // Should be Vitest mock functions
    expect(prisma.user.findUnique.mock).toBeDefined();
    expect(prisma.review.create.mock).toBeDefined();
  });

  it("should allow chaining and return values", async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 1, name: "Test User" });
    const result = await prisma.user.findUnique({ where: { id: 1 } });
    expect(result).toEqual({ id: 1, name: "Test User" });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("should mock reviewRequest.create", async () => {
    const prisma = createMockPrisma();
    prisma.reviewRequest.create.mockResolvedValue({ id: 2, text: "Sample" });
    const result = await prisma.reviewRequest.create({ data: { text: "Sample" } });
    expect(result).toEqual({ id: 2, text: "Sample" });
    expect(prisma.reviewRequest.create).toHaveBeenCalledWith({ data: { text: "Sample" } });
  });
});
