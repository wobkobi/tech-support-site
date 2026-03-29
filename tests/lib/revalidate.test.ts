import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  revalidatePath: mocks.revalidatePath,
}));

import { revalidateReviewPaths } from "../../src/features/reviews/lib/revalidate";

describe("revalidateReviewPaths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls revalidateTag with reviews tag", () => {
    revalidateReviewPaths();
    expect(mocks.revalidateTag).toHaveBeenCalledWith("reviews", {});
  });

  it("revalidates /reviews, /review, and / paths", () => {
    revalidateReviewPaths();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/review");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });
});
