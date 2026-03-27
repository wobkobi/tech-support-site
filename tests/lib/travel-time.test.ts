import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch before importing the module
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { calculateTravelMinutes } from "../../src/features/calendar/lib/travel-time";

describe("calculateTravelMinutes", () => {
  const originalEnv = process.env;
  const departure = new Date("2026-04-01T09:00:00Z");

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, GOOGLE_MAPS_API_KEY: "test-key" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null when GOOGLE_MAPS_API_KEY is not set", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const result = await calculateTravelMinutes("home", "destination", departure);
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns travel time in minutes (ceiling) on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        rows: [{ elements: [{ status: "OK", duration: { value: 1260 } }] }], // 21 minutes
      }),
    });
    const result = await calculateTravelMinutes("1 Home St", "2 Work Ave", departure);
    expect(result).toBe(21);
  });

  it("rounds up fractional minutes with Math.ceil", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        rows: [{ elements: [{ status: "OK", duration: { value: 91 } }] }], // 1.516... minutes
      }),
    });
    const result = await calculateTravelMinutes("origin", "dest", departure);
    expect(result).toBe(2);
  });

  it("sends mode=transit and departure_time in the request URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        rows: [{ elements: [{ status: "OK", duration: { value: 600 } }] }],
      }),
    });
    await calculateTravelMinutes("1 Home St", "2 Work Ave", departure);
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("mode=transit");
    expect(calledUrl).toContain(`departure_time=${Math.floor(departure.getTime() / 1000)}`);
  });

  it("sends arrival_time instead of departure_time when useArrivalTime is true", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        rows: [{ elements: [{ status: "OK", duration: { value: 600 } }] }],
      }),
    });
    await calculateTravelMinutes("1 Home St", "2 Work Ave", departure, { useArrivalTime: true });
    const calledUrl: string = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("mode=transit");
    expect(calledUrl).toContain(`arrival_time=${Math.floor(departure.getTime() / 1000)}`);
    expect(calledUrl).not.toContain("departure_time");
  });

  it("returns null when API top-level status is not OK", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "REQUEST_DENIED", rows: [] }),
    });
    const result = await calculateTravelMinutes("a", "b", departure);
    expect(result).toBeNull();
  });

  it("returns null when element status is not OK", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        rows: [{ elements: [{ status: "ZERO_RESULTS" }] }],
      }),
    });
    const result = await calculateTravelMinutes("a", "b", departure);
    expect(result).toBeNull();
  });

  it("returns null when fetch returns a non-OK HTTP status", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });
    const result = await calculateTravelMinutes("a", "b", departure);
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network failure"));
    const result = await calculateTravelMinutes("a", "b", departure);
    expect(result).toBeNull();
  });

  it("bumps proxy forward a week when candidate lands within 1 hour of now", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        rows: [{ elements: [{ status: "OK", duration: { value: 600 } }] }],
      }),
    });

    // now = Saturday 23:30 UTC; departure is a Sunday far in the future at 00:15 UTC.
    // candidate = tomorrow (Sunday) at 00:15 UTC, which is only 45 min from now —
    // within the 1 h safety margin → must be bumped an extra week.
    const fakeNow = new Date("2026-03-28T23:30:00Z"); // Saturday
    vi.setSystemTime(fakeNow);

    const farDeparture = new Date("2026-06-07T00:15:00Z"); // Sunday, > 7 days away
    await calculateTravelMinutes("home", "dest", farDeparture);

    const calledUrl: string = mockFetch.mock.calls[0][0];
    const params = new URL(calledUrl).searchParams;
    const usedTimestamp = Number(params.get("departure_time")) * 1000;
    const usedDate = new Date(usedTimestamp);

    // Proxy must be at least 1 h after fakeNow (not in the near-past danger zone)
    expect(usedDate.getTime()).toBeGreaterThan(fakeNow.getTime() + 60 * 60 * 1000);
    // Proxy must still land on a Sunday
    expect(usedDate.getUTCDay()).toBe(farDeparture.getUTCDay());

    vi.useRealTimers();
  });

  it("proxies departure_time to nearest same-day-of-week when event is more than 7 days away", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        rows: [{ elements: [{ status: "OK", duration: { value: 600 } }] }],
      }),
    });

    // Fix "now" so the horizon check is deterministic
    const fakeNow = new Date("2026-03-27T10:00:00Z"); // Friday UTC
    vi.setSystemTime(fakeNow);

    // Event on Tuesday 2026-04-14 at 12:00 UTC — 18 days away, beyond 7-day horizon
    const farDeparture = new Date("2026-04-14T12:00:00Z"); // Tuesday UTC
    await calculateTravelMinutes("home", "dest", farDeparture);

    const calledUrl: string = mockFetch.mock.calls[0][0];
    const params = new URL(calledUrl).searchParams;
    const usedTimestamp = Number(params.get("departure_time")) * 1000;
    const usedDate = new Date(usedTimestamp);

    // Proxy must be within 7 days of fakeNow
    expect(usedDate.getTime()).toBeLessThanOrEqual(
      fakeNow.getTime() + 7 * 24 * 60 * 60 * 1000 + 60_000,
    );
    // Proxy must preserve day-of-week (Tuesday = 2)
    expect(usedDate.getUTCDay()).toBe(farDeparture.getUTCDay());
    // Proxy must preserve time-of-day
    expect(usedDate.getUTCHours()).toBe(farDeparture.getUTCHours());
    expect(usedDate.getUTCMinutes()).toBe(farDeparture.getUTCMinutes());

    vi.useRealTimers();
  });
});
