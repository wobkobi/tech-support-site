// src/features/social/lib/insights/meta.server.ts
// Reads post and account figures from Facebook and Instagram. A request asks for several metrics
// at once and, when Meta refuses it, again one at a time, so one renamed metric or missing
// permission can't hide the rest; the names that fail are left out for a while.

import {
  FACEBOOK_DAY_METRICS,
  facebookDays,
  FIELD_ASK,
  fieldValues,
  figuresOf,
  insightValues,
  INSTAGRAM_DAY_METRICS,
  INSTAGRAM_FOLLOWS_METRIC,
  instagramDay,
  metaProblem,
  NO_FIGURES,
  postAsk,
  problemNote,
  scopeIn,
  SKIP_INVALID_MS,
  SKIP_PERMISSION_MS,
  skipKey,
  type DayFigures,
  type Figures,
  type InsightsAnswer,
  type MetaProblem,
  type Skips,
} from "@/features/social/lib/insights/metrics";
import type { SocialFormatKey } from "@/features/social/lib/media";
import { graph, GraphError, metaConfig } from "@/features/social/lib/meta-graph";
import { addDaysToDateKey, dateKeyParts, nzMidnightUtc } from "@/shared/lib/timezone-utils";

/** A problem that ends this app's run: a bad token or a rate limit. */
export class MetaStop extends Error {
  /**
   * Creates the stop.
   * @param message - Why.
   */
  constructor(message: string) {
    super(message);
    this.name = "MetaStop";
  }
}

interface Problem {
  kind: MetaProblem;
  /** The permission for a permission problem, otherwise Meta's message. */
  detail: string | null;
}

interface Asked<T> {
  value: T;
  problem: Problem | null;
}

interface Ask<T> {
  /** Names the request in skip keys. */
  kind: string;
  names: readonly string[];
  /** The permission these names need. */
  scope: string;
  read: (names: string[]) => Promise<T>;
  merge: (a: T, b: T) => T;
  empty: T;
}

/**
 * Sorts what a read threw, ending the app's run on a bad token or rate limit.
 * @param error - What it threw.
 * @param scope - The permission the read is expected to need, used when Meta's message names none.
 * @returns The problem.
 */
function classify(error: unknown, scope: string): Problem {
  if (!(error instanceof GraphError)) {
    return { kind: "other", detail: error instanceof Error ? error.message : null };
  }
  const kind = metaProblem(error.code, error.raw);
  if (kind === "token" || kind === "rate") throw new MetaStop(error.message);
  return { kind, detail: kind === "permission" ? (scopeIn(error.raw) ?? scope) : error.raw };
}

/**
 * Asks for some names at once and, when Meta refuses, one at a time. A name that fails on its
 * own as invalid or unreadable is left out for a while; one already left out for a permission
 * still reports that, so every post can say why its figures are short.
 * @param ask - What to ask.
 * @param skips - Names left out, which this adds to.
 * @param now - Now.
 * @returns What came back and the first problem met.
 */
async function askEach<T>(ask: Ask<T>, skips: Skips, now: Date): Promise<Asked<T>> {
  const wanted: string[] = [];
  let problem: Problem | null = null;
  for (const name of ask.names) {
    const skip = skips[skipKey(ask.kind, name)];
    if (!skip) wanted.push(name);
    else if (skip.why === "permission") problem ??= { kind: "permission", detail: skip.scope };
  }
  if (wanted.length === 0) return { value: ask.empty, problem };
  try {
    return { value: await ask.read(wanted), problem };
  } catch (error) {
    const met = classify(error, ask.scope);
    // A deleted post or one too few people saw fails every name alike.
    if (met.kind === "gone" || met.kind === "thin" || wanted.length === 1) {
      if (wanted.length === 1 && (met.kind === "invalid" || met.kind === "permission")) {
        const invalid = met.kind === "invalid";
        skips[skipKey(ask.kind, wanted[0]!)] = {
          until: new Date(
            now.getTime() + (invalid ? SKIP_INVALID_MS : SKIP_PERMISSION_MS),
          ).toISOString(),
          why: met.kind,
          scope: invalid ? null : (met.detail ?? ask.scope),
        };
      }
      return { value: ask.empty, problem: problem ?? met };
    }
  }
  let value = ask.empty;
  for (const name of wanted) {
    const one = await askEach({ ...ask, names: [name] }, skips, now);
    value = ask.merge(value, one.value);
    problem ??= one.problem;
  }
  return { value, problem };
}

/**
 * Joins two insights answers.
 * @param a - One.
 * @param b - The other.
 * @returns Both answers' rows.
 */
function joinAnswers(a: InsightsAnswer, b: InsightsAnswer): InsightsAnswer {
  return { data: [...(a.data ?? []), ...(b.data ?? [])] };
}

/**
 * Joins two sets of counts.
 * @param a - One.
 * @param b - The other.
 * @returns Both sets' counts.
 */
function joinCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  return { ...a, ...b };
}

/** What a post read found. */
export interface PostRead {
  figures: Figures;
  extra: Record<string, number> | null;
  /** Why some figures are missing, or null. */
  note: string | null;
  /** The post is no longer on the app, so it isn't read again. */
  gone: boolean;
}

/**
 * Reads one post's figures on Facebook or Instagram: its insights, then its plain counts for
 * any figure the insights didn't give.
 * @param platform - The app.
 * @param externalId - The post's id there (a Facebook reel's is its video id).
 * @param format - The kind of post.
 * @param skips - Names left out, which this adds to.
 * @param now - Now.
 * @returns What came back.
 */
export async function readPost(
  platform: "facebook" | "instagram",
  externalId: string,
  format: SocialFormatKey,
  skips: Skips,
  now: Date,
): Promise<PostRead> {
  const ask = postAsk(platform, format);
  const insights = await askEach<Record<string, number>>(
    {
      kind: ask.kind,
      names: ask.metrics.map((m) => m.name),
      scope: ask.scope,
      /**
       * Reads the post's insights for these metrics.
       * @param names - The names still asked for.
       * @returns Each metric's value.
       */
      read: async (names) =>
        insightValues(
          await graph<InsightsAnswer>(`/${externalId}/${ask.edge}`, "GET", {
            metric: names.join(","),
          }),
        ),
      merge: joinCounts,
      empty: {},
    },
    skips,
    now,
  );
  if (insights.problem?.kind === "gone") {
    return {
      figures: { ...NO_FIGURES },
      extra: null,
      note: problemNote(platform, "gone", null),
      gone: true,
    };
  }

  // Plain counts only for the figures the insights didn't fill.
  const filled = figuresOf(ask, insights.value, {}).figures;
  const wanted = ask.fields.filter((f) => f.figure === null || filled[f.figure] === null);
  const counts = await askEach<Record<string, number>>(
    {
      kind: `${ask.kind}-fields`,
      names: wanted.map((f) => f.name),
      scope: platform === "facebook" ? "pages_read_engagement" : "instagram_basic",
      /**
       * Reads these counts off the post itself.
       * @param names - The names still asked for.
       * @returns Each field's count.
       */
      read: async (names) =>
        fieldValues(
          await graph<Record<string, unknown>>(`/${externalId}`, "GET", {
            fields: names.map((n) => FIELD_ASK[n] ?? n).join(","),
          }),
          names,
        ),
      merge: joinCounts,
      empty: {},
    },
    skips,
    now,
  );
  if (counts.problem?.kind === "gone") {
    return {
      figures: { ...NO_FIGURES },
      extra: null,
      note: problemNote(platform, "gone", null),
      gone: true,
    };
  }

  const { figures, extra } = figuresOf(ask, insights.value, counts.value);
  const problem = insights.problem ?? counts.problem;
  return {
    figures,
    extra,
    note: problem ? problemNote(platform, problem.kind, problem.detail) : null,
    gone: false,
  };
}

/** One app's figures by day, and why some are missing. */
export interface DaysRead {
  days: Map<string, DayFigures>;
  note: string | null;
}

/**
 * Seconds since 1970 at NZ midnight of a day.
 * @param key - YYYY-MM-DD.
 * @returns Unix seconds.
 */
function nzMidnightUnix(key: string): number {
  const [y, m, d] = dateKeyParts(key);
  return Math.floor(nzMidnightUtc(y, m, d).getTime() / 1000);
}

/**
 * Reads the Facebook Page's figures by day.
 * @param from - First day.
 * @param to - Last day, included.
 * @param skips - Names left out, which this adds to.
 * @param now - Now.
 * @returns Figures by Facebook's day, inside the range asked for.
 */
export async function readFacebookDays(
  from: string,
  to: string,
  skips: Skips,
  now: Date,
): Promise<DaysRead> {
  const { pageId } = metaConfig();
  if (!pageId) throw new Error("META_PAGE_ID isn't set.");
  // A day either side, since Meta's days end at US Pacific midnight; the range is trimmed after.
  const [fy, fm, fd] = dateKeyParts(from);
  const [ty, tm, td] = dateKeyParts(to);
  const since = Math.floor(Date.UTC(fy, fm - 1, fd - 1) / 1000);
  const until = Math.floor(Date.UTC(ty, tm - 1, td + 2) / 1000);
  const asked = await askEach<InsightsAnswer>(
    {
      kind: "facebook-day",
      names: FACEBOOK_DAY_METRICS.map((m) => m.name),
      scope: "read_insights",
      /**
       * Reads the Page's daily figures for these metrics.
       * @param names - The names still asked for.
       * @returns Meta's answer.
       */
      read: (names) =>
        graph<InsightsAnswer>(`/${pageId}/insights`, "GET", {
          metric: names.join(","),
          period: "day",
          since: String(since),
          until: String(until),
        }),
      merge: joinAnswers,
      empty: { data: [] },
    },
    skips,
    now,
  );
  const days = new Map([...facebookDays(asked.value)].filter(([day]) => day >= from && day <= to));
  let note = asked.problem
    ? problemNote("facebook", asked.problem.kind, asked.problem.detail)
    : null;
  // Without read_insights Meta answers with no figures rather than an error.
  if (days.size === 0 && !note) {
    note = "Facebook gave no Page figures. It needs the read_insights permission.";
  }
  return { days, note };
}

/**
 * Reads the Instagram account's figures, one NZ day at a time, since most of its figures come
 * only as a total over the days asked for.
 * @param days - The days to read, oldest first.
 * @param skips - Names left out, which this adds to.
 * @param now - Now.
 * @param deadline - Stop before reading a day after this (ms since 1970); the rest wait for the next run.
 * @returns Figures by NZ day, for the days read.
 */
export async function readInstagramDays(
  days: readonly string[],
  skips: Skips,
  now: Date,
  deadline: number,
): Promise<DaysRead & { complete: boolean }> {
  const { igAccountId } = metaConfig();
  if (!igAccountId) throw new Error("INSTAGRAM_ACCOUNT_ID isn't set.");
  const out = new Map<string, DayFigures>();
  let problem: Problem | null = null;
  for (const [i, day] of days.entries()) {
    if (Date.now() > deadline) return { days: out, note: null, complete: false };
    const range = {
      period: "day",
      metric_type: "total_value",
      since: String(nzMidnightUnix(day)),
      until: String(nzMidnightUnix(days[i + 1] ?? addDaysToDateKey(day, 1))),
    };
    const totals = await askEach<InsightsAnswer>(
      {
        kind: "instagram-day",
        names: INSTAGRAM_DAY_METRICS.map((m) => m.name),
        scope: "instagram_manage_insights",
        /**
         * Reads the account's totals for the day.
         * @param names - The names still asked for.
         * @returns Meta's answer.
         */
        read: (names) =>
          graph<InsightsAnswer>(`/${igAccountId}/insights`, "GET", {
            ...range,
            metric: names.join(","),
          }),
        merge: joinAnswers,
        empty: { data: [] },
      },
      skips,
      now,
    );
    const follows = await askEach<InsightsAnswer>(
      {
        kind: "instagram-follows",
        names: [INSTAGRAM_FOLLOWS_METRIC],
        scope: "instagram_manage_insights",
        /**
         * Reads the day's follows and unfollows.
         * @param names - The names still asked for.
         * @returns Meta's answer.
         */
        read: (names) =>
          graph<InsightsAnswer>(`/${igAccountId}/insights`, "GET", {
            ...range,
            metric: names.join(","),
            breakdown: "follow_type",
          }),
        merge: joinAnswers,
        empty: { data: [] },
      },
      skips,
      now,
    );
    problem ??= totals.problem ?? follows.problem;
    const figures = instagramDay(totals.value, follows.value);
    if (Object.keys(figures).length > 0) out.set(day, figures);
  }
  return {
    days: out,
    note: problem ? problemNote("instagram", problem.kind, problem.detail) : null,
    complete: true,
  };
}
