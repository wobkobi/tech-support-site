// src/features/social/lib/insights/analytics-csv.ts
// Analytics' downloads: one line per post with each app's figures, or one per app and day.
// Pure and client-safe.

import type { AnalyticsPost } from "@/features/social/lib/insights/analytics.server";
import {
  engagementRate,
  FIGURE_KEYS,
  FIGURE_LABEL,
  type DayFigureKey,
  type DayFigures,
} from "@/features/social/lib/insights/metrics";
import { FORMAT_LABEL } from "@/features/social/lib/media";
import { PLATFORM_LABEL, type SocialPlatformKey } from "@/features/social/lib/validate";
import { CSV_BOM, CSV_EOL, csvText } from "@/shared/lib/csv";
import { nzDateKey } from "@/shared/lib/timezone-utils";

/**
 * A cell for a figure; blank when the app didn't give it.
 * @param value - The figure.
 * @returns The cell text.
 */
function figureCell(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * A day key as DD/MM/YYYY, which spreadsheets read as a date.
 * @param key - YYYY-MM-DD.
 * @returns The date.
 */
function slashDate(key: string): string {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * The posts CSV: one line per post and app, so each app's figures stay apart.
 * @param posts - Posts in the range.
 * @returns The CSV text, BOM first, CRLF line endings.
 */
export function postsCsv(posts: readonly AnalyticsPost[]): string {
  const headers = [
    "Date",
    "Post",
    "Kind",
    "App",
    ...FIGURE_KEYS.map((k) => FIGURE_LABEL[k]),
    "Engagement rate",
    "Note",
    "Link",
  ];
  const lines = [headers.map(csvText).join(",")];
  for (const post of posts) {
    for (const app of post.byApp) {
      const rate = engagementRate(app.figures);
      lines.push(
        [
          slashDate(nzDateKey(new Date(post.postedAt))),
          post.name,
          FORMAT_LABEL[post.format],
          PLATFORM_LABEL[app.platform],
          ...FIGURE_KEYS.map((k) => figureCell(app.figures[k])),
          rate === null ? "" : `${(rate * 100).toFixed(1)}%`,
          app.note ?? "",
          app.link ?? "",
        ]
          .map(csvText)
          .join(","),
      );
    }
  }
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

const DAY_COLUMNS: readonly [DayFigureKey, string][] = [
  ["views", "Views"],
  ["reach", "Reach"],
  ["engagements", "Engagements"],
  ["follows", "New followers"],
  ["unfollows", "Unfollows"],
  ["clicks", "Link clicks"],
  ["searchViews", "Search views"],
  ["mapsViews", "Maps views"],
  ["calls", "Calls"],
  ["websiteClicks", "Website clicks"],
  ["directions", "Directions"],
  ["conversations", "Messages"],
  ["bookings", "Bookings"],
];

/**
 * The days CSV: one line per app and day, oldest first.
 * @param days - Each app's figures by day.
 * @returns The CSV text, BOM first, CRLF line endings.
 */
export function daysCsv(
  days: readonly { platform: SocialPlatformKey; day: string; figures: DayFigures }[],
): string {
  const lines = [["Date", "App", ...DAY_COLUMNS.map(([, label]) => label)].map(csvText).join(",")];
  const sorted = [...days].sort(
    (a, b) => a.day.localeCompare(b.day) || a.platform.localeCompare(b.platform),
  );
  for (const d of sorted) {
    lines.push(
      [
        slashDate(d.day),
        PLATFORM_LABEL[d.platform],
        ...DAY_COLUMNS.map(([key]) => figureCell(d.figures[key])),
      ]
        .map(csvText)
        .join(","),
    );
  }
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

/**
 * The download's file name, e.g. "social-posts-2026-09-25-to-2026-10-22.csv".
 * @param what - Posts or days.
 * @param from - First day.
 * @param to - Last day.
 * @returns The name.
 */
export function analyticsCsvName(what: "posts" | "days", from: string, to: string): string {
  return `social-${what}-${from}-to-${to}.csv`;
}
