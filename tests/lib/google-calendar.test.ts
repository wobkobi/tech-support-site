import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getBookingCalendarId,
  getCalendarIds,
  getOAuth2Client,
} from "../../src/features/calendar/lib/google-calendar";

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

vi.mock("../../src/features/calendar/lib/google-calendar", () => {
  return {
    ...vi.importActual("../../src/features/calendar/lib/google-calendar"),
    google: {
      auth: { OAuth2: mockOAuth2 },
      calendar: vi.fn(),
    },
  };
});

// Mock environment variables
const envBackup = { ...process.env };

beforeEach(() => {
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

describe("google-calendar integration", () => {
  it("should return correct booking calendar id", () => {
    expect(getBookingCalendarId()).toBe("booking-cal-id");
  });

  it("should return all calendar ids", () => {
    expect(getCalendarIds()).toEqual(["booking-cal-id", "work-cal-id", "personal-cal-id"]);
  });

  it("should fallback to 'primary' if no calendar ids", () => {
    process.env.BOOKING_CALENDAR_ID = "";
    process.env.WORK_CALENDAR_ID = "";
    process.env.PERSONAL_CALENDAR_ID = "";
    expect(getCalendarIds()).toEqual(["primary"]);
  });

  it("should create OAuth2 client with env credentials", () => {
    const client = getOAuth2Client();
    expect(mockOAuth2).toHaveBeenCalledWith(
      "mock-client-id",
      "mock-client-secret",
      "https://developers.google.com/oauthplayground",
    );
    expect(typeof client.setCredentials).toBe("function");
  });
});
