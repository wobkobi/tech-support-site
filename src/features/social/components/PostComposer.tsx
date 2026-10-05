"use client";
// src/features/social/components/PostComposer.tsx
// Write, preview and publish one social post. Drafts and presets autosave; the preview
// cards and their warnings come from the same rules publishing enforces, filled with the
// same promo wording, so what shows here is what goes out.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { InsertMenu } from "@/features/admin/components/ui/InsertMenu";
import { Modal } from "@/features/admin/components/ui/Modal";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import type { PromoWording } from "@/features/mailing/lib/render";
import {
  FacebookPreview,
  InstagramPreview,
  type PreviewPost,
} from "@/features/social/components/PlatformPreview";
import { insertableGroups, type InsertDetails } from "@/features/social/lib/insertables";
import { POST_STATUS_PILL, liveOn, type Connection } from "@/features/social/lib/post-display";
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
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FaChevronDown } from "react-icons/fa6";

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
    <div className="flex flex-col gap-2 rounded-xl border border-admin-border bg-admin-surface py-3 pr-20 pl-4 shadow-sm sm:flex-row sm:items-center sm:justify-between lg:pr-4">
      <div className="min-w-0 text-sm" aria-live="polite">
        <p
          className={cn("font-medium", saveState === "error" ? "text-red-700" : "text-admin-text")}
        >
          {saveState === "saving" && "Saving..."}
          {saveState === "saved" && "All changes saved"}
          {saveState === "unsaved" && "Unsaved changes"}
          {saveState === "error" && (
            <>
              Couldn&apos;t save.{" "}
              <button
                type="button"
                onClick={() => void save()}
                className="font-semibold text-russian-violet underline"
              >
                Try again
              </button>
            </>
          )}
        </p>
        <p
          className={cn(
            !initial.isPreset && (blocked.length > 0 || setupMissing.length > 0)
              ? "text-red-700"
              : "text-admin-muted",
          )}
        >
          {initial.isPreset
            ? "Presets aren't posted. Press Write a post from this to start one from it."
            : readyMessage}
        </p>
      </div>
      {!initial.isPreset && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <AdminButton
            variant="secondary"
            disabled={scheduleBlocked.length > 0 || setupMissing.length > 0}
            onClick={() => {
              const next = new Date(Date.now() + 60 * 60_000);
              next.setMinutes(0, 0, 0);
              setScheduling(toNzInputValue(next));
            }}
          >
            Schedule
          </AdminButton>
          <AdminButton
            busy={busy === "now"}
            disabled={blocked.length > 0 || setupMissing.length > 0}
            onClick={() => setConfirming(true)}
          >
            Post now
          </AdminButton>
        </div>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <StatusBanner
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
        <div className="sticky top-0 z-20 -mx-6 hidden bg-slate-50/90 px-6 py-3 backdrop-blur xl:block">
          {actionBar}
        </div>
      )}

      {/* Below xl the form and preview don't fit side by side, so show one at a time. */}
      <div
        role="tablist"
        aria-label="Show"
        className="sticky top-16 z-20 grid grid-cols-2 gap-1 rounded-xl border border-admin-border bg-admin-surface p-1 shadow-sm lg:top-4 xl:hidden"
      >
        {(["write", "preview"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={pane === k}
            onClick={() => switchPane(k)}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors",
              pane === k
                ? "bg-russian-violet text-white"
                : "text-admin-muted hover:bg-admin-bg hover:text-admin-text",
            )}
          >
            {k === "write" ? "Write" : "Preview"}
            {k === "preview" && blocked.length > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-sm leading-5",
                  pane === k ? "bg-white text-red-700" : "bg-red-600 text-white",
                )}
              >
                {blocked.length}
                <span className="sr-only"> to fix</span>
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className={cn(pane === "preview" && "hidden xl:block")}>
          <Card>
            <div className="flex flex-col gap-5">
              <Field label={initial.isPreset ? "Preset name" : "Name (only you see this)"}>
                <input
                  value={content.name}
                  onChange={(e) => setContent((c) => ({ ...c, name: e.target.value }))}
                  disabled={!editable}
                  maxLength={120}
                  className={ADMIN_INPUT_CLS}
                />
              </Field>

              {promoId && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-admin-border bg-admin-bg px-3 py-2 text-sm">
                  <span>
                    Promo wording comes from <strong>{promoTitle ?? "a promo"}</strong>. It
                    won&apos;t post once that promo has ended.
                  </span>
                  {editable && (
                    <AdminButton
                      size="xs"
                      variant="ghost"
                      busy={busy === "unlink"}
                      onClick={() => void unlinkPromo()}
                    >
                      Unlink
                    </AdminButton>
                  )}
                </div>
              )}

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium text-admin-text">Post to</legend>
                <div className="flex flex-wrap gap-2">
                  {SOCIAL_PLATFORMS.map((p) => {
                    const target = content.targets.find((t) => t.platform === p);
                    if (!target) return null;
                    return (
                      <label
                        key={p}
                        className={cn(
                          "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                          editable && "cursor-pointer",
                          target.enabled
                            ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                            : "border-admin-border text-admin-muted hover:border-russian-violet/50",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={target.enabled}
                          disabled={!editable}
                          onChange={(e) => setTarget(p, { enabled: e.target.checked })}
                          className="size-4 accent-russian-violet"
                        />
                        {PLATFORM_LABEL[p]}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex flex-col gap-1">
                <div className="flex items-end justify-between gap-2">
                  <label htmlFor="post-body" className="text-sm font-medium text-admin-text">
                    Post
                  </label>
                  {editable && (
                    <InsertMenu
                      groups={insertGroups}
                      onInsert={(text, line) => insertAt("body", text, line)}
                      align="right"
                    />
                  )}
                </div>
                <textarea
                  ref={bodyRef}
                  id="post-body"
                  value={content.body}
                  onChange={(e) => setContent((c) => ({ ...c, body: e.target.value }))}
                  disabled={!editable}
                  rows={9}
                  className={cn(ADMIN_INPUT_CLS, "resize-y leading-relaxed")}
                />
                <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
                  <span className="text-admin-muted">
                    Plain text: **bold** shows as typed. Add has links, contact details, symbols and
                    promo wording.
                  </span>
                  <span
                    className={cn(
                      "ml-auto shrink-0 tabular-nums",
                      strictest !== null && content.body.length > strictest
                        ? "text-red-700"
                        : "text-admin-muted",
                    )}
                  >
                    {content.body.length.toLocaleString()}
                    {strictest !== null && ` / ${strictest.toLocaleString()}`}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-admin-text">Picture</span>
                {content.imageUrl ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-admin-border p-3 sm:flex-row sm:items-start">
                    {/* Blob-hosted and already shrunk, so next/image would add nothing. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={content.imageUrl}
                      alt={content.imageAlt}
                      className="h-28 w-auto self-start rounded-md border border-admin-border"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Field label="Picture description (read out by screen readers)">
                        <input
                          value={content.imageAlt}
                          onChange={(e) => setContent((c) => ({ ...c, imageAlt: e.target.value }))}
                          disabled={!editable}
                          maxLength={300}
                          className={ADMIN_INPUT_CLS}
                        />
                      </Field>
                      {editable && (
                        <div className="flex gap-2">
                          <AdminButton
                            size="xs"
                            variant="secondary"
                            busy={busy === "image"}
                            disabled={!canUpload}
                            onClick={() => fileRef.current?.click()}
                          >
                            Replace
                          </AdminButton>
                          <AdminButton
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              setContent((c) => ({
                                ...c,
                                imageUrl: null,
                                imageWidth: null,
                                imageHeight: null,
                              }))
                            }
                          >
                            Remove
                          </AdminButton>
                        </div>
                      )}
                    </div>
                  </div>
                ) : editable ? (
                  <button
                    type="button"
                    disabled={!canUpload || busy === "image"}
                    onClick={() => fileRef.current?.click()}
                    className="flex h-20 items-center justify-center rounded-lg border border-dashed border-admin-border-strong text-sm font-semibold text-admin-muted transition-colors hover:border-russian-violet hover:text-russian-violet disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy === "image" ? "Adding the picture..." : "+ Add a picture"}
                  </button>
                ) : (
                  <p className="text-sm text-admin-muted">No picture</p>
                )}
                {editable && !canUpload && (
                  <p className="text-sm text-admin-muted">
                    Picture uploads are off until BLOB_READ_WRITE_TOKEN is set.
                  </p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void addImage(file);
                  }}
                />
              </div>

              <Field label="Link (optional)">
                <input
                  value={content.linkUrl}
                  onChange={(e) => setContent((c) => ({ ...c, linkUrl: e.target.value }))}
                  disabled={!editable}
                  placeholder="https://"
                  inputMode="url"
                  className={ADMIN_INPUT_CLS}
                />
              </Field>

              {enabled.length > 0 && (
                <details
                  className="group rounded-lg border border-admin-border"
                  open={overridesOpen}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-admin-text">
                    Different text for one app
                    <FaChevronDown
                      aria-hidden
                      className="size-3 text-admin-muted transition-[rotate] group-open:rotate-180"
                    />
                  </summary>
                  <div className="flex flex-col gap-4 border-t border-admin-border px-3 py-3">
                    <p className="text-sm text-admin-muted">
                      Leave a box empty to use the post above.
                    </p>
                    {enabled.map((p) => {
                      const target = content.targets.find((t) => t.platform === p);
                      if (!target) return null;
                      return (
                        <div key={p} className="flex flex-col gap-1">
                          <div className="flex items-end justify-between gap-2">
                            <label
                              htmlFor={`override-${p}`}
                              className="text-sm font-medium text-admin-text"
                            >
                              {PLATFORM_LABEL[p]}
                            </label>
                            {editable && (
                              <InsertMenu
                                groups={insertGroups}
                                onInsert={(text, line) => insertAt(p, text, line)}
                                align="right"
                              />
                            )}
                          </div>
                          <textarea
                            ref={(el) => {
                              overrideRefs.current[p] = el;
                            }}
                            id={`override-${p}`}
                            value={target.textOverride}
                            onChange={(e) => setTarget(p, { textOverride: e.target.value })}
                            disabled={!editable}
                            rows={5}
                            className={cn(ADMIN_INPUT_CLS, "resize-y leading-relaxed")}
                          />
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          </Card>
        </div>

        <section
          aria-label="Preview"
          className={cn(
            "flex-col gap-3 rounded-xl border border-admin-border bg-admin-surface p-4 xl:sticky xl:flex xl:overflow-y-auto",
            // Clear the pinned action bar when there is one (drafts and presets).
            actionBar
              ? "xl:top-28 xl:max-h-[calc(100dvh-8rem)]"
              : "xl:top-6 xl:max-h-[calc(100dvh-3rem)]",
            pane === "write" ? "hidden" : "flex",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-admin-text">Preview</h2>
            {enabled.length > 1 && (
              <div
                role="tablist"
                aria-label="Preview for"
                className="inline-flex gap-0.5 rounded-lg border border-admin-border bg-admin-bg p-0.5"
              >
                {enabled.map((p) => {
                  const errors = (issues[p] ?? []).filter((i) => i.level === "error").length;
                  return (
                    <button
                      key={p}
                      type="button"
                      role="tab"
                      aria-selected={p === shownPreview}
                      onClick={() => setPreviewOn(p)}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors",
                        p === shownPreview
                          ? "bg-admin-surface text-admin-text shadow-sm"
                          : "text-admin-muted hover:text-admin-text",
                      )}
                    >
                      {PLATFORM_LABEL[p]}
                      {errors > 0 && (
                        <span className="rounded-full bg-red-600 px-1.5 text-sm leading-5 text-white">
                          {errors}
                          <span className="sr-only"> to fix</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {shownPreview === null ? (
            <p className="text-sm text-admin-muted">Pick where to post to see a preview.</p>
          ) : (
            <>
              <div className="rounded-lg bg-[#f0f2f5] p-3">
                {shownPreview === "facebook" ? (
                  <FacebookPreview
                    post={previewOf("facebook")}
                    pageName={accounts.facebook ?? "Your Page"}
                  />
                ) : (
                  <InstagramPreview
                    post={previewOf("instagram")}
                    username={(accounts.instagram ?? "your.account").replace(/^@/, "")}
                  />
                )}
              </div>
              {(issues[shownPreview] ?? []).length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {(issues[shownPreview] ?? []).map((i) => (
                    <li
                      key={i.message}
                      className={i.level === "error" ? "text-red-700" : "text-amber-800"}
                    >
                      {i.level === "error" ? "Fix: " : "Note: "}
                      {i.message}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-admin-muted">Likes and comments are for show.</p>
            </>
          )}
        </section>
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
        <Field label="Date and time">
          <input
            type="datetime-local"
            value={scheduling ?? ""}
            onChange={(e) => setScheduling(e.target.value)}
            className={ADMIN_INPUT_CLS}
          />
        </Field>
      </Modal>
    </div>
  );
}

/**
 * Labelled form field.
 * @param props - Component props.
 * @param props.label - Field label.
 * @param props.children - The input.
 * @returns Field element.
 */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-admin-text">
      {label}
      {children}
    </label>
  );
}

/**
 * Explains a locked post: scheduled, posting, posted, partly posted, failed, being
 * taken down or taken down, with each platform's outcome.
 * @param props - Component props.
 * @param props.post - The post.
 * @param props.busy - Which action is running.
 * @param props.onCancelSchedule - Cancels a schedule.
 * @param props.onRetry - Re-posts to the failed platforms.
 * @param props.canRetry - Whether a partly posted or failed post has a platform to retry.
 * @param props.onTakeDown - Asks to take the post down.
 * @param props.canTakeDown - Whether it's up on any platform.
 * @param props.onRefresh - Reloads the page data.
 * @returns Banner element, or null for drafts and presets.
 */
function StatusBanner({
  post,
  busy,
  onCancelSchedule,
  onRetry,
  canRetry,
  onTakeDown,
  canTakeDown,
  onRefresh,
}: {
  post: SocialPostRow;
  busy: string | null;
  onCancelSchedule: () => void;
  onRetry: () => void;
  canRetry: boolean;
  onTakeDown: () => void;
  canTakeDown: boolean;
  onRefresh: () => void;
}): React.ReactElement | null {
  if (post.isPreset || post.status === "draft") return null;
  const box =
    "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm";

  if (post.status === "scheduled") {
    return (
      <div className={cn(box, "border-sky-300 bg-sky-50 text-sky-900")}>
        <span>
          Posts {post.scheduledAt ? formatDateTimeShort(post.scheduledAt) : "soon"}. Cancel the
          schedule to make changes.
        </span>
        <AdminButton
          size="sm"
          variant="secondary"
          busy={busy === "unschedule"}
          onClick={onCancelSchedule}
        >
          Cancel schedule
        </AdminButton>
      </div>
    );
  }

  const pill = POST_STATUS_PILL[post.status];
  const live = post.targets.filter((t) => t.enabled && t.status !== "skipped");
  const removedAt = post.targets
    .map((t) => t.removedAt)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  return (
    <div
      className={cn(
        box,
        "flex-col items-stretch",
        post.status === "posted" && "border-emerald-300 bg-emerald-50 text-emerald-900",
        (post.status === "partial" || post.status === "posting") &&
          "border-amber-300 bg-amber-50 text-amber-900",
        post.status === "failed" && "border-red-300 bg-red-50 text-red-900",
        post.status === "removing" && "border-amber-300 bg-amber-50 text-amber-900",
        post.status === "removed" && "border-admin-border bg-admin-bg text-admin-text",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          {post.status === "posting"
            ? "Still going. Anything left over is picked up automatically within 15 minutes."
            : post.status === "removing"
              ? "Taking it down. If this still shows after 10 minutes, press Take down again."
              : post.status === "removed" && removedAt
                ? `Taken down ${formatDateTimeShort(removedAt)}`
                : post.postedAt && formatDateTimeShort(post.postedAt)}
        </span>
        <div className="flex flex-wrap gap-2">
          {(post.status === "posting" || post.status === "removing") && (
            <AdminButton size="sm" variant="secondary" onClick={onRefresh}>
              Refresh
            </AdminButton>
          )}
          {canRetry && (
            <AdminButton
              size="sm"
              busy={busy === "retry"}
              disabled={busy !== null}
              onClick={onRetry}
            >
              Retry failed
            </AdminButton>
          )}
          {canTakeDown && post.status !== "posting" && (
            <AdminButton
              size="sm"
              variant="danger"
              busy={busy === "takedown"}
              disabled={busy !== null}
              onClick={onTakeDown}
            >
              Take down
            </AdminButton>
          )}
        </div>
      </div>
      <ul className="flex flex-col gap-1">
        {live.map((t) => {
          const label = PLATFORM_LABEL[t.platform as SocialPlatformKey] ?? t.platform;
          return (
            <li key={t.platform}>
              <strong>{label}:</strong>{" "}
              {t.status === "posted" ? (
                <>
                  {t.permalink ? (
                    <a href={t.permalink} target="_blank" rel="noreferrer" className="underline">
                      view the post
                    </a>
                  ) : (
                    "posted"
                  )}
                  {t.error && ` - couldn't take it down: ${t.error}`}
                </>
              ) : t.status === "removed" ? (
                "taken down"
              ) : t.status === "failed" ? (
                (t.error ?? "failed")
              ) : (
                "still processing"
              )}
            </li>
          );
        })}
      </ul>
      <span>To post something similar, press Duplicate above.</span>
    </div>
  );
}
