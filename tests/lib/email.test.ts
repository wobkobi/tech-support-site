// tests/lib/email.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted ensures mockSend is created before the vi.mock factory runs (ESM hoisting).
const mockSend = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: { id: "email-id" }, error: null }),
);

// Mock Resend before importing email.ts so the lazy singleton picks up the mock.
// Must use a regular function (not an arrow function) — arrow functions cannot be
// used as constructors with `new`.
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

import {
  buildPastClientReviewEmailHtml,
  sendOwnerReviewNotification,
  sendOwnerBookingNotification,
  sendCustomerBookingConfirmation,
  sendCustomerReviewRequest,
  sendPastClientReviewRequest,
} from "../../src/features/reviews/lib/email";

// ─── helpers ──────────────────────────────────────────────────────────────────

const BOOKING = {
  id: "b1",
  name: "Alice Smith",
  email: "alice@example.com",
  notes: "Laptop repair\nPlus data backup",
  startAt: new Date("2026-03-11T09:00:00Z"),
  endAt: new Date("2026-03-11T10:00:00Z"),
  cancelToken: "cancel-tok",
};

const REVIEW_REQUEST = {
  id: "rr1",
  name: "Alice Smith",
  email: "alice@example.com",
  reviewToken: "review-tok",
};

const REVIEW = {
  id: "r1",
  text: "Great service!",
  firstName: "Alice",
  lastName: "Smith",
  isAnonymous: false,
  verified: false,
};

// ─── buildPastClientReviewEmailHtml ───────────────────────────────────────────

describe("buildPastClientReviewEmailHtml", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("contains the first name and review URL", () => {
    const html = buildPastClientReviewEmailHtml("Alice", "https://example.com/review?token=abc");
    expect(html).toContain("Hi Alice,");
    expect(html).toContain("https://example.com/review?token=abc");
    expect(html).toContain("Leave a review");
  });

  it("uses NEXT_PUBLIC_SITE_URL for the site link in the signature", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://custom.site.com");
    const html = buildPastClientReviewEmailHtml("Bob", "https://example.com/review");
    expect(html).toContain("https://custom.site.com");
  });

  it("falls back to tothepoint.co.nz when NEXT_PUBLIC_SITE_URL is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const html = buildPastClientReviewEmailHtml("Carol", "https://example.com/review");
    expect(html).toContain("tothepoint.co.nz");
  });
});

// ─── sendOwnerReviewNotification ──────────────────────────────────────────────

describe("sendOwnerReviewNotification", () => {
  beforeEach(() => {
    mockSend.mockClear();
    vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("EMAIL_FROM", "from@example.com");
    vi.stubEnv("RESEND_API_KEY", "test-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends to the admin when fully configured", async () => {
    await sendOwnerReviewNotification(REVIEW);
    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0] as { to: string; subject: string };
    expect(call.to).toBe("admin@example.com");
    expect(call.subject).toContain("Alice Smith");
  });

  it("skips when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await sendOwnerReviewNotification(REVIEW);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips when ADMIN_EMAIL is missing", async () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    await sendOwnerReviewNotification(REVIEW);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("uses 'Anonymous' as display name for anonymous reviews", async () => {
    await sendOwnerReviewNotification({ ...REVIEW, isAnonymous: true });
    const call = mockSend.mock.calls[0][0] as { subject: string };
    expect(call.subject).toContain("Anonymous");
  });

  it("labels verified reviews as verified in the subject", async () => {
    await sendOwnerReviewNotification({ ...REVIEW, verified: true });
    const call = mockSend.mock.calls[0][0] as { subject: string };
    expect(call.subject).toContain("verified");
  });

  it("does not throw when send fails", async () => {
    mockSend.mockRejectedValueOnce(new Error("SMTP error"));
    await expect(sendOwnerReviewNotification(REVIEW)).resolves.toBeUndefined();
  });
});

// ─── sendOwnerBookingNotification ─────────────────────────────────────────────

describe("sendOwnerBookingNotification", () => {
  beforeEach(() => {
    mockSend.mockClear();
    vi.stubEnv("ADMIN_EMAIL", "admin@example.com");
    vi.stubEnv("EMAIL_FROM", "from@example.com");
    vi.stubEnv("RESEND_API_KEY", "test-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends to the admin with the customer name in the subject", async () => {
    await sendOwnerBookingNotification(BOOKING);
    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0] as { to: string; subject: string };
    expect(call.to).toBe("admin@example.com");
    expect(call.subject).toContain("Alice Smith");
  });

  it("skips when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await sendOwnerBookingNotification(BOOKING);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not throw when send fails", async () => {
    mockSend.mockRejectedValueOnce(new Error("SMTP error"));
    await expect(sendOwnerBookingNotification(BOOKING)).resolves.toBeUndefined();
  });
});

// ─── sendCustomerBookingConfirmation ──────────────────────────────────────────

describe("sendCustomerBookingConfirmation", () => {
  beforeEach(() => {
    mockSend.mockClear();
    vi.stubEnv("EMAIL_FROM", "from@example.com");
    vi.stubEnv("RESEND_API_KEY", "test-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends confirmation to the customer", async () => {
    await sendCustomerBookingConfirmation(BOOKING);
    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0] as { to: string; html: string };
    expect(call.to).toBe("alice@example.com");
    expect(call.html).toContain("Alice");
    expect(call.html).toContain("cancel-tok");
  });

  it("skips when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await sendCustomerBookingConfirmation(BOOKING);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not throw when send fails", async () => {
    mockSend.mockRejectedValueOnce(new Error("SMTP error"));
    await expect(sendCustomerBookingConfirmation(BOOKING)).resolves.toBeUndefined();
  });
});

// ─── sendCustomerReviewRequest ────────────────────────────────────────────────

describe("sendCustomerReviewRequest", () => {
  beforeEach(() => {
    mockSend.mockClear();
    vi.stubEnv("EMAIL_FROM", "from@example.com");
    vi.stubEnv("RESEND_API_KEY", "test-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends a review request to the customer", async () => {
    await sendCustomerReviewRequest(REVIEW_REQUEST);
    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(call.to).toBe("alice@example.com");
    expect(call.subject).toContain("Alice");
    expect(call.html).toContain("review-tok");
  });

  it("skips when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await sendCustomerReviewRequest(REVIEW_REQUEST);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not throw when send fails", async () => {
    mockSend.mockRejectedValueOnce(new Error("SMTP error"));
    await expect(sendCustomerReviewRequest(REVIEW_REQUEST)).resolves.toBeUndefined();
  });
});

// ─── sendPastClientReviewRequest ──────────────────────────────────────────────

describe("sendPastClientReviewRequest", () => {
  beforeEach(() => {
    mockSend.mockClear();
    vi.stubEnv("EMAIL_FROM", "from@example.com");
    vi.stubEnv("RESEND_API_KEY", "test-key");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends a past-client review request to the customer", async () => {
    await sendPastClientReviewRequest(REVIEW_REQUEST);
    expect(mockSend).toHaveBeenCalledOnce();
    const call = mockSend.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(call.to).toBe("alice@example.com");
    expect(call.subject).toContain("Alice");
    expect(call.html).toContain("review-tok");
    expect(call.html).toContain("Leave a review");
  });

  it("skips when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await sendPastClientReviewRequest(REVIEW_REQUEST);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not throw when send fails", async () => {
    mockSend.mockRejectedValueOnce(new Error("SMTP error"));
    await expect(sendPastClientReviewRequest(REVIEW_REQUEST)).resolves.toBeUndefined();
  });
});
