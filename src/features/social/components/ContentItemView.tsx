"use client";
// src/features/social/components/ContentItemView.tsx
// One content item's page: its heading and actions, then the composer in content mode with the
// item's recycling and postings.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { EmailStepDialog } from "@/features/social/components/EmailStepDialog";
import { PostComposer, type ContentItemInfo } from "@/features/social/components/PostComposer";
import { SOCIAL_CONTENT_PATH, postHref } from "@/features/social/lib/links";
import type { OpenPost } from "@/features/social/lib/open-post";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { byTagName, type SocialTagRow } from "@/features/social/lib/tags";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaArrowLeft } from "react-icons/fa6";

/**
 * Content item page.
 * @param props - Component props.
 * @param props.open - The item, loaded for the composer.
 * @param props.info - Its stats, postings and lined-up problems.
 * @param props.tags - Every tag, A to Z.
 * @returns Page element.
 */
export function ContentItemView({
  open,
  info,
  tags,
}: {
  open: OpenPost;
  info: ContentItemInfo;
  tags: SocialTagRow[];
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const item = open.post;
  const [name, setName] = useState(item.name);
  const [tagList, setTagList] = useState(tags);
  const [shownTags, setShownTags] = useState(tags);
  if (tags !== shownTags) {
    setShownTags(tags);
    setTagList(tags);
  }
  const [busy, setBusy] = useState<"copy" | "delete" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [emailStep, setEmailStep] = useState<{ afterPublish: boolean } | null>(null);
  const saveOpen = useRef<(() => Promise<boolean>) | null>(null);
  // Postings that go when the item does: lined up and still following it.
  const goingWith = info.postings.filter(
    (p) => (p.status === "draft" || p.status === "scheduled") && !p.detached,
  ).length;

  // Back/Forward can show an older copy of the page than autosave left; reload when it has.
  useEffect(() => {
    let live = true;
    void callApi<{ post: SocialPostRow }>(`/api/admin/social/${item.id}`).then((res) => {
      if (live && (!res.ok || res.post.updatedAt !== item.updatedAt)) router.refresh();
    });
    return () => {
      live = false;
    };
  }, [item.id, item.updatedAt, router]);

  const onSaved = useCallback((saved: Partial<Pick<SocialPostRow, "name">>) => {
    if (saved.name !== undefined) setName(saved.name);
  }, []);
  const onTagCreated = useCallback((tag: SocialTagRow) => {
    setTagList((prev) =>
      prev.some((t) => t.id === tag.id) ? prev : [...prev, tag].sort(byTagName),
    );
  }, []);
  const onDraftEmail = useCallback((afterPublish: boolean) => {
    setEmailStep({ afterPublish });
  }, []);

  /** Saves, then makes a copy of the item and opens it. */
  async function duplicate(): Promise<void> {
    if (saveOpen.current && !(await saveOpen.current())) return;
    setBusy("copy");
    const res = await callApi<{ item: SocialPostRow }>("/api/admin/social/content", "POST", {
      source: "copy",
      sourceId: item.id,
    });
    if (!res.ok) {
      setBusy(null);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(postHref(res.item));
  }

  /** Deletes the item and its lined-up postings, then goes back to the list. */
  async function remove(): Promise<void> {
    setBusy("delete");
    // Flush pending edits first, so autosave has nothing left to write to the deleted item.
    await saveOpen.current?.();
    const res = await callApi(`/api/admin/social/${item.id}`, "DELETE");
    if (!res.ok) {
      setBusy(null);
      setDeleting(false);
      toast(res.error, { tone: "error" });
      return;
    }
    toast(`Deleted "${name || "Untitled"}".`, { tone: "success" });
    router.push(SOCIAL_CONTENT_PATH);
  }

  const showEmailStep =
    emailStep !== null && (!emailStep.afterPublish || (open.email === null && !open.emailSkipped));

  return (
    <section aria-label="Content item" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-admin-border pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-lg font-semibold text-admin-text">{name || "Untitled"}</h2>
          <StatusPill tone="neutral">Content item</StatusPill>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminButton size="sm" variant="ghost" href={SOCIAL_CONTENT_PATH}>
            <FaArrowLeft aria-hidden className="size-3.5" /> Back to content
          </AdminButton>
          <AdminButton
            size="sm"
            variant="secondary"
            busy={busy === "copy"}
            disabled={busy !== null}
            onClick={() => void duplicate()}
          >
            Duplicate
          </AdminButton>
          <AdminButton
            size="sm"
            variant="danger"
            disabled={busy !== null}
            onClick={() => setDeleting(true)}
          >
            Delete
          </AdminButton>
        </div>
      </div>

      {/* Keyed on the last save, so a refresh with newer words remounts it. */}
      <PostComposer
        key={`${item.id}-${item.updatedAt}`}
        initial={item}
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
        contentItem={info}
      />

      {showEmailStep && (
        <EmailStepDialog
          postId={item.id}
          imageUrl={item.imageUrl}
          hasDesignPicture={open.emailPicture !== null}
          aiReady={open.captionAi !== null}
          afterPublish={emailStep.afterPublish}
          onClose={() => setEmailStep(null)}
        />
      )}

      <ConfirmDialog
        open={deleting}
        title="Delete this content item?"
        body={
          goingWith > 0
            ? `Its ${goingWith === 1 ? "lined-up posting goes" : `${goingWith} lined-up postings go`} too. Postings that went out, or that you edited by hand, stay in Posts.`
            : "Postings that went out stay in Posts. This can't be undone."
        }
        confirmLabel="Delete"
        tone="danger"
        busy={busy === "delete"}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(false)}
      />
    </section>
  );
}
