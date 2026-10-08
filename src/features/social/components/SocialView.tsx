"use client";
// src/features/social/components/SocialView.tsx
// The whole Social page. Starting a post comes first: a blank post or any preset, and
// drafts and scheduled posts to pick back up. The open post is written right below in
// the composer. What has already gone out folds away under Posted, and the connection
// check sits at the bottom, run once when the page opens.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { PostComposer } from "@/features/social/components/PostComposer";
import type { OpenPost } from "@/features/social/lib/open-post";
import { POST_STATUS_PILL, liveOn, type Connection } from "@/features/social/lib/post-display";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { PLATFORM_LABEL, type SocialPlatformKey } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { FaChevronDown, FaPen, FaPlus, FaXmark } from "react-icons/fa6";

/**
 * Posts that still need something: being written, waiting to go out, or stuck
 * partway. Only posts that are done (up, or taken down) fold away under Posted.
 */
const IN_PROGRESS = new Set(["draft", "scheduled", "posting", "partial", "failed", "removing"]);

/**
 * Where an unfinished post is at, for its chip.
 * @param p - Post row.
 * @returns Wording and colour.
 */
function chipStatus(p: SocialPostRow): { text: string; className: string } {
  switch (p.status) {
    case "scheduled":
      return {
        text: `Posts ${formatDateTimeShort(p.scheduledAt ?? p.updatedAt)}`,
        className: "text-russian-violet",
      };
    case "posting":
      return { text: "Going out now", className: "text-amber-800" };
    case "removing":
      return { text: "Being taken down", className: "text-amber-800" };
    case "partial":
      return { text: "Only partly posted", className: "text-amber-800" };
    case "failed":
      return { text: "Didn't post", className: "text-red-700" };
    default:
      return {
        text: `Draft, edited ${formatDateTimeShort(p.updatedAt)}`,
        className: "text-admin-muted",
      };
  }
}

/**
 * The date that matters for a row: when it went or will go out, else last edit.
 * @param p - Post row.
 * @returns Label for the date line.
 */
function dateLabel(p: SocialPostRow): string {
  if (p.status === "posting") return "Going out now";
  if (p.status === "failed") return `Didn't post ${formatDateTimeShort(p.postedAt ?? p.updatedAt)}`;
  if (p.postedAt) return `Posted ${formatDateTimeShort(p.postedAt)}`;
  if (p.scheduledAt) return `Posts ${formatDateTimeShort(p.scheduledAt)}`;
  return `Edited ${formatDateTimeShort(p.updatedAt)}`;
}

/**
 * First line of a post's text, for a one-line summary.
 * @param body - Post text.
 * @returns The first non-empty line, or "".
 */
function firstLine(body: string): string {
  return body.split("\n").find((l) => l.trim()) ?? "";
}

/**
 * Social page.
 * @param props - Component props.
 * @param props.initial - Every post and preset, newest first.
 * @param props.open - The post open in the composer, or null.
 * @param props.openMissing - Whether the address named a post that no longer exists.
 * @returns Social view element.
 */
export function SocialView({
  initial,
  open,
  openMissing,
}: {
  initial: SocialPostRow[];
  open: OpenPost | null;
  openMissing: boolean;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState(initial);
  // Take the server's list again whenever the page re-renders (opening a post,
  // router.refresh after posting), dropping local edits it already includes.
  const [shownInitial, setShownInitial] = useState(initial);
  if (initial !== shownInitial) {
    setShownInitial(initial);
    setRows(initial);
  }
  const [busyId, setBusyId] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  // Which button started the post now loading, so it keeps its spinner until the
  // composer shows rather than going quiet once the create request returns.
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  // A preset opened from the address starts in preset editing, where it's highlighted.
  const [editingPresets, setEditingPresets] = useState(open?.post.isPreset ?? false);
  const [deleting, setDeleting] = useState<SocialPostRow | null>(null);
  const [alsoTakeDown, setAlsoTakeDown] = useState(true);
  const [connections, setConnections] = useState<Connection[] | null>(null);
  // Why the check on opening the page couldn't run, shown in the strip instead of a toast.
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const saveOpen = useRef<(() => Promise<boolean>) | null>(null);
  const composerRef = useRef<HTMLElement>(null);
  const composerHeadingRef = useRef<HTMLHeadingElement>(null);
  const startHeadingRef = useRef<HTMLHeadingElement>(null);

  const openId = open?.post.id ?? null;
  const openRow = open ? (rows.find((r) => r.id === openId) ?? open.post) : null;
  // The list arrives newest first; presets read oldest first so the starter set keeps
  // its order and new ones join the end.
  const presets = rows.filter((r) => r.isPreset).reverse();
  const inProgress = rows.filter((r) => !r.isPreset && IN_PROGRESS.has(r.status));
  const posted = rows
    .filter((r) => !r.isPreset && !IN_PROGRESS.has(r.status))
    .sort((a, b) => (b.postedAt ?? b.updatedAt).localeCompare(a.postedAt ?? a.updatedAt));
  const [historyOpen, setHistoryOpen] = useState(
    open !== null && !open.post.isPreset && !IN_PROGRESS.has(open.post.status),
  );

  /**
   * Whether a button's post is being created or loaded.
   * @param key - The button's busy marker.
   * @returns True while it should show a spinner.
   */
  const isBusy = (key: string): boolean => busyId === key || (opening && openingKey === key);

  // When another post opens, bring it into view if it's off screen or well down it
  // (the start options above are short, so usually nothing moves), and put keyboard
  // focus on its heading, since the button that opened it may have been swapped out.
  // On close, focus goes back to Start a post. The page loading doesn't count.
  // The first 56px sit under the sticky admin top bar (AdminTopBar, h-14), so a top
  // edge there counts as off screen.
  const shownId = useRef(openId);
  useEffect(() => {
    if (shownId.current === openId) return;
    shownId.current = openId;
    const el = composerRef.current;
    if (!openId || !el) {
      startHeadingRef.current?.focus({ preventScroll: true });
      return;
    }
    const top = el.getBoundingClientRect().top;
    if (top < 56 || top > window.innerHeight * 0.6) {
      el.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    composerHeadingRef.current?.focus({ preventScroll: true });
  }, [openId]);

  // Back and Forward reuse the page as it was first loaded, which can be older than
  // what autosave has written since; editing that stale copy would save old text over
  // new. Reload from the server after any history step, and whenever the open post
  // turns out to have changed since this render.
  useEffect(() => {
    /** Reloads after a Back or Forward. */
    const onPop = (): void => {
      router.refresh();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [router]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void callApi<{ post: SocialPostRow }>(`/api/admin/social/${open.post.id}`).then((res) => {
      const stale =
        !res.ok ||
        res.post.updatedAt !== open.post.updatedAt ||
        res.post.status !== open.post.status;
      if (live && stale) router.refresh();
    });
    return () => {
      live = false;
    };
  }, [open, router]);

  /**
   * Shows another post in the composer, or none. Any edit still waiting for autosave
   * is saved first; if that fails the current post stays open with its error showing.
   * @param id - Post to open, or null to close the composer.
   * @param key - Busy marker of the button that asked, kept spinning until it opens.
   */
  async function openPost(id: string | null, key: string | null = id): Promise<void> {
    if (id === openId) return;
    if (saveOpen.current && !(await saveOpen.current())) return;
    // Preset editing ends once something other than a preset is opened.
    if (!id || !rows.find((r) => r.id === id)?.isPreset) setEditingPresets(false);
    setOpeningKey(key);
    startOpening(() => {
      router.push(id ? `/admin/social?post=${id}` : "/admin/social", { scroll: false });
    });
  }

  /**
   * Creates a post or preset and opens it in the composer. The open post's pending
   * edits are saved first, so a copy of it includes them.
   * @param body - POST body for the create route.
   * @param key - Busy marker while the request runs.
   */
  async function createAndOpen(body: Record<string, unknown>, key: string): Promise<void> {
    if (saveOpen.current && !(await saveOpen.current())) return;
    setBusyId(key);
    const res = await callApi<{ post: SocialPostRow }>("/api/admin/social", "POST", body);
    if (!res.ok) {
      setBusyId(null);
      toast(res.error, { tone: "error" });
      return;
    }
    setRows((prev) => [res.post, ...prev]);
    await openPost(res.post.id, key);
    setBusyId(null);
  }

  /**
   * Copies a post into a new preset, leaving the post open.
   * @param row - Post to copy.
   */
  async function saveAsPreset(row: SocialPostRow): Promise<void> {
    if (saveOpen.current && !(await saveOpen.current())) return;
    setBusyId(`preset-${row.id}`);
    const res = await callApi<{ post: SocialPostRow }>("/api/admin/social", "POST", {
      source: "copy",
      sourceId: row.id,
      asPreset: true,
    });
    setBusyId(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setRows((prev) => [res.post, ...prev]);
    toast(`Saved "${res.post.name}" to your presets.`, { tone: "success" });
  }

  // Check the connections once when the page opens, so a revoked or expired token shows
  // before a post fails on it. Opening other posts keeps this component mounted, so it
  // doesn't re-check on every click.
  useEffect(() => {
    let live = true;
    void callApi<{ connections: Connection[] }>("/api/admin/social/connections").then((res) => {
      if (!live) return;
      if (res.ok) setConnections(res.connections);
      else setConnectionsError(res.error);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Checks every platform's credentials again, from the Check button. */
  async function checkConnections(): Promise<void> {
    setBusyId("connections");
    const res = await callApi<{ connections: Connection[] }>("/api/admin/social/connections");
    setBusyId(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setConnections(res.connections);
    setConnectionsError(null);
  }

  /**
   * Opens the delete confirmation with take-down ticked, so a fresh dialog never
   * carries over an unticked box from the last one.
   * @param row - Post to delete.
   */
  function askDelete(row: SocialPostRow): void {
    setAlsoTakeDown(true);
    setDeleting(row);
  }

  /**
   * Deletes the post waiting in the confirm dialog. The server takes it down first
   * unless the box was unticked, judging from the stored post rather than this row,
   * which may predate a scheduled post going out. A refused delete reloads the row to
   * show where it is now.
   */
  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    const id = deleting.id;
    const wasLive = liveOn(deleting).length > 0;
    const keepOnline = wasLive && !alsoTakeDown;
    setBusyId(`delete-${id}`);
    const res = await callApi(
      `/api/admin/social/${id}${keepOnline ? "?keepOnline=1" : ""}`,
      "DELETE",
    );
    if (!res.ok) {
      setBusyId(null);
      setDeleting(null);
      toast(res.error, { tone: "error" });
      if (id === openId) router.refresh();
      else {
        const fresh = await callApi<{ post: SocialPostRow }>(`/api/admin/social/${id}`);
        if (fresh.ok) setRows((prev) => prev.map((r) => (r.id === id ? fresh.post : r)));
      }
      return;
    }
    setBusyId(null);
    setDeleting(null);
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (wasLive && !keepOnline) toast("Taken down and deleted.", { tone: "success" });
    // The composer's pending edits belong to the deleted post, so skip saving them.
    if (id === openId) {
      saveOpen.current = null;
      await openPost(null);
    }
  }

  // Stable, so the composer's autosave isn't reset every time the list re-renders.
  const onSaved = useCallback(
    (saved: { name: string; body: string }) => {
      setRows((prev) => prev.map((r) => (r.id === openId ? { ...r, ...saved } : r)));
    },
    [openId],
  );

  const deletingLive = deleting ? liveOn(deleting) : [];

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="social-start"
        className="flex flex-col gap-3 rounded-xl border border-admin-border bg-admin-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            ref={startHeadingRef}
            id="social-start"
            tabIndex={-1}
            className="text-base font-semibold text-admin-text focus:outline-none"
          >
            {editingPresets ? "Edit presets" : "Start a post"}
          </h2>
          <button
            type="button"
            onClick={() => setEditingPresets((e) => !e)}
            className="text-sm font-semibold text-russian-violet underline-offset-2 hover:underline"
          >
            {editingPresets ? "Done" : "Edit presets"}
          </button>
        </div>
        <p className={cn("-mt-2 text-sm text-admin-text-secondary", open && "hidden sm:block")}>
          {editingPresets
            ? "Pick a preset to change its wording, or add a new one."
            : "Start blank, or from a preset that has the wording ready to change."}
        </p>
        <div
          className={
            // Roomy cards while nothing is open, since starting a post is the whole
            // page then; a compact row of buttons once a post is being written.
            // On a phone the compact row scrolls sideways, keeping the post in view.
            open
              ? "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
              : "grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          }
        >
          {editingPresets ? (
            <StartButton
              compact={open !== null}
              icon={<FaPlus aria-hidden className="size-3" />}
              label="New preset"
              busy={isBusy("new-preset")}
              onClick={() => void createAndOpen({ source: "blank", asPreset: true }, "new-preset")}
            />
          ) : (
            <StartButton
              compact={open !== null}
              primary
              icon={<FaPlus aria-hidden className="size-3" />}
              label="Blank post"
              hint="Write it from scratch."
              busy={isBusy("blank")}
              onClick={() => void createAndOpen({ source: "blank" }, "blank")}
            />
          )}
          {presets.map((p) => (
            <StartButton
              key={p.id}
              compact={open !== null}
              icon={editingPresets ? <FaPen aria-hidden className="size-3" /> : undefined}
              label={p.name}
              hint={firstLine(p.body)}
              current={editingPresets && p.id === openId}
              busy={isBusy(`use-${p.id}`) || (editingPresets && isBusy(p.id))}
              onClick={() =>
                editingPresets
                  ? void openPost(p.id)
                  : void createAndOpen({ source: "copy", sourceId: p.id }, `use-${p.id}`)
              }
            />
          ))}
        </div>
      </section>

      {inProgress.length > 0 && (
        <section aria-labelledby="social-in-progress" className="flex flex-col gap-2">
          <h2 id="social-in-progress" className="text-sm font-semibold text-admin-text">
            In progress
          </h2>
          <ul className="flex flex-wrap gap-2">
            {inProgress.map((r) => {
              const current = r.id === openId;
              const status = chipStatus(r);
              return (
                <li key={r.id} className="w-full sm:w-64">
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    aria-busy={isBusy(r.id)}
                    onClick={() => void openPost(r.id)}
                    className={cn(
                      "flex w-full flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors",
                      current
                        ? "border-russian-violet bg-russian-violet/10"
                        : "border-admin-border bg-admin-surface hover:border-russian-violet/50",
                      isBusy(r.id) && "opacity-60",
                    )}
                  >
                    <span className="w-full truncate text-sm font-semibold text-admin-text">
                      {r.name || "Untitled"}
                    </span>
                    <span className="w-full truncate text-sm text-admin-text-secondary">
                      {firstLine(r.body) || <span className="italic">No text yet</span>}
                    </span>
                    <span className={cn("text-sm", status.className)}>{status.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {open && openRow ? (
        <section
          ref={composerRef}
          aria-label={openRow.isPreset ? "Preset" : "Post"}
          className={cn("flex flex-col gap-4 transition-opacity", opening && "opacity-60")}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-admin-border pb-3">
            <div className="flex min-w-0 items-center gap-2">
              <h2
                ref={composerHeadingRef}
                tabIndex={-1}
                className="truncate text-lg font-bold text-admin-text focus:outline-none"
              >
                {openRow.name || "Untitled"}
              </h2>
              {openRow.isPreset ? (
                <StatusPill tone="neutral">Preset</StatusPill>
              ) : (
                <StatusPill tone={POST_STATUS_PILL[openRow.status].tone}>
                  {POST_STATUS_PILL[openRow.status].label}
                </StatusPill>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {openRow.isPreset && (
                <AdminButton
                  size="sm"
                  busy={isBusy(`use-${openRow.id}`)}
                  onClick={() =>
                    void createAndOpen(
                      { source: "copy", sourceId: openRow.id },
                      `use-${openRow.id}`,
                    )
                  }
                >
                  Write a post from this
                </AdminButton>
              )}
              {!openRow.isPreset && (
                <>
                  <AdminButton
                    size="sm"
                    variant="secondary"
                    busy={isBusy(`copy-${openRow.id}`)}
                    onClick={() =>
                      void createAndOpen(
                        { source: "copy", sourceId: openRow.id },
                        `copy-${openRow.id}`,
                      )
                    }
                  >
                    Duplicate
                  </AdminButton>
                  <AdminButton
                    size="sm"
                    variant="secondary"
                    busy={busyId === `preset-${openRow.id}`}
                    onClick={() => void saveAsPreset(openRow)}
                  >
                    Save as preset
                  </AdminButton>
                </>
              )}
              {openRow.status !== "posting" && openRow.status !== "removing" && (
                <AdminButton size="sm" variant="ghost" onClick={() => askDelete(openRow)}>
                  Delete
                </AdminButton>
              )}
              <AdminButton size="sm" variant="ghost" onClick={() => void openPost(null)}>
                <FaXmark aria-hidden className="size-3.5" /> Close
              </AdminButton>
            </div>
          </div>
          {/* Keyed on status and last save: router.refresh() after a publish or schedule
              change remounts the composer with the new state instead of keeping stale fields. */}
          <PostComposer
            key={`${open.post.id}-${open.post.status}-${open.post.updatedAt}`}
            initial={open.post}
            promo={open.promo}
            promoTitle={open.promoTitle}
            canUpload={open.canUpload}
            missingEnv={open.missingEnv}
            details={open.details}
            onSaved={onSaved}
            saveRef={saveOpen}
          />
        </section>
      ) : openMissing ? (
        <p className="rounded-xl border border-dashed border-admin-border bg-admin-surface px-4 py-6 text-center text-sm text-admin-muted">
          That post has been deleted. Start a new one above.
        </p>
      ) : null}

      <details
        open={historyOpen}
        onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
        className="group rounded-xl border border-admin-border bg-admin-surface"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-base font-semibold text-admin-text">
          <span>
            Posted
            {posted.length > 0 && (
              <span className="ml-1.5 font-normal text-admin-muted">{posted.length}</span>
            )}
          </span>
          <FaChevronDown
            aria-hidden
            className="size-3 text-admin-muted transition-[rotate] group-open:rotate-180"
          />
        </summary>
        {posted.length === 0 ? (
          <p className="border-t border-admin-border px-4 py-4 text-sm text-admin-muted">
            Nothing posted yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-admin-border border-t border-admin-border">
            {posted.map((row) => (
              <PostedRow
                key={row.id}
                row={row}
                current={row.id === openId}
                busy={isBusy(row.id)}
                onOpen={() => void openPost(row.id)}
              />
            ))}
          </ul>
        )}
      </details>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-admin-text">Connections</span>
          {connections === null ? (
            <span className="text-admin-muted">
              {connectionsError ? `Couldn't check: ${connectionsError}` : "Checking..."}
            </span>
          ) : (
            connections.map((c) => (
              <span key={c.platform} title={c.ok ? c.label : c.error}>
                <StatusPill tone={c.ok ? "success" : "critical"}>
                  {PLATFORM_LABEL[c.platform]}
                  {c.ok ? `: ${c.label}` : ": not connected"}
                </StatusPill>
              </span>
            ))
          )}
          <AdminButton
            size="xs"
            variant="secondary"
            busy={busyId === "connections"}
            onClick={() => void checkConnections()}
          >
            Check
          </AdminButton>
        </div>
        {connections?.some((c) => !c.ok) && (
          <ul className="list-disc pl-5 text-sm text-admin-text-secondary">
            {connections
              .filter((c) => !c.ok)
              .map((c) => (
                <li key={c.platform}>
                  {PLATFORM_LABEL[c.platform]}: {c.error}
                </li>
              ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.isPreset ? "Delete this preset?" : "Delete this post?"}
        body={
          deletingLive.length > 0 ? (
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-2 text-admin-text">
                <input
                  type="checkbox"
                  checked={alsoTakeDown}
                  onChange={(e) => setAlsoTakeDown(e.target.checked)}
                  className="mt-0.5 size-4 accent-russian-violet"
                />
                <span>Also take it down from {deletingLive.join(" and ")}</span>
              </label>
              <p>
                {alsoTakeDown
                  ? "It's deleted there too, along with its likes and comments. If that fails, the post stays here so you can try again."
                  : `It only goes from this list. It stays on ${deletingLive.join(" and ")} until you delete it there.`}
              </p>
            </div>
          ) : (
            "This can't be undone."
          )
        }
        confirmLabel={deletingLive.length > 0 && alsoTakeDown ? "Take down and delete" : "Delete"}
        tone="danger"
        busy={busyId === `delete-${deleting?.id}`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/**
 * One way to start a post: a roomy card with a hint while nothing is open, or a
 * compact button beside a post being written.
 * @param props - Component props.
 * @param props.label - What it starts.
 * @param props.hint - A line on what's in it; only shown on the roomy card.
 * @param props.icon - Optional leading icon.
 * @param props.primary - Highlight it as the main choice.
 * @param props.compact - Show the compact button.
 * @param props.current - Whether it's the preset open in the composer.
 * @param props.busy - Whether it's being created.
 * @param props.onClick - Click handler.
 * @returns Start button element.
 */
function StartButton({
  label,
  hint,
  icon,
  primary = false,
  compact,
  current = false,
  busy,
  onClick,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  primary?: boolean;
  compact: boolean;
  current?: boolean;
  busy: boolean;
  onClick: () => void;
}): React.ReactElement {
  if (compact) {
    return (
      <AdminButton
        size="sm"
        variant={primary ? "primary" : "secondary"}
        busy={busy}
        aria-current={current ? "true" : undefined}
        className={cn("shrink-0", current && "border-russian-violet text-russian-violet")}
        onClick={onClick}
      >
        {icon}
        {label}
      </AdminButton>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      aria-current={current ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-20 flex-col items-start gap-1 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-60",
        primary
          ? "border-russian-violet bg-russian-violet text-white hover:bg-russian-violet/90"
          : "border-admin-border bg-admin-bg hover:border-russian-violet/50",
        current && "border-russian-violet",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-2 font-semibold",
          primary ? "text-white" : "text-admin-text",
        )}
      >
        {icon}
        {busy ? "Opening..." : label}
      </span>
      {hint && (
        <span
          className={cn(
            "line-clamp-2 text-sm",
            primary ? "text-white/80" : "text-admin-text-secondary",
          )}
        >
          {hint}
        </span>
      )}
    </button>
  );
}

/**
 * One post in the Posted list: its outcome on each platform, with links to the live
 * copies, and a button to open it for take-down, retry or duplicating.
 * @param props - Component props.
 * @param props.row - Post row.
 * @param props.current - Whether it's open in the composer.
 * @param props.busy - Whether it's being opened.
 * @param props.onOpen - Opens it in the composer.
 * @returns Row element.
 */
function PostedRow({
  row,
  current,
  busy,
  onOpen,
}: {
  row: SocialPostRow;
  current: boolean;
  busy: boolean;
  onOpen: () => void;
}): React.ReactElement {
  const pill = POST_STATUS_PILL[row.status];
  const outcomes = row.targets.filter((t) => t.enabled && t.status !== "skipped");
  return (
    <li
      className={cn(
        "flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        current && "bg-russian-violet/5",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-admin-text">{row.name || "Untitled"}</span>
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        </div>
        <p className="truncate text-sm text-admin-text-secondary">
          {firstLine(row.body) || <span className="italic">No text</span>}
        </p>
        <p className="text-sm text-admin-muted">{dateLabel(row)}</p>
        {outcomes.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {outcomes.map((t) => {
              const label = PLATFORM_LABEL[t.platform as SocialPlatformKey] ?? t.platform;
              return (
                <li key={t.platform}>
                  {t.status === "posted" && t.permalink ? (
                    <a
                      href={t.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-russian-violet underline"
                    >
                      See it on {label}
                    </a>
                  ) : t.status === "posted" ? (
                    <span className="text-admin-text">{label}: posted</span>
                  ) : t.status === "removed" ? (
                    <span className="text-admin-muted">{label}: taken down</span>
                  ) : t.status === "failed" ? (
                    <span className="text-coquelicot-600">
                      {label}: {t.error ?? "failed"}
                    </span>
                  ) : (
                    <span className="text-admin-muted">{label}: still going</span>
                  )}
                  {t.status === "posted" && t.error && (
                    <span className="text-coquelicot-600"> (couldn&apos;t take it down)</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <AdminButton
        size="sm"
        variant="secondary"
        busy={busy}
        aria-current={current ? "true" : undefined}
        disabled={current}
        onClick={onOpen}
        className="shrink-0 self-start sm:self-center"
      >
        {current ? "Open above" : "Open"}
      </AdminButton>
    </li>
  );
}
