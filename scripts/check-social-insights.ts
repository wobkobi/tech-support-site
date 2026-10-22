// scripts/check-social-insights.ts
// Social stats: when each reading is due, which posts have figures, reading Meta's and Google's
// answers, sorting Meta's errors, the sync's stored state, the days each app is read for, the
// sums, chart groups, best times and content averages Analytics shows, its address, the count
// axis, and the downloads. Pure logic, no DB.
// Run with: npm test -- social-insights

import { formatCount, niceScale } from "@/features/admin/components/charts/chart-scale";
import { analyticsCsvName, daysCsv, postsCsv } from "@/features/social/lib/insights/analytics-csv";
import type { AnalyticsPost } from "@/features/social/lib/insights/analytics.server";
import {
  agesFor,
  bestTimes,
  contentPerformance,
  dayGroups,
  dayLabel,
  daysBetween,
  dayWindow,
  engagementRate,
  facebookDays,
  fieldValues,
  figuresOf,
  googleDays,
  hasPostStats,
  insightValues,
  instagramDay,
  liveSkips,
  metaProblem,
  milestoneDue,
  NO_FIGURES,
  postAsk,
  problemNote,
  readAppFilter,
  readRange,
  readState,
  scopeIn,
  skipKey,
  STORY_AGES,
  sumDays,
  sumFigures,
  type Figures,
} from "@/features/social/lib/insights/metrics";
import { expect, expectEqual, finish } from "./lib/harness.js";

const HOUR = 3_600_000;
const POSTED = new Date("2026-10-20T20:00:00.000Z");

/**
 * The time some hours after the test post went out.
 * @param hours - Hours after.
 * @returns The time.
 */
function after(hours: number): Date {
  return new Date(POSTED.getTime() + hours * HOUR);
}

/**
 * Figures with some filled in.
 * @param over - The figures given.
 * @returns The figures.
 */
function figures(over: Partial<Figures>): Figures {
  return { ...NO_FIGURES, ...over };
}

/** When readings are due, and which posts have figures. */
function checkAges(): void {
  console.log("Ages");
  expectEqual("not an hour yet", milestoneDue(POSTED, "feed", [], after(0.5)), null);
  expectEqual("an hour in", milestoneDue(POSTED, "feed", [], after(2)), 1);
  expectEqual("a day in, hour kept", milestoneDue(POSTED, "feed", [1], after(25)), 24);
  expectEqual("a day in, hour missed", milestoneDue(POSTED, "feed", [], after(25)), 24);
  expectEqual("a day in, day kept", milestoneDue(POSTED, "feed", [24], after(25)), null);
  expectEqual("later age kept", milestoneDue(POSTED, "feed", [72], after(25)), null);
  expectEqual("three days in", milestoneDue(POSTED, "feed", [1, 24], after(100)), 72);
  expectEqual("all kept", milestoneDue(POSTED, "feed", [672], after(800)), null);
  expectEqual("story at 7 hours", milestoneDue(POSTED, "story", [1], after(7)), 6);
  expectEqual("story near the end", milestoneDue(POSTED, "story", [6], after(23.5)), 23);
  expectEqual("story gone", milestoneDue(POSTED, "story", [], after(24)), null);
  expectEqual("story ages", agesFor("story"), STORY_AGES);

  expect("Facebook post has figures", hasPostStats("facebook", "feed"));
  expect("Facebook reel has figures", hasPostStats("facebook", "reel"));
  expect("Instagram story has figures", hasPostStats("instagram", "story"));
  expect("Facebook story has none", !hasPostStats("facebook", "story"));
  expect("Google has none", !hasPostStats("google", "feed"));
  expect("a cover has none", !hasPostStats("instagram", "cover"));

  expectEqual("Facebook reel edge", postAsk("facebook", "reel").edge, "video_insights");
  expectEqual("Facebook post kind", postAsk("facebook", "story").kind, "facebook-post");
  expectEqual("Instagram story kind", postAsk("instagram", "story").kind, "instagram-story");
  expectEqual("Instagram reel kind", postAsk("instagram", "reel").kind, "instagram-media");
}

/** Reading Meta's answers about a post. */
function checkMetaAnswers(): void {
  console.log("Meta answers");
  expectEqual(
    "insights",
    insightValues({
      data: [
        { name: "post_media_view", values: [{ value: 10 }, { value: 12 }] },
        { name: "views", total_value: { value: 30 } },
        { name: "reactions_by_type", values: [{ value: { like: 3, love: 2 } }] },
        { name: "nothing", values: [] },
        { values: [{ value: 1 }] },
      ],
    }),
    { post_media_view: 12, views: 30, reactions_by_type: 5 },
  );
  expectEqual(
    "fields",
    fieldValues(
      {
        reactions: { summary: { total_count: 7 } },
        comments: { data: [], summary: { total_count: 2 } },
        like_count: 4,
      },
      ["reactions", "comments", "shares", "like_count", "likes"],
    ),
    { reactions: 7, comments: 2, shares: 0, like_count: 4 },
  );
  expectEqual("shares count", fieldValues({ shares: { count: 3 } }, ["shares"]), { shares: 3 });

  const post = figuresOf(
    postAsk("facebook", "feed"),
    { post_media_view: 100, post_clicks: 5 },
    { reactions: 7, comments: 2, shares: 1 },
  );
  expectEqual("Facebook post figures", post.figures, {
    views: 100,
    reach: null,
    likes: 7,
    comments: 2,
    shares: 1,
    saves: null,
    clicks: 5,
    engagements: 10,
  });
  expectEqual("no extra", post.extra, null);

  const reel = figuresOf(
    postAsk("facebook", "reel"),
    { blue_reels_play_count: 50, post_video_avg_time_watched: 4000 },
    { likes: 3 },
  );
  expectEqual("reel views", reel.figures.views, 50);
  expectEqual("reel extra", reel.extra, { post_video_avg_time_watched: 4000 });
  expectEqual("reel engagements added up", reel.figures.engagements, 3);

  const insta = figuresOf(
    postAsk("instagram", "feed"),
    { likes: 5, total_interactions: 9 },
    { like_count: 99, comments_count: 1 },
  );
  expectEqual("insights before fields", insta.figures.likes, 5);
  expectEqual("fields fill the gaps", insta.figures.comments, 1);
  expectEqual("given engagements kept", insta.figures.engagements, 9);
  expectEqual("nothing given", figuresOf(postAsk("instagram", "feed"), {}, {}).figures, NO_FIGURES);
  expectEqual(
    "no engagements from shares alone",
    figuresOf(postAsk("facebook", "feed"), {}, { shares: 0 }).figures.engagements,
    null,
  );
}

/** Sorting Meta's errors and the notes they leave. */
function checkProblems(): void {
  console.log("Meta problems");
  expectEqual("bad token", metaProblem(190, "Error validating access token"), "token");
  expectEqual("rate limit", metaProblem(17, null), "rate");
  expectEqual("app rate limit", metaProblem(4, "Application request limit reached"), "rate");
  expectEqual(
    "deleted post",
    metaProblem(
      100,
      "Object with ID '123' does not exist, cannot be loaded due to missing permissions",
    ),
    "gone",
  );
  expectEqual(
    "renamed metric",
    metaProblem(100, "(#100) The value must be a valid insights metric"),
    "invalid",
  );
  expectEqual(
    "missing permission",
    metaProblem(10, "Application does not have permission"),
    "permission",
  );
  expectEqual("permission range", metaProblem(200, null), "permission");
  expectEqual(
    "too few viewers",
    metaProblem(100, "Not enough viewers for the media to show insights"),
    "thin",
  );
  expectEqual("other", metaProblem(1, "Something broke"), "other");
  expectEqual("no code", metaProblem(null, null), "other");
  expectEqual(
    "named permission",
    scopeIn(
      "(#10) This endpoint requires the 'pages_read_user_content' permission or the 'Page Public Content Access' feature.",
    ),
    "pages_read_user_content",
  );
  expectEqual("no permission named", scopeIn("(#10) Application does not have permission"), null);
  expectEqual("no message", scopeIn(null), null);

  expectEqual(
    "permission note",
    problemNote("facebook", "permission", "read_insights"),
    "Some figures need the read_insights permission, which the Meta token doesn't have.",
  );
  expectEqual(
    "thin note",
    problemNote("instagram", "thin", null),
    "Instagram shows these figures once more people have seen the post.",
  );
  expectEqual(
    "gone note",
    problemNote("facebook", "gone", null),
    "The post is no longer on Facebook.",
  );
  expectEqual("renamed metric has no note", problemNote("facebook", "invalid", "x"), null);
  expectEqual(
    "other note",
    problemNote("facebook", "other", "Something broke"),
    "Facebook didn't give figures: Something broke",
  );
}

/** The sync's stored state and skips. */
function checkState(): void {
  console.log("State");
  const now = new Date("2026-10-22T00:00:00.000Z");
  expectEqual("skip key", skipKey("facebook-post", "post_clicks"), "facebook-post:post_clicks");
  expectEqual(
    "live skips",
    Object.keys(
      liveSkips(
        {
          a: { until: "2026-10-23T00:00:00.000Z", why: "invalid", scope: null },
          b: { until: "2026-10-21T00:00:00.000Z", why: "permission", scope: "read_insights" },
        },
        now,
      ),
    ),
    ["a"],
  );

  expectEqual("nothing stored", readState(null), {
    ranAt: null,
    daysAt: {},
    errors: {},
    skips: {},
  });
  expectEqual("not JSON", readState("{nope"), { ranAt: null, daysAt: {}, errors: {}, skips: {} });
  const fresh = readState(null);
  fresh.daysAt.facebook = "2026-10-22T00:00:00.000Z";
  expectEqual("fresh states share nothing", readState(null).daysAt, {});
  expectEqual(
    "keeps what's well formed",
    readState(
      JSON.stringify({
        ranAt: "2026-10-22T00:00:00.000Z",
        daysAt: { facebook: "2026-10-21T00:00:00.000Z", instagram: 5 },
        errors: "nope",
        skips: {
          "k:a": { until: "2026-10-29T00:00:00.000Z", why: "invalid", scope: 3 },
          "k:b": { until: "2026-10-29T00:00:00.000Z", why: "other" },
          "k:c": { why: "permission" },
        },
      }),
    ),
    {
      ranAt: "2026-10-22T00:00:00.000Z",
      daysAt: { facebook: "2026-10-21T00:00:00.000Z" },
      errors: {},
      skips: { "k:a": { until: "2026-10-29T00:00:00.000Z", why: "invalid", scope: null } },
    },
  );
}

/** Which days each app is read for, and reading its answer. */
function checkDays(): void {
  console.log("Account days");
  const today = "2026-10-22";
  expectEqual("Facebook backfill", dayWindow("facebook", today, null), {
    from: "2026-09-22",
    to: "2026-10-21",
  });
  expectEqual("Google backfill", dayWindow("google", today, null), {
    from: "2026-09-20",
    to: "2026-10-19",
  });
  expectEqual("Meta reads its last 3 again", dayWindow("instagram", today, "2026-10-20"), {
    from: "2026-10-18",
    to: "2026-10-21",
  });
  expectEqual("Google reads its last 5 again", dayWindow("google", today, "2026-10-19"), {
    from: "2026-10-15",
    to: "2026-10-19",
  });
  expectEqual("a kept day past the end", dayWindow("google", today, "2026-10-21"), {
    from: "2026-10-15",
    to: "2026-10-19",
  });
  expectEqual("long gap stops at the backfill", dayWindow("facebook", today, "2026-01-01"), {
    from: "2026-09-22",
    to: "2026-10-21",
  });
  expectEqual("days across a month", daysBetween("2026-10-30", "2026-11-02"), [
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
  ]);
  expectEqual("no days backwards", daysBetween("2026-11-02", "2026-10-30"), []);

  expectEqual(
    "Facebook's day ends at its stamp",
    [
      ...facebookDays({
        data: [
          {
            name: "page_media_view",
            values: [
              { value: 10, end_time: "2026-10-20T07:00:00+0000" },
              { value: 12, end_time: "2026-10-21T07:00:00+0000" },
            ],
          },
          {
            name: "page_daily_follows_unique",
            values: [{ value: 1, end_time: "2026-10-21T07:00:00+0000" }],
          },
          { name: "page_unknown", values: [{ value: 9, end_time: "2026-10-21T07:00:00+0000" }] },
        ],
      }),
    ],
    [
      ["2026-10-19", { views: 10 }],
      ["2026-10-20", { views: 12, follows: 1 }],
    ],
  );

  const totals = {
    data: [
      { name: "views", total_value: { value: 40 } },
      { name: "reach", total_value: { value: 30 } },
      { name: "website_clicks", total_value: { value: 2 } },
    ],
  };
  const follows = {
    data: [
      {
        name: "follows_and_unfollows",
        total_value: {
          breakdowns: [
            {
              results: [
                { dimension_values: ["FOLLOWER"], value: 3 },
                { dimension_values: ["NON_FOLLOWER"], value: 1 },
              ],
            },
          ],
        },
      },
    ],
  };
  expectEqual("Instagram day", instagramDay(totals, follows), {
    views: 40,
    reach: 30,
    clicks: 2,
    follows: 3,
    unfollows: 1,
  });
  expectEqual("Instagram day without follows", instagramDay(totals, null), {
    views: 40,
    reach: 30,
    clicks: 2,
  });

  expectEqual(
    "Google days",
    [
      ...googleDays({
        multiDailyMetricTimeSeries: [
          {
            dailyMetricTimeSeries: [
              {
                dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
                timeSeries: {
                  datedValues: [
                    { date: { year: 2026, month: 10, day: 18 }, value: "5" },
                    { date: { year: 2026, month: 10, day: 19 } },
                  ],
                },
              },
              {
                dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
                timeSeries: {
                  datedValues: [{ date: { year: 2026, month: 10, day: 18 }, value: "2" }],
                },
              },
              {
                dailyMetric: "CALL_CLICKS",
                timeSeries: {
                  datedValues: [{ date: { year: 2026, month: 10, day: 19 }, value: "1" }],
                },
              },
            ],
          },
        ],
      }),
    ],
    [
      ["2026-10-18", { searchViews: 5, mapsViews: 2, views: 7 }],
      ["2026-10-19", { searchViews: 0, calls: 1, views: 0 }],
    ],
  );
}

/** The sums, chart groups, best times and content averages. */
function checkSums(): void {
  console.log("Sums");
  expectEqual(
    "figures added up",
    sumFigures([figures({ views: 1 }), figures({ views: 2, reach: 5 })]),
    figures({ views: 3, reach: 5 }),
  );
  expectEqual("rate over reach", engagementRate(figures({ engagements: 10, reach: 200 })), 0.05);
  expectEqual("rate over views", engagementRate(figures({ engagements: 10, views: 100 })), 0.1);
  expectEqual("no rate without engagements", engagementRate(figures({ reach: 10 })), null);
  expectEqual("no rate over nobody", engagementRate(figures({ engagements: 1, reach: 0 })), null);
  expectEqual("days added up", sumDays([{ views: 1 }, { views: 2, calls: 1 }, {}]), {
    views: 3,
    calls: 1,
  });

  expectEqual("day label", dayLabel("2026-10-21"), "Wed 21 Oct");
  const week = dayGroups(
    [
      { platform: "facebook", day: "2026-10-15", value: 5 },
      { platform: "facebook", day: "2026-10-21", value: 7 },
      { platform: "google", day: "2026-10-21", value: 3 },
      { platform: "google", day: "2026-10-16", value: null },
    ],
    "2026-10-15",
    "2026-10-21",
    ["facebook", "google"],
  );
  expectEqual("a column a day", week.length, 7);
  expectEqual("first day", week[0], {
    key: "2026-10-15",
    shortLabel: "Thu",
    label: "Thu 15 Oct",
    values: [5, 0],
  });
  expectEqual("last day", week[6]?.values, [7, 3]);
  expectEqual(
    "a month labels by date",
    dayGroups([], "2026-09-25", "2026-10-22", ["facebook"])
      .map((g) => g.shortLabel)
      .slice(0, 3),
    ["25", "26", "27"],
  );
  const quarter = dayGroups([], "2026-07-25", "2026-10-22", ["facebook"]);
  expectEqual("90 days in weeks", quarter.length, 13);
  expectEqual("the last week is whole", quarter.at(-1)?.label, "Fri 16 Oct to Thu 22 Oct");
  expectEqual("the first week is what's left", quarter[0]?.key, "2026-07-25");
  expectEqual("week label", quarter.at(-1)?.shortLabel, "16 Oct");

  // Monday 19 Oct, 10am NZ (UTC+13), and Wednesday 21 Oct, 7pm NZ.
  const monday = "2026-10-18T21:00:00.000Z";
  const wednesday = "2026-10-21T06:00:00.000Z";
  const times = bestTimes([
    { postedAt: monday, figures: figures({ engagements: 10, views: 100 }) },
    { postedAt: monday, figures: figures({ engagements: 20 }) },
    { postedAt: wednesday, figures: figures({ engagements: 4 }) },
    { postedAt: wednesday, figures: figures({ views: 50 }) },
  ]);
  expectEqual("by engagements when most have them", times.measure, "engagements");
  expectEqual("a post without it isn't counted", times.counted, 3);
  expectEqual(
    "Monday morning",
    times.cells.find((c) => c.weekday === 0 && c.band === 1),
    {
      weekday: 0,
      band: 1,
      posts: 2,
      average: 15,
    },
  );
  expectEqual(
    "Wednesday evening",
    times.cells.find((c) => c.weekday === 2 && c.band === 4)?.average,
    4,
  );
  expectEqual("every cell", times.cells.length, 35);
  expectEqual(
    "by views when few have engagements",
    bestTimes([
      { postedAt: monday, figures: figures({ views: 1 }) },
      { postedAt: monday, figures: figures({ views: 2 }) },
      { postedAt: monday, figures: figures({ engagements: 1, views: 3 }) },
    ]).measure,
    "views",
  );

  expectEqual(
    "content averages",
    contentPerformance([
      { sourceId: "a", captionIndex: 0, views: 10 },
      { sourceId: "a", captionIndex: 1, views: 30 },
      { sourceId: "a", captionIndex: 1, views: null },
      { sourceId: "b", captionIndex: null, views: 50 },
    ]),
    [
      { itemId: "b", postings: 1, average: 50, captions: [{ index: 0, postings: 1, average: 50 }] },
      {
        itemId: "a",
        postings: 3,
        average: 20,
        captions: [
          { index: 0, postings: 1, average: 10 },
          { index: 1, postings: 2, average: 30 },
        ],
      },
    ],
  );
}

/** The page's address, the count axis and the downloads. */
function checkPage(): void {
  console.log("Page");
  expectEqual("range", readRange("7"), 7);
  expectEqual("long range", readRange("90"), 90);
  expectEqual("unknown range", readRange("30"), 28);
  expectEqual("no range", readRange(undefined), 28);
  expectEqual("app", readAppFilter("google"), "google");
  expectEqual("unknown app", readAppFilter("tiktok"), "all");
  expectEqual("no app", readAppFilter(undefined), "all");

  expectEqual("count axis", niceScale(7, 6, 1), { top: 8, step: 2, ticks: [0, 2, 4, 6, 8] });
  expectEqual("small count axis", niceScale(3, 6, 1).ticks, [0, 1, 2, 3]);
  expectEqual("tiny count axis", niceScale(0.5, 6, 1).ticks, [0, 1]);
  expectEqual("count skips 2.5", niceScale(12, 6, 1).step, 5);
  expectEqual("count label", formatCount(12400), "12,400");

  const post: AnalyticsPost = {
    id: "p1",
    name: "=Tip",
    format: "reel",
    postedAt: "2026-10-20T20:00:00.000Z",
    thumb: null,
    figures: figures({ views: 300 }),
    byApp: [
      {
        platform: "facebook",
        figures: figures({ views: 100, engagements: 5, reach: 100 }),
        note: null,
        link: "https://facebook.com/p1",
      },
      { platform: "instagram", figures: figures({ views: 200 }), note: "Too few", link: null },
    ],
  };
  const csv = postsCsv([post]);
  expect("starts with a byte-order mark", csv.charCodeAt(0) === 0xfeff);
  const lines = csv.slice(1).split("\r\n");
  expectEqual("a line per app", lines.length, 4);
  expect("header names the rate", lines[0]!.includes('"Engagement rate"'));
  expect(
    "Facebook line",
    lines[1] ===
      '"21/10/2026","\'=Tip","Reel","Facebook","100","100","","","","","","5","5.0%","","https://facebook.com/p1"',
    lines[1],
  );
  expect("figures not given stay blank", lines[2]!.includes('"Instagram","200","",""'), lines[2]);

  const days = daysCsv([
    { platform: "instagram", day: "2026-10-21", figures: { views: 4 } },
    { platform: "facebook", day: "2026-10-21", figures: { views: 3, follows: 1 } },
    { platform: "google", day: "2026-10-20", figures: { calls: 2 } },
  ]);
  const dayLines = days.slice(1).split("\r\n");
  expect("days oldest first", dayLines[1]!.startsWith('"20/10/2026","Google"'), dayLines[1]);
  expect("then by app", dayLines[2]!.startsWith('"21/10/2026","Facebook","3"'), dayLines[2]);
  expectEqual(
    "file name",
    analyticsCsvName("posts", "2026-09-25", "2026-10-22"),
    "social-posts-2026-09-25-to-2026-10-22.csv",
  );
}

checkAges();
checkMetaAnswers();
checkProblems();
checkState();
checkDays();
checkSums();
checkPage();
finish();
