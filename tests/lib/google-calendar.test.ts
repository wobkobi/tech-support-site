import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted ensures mockOAuth2 is available when the vi.mock factory runs (which is hoisted)
const { mockOAuth2 } = vi.hoisted(() => {
  const mockOAuth2 = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ) {
    this.setCredentials = vi.fn();
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  });
  return { mockOAuth2 };
});

// Mock the googleapis package so getOAuth2Client uses our mockOAuth2 constructor
vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: mockOAuth2 },
    calendar: vi.fn(),
  },
}));

import {
  getBookingCalendarId,
  getOAuth2Client,
} from "../../src/features/calendar/lib/google-calendar";

const envBackup = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BOOKING_CALENDAR_ID = "booking-cal-id";
  process.env.WORK_CALENDAR_ID = "work-cal-id";
  process.env.PERSONAL_CALENDAR_ID = "personal-cal-id";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "mock-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "mock-client-secret";
  process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "mock-refresh-token";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://developers.google.com/oauthplayground";
});

afterEach(() => {
  process.env = { ...envBackup };
});

describe("google-calendar utilities", () => {
  it("returns the booking calendar id from env", () => {
    expect(getBookingCalendarId()).toBe("booking-cal-id");
  });

  it("creates an OAuth2 client with credentials from env", () => {
    const client = getOAuth2Client();
    expect(mockOAuth2).toHaveBeenCalledWith(
      "mock-client-id",
      "mock-client-secret",
      "https://developers.google.com/oauthplayground",
    );
    expect(typeof client.setCredentials).toBe("function");
  });

  it("throws when OAuth credentials are missing", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(() => getOAuth2Client()).toThrow(/Missing Google OAuth/);
  });
});
