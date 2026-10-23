"use client";
// src/features/social/components/SocialAnalyticsView.tsx
// Social Analytics: the range and apps on show, when the figures were last read with Refresh,
// what the figures can't show, the account totals, daily views by app, Top posts, how each
// content item does, the best times to post, and downloads of the posts and days.

import { BarChart } from "@/features/admin/components/charts/BarChart";
import { formatCount } from "@/features/admin/components/charts/chart-scale";
import { appSeries } from "@/features/admin/components/charts/series";
import {
  STICKY_THEAD_CLS,
  TABLE_CLS,
  TABLE_SCROLL_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { SortableTh } from "@/features/admin/components/ui/SortableTh";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { StatStrip } from "@/features/admin/components/ui/StatStrip";
import { StickyList } from "@/features/admin/components/ui/StickyList";
import { useToast } from "@/features/admin/components/ui/Toast";
import { useShowMore } from "@/features/admin/hooks/use-show-more";
import { timeAgo } from "@/features/business/lib/calculator-draft";
import { callApi } from "@/features/mailing/lib/api-client";
import { AppIcons } from "@/features/social/components/AppIcons";
import { analyticsCsvName, daysCsv, postsCsv } from "@/features/social/lib/insights/analytics-csv";
import type {
  AnalyticsCard,
  AnalyticsData,
  AnalyticsPost,
  ContentRow,
} from "@/features/social/lib/insights/analytics.server";
import {
  ANALYTICS_RANGES,
  dayLabel,
  engagementRate,
  MIN_POSTS_FOR_TIMES,
  TIME_BANDS,
  type AnalyticsRange,
  type AppFilter,
  type FigureKey,
  type TimeCell,
} from "@/features/social/lib/insights/metrics";
import { postHref, SOCIAL_ANALYTICS_PATH } from "@/features/social/lib/links";
import { FORMAT_LABEL } from "@/features/social/lib/media";
import { PLATFORM_LABEL, SOCIAL_PLATFORMS } from "@/features/social/lib/validate";
import { Notice } from "@/shared/components/Notice";
import { cn } from "@/shared/lib/cn";
import { nzDateKey } from "@/shared/lib/timezone-utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useMemo, useState } from "react";
import { FaArrowsRotate, FaDownload } from "react-icons/fa6";

const APP_FILTERS: readonly AppFilter[] = ["all", ...SOCIAL_PLATFORMS];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Top posts shown before Show more. */
const POSTS_STEP = 20;

type SortKey = "date" | FigureKey | "rate";

/**
 * Downloads text as a CSV file.
 * @param text - The CSV.
 * @param name - The file name.
 */
function saveCsv(text: string, name: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * A figure, or a dash read out as "Not given" when the app didn't give it.
 * @param props - Component props.
 * @param props.value - The figure.
 * @returns The figure.
 */
function Figure({ value }: { value: number | null }): React.ReactElement {
  if (value === null) {
    return (
      <>
        <span aria-hidden className="text-admin-muted">
          -
        </span>
        <span className="sr-only">Not given</span>
      </>
    );
  }
  return <>{formatCount(value)}</>;
}

/**
 * An engagement rate as a percentage.
 * @param rate - The fraction, or null.
 * @returns The text, or null.
 */
function rateText(rate: number | null): string | null {
  return rate === null ? null : `${(rate * 100).toFixed(1)}%`;
}

/**
 * Social Analytics.
 * @param props - Component props.
 * @param props.data - What the server loaded.
 * @param props.now - When the page loaded, as ISO, so "Updated" reads the same on both sides.
 * @returns The analytics page.
 */
export function SocialAnalyticsView({
  data,
  now,
}: {
  data: AnalyticsData;
  now: string;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  /**
   * The address for another range or app filter.
   * @param next - What changes.
   * @param next.range - Days to show.
   * @param next.app - Apps to show.
   * @returns The href.
   */
  function href(next: { range?: AnalyticsRange; app?: AppFilter }): string {
    const range = next.range ?? data.range;
    const app = next.app ?? data.app;
    const query = new URLSearchParams();
    if (range !== 28) query.set("range", String(range));
    if (app !== "all") query.set("app", app);
    const text = query.toString();
    return text ? `${SOCIAL_ANALYTICS_PATH}?${text}` : SOCIAL_ANALYTICS_PATH;
  }

  /** Reads every app's figures again, then reloads the page's data. */
  async function refresh(): Promise<void> {
    setRefreshing(true);
    const res = await callApi<{ result: unknown }>(
      "/api/admin/social/insights/refresh",
      "POST",
      {},
    );
    setRefreshing(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast("Figures read again.");
    router.refresh();
  }

  const updated = data.ranAt ? timeAgo(Date.parse(data.ranAt), Date.parse(now)) : null;
  const weekly = data.chart.groups.length < data.range;
  const hasAny = data.days.length > 0 || data.posts.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <nav aria-label="Days to show" className={SEGMENTED_GROUP_CLS}>
          {ANALYTICS_RANGES.map((r) => (
            <Link
              key={r}
              href={href({ range: r })}
              aria-current={r === data.range ? "page" : undefined}
              className={cn(segmentedButtonClass(r === data.range), "inline-flex items-center")}
            >
              {r} days
            </Link>
          ))}
        </nav>
        <nav aria-label="Apps to show" className={cn(SEGMENTED_GROUP_CLS, "flex-wrap")}>
          {APP_FILTERS.map((a) => (
            <Link
              key={a}
              href={href({ app: a })}
              aria-current={a === data.app ? "page" : undefined}
              className={cn(segmentedButtonClass(a === data.app), "inline-flex items-center")}
            >
              {a === "all" ? "All apps" : PLATFORM_LABEL[a]}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3 lg:ml-auto">
          <p className="text-sm text-admin-text-secondary" aria-live="polite">
            {refreshing
              ? "Reading the figures..."
              : updated
                ? `Updated ${updated}`
                : "Not read yet"}
          </p>
          <AdminButton variant="outline" onClick={() => void refresh()} disabled={refreshing}>
            <FaArrowsRotate aria-hidden className={cn("size-3.5", refreshing && "animate-spin")} />{" "}
            Refresh
          </AdminButton>
          <AdminButton
            variant="outline"
            onClick={() =>
              saveCsv(postsCsv(data.posts), analyticsCsvName("posts", data.from, data.to))
            }
            disabled={data.posts.length === 0}
          >
            <FaDownload aria-hidden className="size-3.5" /> Posts CSV
          </AdminButton>
          <AdminButton
            variant="outline"
            onClick={() =>
              saveCsv(daysCsv(data.days), analyticsCsvName("days", data.from, data.to))
            }
            disabled={data.days.length === 0}
          >
            <FaDownload aria-hidden className="size-3.5" /> Days CSV
          </AdminButton>
        </div>
      </div>

      <p className="-mt-3 text-base text-admin-text-secondary">
        {dayLabel(data.from)} to {dayLabel(data.to)}
      </p>

      {data.notes.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.notes.map((note) => (
            <Notice key={note.text} tone={note.tone === "warn" ? "warn" : "info"} onGrey>
              {note.text}
            </Notice>
          ))}
        </div>
      )}

      {!hasAny && (
        <Card>
          <p className="text-base text-admin-text">
            No figures for these days yet. They&apos;re read every 6 hours once the stats sync is
            running, and each post&apos;s figures an hour after it goes out. Press Refresh to read
            them now.
          </p>
        </Card>
      )}

      {data.cards.length > 0 && <FigureStrip label="Facebook and Instagram" cards={data.cards} />}
      {data.googleCards && (
        <FigureStrip label="Google Business Profile" cards={data.googleCards} heading />
      )}

      <BarChart
        title="Views by app"
        description={
          weekly
            ? "Each column is a week. Google's are profile views; Facebook's and Instagram's are views of your posts and Page."
            : "Google's are profile views; Facebook's and Instagram's are views of your posts and Page."
        }
        series={appSeries(data.chart.series)}
        groups={data.chart.groups}
        groupHeading={weekly ? "Week" : "Day"}
        emptyText="No views given for these days yet."
        format="count"
      />

      <TopPosts posts={data.posts} />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <ContentPerformanceCard rows={data.content} />
        <BestTimes times={data.times} />
      </div>
    </div>
  );
}

/**
 * A strip of figures.
 * @param props - Component props.
 * @param props.label - The group's name.
 * @param props.cards - The figures.
 * @param props.heading - Show the name above the strip.
 * @returns The strip.
 */
function FigureStrip({
  label,
  cards,
  heading = false,
}: {
  label: string;
  cards: readonly AnalyticsCard[];
  heading?: boolean;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      {heading && <h2 className="text-base font-semibold text-admin-text">{label}</h2>}
      <StatStrip
        label={label}
        // Two columns until lg, where an odd last figure spans both so no empty cell shows.
        className={cn(
          "grid-cols-2 [&>*:last-child:nth-child(odd)]:col-span-2",
          "lg:[&>*:last-child:nth-child(odd)]:col-span-1",
          cards.length >= 5 ? "lg:grid-cols-5" : "lg:grid-cols-4",
        )}
      >
        {cards.map((card) => (
          <StatCard
            key={card.key}
            label={card.label}
            value={card.value === null ? "-" : formatCount(card.value)}
            sub={card.sub}
          />
        ))}
      </StatStrip>
    </section>
  );
}

/**
 * Top posts, sortable, with each app's views and links.
 * @param props - Component props.
 * @param props.posts - Posts in the range, the most viewed first.
 * @returns The card.
 */
function TopPosts({ posts }: { posts: readonly AnalyticsPost[] }): React.ReactElement {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "views",
    dir: "desc",
  });
  const sorted = useMemo(() => {
    /**
     * The value a post sorts by.
     * @param p - The post.
     * @returns The value, -1 when missing so those sink.
     */
    const valueOf = (p: AnalyticsPost): number =>
      sort.key === "date"
        ? Date.parse(p.postedAt)
        : sort.key === "rate"
          ? (engagementRate(p.figures) ?? -1)
          : (p.figures[sort.key] ?? -1);
    const out = [...posts].sort((a, b) => valueOf(a) - valueOf(b));
    return sort.dir === "desc" ? out.reverse() : out;
  }, [posts, sort]);
  const { visible, remaining, nextBatch, showMore } = useShowMore(
    sorted,
    POSTS_STEP,
    `${sort.key}:${sort.dir}`,
  );

  /**
   * Sorts by a column, flipping the direction when it's already the one.
   * @param key - The column.
   */
  function sortBy(key: SortKey): void {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );
  }

  const columns: [SortKey, string][] = [
    ["views", "Views"],
    ["reach", "Reach"],
    ["engagements", "Engagements"],
    ["rate", "Engagement rate"],
    ["clicks", "Link clicks"],
  ];

  return (
    <StickyList
      toolbar={
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-admin-text">Top posts</h2>
          <span className="text-base text-admin-text-secondary">
            {posts.length} post{posts.length === 1 ? "" : "s"} with figures
          </span>
        </div>
      }
    >
      {posts.length === 0 ? (
        <Card>
          <p className="text-base text-admin-muted">
            No post in these days has figures yet. Google gives none for single posts.
          </p>
        </Card>
      ) : (
        // Relative so the cells' screen-reader text is positioned inside the scroller; otherwise
        // it hangs off the page's edge and the whole page scrolls sideways on a phone.
        <Card padding="none" className={cn("relative", TABLE_SCROLL_CLS)}>
          <table className={cn(TABLE_CLS, "min-w-180")}>
            <thead className={cn(THEAD_CLS, STICKY_THEAD_CLS)}>
              <tr>
                <th scope="col" className={TH_CLS}>
                  Post
                </th>
                <SortableTh
                  label="Date"
                  active={sort.key === "date"}
                  dir={sort.dir}
                  onSort={() => sortBy("date")}
                />
                {columns.map(([key, label]) => (
                  <SortableTh
                    key={key}
                    label={label}
                    active={sort.key === key}
                    dir={sort.dir}
                    onSort={() => sortBy(key)}
                    className="text-right"
                  />
                ))}
              </tr>
            </thead>
            <tbody className={TBODY_CLS}>
              {visible.map((post) => (
                <PostRow key={post.id} post={post} />
              ))}
            </tbody>
          </table>
          {remaining > 0 && (
            <div className="border-t border-admin-border p-3 text-center">
              <AdminButton variant="ghost" onClick={showMore}>
                Show {nextBatch} more
              </AdminButton>
            </div>
          )}
        </Card>
      )}
    </StickyList>
  );
}

/**
 * One Top posts row.
 * @param props - Component props.
 * @param props.post - The post.
 * @returns Table row.
 */
function PostRow({ post }: { post: AnalyticsPost }): React.ReactElement {
  const rate = rateText(engagementRate(post.figures));
  const viewed = post.byApp.filter((a) => a.figures.views !== null);
  return (
    <tr className="align-top">
      <td className={cn(TD_CLS, "min-w-64")}>
        <div className="flex items-start gap-3">
          {post.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- Blob picture at thumbnail size
            <img
              src={post.thumb}
              alt=""
              className="size-12 shrink-0 rounded-md border border-admin-border object-cover"
            />
          ) : (
            <span aria-hidden className="size-12 shrink-0 rounded-md bg-admin-bg" />
          )}
          <div className="min-w-0">
            <Link
              href={postHref({ id: post.id })}
              className="font-semibold wrap-break-word text-russian-violet hover:underline"
            >
              {post.name}
            </Link>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-admin-text-secondary">
              {post.format !== "feed" && <span>{FORMAT_LABEL[post.format]}</span>}
              <AppIcons platforms={post.byApp.map((a) => a.platform)} />
            </p>
            {post.byApp.length > 1 && viewed.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-x-3 text-sm text-admin-text-secondary">
                {viewed.map((app) => (
                  <li key={app.platform}>
                    {PLATFORM_LABEL[app.platform]}{" "}
                    <span className="font-semibold text-admin-text">
                      <Figure value={app.figures.views} />
                    </span>{" "}
                    views
                  </li>
                ))}
              </ul>
            )}
            {post.byApp.some((a) => a.link) && (
              <p className="mt-1 flex flex-wrap gap-x-3 text-sm">
                {post.byApp.map((app) =>
                  app.link ? (
                    <a
                      key={app.platform}
                      href={app.link}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-russian-violet hover:underline"
                    >
                      Open on {PLATFORM_LABEL[app.platform]}
                    </a>
                  ) : null,
                )}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className={cn(TD_CLS, "whitespace-nowrap")}>
        {dayLabel(nzDateKey(new Date(post.postedAt)))}
      </td>
      <td className={cn(TD_CLS, "text-right font-semibold")}>
        <Figure value={post.figures.views} />
      </td>
      <td className={cn(TD_CLS, "text-right")}>
        <Figure value={post.figures.reach} />
      </td>
      <td className={cn(TD_CLS, "text-right")}>
        <Figure value={post.figures.engagements} />
      </td>
      <td className={cn(TD_CLS, "text-right")}>
        {rate ?? (
          <>
            <span aria-hidden className="text-admin-muted">
              -
            </span>
            <span className="sr-only">Not given</span>
          </>
        )}
      </td>
      <td className={cn(TD_CLS, "text-right")}>
        <Figure value={post.figures.clicks} />
      </td>
    </tr>
  );
}

/**
 * How each content item's postings did, and each of its captions.
 * @param props - Component props.
 * @param props.rows - Content items with postings in the range, the best first.
 * @returns The card.
 */
function ContentPerformanceCard({ rows }: { rows: readonly ContentRow[] }): React.ReactElement {
  const { visible, remaining, nextBatch, showMore } = useShowMore(rows, 8);
  return (
    <Card>
      <CardHeader
        title="Content items"
        description="Average views a posting, for items posted in these days."
      />
      {rows.length === 0 ? (
        <p className="text-base text-admin-muted">
          No content item has been posted with figures in these days.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-admin-border">
          {visible.map((row) => (
            <li key={row.itemId} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Link
                  href={postHref({ id: row.itemId, isContent: true })}
                  className="font-semibold text-russian-violet hover:underline"
                >
                  {row.name}
                </Link>
                <span className="text-base text-admin-text">
                  {row.average === null ? (
                    "No views given"
                  ) : (
                    <>
                      <span className="font-bold">{formatCount(row.average)}</span> views on average
                    </>
                  )}{" "}
                  <span className="text-admin-text-secondary">
                    over {row.postings} posting{row.postings === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
              {row.captions.length > 1 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {row.captions.map((c) => (
                    <li key={c.index} className="text-sm text-admin-text-secondary">
                      <span className="font-semibold text-admin-text">Caption {c.index + 1}</span>
                      {c.text && <span className="italic"> &ldquo;{c.text}&rdquo;</span>}:{" "}
                      {c.average === null
                        ? "no views given"
                        : `${formatCount(c.average)} views on average`}{" "}
                      over {c.postings} posting{c.postings === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {remaining > 0 && (
        <div className="mt-3 text-center">
          <AdminButton variant="ghost" onClick={showMore}>
            Show {nextBatch} more
          </AdminButton>
        </div>
      )}
    </Card>
  );
}

// Shades from light to dark for the best-times grid, so Tailwind sees each class.
const SHADES = [
  "bg-rich-black-50 text-admin-text",
  "bg-rich-black-100 text-admin-text",
  "bg-rich-black-200 text-admin-text",
  "bg-rich-black-400 text-white",
  "bg-rich-black-700 text-white",
];

/**
 * The best times to post: each weekday and time band, shaded by its average.
 * @param props - Component props.
 * @param props.times - The cells, how many posts counted, and the figure used.
 * @returns The card.
 */
function BestTimes({ times }: { times: AnalyticsData["times"] }): React.ReactElement {
  const measure = times.measure === "engagements" ? "engagements" : "views";
  const best = Math.max(0, ...times.cells.map((c) => c.average ?? 0));
  /**
   * A cell's shade, by how near its average is to the best.
   * @param cell - The cell.
   * @returns Its classes.
   */
  function shade(cell: TimeCell): string {
    if (cell.average === null || best === 0) return "bg-admin-bg text-admin-muted";
    const step = Math.min(SHADES.length - 1, Math.floor((cell.average / best) * SHADES.length));
    return SHADES[step]!;
  }
  return (
    <Card>
      <CardHeader
        title="Best times to post"
        description={`Average ${measure} a post by when it went out, NZ time, from every post with figures.`}
      />
      {times.counted < MIN_POSTS_FOR_TIMES ? (
        <p className="text-base text-admin-muted">
          This shows once {MIN_POSTS_FOR_TIMES} posts have figures ({times.counted} so far), so one
          lucky post can&apos;t make a time look best.
        </p>
      ) : (
        <div className="overflow-x-auto overflow-y-hidden">
          <table className="w-full min-w-120 border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th scope="col" className="sr-only">
                  Day
                </th>
                {TIME_BANDS.map((band) => (
                  <th
                    key={band.label}
                    scope="col"
                    className="px-1 pb-1 text-center font-semibold text-admin-muted"
                  >
                    {band.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((day, weekday) => (
                <tr key={day}>
                  <th scope="row" className="pr-2 text-left font-semibold text-admin-text">
                    {day}
                  </th>
                  {TIME_BANDS.map((band, bandIndex) => {
                    const cell = times.cells.find(
                      (c) => c.weekday === weekday && c.band === bandIndex,
                    );
                    return (
                      <td
                        key={band.label}
                        className={cn(
                          "h-12 rounded-md text-center tabular-nums",
                          cell && shade(cell),
                        )}
                      >
                        {cell && cell.average !== null ? (
                          <>
                            <span className="block font-bold">{formatCount(cell.average)}</span>
                            <span className="block">
                              {cell.posts} post{cell.posts === 1 ? "" : "s"}
                            </span>
                          </>
                        ) : (
                          <span className="sr-only">No posts</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-admin-text-secondary">
            From {times.counted} posts. Darker is better.
          </p>
        </div>
      )}
    </Card>
  );
}
