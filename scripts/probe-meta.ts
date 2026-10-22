// scripts/probe-meta.ts
// Read-only look at what the Meta token can reach: its permissions and dates, Page and Instagram
// stats under each metric name Meta has used, whether comments from the public come back with who
// wrote them, and the Instagram posting quota. GET calls only; nothing is posted or changed.
// Run with: npm run probe:meta

import { graph, GraphError, metaConfig } from "@/features/social/lib/meta-graph";
import { tokenInfoOf, type DebugTokenData } from "@/features/social/lib/permissions";

type Outcome = "ok" | "fail" | "skip";

const lines: { outcome: Outcome; name: string; detail: string }[] = [];

/**
 * Records one result.
 * @param outcome - How it went.
 * @param name - What was checked.
 * @param detail - What came back.
 */
function note(outcome: Outcome, name: string, detail: string): void {
  lines.push({ outcome, name, detail });
}

/**
 * Why a call failed, with Meta's code.
 * @param error - What it threw.
 * @returns One line.
 */
function why(error: unknown): string {
  if (error instanceof GraphError)
    return `${error.message}${error.code ? ` (code ${error.code})` : ""}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one read and records it.
 * @param name - What's checked.
 * @param read - The read.
 * @param describe - Turns the answer into a line.
 * @returns The answer, or null when it failed.
 */
async function check<T>(
  name: string,
  read: () => Promise<T>,
  describe: (res: T) => string,
): Promise<T | null> {
  try {
    const res = await read();
    note("ok", name, describe(res));
    return res;
  } catch (error) {
    note("fail", name, why(error));
    return null;
  }
}

interface Insight {
  name: string;
  values?: { value: unknown }[];
  total_value?: { value: unknown };
}

/**
 * A short reading of an insights answer.
 * @param res - The answer.
 * @param res.data - Its figures, one row per metric.
 * @returns "name=value" for each metric.
 */
function insightLine(res: { data?: Insight[] }): string {
  const rows = res.data ?? [];
  if (rows.length === 0) return "answered, no figures";
  return rows
    .map((r) => {
      const value = r.total_value?.value ?? r.values?.at(-1)?.value;
      return `${r.name}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`;
    })
    .join(", ");
}

/** Every check, in order. */
async function main(): Promise<void> {
  const { pageId, igAccountId, token, appToken } = metaConfig();
  if (!token || !pageId) {
    console.error("META_PAGE_ACCESS_TOKEN and META_PAGE_ID must be set in .env.local.");
    process.exit(1);
  }

  // Token
  await check(
    "token",
    () =>
      graph<{ data?: DebugTokenData }>(
        "/debug_token",
        "GET",
        { input_token: token },
        appToken ?? token,
      ),
    (res) => {
      const info = tokenInfoOf(res.data ?? {});
      const runs = info.expiresAt ? `runs out ${info.expiresAt.slice(0, 10)}` : "never runs out";
      const data = info.dataAccessExpiresAt
        ? `data access until ${info.dataAccessExpiresAt.slice(0, 10)}`
        : "data access never ends";
      return `${info.valid ? "valid" : "INVALID"} ${info.type ?? "?"} token for ${info.app ?? "?"}, ${runs}, ${data}; scopes: ${info.scopes.join(", ")}`;
    },
  );

  // Page stats, one metric at a time so a renamed one doesn't hide the rest
  for (const metric of [
    "page_media_view",
    "page_views_total",
    "page_post_engagements",
    "page_follows",
  ]) {
    await check(
      `page insight ${metric}`,
      () => graph<{ data?: Insight[] }>(`/${pageId}/insights`, "GET", { metric, period: "day" }),
      insightLine,
    );
  }

  // Post stats: which name Meta uses for views decides Phase 11's metric list
  const posts = await check(
    "latest Page post",
    () =>
      graph<{ data?: { id: string }[] }>(`/${pageId}/posts`, "GET", { limit: "1", fields: "id" }),
    (res) => res.data?.[0]?.id ?? "none",
  );
  const postId = posts?.data?.[0]?.id;
  for (const metric of ["post_media_view", "post_media_views", "post_impressions", "post_clicks"]) {
    if (!postId) {
      note("skip", `post insight ${metric}`, "no post to read");
      continue;
    }
    await check(
      `post insight ${metric}`,
      () => graph<{ data?: Insight[] }>(`/${postId}/insights`, "GET", { metric }),
      insightLine,
    );
  }

  // Facebook comments: without `from`, the Inbox can't say who wrote them
  await check(
    "Facebook comments",
    () =>
      graph<{ data?: { comments?: { data?: { from?: { name?: string } }[] } }[] }>(
        `/${pageId}/posts`,
        "GET",
        { limit: "10", fields: "comments.limit(10){from,message}" },
      ),
    (res) => {
      const all = (res.data ?? []).flatMap((p) => p.comments?.data ?? []);
      const named = all.filter((c) => c.from?.name).length;
      return `${all.length} comments on the last 10 posts, ${named} with who wrote them`;
    },
  );

  if (!igAccountId) {
    note("skip", "Instagram", "INSTAGRAM_ACCOUNT_ID isn't set");
  } else {
    for (const [metric, extra] of [
      ["reach", {}],
      ["views", { metric_type: "total_value" }],
      ["accounts_engaged", { metric_type: "total_value" }],
      ["follows_and_unfollows", { metric_type: "total_value" }],
      ["website_clicks", { metric_type: "total_value" }],
    ] as const) {
      await check(
        `Instagram insight ${metric}`,
        () =>
          graph<{ data?: Insight[] }>(`/${igAccountId}/insights`, "GET", {
            metric,
            period: "day",
            ...extra,
          }),
        insightLine,
      );
    }

    const media = await check(
      "latest Instagram media",
      () =>
        graph<{ data?: { id: string; comments_count?: number }[] }>(
          `/${igAccountId}/media`,
          "GET",
          { limit: "5", fields: "id,media_type,comments_count" },
        ),
      (res) => `${res.data?.length ?? 0} read`,
    );
    const first = media?.data?.[0]?.id;
    if (first) {
      await check(
        "Instagram media insights",
        () =>
          graph<{ data?: Insight[] }>(`/${first}/insights`, "GET", {
            metric: "views,reach,likes,comments,shares,saved,total_interactions",
          }),
        insightLine,
      );
    } else {
      note("skip", "Instagram media insights", "no media to read");
    }
    const commented = media?.data?.find((m) => (m.comments_count ?? 0) > 0)?.id;
    if (commented) {
      await check(
        "Instagram comments",
        () =>
          graph<{ data?: { username?: string }[] }>(`/${commented}/comments`, "GET", {
            fields: "username,text",
            limit: "10",
          }),
        (res) => {
          const all = res.data ?? [];
          return `${all.length} read, ${all.filter((c) => c.username).length} with a username`;
        },
      );
    } else {
      note("skip", "Instagram comments", "none of the last 5 posts has a comment");
    }

    await check(
      "Instagram posting quota",
      () =>
        graph<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
          `/${igAccountId}/content_publishing_limit`,
          "GET",
          { fields: "quota_usage,config" },
        ),
      (res) => {
        const row = res.data?.[0];
        return `${row?.quota_usage ?? "?"} of ${row?.config?.quota_total ?? "?"} used in the last 24 hours`;
      },
    );
  }

  const width = Math.max(...lines.map((l) => l.name.length));
  for (const l of lines) {
    const tag = l.outcome === "ok" ? "OK  " : l.outcome === "fail" ? "FAIL" : "--  ";
    console.log(`${tag} ${l.name.padEnd(width)}  ${l.detail}`);
  }
}

void main();
