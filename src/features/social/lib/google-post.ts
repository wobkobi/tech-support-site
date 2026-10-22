// src/features/social/lib/google-post.ts
// Builds the Business Profile localPosts request body from a post. Pure, so the check
// script covers it; google-business.ts sends it.

import type { PublishInput } from "@/features/social/lib/adapter";
import type { GooglePostCta } from "@/features/social/lib/validate";

interface DateParts {
  year: number;
  month: number;
  day: number;
}

interface TimeParts {
  hours: number;
  minutes: number;
}

/** The localPosts fields this site writes (v4 LocalPost). */
export interface GoogleLocalPostBody {
  languageCode: string;
  topicType: "STANDARD" | "OFFER" | "EVENT";
  summary: string;
  media?: { mediaFormat: "PHOTO"; sourceUrl: string }[];
  callToAction?: { actionType: GooglePostCta; url?: string };
  event?: {
    title: string;
    schedule: {
      startDate: DateParts;
      startTime: TimeParts;
      endDate: DateParts;
      endTime: TimeParts;
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
 * Splits "HH:MM" into Google's TimeOfDay message.
 * @param time - 24-hour time.
 * @returns Hours and minutes.
 */
function timeParts(time: string): TimeParts {
  const [hours, minutes] = time.split(":").map(Number);
  return { hours: hours!, minutes: minutes! };
}

/**
 * The localPosts body. Offers and events carry a title and schedule (TimeInterval needs every
 * field, so a whole day runs 00:00 to 23:59); Google reads the times in the profile's own time
 * zone, so NZ times go as they are. Offers send their link as redeemOnlineUrl, since
 * callToAction is ignored on them. Updates and events send a button: CALL takes no URL (and an
 * event can't ring), the rest go to the Google button link or the post's Link.
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
      const what = google.type === "OFFER" ? "offer" : "event";
      throw new Error(`A Google ${what} needs a title and both dates.`);
    }
    const timed = google.type === "EVENT" && google.startTime && google.endTime;
    body.event = {
      title: google.title,
      schedule: {
        startDate: dateParts(google.start),
        startTime: timed ? timeParts(google.startTime!) : { hours: 0, minutes: 0 },
        endDate: dateParts(google.end),
        endTime: timed ? timeParts(google.endTime!) : { hours: 23, minutes: 59 },
      },
    };
  }
  if (google.type === "OFFER") {
    const offer = {
      ...(google.couponCode ? { couponCode: google.couponCode } : {}),
      ...(input.linkUrl ? { redeemOnlineUrl: input.linkUrl } : {}),
    };
    if (Object.keys(offer).length > 0) body.offer = offer;
    return body;
  }

  const url = google.url || input.linkUrl;
  if (google.cta === "CALL") {
    if (google.type === "STANDARD") body.callToAction = { actionType: "CALL" };
  } else if (google.cta && url) {
    body.callToAction = { actionType: google.cta, url };
  }
  return body;
}
