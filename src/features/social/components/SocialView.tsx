"use client";
// src/features/social/components/SocialView.tsx
// The Social Posts tab: start options, then the composer, then Posted folded away. Linked
// accounts live on the Overview.

import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { EmailStepDialog } from "@/features/social/components/EmailStepDialog";
import { PostComposer } from "@/features/social/components/PostComposer";
import { SocialComposerHeader } from "@/features/social/components/SocialComposerHeader";

import { SocialInProgress } from "@/features/social/components/SocialInProgress";
import { SocialPostedList } from "@/features/social/components/SocialPostedList";
import { SocialStartSection } from "@/features/social/components/SocialStartSection";
import { SocialTagFilter } from "@/features/social/components/SocialTagFilter";
import { TagManager, type TagUse } from "@/features/social/components/TagManager";
import { SOCIAL_POSTS_PATH } from "@/features/social/lib/links";
import type { OpenPost } from "@/features/social/lib/open-post";
import { liveOn } from "@/features/social/lib/post-display";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { byTagName, type SocialTagRow } from "@/features/social/lib/tags";
import { cn } from "@/shared/lib/cn";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState, useTransition } from "react";

/** Posts still needing something; only finished (up or taken down) posts fold under Posted. */
const IN_PROGRESS = new Set(["draft", "scheduled", "posting", "partial", "failed", "removing"]);

/**
 * Social page.
 * @param props - Component props.
 * @param props.initial - Every post and preset, newest first.
 * @param props.open - The post open in the composer, or null.
 * @param props.openMissing - Whether the address named a post that no longer exists.
 * @param props.tags - Every tag, A to Z.
 * @returns Social view element.
 */
export function SocialView({
  initial,
  open,
  openMissing,
  tags,
}: {
  initial: SocialPostRow[];
  open: OpenPost | null;
  openMissing: boolean;
  tags: SocialTagRow[];
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
  const [tagList, setTagList] = useState(tags);
  const [shownTags, setShownTags] = useState(tags);
  if (tags !== shownTags) {
    setShownTags(tags);
    setTagList(tags);
  }
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [managingTags, setManagingTags] = useState(false);
  const tagsById = new Map(tagList.map((t) => [t.id, t]));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  // Which button started the post now loading, so it keeps its spinner until the
  // composer shows rather than going quiet once the create request returns.
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  // A preset opened from the address starts in preset editing, where it's highlighted.
  const [editingPresets, setEditingPresets] = useState(open?.post.isPreset ?? false);
  const [deleting, setDeleting] = useState<SocialPostRow | null>(null);
  const [alsoTakeDown, setAlsoTakeDown] = useState(true);

  const saveOpen = useRef<(() => Promise<boolean>) | null>(null);
  const composerRef = useRef<HTMLElement>(null);
  const composerHeadingRef = useRef<HTMLHeadingElement>(null);
  const startHeadingRef = useRef<HTMLHeadingElement>(null);

  const openId = open?.post.id ?? null;
  const openRow = open ? (rows.find((r) => r.id === openId) ?? open.post) : null;
  // Email this too lives here, not in the composer, which remounts on the refresh after a
  // publish. Offered after publishing only while the post has no email and wasn't turned down,
  // and never on a posting: its content item holds the email.
  const [emailStep, setEmailStep] = useState<{ postId: string; afterPublish: boolean } | null>(
    null,
  );
  const [emailStepFor, setEmailStepFor] = useState(openId);
  if (emailStepFor !== openId) {
    setEmailStepFor(openId);
    setEmailStep(null);
  }
  const showEmailStep =
    emailStep !== null &&
    open !== null &&
    emailStep.postId === open.post.id &&
    !open.post.isPreset &&
    !open.post.sourceId &&
    (!emailStep.afterPublish || (open.email === null && !open.emailSkipped));
  // The list arrives newest first; presets read oldest first so the starter set keeps
  // its order and new ones join the end.
  const presets = rows.filter((r) => r.isPreset).reverse();
  const shownPosts = rows.filter(
    (r) => !r.isPreset && (tagFilter === null || r.tagIds.includes(tagFilter)),
  );
  const inProgress = shownPosts.filter((r) => IN_PROGRESS.has(r.status));
  const posted = shownPosts
    .filter((r) => !IN_PROGRESS.has(r.status))
    .sort((a, b) => (b.postedAt ?? b.updatedAt).localeCompare(a.postedAt ?? a.updatedAt));
  const filterName = tagFilter ? tagsById.get(tagFilter)?.name : undefined;
  const [historyOpen, setHistoryOpen] = useState(
    open !== null && !open.post.isPreset && !IN_PROGRESS.has(open.post.status),
  );

  /**
   * Whether a button's post is being created or loaded.
   * @param key - The button's busy marker.
   * @returns True while it should show a spinner.
   */
  const isBusy = (key: string): boolean => busyId === key || (opening && openingKey === key);

  // When another post opens, scroll it into view if needed and focus its heading (the opener may
  // have been swapped out); on close, focus Start a post. The top 56px sit under the sticky
  // AdminTopBar, so count them as off screen.
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

  // Back/Forward reuse the first-loaded page, which may be older than autosave's writes; reload
  // after a history step or when the open post changed, so stale text never saves over new.
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
   * Opens another post (or none) in the composer after saving pending edits; on save failure
   * the current post stays open.
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
      router.push(id ? `${SOCIAL_POSTS_PATH}?post=${id}` : SOCIAL_POSTS_PATH, { scroll: false });
    });
  }

  /**
   * Creates a post or preset and opens it, saving pending edits first so a copy includes them.
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

  /**
   * Copies a post or preset into a new content item, leaving the post open.
   * @param row - Post to copy.
   */
  async function saveToContent(row: SocialPostRow): Promise<void> {
    if (saveOpen.current && !(await saveOpen.current())) return;
    setBusyId(`content-${row.id}`);
    const res = await callApi<{ item: SocialPostRow }>("/api/admin/social/content", "POST", {
      source: "copy",
      sourceId: row.id,
    });
    setBusyId(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast(`Saved "${res.item.name}" to Content.`, { tone: "success" });
  }

  /**
   * Opens the delete confirmation with take-down ticked fresh each time.
   * @param row - Post to delete.
   */
  function askDelete(row: SocialPostRow): void {
    setAlsoTakeDown(true);
    setDeleting(row);
  }

  /**
   * Deletes the post in the confirm dialog. The server takes it down first (unless unticked),
   * judging from the stored post; a refused delete reloads the row.
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

  /**
   * Where a tag is used, counted from the list so it stays right as tags change.
   * @param id - Tag id.
   * @returns Its post and preset counts.
   */
  function usageOf(id: string): TagUse {
    const carrying = rows.filter((r) => r.tagIds.includes(id));
    const presetCount = carrying.filter((r) => r.isPreset).length;
    return { posts: carrying.length - presetCount, presets: presetCount };
  }

  /**
   * Puts a renamed or recoloured tag back in the list, keeping it A to Z.
   * @param tag - The tag as saved.
   */
  function putTag(tag: SocialTagRow): void {
    setTagList((prev) => [...prev.filter((t) => t.id !== tag.id), tag].sort(byTagName));
  }

  /**
   * Drops a deleted tag from the list, every post and the filter.
   * @param id - Deleted tag's id.
   */
  function dropTag(id: string): void {
    setTagList((prev) => prev.filter((t) => t.id !== id));
    setRows((prev) =>
      prev.map((r) =>
        r.tagIds.includes(id) ? { ...r, tagIds: r.tagIds.filter((t) => t !== id) } : r,
      ),
    );
    setTagFilter((f) => (f === id ? null : f));
  }

  // Stable, so the composer's autosave isn't reset every time the list re-renders.
  const onSaved = useCallback(
    (saved: Partial<Pick<SocialPostRow, "name" | "body" | "tagIds">>) => {
      setRows((prev) => prev.map((r) => (r.id === openId ? { ...r, ...saved } : r)));
    },
    [openId],
  );
  const onTagCreated = useCallback((tag: SocialTagRow) => {
    setTagList((prev) =>
      prev.some((t) => t.id === tag.id) ? prev : [...prev, tag].sort(byTagName),
    );
  }, []);
  const onDraftEmail = useCallback(
    (afterPublish: boolean) => {
      if (openId) setEmailStep({ postId: openId, afterPublish });
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

      {tagList.length > 0 && (
        <SocialTagFilter
          tags={tagList}
          countOf={(id) => usageOf(id).posts}
          value={tagFilter}
          onChange={setTagFilter}
          onManage={() => setManagingTags(true)}
        />
      )}

      {inProgress.length > 0 && (
        <SocialInProgress
          rows={inProgress}
          tagsById={tagsById}
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
            savingContent={busyId === `content-${openRow.id}`}
            onSaveToContent={() => void saveToContent(openRow)}
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
            design={open.design}
            captionAi={open.captionAi}
            email={open.email}
            watermark={open.watermark}
            tags={tagList}
            onTagCreated={onTagCreated}
            onDraftEmail={onDraftEmail}
            onSaved={onSaved}
            saveRef={saveOpen}
            source={open.source}
          />
        </section>
      ) : openMissing ? (
        <Card padding="none">
          <EmptyState title="That post has been deleted. Start a new one above." />
        </Card>
      ) : null}

      <SocialPostedList
        posted={posted}
        tagsById={tagsById}
        emptyText={
          filterName ? `Nothing posted with the ${filterName} tag.` : "Nothing posted yet."
        }
        open={historyOpen}
        onToggle={setHistoryOpen}
        openId={openId}
        isBusy={isBusy}
        onOpen={(id) => void openPost(id)}
      />

      <TagManager
        open={managingTags}
        onClose={() => setManagingTags(false)}
        tags={tagList}
        usageOf={usageOf}
        onChanged={putTag}
        onDeleted={dropTag}
      />

      {showEmailStep && (
        <EmailStepDialog
          postId={open.post.id}
          imageUrl={open.post.imageUrl}
          hasDesignPicture={open.emailPicture !== null}
          aiReady={open.captionAi !== null}
          afterPublish={emailStep.afterPublish}
          onClose={() => setEmailStep(null)}
        />
      )}

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
                // The label can wrap onto two lines: keep the box level with the first.
                className="items-start [&>input]:mt-0.5 [&>input]:shrink-0"
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
