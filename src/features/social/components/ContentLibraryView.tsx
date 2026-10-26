"use client";
// src/features/social/components/ContentLibraryView.tsx
// The Content tab: every content item as cards or a table, with search, filters, sorts, the
// starter set, and bulk tagging, recycling and deleting.

import {
  ROW_CLS,
  STICKY_THEAD_CLS,
  TABLE_CLS,
  TABLE_SCROLL_CLS,
  TBODY_CLS,
  TD_CLS,
  THEAD_CLS,
  TH_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { Card } from "@/features/admin/components/ui/Card";
import {
  SEGMENTED_GROUP_CLS,
  adminChipClass,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ListToolbar } from "@/features/admin/components/ui/ListToolbar";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { StatStrip } from "@/features/admin/components/ui/StatStrip";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { StickyList } from "@/features/admin/components/ui/StickyList";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { ContentCard, postingsLine } from "@/features/social/components/ContentCard";
import { TagChipRow } from "@/features/social/components/TagPicker";
import { useLibraryLayout } from "@/features/social/components/useLibraryLayout";
import type { ContentListRow } from "@/features/social/lib/content-row";
import {
  LIBRARY_SORTS,
  LIBRARY_SORT_LABEL,
  NO_FILTER,
  filterLibrary,
  isFiltered,
  type LibraryFilter,
  type LibrarySort,
  type LibrarySummary,
} from "@/features/social/lib/library";
import { postHref } from "@/features/social/lib/links";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { captionsOf } from "@/features/social/lib/postings-core";
import { TAG_COLOURS, type SocialTagRow } from "@/features/social/lib/tags";
import { PLATFORM_LABEL, SOCIAL_PLATFORMS } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useMemo, useState } from "react";
import { FaPlus } from "react-icons/fa6";

type BulkAction = "tag" | "untag" | "recycle-on" | "recycle-off" | "delete";

/**
 * Content library.
 * @param props - Component props.
 * @param props.rows - Every content item, last edited first.
 * @param props.tags - Every tag, A to Z.
 * @param props.summary - The figures across the top.
 * @param props.schedules - Every schedule, A to Z, for the schedule filter.
 * @returns Library element.
 */
export function ContentLibraryView({
  rows,
  tags,
  summary,
  schedules,
}: {
  rows: ContentListRow[];
  tags: SocialTagRow[];
  summary: LibrarySummary;
  schedules: { id: string; name: string }[];
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const [sort, setSort] = useState<LibrarySort>("newest");
  const [layout, chooseLayout] = useLibraryLayout();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const tagNames = useMemo(() => new Map(tags.map((t) => [t.id, t.name])), [tags]);
  const shown = useMemo(
    () => filterLibrary(rows, filter, sort, tagNames),
    [rows, filter, sort, tagNames],
  );
  // Ticks on items a filter hides, or that have since gone, don't count, so a bulk action only
  // touches what's on screen.
  const selected = shown.filter((r) => picked.has(r.item.id));
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.item.id));
  const usedTags = tags.filter((t) => rows.some((r) => r.item.tagIds.includes(t.id)));
  const linedUp = selected.reduce((n, r) => n + r.linedUp, 0);

  /**
   * Changes part of the filter.
   * @param change - The parts to change.
   */
  function narrow(change: Partial<LibraryFilter>): void {
    setFilter((f) => ({ ...f, ...change }));
  }

  /**
   * Ticks or unticks one item.
   * @param id - The item.
   * @param on - Ticked or not.
   */
  function pick(id: string, on: boolean): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Ticks every item shown, or unticks them when they're all ticked. */
  function pickAllShown(): void {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (allShownPicked) next.delete(r.item.id);
        else next.add(r.item.id);
      }
      return next;
    });
  }

  /** Makes a blank content item and opens it. */
  async function create(): Promise<void> {
    setBusy("create");
    const res = await callApi<{ item: SocialPostRow }>("/api/admin/social/content", "POST", {
      source: "blank",
    });
    if (!res.ok) {
      setBusy(null);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(postHref(res.item));
  }

  /** Adds the starter set, skipping items already here. */
  async function importStarters(): Promise<void> {
    setBusy("import");
    const res = await callApi<{ created: number; skipped: number }>(
      "/api/admin/social/content/import",
      "POST",
    );
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast(
      res.created === 0
        ? "The starter content is already all here."
        : `Added ${res.created} starter ${res.created === 1 ? "item" : "items"}${
            res.skipped > 0 ? `. ${res.skipped} were already here` : ""
          }.`,
      { tone: "success" },
    );
    router.refresh();
  }

  /**
   * Makes one change to every ticked item.
   * @param action - The change.
   */
  async function bulk(action: BulkAction): Promise<void> {
    if ((action === "tag" || action === "untag") && !bulkTag) {
      toast("Pick a tag first.", { tone: "error" });
      return;
    }
    setBusy(action);
    const res = await callApi<{ changed: number }>("/api/admin/social/content/bulk", "POST", {
      ids: selected.map((r) => r.item.id),
      action,
      ...(action === "tag" || action === "untag" ? { tagId: bulkTag } : {}),
    });
    setBusy(null);
    setConfirmingDelete(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    const n = res.changed === 1 ? "1 item" : `${res.changed} items`;
    const tagName = tagsById.get(bulkTag)?.name ?? "the tag";
    const done: Record<BulkAction, string> = {
      tag: `Tagged ${n} ${tagName}.`,
      untag: `Took ${tagName} off ${n}.`,
      "recycle-on": `Turned recycling on for ${n}.`,
      "recycle-off": `Turned recycling off for ${n}.`,
      delete: `Deleted ${n}.`,
    };
    toast(done[action], { tone: "success" });
    if (action === "delete") setPicked(new Set());
    router.refresh();
  }

  const toolbar = (
    <div className="mb-4 flex flex-col gap-3">
      <ListToolbar
        className="mb-0"
        search={
          <AdminInput
            type="search"
            aria-label="Search content"
            placeholder="Search names, captions and tags"
            value={filter.search}
            onChange={(e) => narrow({ search: e.target.value })}
            className="h-10"
          />
        }
        filters={
          <>
            <AdminSelect
              aria-label="Sort content"
              value={sort}
              onChange={(e) => setSort(e.target.value as LibrarySort)}
              className="h-10 w-auto"
            >
              {LIBRARY_SORTS.map((s) => (
                <option key={s} value={s}>
                  {LIBRARY_SORT_LABEL[s]}
                </option>
              ))}
            </AdminSelect>
            <div role="group" aria-label="Show content as" className={SEGMENTED_GROUP_CLS}>
              {(["grid", "list"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={layout === l}
                  onClick={() => chooseLayout(l)}
                  className={segmentedButtonClass(layout === l)}
                >
                  {l === "grid" ? "Cards" : "Table"}
                </button>
              ))}
            </div>
          </>
        }
        count={
          rows.length > 0 &&
          (shown.length === rows.length
            ? `${rows.length} items`
            : `${shown.length} of ${rows.length}`)
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <AdminSelect
          aria-label="Picture"
          value={filter.picture}
          onChange={(e) => narrow({ picture: e.target.value as LibraryFilter["picture"] })}
          className="h-10 w-auto"
        >
          <option value="any">Any picture</option>
          <option value="with">Has a picture</option>
          <option value="without">No picture</option>
        </AdminSelect>
        <AdminSelect
          aria-label="Recycling"
          value={filter.recycling}
          onChange={(e) => narrow({ recycling: e.target.value as LibraryFilter["recycling"] })}
          className="h-10 w-auto"
        >
          <option value="any">Recycling on or off</option>
          <option value="on">Recycling on</option>
          <option value="off">Recycling off</option>
        </AdminSelect>
        <AdminSelect
          aria-label="Finished or not"
          value={filter.state}
          onChange={(e) => narrow({ state: e.target.value as LibraryFilter["state"] })}
          className="h-10 w-auto"
        >
          <option value="any">Finished or not</option>
          <option value="active">Can still go out</option>
          <option value="finished">Finished</option>
        </AdminSelect>
        <AdminSelect
          aria-label="App"
          value={filter.platform}
          onChange={(e) => narrow({ platform: e.target.value as LibraryFilter["platform"] })}
          className="h-10 w-auto"
        >
          <option value="any">Any app</option>
          {SOCIAL_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              On {PLATFORM_LABEL[p]}
            </option>
          ))}
        </AdminSelect>
        {schedules.length > 0 && (
          <AdminSelect
            aria-label="Schedule"
            value={filter.schedule}
            onChange={(e) => narrow({ schedule: e.target.value })}
            className="h-10 w-auto"
          >
            <option value="any">In a schedule or not</option>
            <option value="in">In a schedule</option>
            <option value="none">In no schedule</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                In {s.name}
              </option>
            ))}
          </AdminSelect>
        )}
        {isFiltered(filter) && (
          <AdminButton variant="ghost" onClick={() => setFilter(NO_FILTER)} className="h-9 px-2.5">
            Clear
          </AdminButton>
        )}
      </div>
      {usedTags.length > 0 && (
        <div
          role="group"
          aria-label="Show items with any of these tags"
          className="flex flex-wrap gap-2"
        >
          {usedTags.map((t) => {
            const active = filter.tagIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  narrow({
                    tagIds: active
                      ? filter.tagIds.filter((id) => id !== t.id)
                      : [...filter.tagIds, t.id],
                  })
                }
                className={cn(adminChipClass(active), "inline-flex items-center gap-1.5")}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    TAG_COLOURS[t.colour].dot,
                    active && "ring-2 ring-white",
                  )}
                />
                {t.name}
              </button>
            );
          })}
        </div>
      )}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-russian-violet-200 bg-russian-violet-50 p-2">
          <p className="px-1 text-sm font-semibold text-admin-text">{selected.length} selected</p>
          {tags.length > 0 && (
            <>
              <AdminSelect
                aria-label="Tag"
                value={bulkTag}
                onChange={(e) => setBulkTag(e.target.value)}
                className="h-9 w-auto py-1"
              >
                <option value="">Pick a tag</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </AdminSelect>
              <AdminButton
                size="sm"
                variant="secondary"
                busy={busy === "tag"}
                disabled={busy !== null}
                onClick={() => void bulk("tag")}
              >
                Add tag
              </AdminButton>
              <AdminButton
                size="sm"
                variant="secondary"
                busy={busy === "untag"}
                disabled={busy !== null}
                onClick={() => void bulk("untag")}
              >
                Take tag off
              </AdminButton>
            </>
          )}
          <AdminButton
            size="sm"
            variant="secondary"
            busy={busy === "recycle-on"}
            disabled={busy !== null}
            onClick={() => void bulk("recycle-on")}
          >
            Recycling on
          </AdminButton>
          <AdminButton
            size="sm"
            variant="secondary"
            busy={busy === "recycle-off"}
            disabled={busy !== null}
            onClick={() => void bulk("recycle-off")}
          >
            Recycling off
          </AdminButton>
          <AdminButton
            size="sm"
            variant="danger"
            disabled={busy !== null}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </AdminButton>
          <AdminButton
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => setPicked(new Set())}
            className="ml-auto"
          >
            Clear selection
          </AdminButton>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-admin-muted">
          Content items are posts you&apos;ll use again. Give one a few captions and it takes the
          next each time it goes out. Use Save to content on any post to add it here.
        </p>
        <div className="flex flex-wrap gap-2">
          <AdminButton
            variant="secondary"
            busy={busy === "import"}
            disabled={busy !== null}
            onClick={() => void importStarters()}
          >
            Add starter content
          </AdminButton>
          <AdminButton
            busy={busy === "create"}
            disabled={busy !== null}
            onClick={() => void create()}
          >
            <FaPlus aria-hidden /> New content item
          </AdminButton>
        </div>
      </div>

      <StatStrip label="Content" className="grid-cols-2 lg:grid-cols-4">
        <StatCard label="Items" value={summary.items} />
        <StatCard label="Recycling" value={summary.recycling} sub="Can go out again and again" />
        <StatCard label="Posted this month" value={summary.postedThisMonth} />
        <StatCard
          label="Ending soon"
          value={summary.endingSoon}
          sub="Last day in the next 2 weeks"
          tone={summary.endingSoon > 0 ? "warning" : "default"}
        />
      </StatStrip>

      {rows.length === 0 ? (
        <Card padding="none">
          <EmptyState
            title="No content yet"
            body="Start with the starter set: tech tips, scam warnings, a little about you and a review ask, each with a few captions. Change anything you like once it's here."
            action={
              <AdminButton busy={busy === "import"} onClick={() => void importStarters()}>
                Add starter content
              </AdminButton>
            }
          />
        </Card>
      ) : (
        <StickyList toolbar={toolbar}>
          {shown.length === 0 ? (
            <Card padding="none">
              <EmptyState
                title="Nothing matches"
                action={
                  <AdminButton variant="secondary" onClick={() => setFilter(NO_FILTER)}>
                    Clear the filters
                  </AdminButton>
                }
              />
            </Card>
          ) : layout === "grid" ? (
            <>
              <label className="mb-3 flex w-fit items-center gap-2 text-sm text-admin-text">
                <input
                  type="checkbox"
                  checked={allShownPicked}
                  onChange={pickAllShown}
                  className="size-4 accent-russian-violet"
                />
                Select all shown
              </label>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {shown.map((r) => (
                  <ContentCard
                    key={r.item.id}
                    row={r}
                    tagsById={tagsById}
                    selected={picked.has(r.item.id)}
                    onSelect={(on) => pick(r.item.id, on)}
                  />
                ))}
              </ul>
            </>
          ) : (
            <LibraryTable
              rows={shown}
              tagsById={tagsById}
              picked={picked}
              allPicked={allShownPicked}
              onPick={pick}
              onPickAll={pickAllShown}
            />
          )}
        </StickyList>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={
          selected.length === 1
            ? "Delete this content item?"
            : `Delete ${selected.length} content items?`
        }
        body={
          linedUp > 0
            ? `${linedUp === 1 ? "1 lined-up posting goes" : `${linedUp} lined-up postings go`} with ${selected.length === 1 ? "it" : "them"}. Postings that already went out, and ones you edited by hand, stay as ordinary posts.`
            : "Postings that already went out stay as ordinary posts. This can't be undone."
        }
        confirmLabel="Delete"
        tone="danger"
        busy={busy === "delete"}
        onConfirm={() => void bulk("delete")}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}

/**
 * The library as a table.
 * @param props - Component props.
 * @param props.rows - The items shown, in order.
 * @param props.tagsById - Every tag, by id.
 * @param props.picked - Ticked item ids.
 * @param props.allPicked - Whether every item shown is ticked.
 * @param props.onPick - Ticks or unticks one item.
 * @param props.onPickAll - Ticks or unticks every item shown.
 * @returns Table element.
 */
function LibraryTable({
  rows,
  tagsById,
  picked,
  allPicked,
  onPick,
  onPickAll,
}: {
  rows: ContentListRow[];
  tagsById: ReadonlyMap<string, SocialTagRow>;
  picked: ReadonlySet<string>;
  allPicked: boolean;
  onPick: (id: string, on: boolean) => void;
  onPickAll: () => void;
}): React.ReactElement {
  return (
    <Card padding="none">
      <div className={TABLE_SCROLL_CLS}>
        <table className={TABLE_CLS}>
          <thead className={cn(THEAD_CLS, STICKY_THEAD_CLS)}>
            <tr>
              <th className={cn(TH_CLS, "w-10")}>
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  checked={allPicked}
                  onChange={onPickAll}
                  className="size-4 accent-russian-violet"
                />
              </th>
              <th className={TH_CLS}>Name</th>
              <th className={TH_CLS}>Captions</th>
              <th className={TH_CLS}>Recycling</th>
              <th className={TH_CLS}>Postings</th>
              <th className={TH_CLS}>Next</th>
            </tr>
          </thead>
          <tbody className={TBODY_CLS}>
            {rows.map(({ item, stats, spent }) => (
              <tr key={item.id} className={ROW_CLS}>
                <td className={TD_CLS}>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={picked.has(item.id)}
                      onChange={(e) => onPick(item.id, e.target.checked)}
                      className="size-4 accent-russian-violet"
                    />
                    <span className="sr-only">Select {item.name || "Untitled"}</span>
                  </label>
                </td>
                <td className={TD_CLS}>
                  <div className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        href={postHref(item)}
                        className="font-semibold text-admin-text underline-offset-2 hover:underline"
                      >
                        {item.name || "Untitled"}
                      </Link>
                      {spent && <StatusPill tone="warning">Finished</StatusPill>}
                    </span>
                    <TagChipRow ids={item.tagIds} tagsById={tagsById} />
                  </div>
                </td>
                <td className={TD_CLS}>{captionsOf(item).filter((c) => c.trim()).length}</td>
                <td className={cn(TD_CLS, "whitespace-nowrap")}>{item.recycle ? "On" : "Off"}</td>
                <td className={cn(TD_CLS, "whitespace-nowrap")}>{postingsLine(stats)}</td>
                <td className={cn(TD_CLS, "whitespace-nowrap")}>
                  {stats.nextAt ? formatDateTimeShort(stats.nextAt) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
