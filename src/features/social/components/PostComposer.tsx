"use client";
// src/features/social/components/PostComposer.tsx
// Write, preview and publish one social post. Drafts and presets autosave; the preview
// cards and their warnings come from the same rules publishing enforces, filled with the
// same promo wording, so what shows here is what goes out.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import type { InsertDetails } from "@/features/admin/lib/insertables";
import { callApi } from "@/features/mailing/lib/api-client";
import type { PromoWording } from "@/features/mailing/lib/render";
import type { PreviewPost } from "@/features/social/components/PlatformPreview";
import { PostActionBar } from "@/features/social/components/PostActionBar";
import { PostPaneTabs } from "@/features/social/components/PostPaneTabs";
import { PostPreviewPanel } from "@/features/social/components/PostPreviewPanel";
import { PostStatusBanner } from "@/features/social/components/PostStatusBanner";
import { PostWriteForm } from "@/features/social/components/PostWriteForm";
import { insertableGroups } from "@/features/social/lib/insertables";
import { liveOn, type Connection } from "@/features/social/lib/post-display";
import type { SocialPostRow, SocialTargetRow } from "@/features/social/lib/post-row";
import {
  FACEBOOK_MAX_CHARS,
  INSTAGRAM_MAX_CHARS,
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  blockingIssues,
  fillPromo,
  textFor,
  validatePost,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { shrinkImage } from "@/shared/lib/resize-image";
import { fromNzInputValue, toNzInputValue } from "@/shared/lib/timezone-utils";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

const AUTOSAVE_MS = 1200;

const MAX_CHARS: Record<SocialPlatformKey, number> = {
  facebook: FACEBOOK_MAX_CHARS,
  instagram: INSTAGRAM_MAX_CHARS,
};

/** Editable fields, as last saved. */
interface Content {
  name: string;
  body: string;
  imageUrl: string | null;
  imageAlt: string;
  imageWidth: number | null;
  imageHeight: number | null;
  linkUrl: string;
  targets: { platform: string; enabled: boolean; textOverride: string }[];
}

/** The editable fields, for the form card in PostWriteForm. */
export type PostContent = Content;

type SaveState = "saved" | "unsaved" | "saving" | "error";

/**
 * The composer's editable shape for a stored post.
 * @param p - Post row.
 * @returns Content with blanks for nulls.
 */
function contentOf(p: SocialPostRow): Content {
  return {
    name: p.name,
    body: p.body,
    imageUrl: p.imageUrl,
    imageAlt: p.imageAlt ?? "",
    imageWidth: p.imageWidth,
    imageHeight: p.imageHeight,
    linkUrl: p.linkUrl ?? "",
    targets: p.targets.map((t) => ({
      platform: t.platform,
      enabled: t.enabled,
      textOverride: t.textOverride ?? "",
    })),
  };
}

/**
 * The fields that differ from the last save, shaped for the PATCH route.
 * @param now - Current content.
 * @param saved - Content as last saved.
 * @returns Changed fields; empty when nothing changed.
 */
function diff(now: Content, saved: Content): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (now.name !== saved.name) out.name = now.name;
  if (now.body !== saved.body) out.body = now.body;
  if (now.imageUrl !== saved.imageUrl) {
    out.imageUrl = now.imageUrl;
    out.imageWidth = now.imageWidth;
    out.imageHeight = now.imageHeight;
  }
  if (now.imageAlt !== saved.imageAlt) out.imageAlt = now.imageAlt || null;
  if (now.linkUrl !== saved.linkUrl) out.linkUrl = now.linkUrl.trim() || null;
  if (JSON.stringify(now.targets) !== JSON.stringify(saved.targets)) {
    out.targets = now.targets
      .filter((t) => (SOCIAL_PLATFORMS as readonly string[]).includes(t.platform))
      .map((t) => ({ ...t, textOverride: t.textOverride || null }));
  }
  return out;
}

/**
 * Social post composer.
 * @param props - Component props.
 * @param props.initial - The post as saved.
 * @param props.promo - Wording the promo placeholders fill with, or null.
 * @param props.promoTitle - Title of the linked promo, if any.
 * @param props.canUpload - Whether image uploads are configured.
 * @param props.missingEnv - Per platform, env vars it still needs.
 * @param props.details - Site address and contact details for the Add menu.
 * @param props.onSaved - Called with the name and text after each successful save.
 * @param props.saveRef - Filled with a function that saves any pending edit, so the page
 *   can save before it opens another post in this composer's place.
 * @returns Composer element.
 */
export function PostComposer({
  initial,
  promo,
  promoTitle,
  canUpload,
  missingEnv,
  details,
  onSaved,
  saveRef,
}: {
  initial: SocialPostRow;
  promo: PromoWording | null;
  promoTitle: string | null;
  canUpload: boolean;
  missingEnv: Record<SocialPlatformKey, string[]>;
  details: InsertDetails;
  onSaved?: (saved: { name: string; body: string }) => void;
  saveRef?: React.RefObject<(() => Promise<boolean>) | null>;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const editable = initial.isPreset || initial.status === "draft";

  const [content, setContent] = useState<Content>(() => contentOf(initial));
  const [promoId, setPromoId] = useState(initial.promoId);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saved = useRef<Content>(content);
  const saving = useRef<Promise<boolean> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingTakeDown, setConfirmingTakeDown] = useState(false);
  // Below xl: whether the form or the preview is showing.
  const [pane, setPane] = useState<"write" | "preview">("write");
  const [previewOn, setPreviewOn] = useState<SocialPlatformKey>("facebook");
  // Scroll position per pane; null until that pane has been left once.
  const paneScroll = useRef<{ write: number | null; preview: number | null }>({
    write: null,
    preview: null,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [accounts, setAccounts] = useState<Partial<Record<SocialPlatformKey, string>>>({});
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const overrideRefs = useRef<Partial<Record<SocialPlatformKey, HTMLTextAreaElement | null>>>({});
  const scheduleFieldId = useId();

  // The previews show the real Page name and username once the connection check
  // answers; until then (or if it fails) they use placeholders.
  useEffect(() => {
    let live = true;
    void callApi<{ connections: Connection[] }>("/api/admin/social/connections").then((res) => {
      if (!live || !res.ok) return;
      setAccounts(
        Object.fromEntries(
          res.connections.filter((c) => c.ok && c.label).map((c) => [c.platform, c.label]),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Writes whatever changed since the last save.
   * @returns False when the save failed.
   */
  const save = useCallback(async (): Promise<boolean> => {
    if (!editable) return true;
    // Chain behind a save already in flight so two PATCHes never race.
    if (saving.current) await saving.current;
    const target = content;
    const changed = diff(target, saved.current);
    if (Object.keys(changed).length === 0) {
      setSaveState("saved");
      return true;
    }
    setSaveState("saving");
    const run = callApi(`/api/admin/social/${initial.id}`, "PATCH", changed).then((res) => {
      if (!res.ok) {
        setSaveState("error");
        toast(res.error, { tone: "error" });
        return false;
      }
      saved.current = target;
      onSaved?.({ name: target.name, body: target.body });
      return true;
    });
    saving.current = run;
    const ok = await run;
    saving.current = null;
    if (ok) setSaveState((s) => (s === "saving" ? "saved" : s));
    return ok;
  }, [content, editable, initial.id, onSaved, toast]);

  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = save;
    return () => {
      saveRef.current = null;
    };
  }, [save, saveRef]);

  // Autosave a moment after typing stops.
  useEffect(() => {
    if (!editable) return;
    if (Object.keys(diff(content, saved.current)).length === 0) return;
    setSaveState("unsaved");
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [content, editable, save]);

  // After switching panes below xl, go back to where the page was in that pane, so
  // checking the preview doesn't lose the operator's place in the form. Skipped on
  // mount, where the page decides the scroll position.
  const shownPane = useRef(pane);
  useLayoutEffect(() => {
    if (shownPane.current === pane) return;
    shownPane.current = pane;
    // A pane not seen yet opens at the top of the composer, or where the page already
    // is if that's higher, rather than at the top of the page above it.
    const composerTop = (rootRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY - 72;
    window.scrollTo({
      top: paneScroll.current[pane] ?? Math.min(window.scrollY, Math.max(0, composerTop)),
    });
  }, [pane]);

  // Warn before leaving with an edit still unsaved.
  useEffect(() => {
    if (saveState === "saved") return;
    /**
     * Asks the browser to confirm leaving the page.
     * @param e - The unload event.
     */
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  /**
   * Updates one target's toggle or override.
   * @param platform - Platform key.
   * @param patch - Fields to change.
   */
  function setTarget(platform: string, patch: Partial<Content["targets"][number]>): void {
    setContent((c) => ({
      ...c,
      targets: c.targets.map((t) => (t.platform === platform ? { ...t, ...patch } : t)),
    }));
  }

  /**
   * Inserts text at the cursor in the post or in one platform's own text,
   * replacing any selection, then puts the cursor just after it.
   * @param box - "body" or the platform whose own text gets it.
   * @param text - Text to insert.
   * @param line - Start on a fresh line.
   */
  function insertAt(box: "body" | SocialPlatformKey, text: string, line = false): void {
    const el = box === "body" ? bodyRef.current : (overrideRefs.current[box] ?? null);
    const current =
      box === "body"
        ? content.body
        : (content.targets.find((t) => t.platform === box)?.textOverride ?? "");
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const lead = line && start > 0 && current[start - 1] !== "\n" ? "\n" : "";
    const next = current.slice(0, start) + lead + text + current.slice(end);
    if (box === "body") setContent((c) => ({ ...c, body: next }));
    else setTarget(box, { textOverride: next });
    // Restore the cursor once React has re-rendered the new value.
    const cursor = start + lead.length + text.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  /**
   * Shrinks and uploads a picture, replacing any current one.
   * @param file - Picked image.
   */
  async function addImage(file: File): Promise<void> {
    setBusy("image");
    try {
      const small = await shrinkImage(file);
      const form = new FormData();
      form.append("file", small.file);
      const res = await callApi<{ url: string }>("/api/admin/social/upload", "POST", form);
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return;
      }
      setContent((c) => ({
        ...c,
        imageUrl: res.url,
        imageWidth: small.width,
        imageHeight: small.height,
      }));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't add the picture.", {
        tone: "error",
      });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** Detaches the post from its promo, so it describes whatever promo is running. */
  async function unlinkPromo(): Promise<void> {
    // Save first: the refresh after unlinking reloads the fields from the server.
    if (!(await save())) return;
    setBusy("unlink");
    const res = await callApi(`/api/admin/social/${initial.id}`, "PATCH", { promoId: null });
    setBusy(null);
    if (!res.ok) toast(res.error, { tone: "error" });
    else {
      setPromoId(null);
      router.refresh();
    }
  }

  /**
   * Publishes now, or re-posts only to the platforms that failed.
   * @param mode - "now" or "retry".
   */
  async function publish(mode: "now" | "retry"): Promise<void> {
    setConfirming(false);
    if (mode === "now" && !(await save())) return;
    setBusy(mode);
    const res = await callApi<{ status: string; targets: SocialTargetRow[] }>(
      `/api/admin/social/${initial.id}/publish`,
      "POST",
      { mode },
    );
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      router.refresh();
      return;
    }
    const live = res.targets.filter((t) => t.enabled && t.status !== "skipped");
    /**
     * A target's platform name for the summary toast.
     * @param t - Target.
     * @returns Display name.
     */
    const label = (t: SocialTargetRow): string =>
      PLATFORM_LABEL[t.platform as SocialPlatformKey] ?? t.platform;
    const posted = live.filter((t) => t.status === "posted").map(label);
    const failed = live.filter((t) => t.status === "failed").map(label);
    const waiting = live.filter((t) => t.status === "pending").map(label);
    const parts = [
      posted.length > 0 && `Posted to ${posted.join(" and ")}`,
      failed.length > 0 && `${failed.join(" and ")} failed - see details`,
      waiting.length > 0 && `${waiting.join(" and ")} is still processing and will finish shortly`,
    ].filter(Boolean);
    toast(`${parts.join("; ")}.`, {
      tone: failed.length > 0 ? (posted.length > 0 ? "warning" : "error") : "success",
    });
    router.refresh();
  }

  /**
   * Deletes the post from every platform it's up on. A platform that refuses stays
   * posted with its reason, and pressing Take down again retries just that one.
   */
  async function takeDown(): Promise<void> {
    setConfirmingTakeDown(false);
    setBusy("takedown");
    const res = await callApi<{ status: string; targets: SocialTargetRow[] }>(
      `/api/admin/social/${initial.id}/take-down`,
      "POST",
    );
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      router.refresh();
      return;
    }
    const before = new Set(
      initial.targets.filter((t) => t.status === "posted").map((t) => t.platform),
    );
    /**
     * A target's platform name for the summary toast.
     * @param t - Target.
     * @returns Display name.
     */
    const label = (t: SocialTargetRow): string =>
      PLATFORM_LABEL[t.platform as SocialPlatformKey] ?? t.platform;
    const attempted = res.targets.filter((t) => before.has(t.platform));
    const down = attempted.filter((t) => t.status === "removed").map(label);
    const stuck = attempted.filter((t) => t.status === "posted").map(label);
    const parts = [
      down.length > 0 && `Taken down from ${down.join(" and ")}`,
      stuck.length > 0 && `${stuck.join(" and ")} couldn't be taken down - see details`,
    ].filter(Boolean);
    toast(`${parts.join("; ") || "Taken down"}.`, {
      tone: stuck.length > 0 ? (down.length > 0 ? "warning" : "error") : "success",
    });
    router.refresh();
  }

  /** Saves, then schedules for the picked time. */
  async function schedule(): Promise<void> {
    if (!scheduling) return;
    let when: Date;
    try {
      when = fromNzInputValue(scheduling);
    } catch {
      toast("Pick a date and time.", { tone: "error" });
      return;
    }
    if (!(await save())) return;
    setBusy("schedule");
    const res = await callApi<{ scheduledAt: string }>(
      `/api/admin/social/${initial.id}/schedule`,
      "POST",
      { scheduledAt: when.toISOString() },
    );
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setScheduling(null);
    toast(`Scheduled for ${formatDateTimeShort(res.scheduledAt)}.`, { tone: "success" });
    router.refresh();
  }

  /** Turns a scheduled post back into an editable draft. */
  async function cancelSchedule(): Promise<void> {
    setBusy("unschedule");
    const res = await callApi(`/api/admin/social/${initial.id}/schedule`, "DELETE");
    setBusy(null);
    if (!res.ok) toast(res.error, { tone: "error" });
    router.refresh();
  }

  const draft = {
    body: content.body,
    imageUrl: content.imageUrl,
    imageWidth: content.imageWidth,
    imageHeight: content.imageHeight,
    linkUrl: content.linkUrl.trim() || null,
    targets: content.targets,
  };
  const issues = validatePost(draft, promo !== null);
  const blocked = blockingIssues(issues);
  const enabled = SOCIAL_PLATFORMS.filter((p) => issues[p] !== undefined);
  const setupMissing = enabled
    .filter((p) => missingEnv[p].length > 0)
    .map((p) => `${PLATFORM_LABEL[p]} is off until ${missingEnv[p].join(", ")} is set.`);
  // The counter only measures against platforms that post the main text; one with its
  // own text has its own limit, checked in its preview.
  const usesBody = enabled.filter(
    (p) => !content.targets.find((t) => t.platform === p)?.textOverride.trim(),
  );
  const strictest = usesBody.length > 0 ? Math.min(...usesBody.map((p) => MAX_CHARS[p])) : null;
  // Scheduling checks promo wording as if a promo will be running by then, the same
  // way the schedule route does; Post now needs one running today.
  const scheduleBlocked = blockingIssues(validatePost(draft, true));
  const insertGroups = insertableGroups(details, promo);
  const failedCount = initial.targets.filter((t) => t.enabled && t.status === "failed").length;
  const upOn = liveOn(initial);

  /**
   * What one platform's preview card shows: its own text when set, promo filled in.
   * @param p - Platform.
   * @returns Preview content.
   */
  function previewOf(p: SocialPlatformKey): PreviewPost {
    return {
      text: fillPromo(textFor(draft, p), promo).trim(),
      imageUrl: content.imageUrl,
      imageAlt: content.imageAlt,
      imageWidth: content.imageWidth,
      imageHeight: content.imageHeight,
      linkUrl: draft.linkUrl,
    };
  }

  // Only decides the starting state; React leaves the toggle alone after that.
  const overridesOpen = initial.targets.some((t) => t.textOverride);
  const shownPreview = enabled.includes(previewOn) ? previewOn : (enabled[0] ?? null);
  const readyMessage =
    setupMissing.length > 0
      ? setupMissing.join(" ")
      : blocked.length > 0 && scheduleBlocked.length === 0
        ? "Post now needs a promo running for the promo wording. You can still schedule it."
        : blocked.length === 1
          ? blocked[0]
          : blocked.length > 1
            ? `${blocked.length} things to fix first. They're listed under the preview.`
            : "Ready to post.";

  /**
   * Switches between the form and the preview below xl, remembering how far down the
   * page was in the one being left.
   * @param next - Pane to show.
   */
  function switchPane(next: "write" | "preview"): void {
    if (next === pane) return;
    paneScroll.current[pane] = window.scrollY;
    setPane(next);
  }

  // One bar, placed twice: pinned to the top beside the pinned preview on wide screens,
  // and to the bottom on narrower ones, where it stays clear of the + button.
  const actionBar = editable && (
    <PostActionBar
      saveState={saveState}
      onRetrySave={() => void save()}
      isPreset={initial.isPreset}
      readyMessage={readyMessage}
      showProblem={!initial.isPreset && (blocked.length > 0 || setupMissing.length > 0)}
      scheduleDisabled={scheduleBlocked.length > 0 || setupMissing.length > 0}
      postDisabled={blocked.length > 0 || setupMissing.length > 0}
      posting={busy === "now"}
      onSchedule={() => {
        const next = new Date(Date.now() + 60 * 60_000);
        next.setMinutes(0, 0, 0);
        setScheduling(toNzInputValue(next));
      }}
      onPostNow={() => setConfirming(true)}
    />
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <PostStatusBanner
        post={initial}
        busy={busy}
        onCancelSchedule={() => void cancelSchedule()}
        onRetry={() => void publish("retry")}
        canRetry={failedCount > 0 && (initial.status === "partial" || initial.status === "failed")}
        onTakeDown={() => setConfirmingTakeDown(true)}
        canTakeDown={upOn.length > 0}
        onRefresh={() => router.refresh()}
      />

      {actionBar && (
        <div className="sticky top-14 z-20 -mx-6 hidden bg-admin-bg/90 px-6 py-3 backdrop-blur xl:block">
          {actionBar}
        </div>
      )}

      {/* Below xl the form and preview don't fit side by side, so show one at a time. */}
      <PostPaneTabs pane={pane} onSwitch={switchPane} blockedCount={blocked.length} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className={cn(pane === "preview" && "hidden xl:block")}>
          <PostWriteForm
            content={content}
            setContent={setContent}
            setTarget={setTarget}
            editable={editable}
            isPreset={initial.isPreset}
            promoId={promoId}
            promoTitle={promoTitle}
            unlinking={busy === "unlink"}
            onUnlink={() => void unlinkPromo()}
            insertGroups={insertGroups}
            insertAt={insertAt}
            bodyRef={bodyRef}
            overrideRefs={overrideRefs}
            strictest={strictest}
            canUpload={canUpload}
            imageBusy={busy === "image"}
            fileRef={fileRef}
            onFile={(file) => void addImage(file)}
            enabled={enabled}
            overridesOpen={overridesOpen}
          />
        </div>

        <PostPreviewPanel
          pane={pane}
          belowActionBar={Boolean(actionBar)}
          enabled={enabled}
          shownPreview={shownPreview}
          onPreviewOn={setPreviewOn}
          issues={issues}
          previewOf={previewOf}
          accounts={accounts}
        />
      </div>

      {actionBar && (
        <div data-phone-bar="sticky" className="sticky bottom-0 z-10 xl:hidden">
          {actionBar}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Post this now?"
        body={`It goes straight to ${enabled.map((p) => PLATFORM_LABEL[p]).join(" and ")}. You can take it down again from here.`}
        confirmLabel="Post now"
        busy={busy === "now"}
        onConfirm={() => void publish("now")}
        onCancel={() => setConfirming(false)}
      />

      <ConfirmDialog
        open={confirmingTakeDown}
        title="Take this post down?"
        body={`It's deleted from ${upOn.join(" and ")}, along with its likes and comments. This can't be undone. The post stays here, so you can duplicate it later.`}
        confirmLabel="Take down"
        tone="danger"
        busy={busy === "takedown"}
        onConfirm={() => void takeDown()}
        onCancel={() => setConfirmingTakeDown(false)}
      />

      <Modal
        open={scheduling !== null}
        onClose={() => setScheduling(null)}
        title="Schedule this post"
        description="It goes out at this time, New Zealand time."
        footer={
          <div className="flex justify-end gap-2">
            <AdminButton variant="secondary" onClick={() => setScheduling(null)}>
              Cancel
            </AdminButton>
            <AdminButton busy={busy === "schedule"} onClick={() => void schedule()}>
              Schedule
            </AdminButton>
          </div>
        }
      >
        <AdminField label="Date and time" htmlFor={scheduleFieldId}>
          <AdminInput
            id={scheduleFieldId}
            type="datetime-local"
            value={scheduling ?? ""}
            onChange={(e) => setScheduling(e.target.value)}
          />
        </AdminField>
      </Modal>
    </div>
  );
}
