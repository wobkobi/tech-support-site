"use client";
// src/features/social/components/SocialView.tsx
// The whole Social page. Starting a post comes first: a blank post or any preset, and
// drafts and scheduled posts to pick back up. The open post is written right below in
// the composer. What has already gone out folds away under Posted, and the connection
// check sits at the bottom, run once when the page opens.

import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { PostComposer } from "@/features/social/components/PostComposer";
import { SocialComposerHeader } from "@/features/social/components/SocialComposerHeader";
import { SocialConnections } from "@/features/social/components/SocialConnections";
import { SocialInProgress } from "@/features/social/components/SocialInProgress";
import { SocialPostedList } from "@/features/social/components/SocialPostedList";
import { SocialStartSection } from "@/features/social/components/SocialStartSection";
import type { OpenPost } from "@/features/social/lib/open-post";
import { liveOn, type Connection } from "@/features/social/lib/post-display";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState, useTransition } from "react";

/**
 * Posts that still need something: being written, waiting to go out, or stuck
 * partway. Only posts that are done (up, or taken down) fold away under Posted.
 */
const IN_PROGRESS = new Set(["draft", "scheduled", "posting", "partial", "failed", "removing"]);

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
      <SocialStartSection
        headingRef={startHeadingRef}
        editingPresets={editingPresets}
        onToggleEditing={() => setEditingPresets((e) => !e)}
        hasOpen={open !== null}
        openId={openId}
        presets={presets}
        isBusy={isBusy}
        onCreate={(body, key) => void createAndOpen(body, key)}
        onOpenPost={(id) => void openPost(id)}
      />

      {inProgress.length > 0 && (
        <SocialInProgress
          rows={inProgress}
          openId={openId}
          isBusy={isBusy}
          onOpen={(id) => void openPost(id)}
        />
      )}

      {open && openRow ? (
        <section
          ref={composerRef}
          aria-label={openRow.isPreset ? "Preset" : "Post"}
          className={cn("flex flex-col gap-4 transition-opacity", opening && "opacity-60")}
        >
          <SocialComposerHeader
            row={openRow}
            headingRef={composerHeadingRef}
            isBusy={isBusy}
            savingPreset={busyId === `preset-${openRow.id}`}
            onCreate={(body, key) => void createAndOpen(body, key)}
            onSaveAsPreset={() => void saveAsPreset(openRow)}
            onDelete={() => askDelete(openRow)}
            onClose={() => void openPost(null)}
          />
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
        <Card padding="none">
          <EmptyState title="That post has been deleted. Start a new one above." />
        </Card>
      ) : null}

      <SocialPostedList
        posted={posted}
        open={historyOpen}
        onToggle={setHistoryOpen}
        openId={openId}
        isBusy={isBusy}
        onOpen={(id) => void openPost(id)}
      />

      <SocialConnections
        connections={connections}
        error={connectionsError}
        checking={busyId === "connections"}
        onCheck={() => void checkConnections()}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.isPreset ? "Delete this preset?" : "Delete this post?"}
        body={
          deletingLive.length > 0 ? (
            <div className="flex flex-col gap-3">
              <AdminCheckbox
                checked={alsoTakeDown}
                onChange={setAlsoTakeDown}
                label={`Also take it down from ${deletingLive.join(" and ")}`}
              />
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
