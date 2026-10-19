// src/features/social/lib/google-post.ts
// Builds the Business Profile localPosts request body from a post. Pure, so the check
// script covers it; google-business.ts sends it.

import type { PublishInput } from "@/features/social/lib/adapter";

interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** The localPosts fields this site writes (v4 LocalPost). */
export interface GoogleLocalPostBody {
  languageCode: string;
  topicType: "STANDARD" | "OFFER" | "EVENT";
  summary: string;
  media?: { mediaFormat: "PHOTO"; sourceUrl: string }[];
  callToAction?: { actionType: "BOOK" | "CALL" | "LEARN_MORE"; url?: string };
  event?: {
    title: string;
    schedule: {
      startDate: DateParts;
      startTime: { hours: number; minutes: number };
      endDate: DateParts;
      endTime: { hours: number; minutes: number };
    };
  };
  offer?: { couponCode?: string; redeemOnlineUrl?: string };
}

/**
 * Splits YYYY-MM-DD into Google's Date message.
 * @param key - Date key.
 * @returns Year, month and day.
 */
function dateParts(key: string): DateParts {
  const [year, month, day] = key.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/**
 * The localPosts body. Offers carry title and a whole-day schedule (TimeInterval needs every
 * field) and their link as redeemOnlineUrl, since callToAction is ignored on offers. Updates
 * send a link only with Book or Learn more; CALL takes no URL.
 * @param input - Filled text, picture, link and Google settings.
 * @returns Request body.
 */
export function googlePostBody(input: PublishInput): GoogleLocalPostBody {
  const { google } = input;
  const body: GoogleLocalPostBody = {
    languageCode: "en",
    topicType: google.type,
    summary: input.text,
  };
  if (input.imageUrl) body.media = [{ mediaFormat: "PHOTO", sourceUrl: input.imageUrl }];

  if (google.type === "OFFER" || google.type === "EVENT") {
    if (!google.title || !google.start || !google.end) {
      throw new Error("A Google offer needs a title and both dates.");
    }
    body.event = {
      title: google.title,
      schedule: {
        startDate: dateParts(google.start),
        startTime: { hours: 0, minutes: 0 },
        endDate: dateParts(google.end),
        endTime: { hours: 23, minutes: 59 },
      },
    };
    if (google.type === "OFFER") {
      const offer = {
        ...(google.couponCode ? { couponCode: google.couponCode } : {}),
        ...(input.linkUrl ? { redeemOnlineUrl: input.linkUrl } : {}),
      };
      if (Object.keys(offer).length > 0) body.offer = offer;
    }
    return body;
  }

  if (google.cta === "CALL") body.callToAction = { actionType: "CALL" };
  else if (google.cta && input.linkUrl) {
    body.callToAction = { actionType: google.cta, url: input.linkUrl };
  }
  return body;
}
