"use client";
// src/features/social/components/PostComposer.tsx
// Write, preview and publish one social post, or a content item that goes out as postings. Drafts,
// presets and content items autosave; previews use the publishing rules and promo wording, so what
// shows is what goes out.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import type { InsertDetails } from "@/features/admin/lib/insertables";
import { callApi } from "@/features/mailing/lib/api-client";
import type { PromoWording } from "@/features/mailing/lib/render";
import {
  CaptionAiDialog,
  type CaptionPlacement,
} from "@/features/social/components/CaptionAiDialog";
import { CaptionsField } from "@/features/social/components/CaptionsField";
import { ContentPostings } from "@/features/social/components/ContentPostings";
import { ContentRecycling } from "@/features/social/components/ContentRecycling";
import { ContentSchedules } from "@/features/social/components/ContentSchedules";
import type { PreviewPost } from "@/features/social/components/PlatformPreview";
import { PostActionBar } from "@/features/social/components/PostActionBar";
import { PostEmailPanel } from "@/features/social/components/PostEmailPanel";
import {
  MorePictures,
  PostKindSwitch,
  PostVideo,
} from "@/features/social/components/PostMediaFields";
import { PostPaneTabs } from "@/features/social/components/PostPaneTabs";
import { PostPreviewPanel } from "@/features/social/components/PostPreviewPanel";
import { PostStatusBanner } from "@/features/social/components/PostStatusBanner";
import { PostWriteForm } from "@/features/social/components/PostWriteForm";
import { PostingDialog } from "@/features/social/components/PostingDialog";
import { PostingSourceNote } from "@/features/social/components/PostingSourceNote";
import type { ContentStatsRow } from "@/features/social/lib/content-row";
import type { PostEmail } from "@/features/social/lib/email-step.server";
import { insertableGroups } from "@/features/social/lib/insertables";
import {
  FORMAT_PLURAL,
  MAX_PICTURES,
  VIDEO_MAX_BYTES,
  canTakeDown,
  formatTakes,
  usesText,
  type MediaItem,
  type SocialFormatKey,
} from "@/features/social/lib/media";
import type { CaptionAiSetup, PostDesign, PostingSource } from "@/features/social/lib/open-post";
import { liveOn, type Connection } from "@/features/social/lib/post-display";
import type { SocialPostRow, SocialTargetRow } from "@/features/social/lib/post-row";
import { MAX_CAPTIONS, clampCaption, spentReason } from "@/features/social/lib/postings-core";
import type { PostingProblem } from "@/features/social/lib/postings.server";
import type { ItemQueue } from "@/features/social/lib/queues";
import type { SocialTagRow, TagColour } from "@/features/social/lib/tags";
import { postBrief } from "@/features/social/lib/to-email";
import {
  FACEBOOK_MAX_CHARS,
  GOOGLE_MAX_CHARS,
  INSTAGRAM_MAX_CHARS,
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  blockingIssues,
  fillPromo,
  pictureFor,
  textFor,
  validatePost,
  type GooglePostCta,
  type GooglePostType,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import {
  captureFrame,
  loadVideo,
  uploadCoverFrame,
  uploadVideo,
  videoMetaOf,
  videoTypeOf,
} from "@/features/social/lib/video-upload";
import { watermarkImage } from "@/features/social/lib/watermark";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { shrinkImage } from "@/shared/lib/resize-image";
import type { WatermarkSettings } from "@/shared/lib/settings/types";
import { fromNzInputValue, toNzInputValue } from "@/shared/lib/timezone-utils";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

// Konva has no server build, and most posts never make a story.
const StoryMaker = dynamic(
  () => import("@/features/social/components/StoryMaker").then((m) => m.StoryMaker),
  { ssr: false },
);

const AUTOSAVE_MS = 1200;
// While a video processes, the page checks back this often.
const POSTING_POLL_MS = 15_000;

const MAX_CHARS: Record<SocialPlatformKey, number> = {
  facebook: FACEBOOK_MAX_CHARS,
  instagram: INSTAGRAM_MAX_CHARS,
  google: GOOGLE_MAX_CHARS,
};

/** Editable fields, as last saved. */
interface Content {
  name: string;
  /** The kind of post. */
  format: SocialFormatKey;
  body: string;
  imageUrl: string | null;
  imageAlt: string;
  imageWidth: number | null;
  imageHeight: number | null;
  /** The picture before Add my logo marked it; null when it has no logo. */
  imageOriginalUrl: string | null;
  /** Pictures 2 onwards of an ordinary post. */
  moreImages: MediaItem[];
  /** A reel's or story's video. */
  video: MediaItem | null;
  linkUrl: string;
  targets: {
    platform: string;
    enabled: boolean;
    textOverride: string;
    /** The platform's own picture, replacing the post's there; null to use the post's. */
    imageUrl: string | null;
    imageAlt: string;
    imageWidth: number | null;
    imageHeight: number | null;
    imageOriginalUrl: string | null;
    /** The picture URL the operator OK'd this platform cutting off. */
    cropApprovedFor: string | null;
  }[];
  googleType: GooglePostType;
  /** Empty for no button. */
  googleCta: GooglePostCta | "";
  /** Empty to send the button to the Link. */
  googleUrl: string;
  googleTitle: string;
  /** YYYY-MM-DD, empty when unset. */
  offerStart: string;
  offerEnd: string;
  /** An event's "HH:MM" times, both empty for all day. */
  eventStartTime: string;
  eventEndTime: string;
  couponCode: string;
  /** A content item's captions after the first, which is body. */
  altCaptions: string[];
  recycle: boolean;
  /** A content item's last day to post as YYYY-MM-DD, empty for none. */
  expiresAt: string;
  maxPosts: number | null;
}

/**
 * A content item's extras: how often it has gone out, its postings, lined-up problems, and the
 * schedules it's in.
 */
export interface ContentItemInfo {
  stats: ContentStatsRow;
  postings: SocialPostRow[];
  problems: PostingProblem[];
  schedules: ItemQueue[];
}

/** The editable fields, for the form card in PostWriteForm. */
export type PostContent = Content;

type SaveState = "saved" | "unsaved" | "saving" | "error";

/** The words Write with AI can change: the post's, each app's own, and other captions. */
interface Words {
  body: string;
  overrides: Record<string, string>;
  altCaptions: string[];
}

/**
 * The words part of the content.
 * @param c - Content.
 * @returns The post's words and each app's own.
 */
function wordsOf(c: Content): Words {
  return {
    body: c.body,
    overrides: Object.fromEntries(c.targets.map((t) => [t.platform, t.textOverride])),
    altCaptions: c.altCaptions,
  };
}

/**
 * The composer's editable shape for a stored post.
 * @param p - Post row.
 * @returns Content with blanks for nulls.
 */
function contentOf(p: SocialPostRow): Content {
  return {
    name: p.name,
    format: p.format,
    body: p.body,
    imageUrl: p.imageUrl,
    imageAlt: p.imageAlt ?? "",
    imageWidth: p.imageWidth,
    imageHeight: p.imageHeight,
    imageOriginalUrl: p.imageOriginalUrl,
    moreImages: p.moreImages,
    video: p.video,
    linkUrl: p.linkUrl ?? "",
    targets: p.targets.map((t) => ({
      platform: t.platform,
      enabled: t.enabled,
      textOverride: t.textOverride ?? "",
      imageUrl: t.imageUrl,
      imageAlt: t.imageAlt ?? "",
      imageWidth: t.imageWidth,
      imageHeight: t.imageHeight,
      imageOriginalUrl: t.imageOriginalUrl,
      cropApprovedFor: t.cropApprovedFor,
    })),
    googleType: p.googleType,
    googleCta: p.googleCta ?? "",
    googleUrl: p.googleUrl ?? "",
    googleTitle: p.googleTitle ?? "",
    offerStart: p.offerStart ?? "",
    offerEnd: p.offerEnd ?? "",
    eventStartTime: p.eventStartTime ?? "",
    eventEndTime: p.eventEndTime ?? "",
    couponCode: p.couponCode ?? "",
    altCaptions: p.altCaptions,
    recycle: p.recycle,
    expiresAt: p.expiresAt ?? "",
    maxPosts: p.maxPosts,
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
  if (now.format !== saved.format) out.format = now.format === "feed" ? null : now.format;
  if (now.body !== saved.body) out.body = now.body;
  if (JSON.stringify(now.moreImages) !== JSON.stringify(saved.moreImages)) {
    out.moreImages = now.moreImages.map((m) => ({ ...m, alt: m.alt?.trim() || null }));
  }
  if (JSON.stringify(now.video) !== JSON.stringify(saved.video)) out.video = now.video;
  if (now.imageUrl !== saved.imageUrl) {
    out.imageUrl = now.imageUrl;
    out.imageWidth = now.imageWidth;
    out.imageHeight = now.imageHeight;
  }
  if (now.imageOriginalUrl !== saved.imageOriginalUrl) {
    out.imageOriginalUrl = now.imageOriginalUrl;
  }
  if (now.imageAlt !== saved.imageAlt) out.imageAlt = now.imageAlt || null;
  if (now.linkUrl !== saved.linkUrl) out.linkUrl = now.linkUrl.trim() || null;
  if (now.googleType !== saved.googleType) out.googleType = now.googleType;
  if (now.googleCta !== saved.googleCta) out.googleCta = now.googleCta || null;
  if (now.googleUrl !== saved.googleUrl) out.googleUrl = now.googleUrl.trim() || null;
  if (now.googleTitle !== saved.googleTitle) out.googleTitle = now.googleTitle || null;
  if (now.offerStart !== saved.offerStart) out.offerStart = now.offerStart || null;
  if (now.offerEnd !== saved.offerEnd) out.offerEnd = now.offerEnd || null;
  if (now.eventStartTime !== saved.eventStartTime) {
    out.eventStartTime = now.eventStartTime || null;
  }
  if (now.eventEndTime !== saved.eventEndTime) out.eventEndTime = now.eventEndTime || null;
  if (now.couponCode !== saved.couponCode) out.couponCode = now.couponCode || null;
  if (JSON.stringify(now.targets) !== JSON.stringify(saved.targets)) {
    out.targets = now.targets
      .filter((t) => (SOCIAL_PLATFORMS as readonly string[]).includes(t.platform))
      .map((t) => ({ ...t, textOverride: t.textOverride || null, imageAlt: t.imageAlt || null }));
  }
  if (JSON.stringify(now.altCaptions) !== JSON.stringify(saved.altCaptions)) {
    out.altCaptions = now.altCaptions;
  }
  if (now.recycle !== saved.recycle) out.recycle = now.recycle;
  if (now.expiresAt !== saved.expiresAt) out.expiresAt = now.expiresAt || null;
  if (now.maxPosts !== saved.maxPosts) out.maxPosts = now.maxPosts;
  return out;
}

/**
 * The fields as the form shows them while a content item's later caption is picked: that caption
 * as the words, and no app-only text, which goes out with caption 1 alone.
 * @param c - Content.
 * @param at - The picked caption.
 * @returns The form's view.
 */
function viewOf(c: Content, at: number): Content {
  if (at === 0) return c;
  return {
    ...c,
    body: c.altCaptions[at - 1] ?? "",
    targets: c.targets.map((t) => ({ ...t, textOverride: "" })),
  };
}

/**
 * Writes a changed view back: its words to the picked caption, every other field as it is.
 * @param v - The view after the change.
 * @param c - Content before it.
 * @param at - The picked caption.
 * @returns Content.
 */
function unview(v: Content, c: Content, at: number): Content {
  if (at === 0) return v;
  return {
    ...v,
    body: c.body,
    altCaptions: c.altCaptions.map((text, i) => (i === at - 1 ? v.body : text)),
    targets: v.targets.map((t) => ({
      ...t,
      textOverride: c.targets.find((o) => o.platform === t.platform)?.textOverride ?? "",
    })),
  };
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
 * @param props.design - Post maker design the picture came from, or null.
 * @param props.captionAi - Write with AI's starting choices; null hides it.
 * @param props.email - The email linked to the post, or null.
 * @param props.watermark - How Add my logo marks a photo, and whether new uploads get it.
 * @param props.tags - Every tag there is.
 * @param props.onTagCreated - Called with a tag the picker added.
 * @param props.onDraftEmail - Opens Email this too, by hand or after publishing.
 * @param props.onSaved - Called with the name, text or tags after each successful save.
 * @param props.saveRef - Filled with a save-pending-edits function, used before another post opens.
 * @param props.contentItem - A content item's stats, postings and problems; null for other posts.
 * @param props.source - The content item a posting came from, or null.
 * @returns Composer element.
 */
export function PostComposer({
  initial,
  promo,
  promoTitle,
  canUpload,
  missingEnv,
  details,
  design,
  captionAi,
  email,
  watermark,
  tags,
  onTagCreated,
  onDraftEmail,
  onSaved,
  saveRef,
  contentItem = null,
  source = null,
}: {
  initial: SocialPostRow;
  promo: PromoWording | null;
  promoTitle: string | null;
  canUpload: boolean;
  missingEnv: Record<SocialPlatformKey, string[]>;
  details: InsertDetails;
  design: PostDesign | null;
  captionAi: CaptionAiSetup | null;
  email: PostEmail | null;
  watermark: WatermarkSettings;
  tags: SocialTagRow[];
  onTagCreated?: (tag: SocialTagRow) => void;
  onDraftEmail?: (afterPublish: boolean) => void;
  onSaved?: (saved: Partial<Pick<SocialPostRow, "name" | "body" | "tagIds">>) => void;
  saveRef?: React.RefObject<(() => Promise<boolean>) | null>;
  contentItem?: ContentItemInfo | null;
  source?: PostingSource | null;
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
  // Which picture the file picker is choosing: the post's, another for a set, or one app's own.
  const uploadFor = useRef<"main" | "more" | SocialPlatformKey>("main");
  // Share of the video uploaded so far, null when no upload is running.
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const videoAbort = useRef<AbortController | null>(null);
  // The video picked this visit, still open, so a cover frame can be drawn without reading the
  // stored copy back across origins.
  const localVideo = useRef<{ url: string; element: HTMLVideoElement } | null>(null);
  const [makingStory, setMakingStory] = useState(false);
  const [accounts, setAccounts] = useState<Partial<Record<SocialPlatformKey, string>>>({});
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const overrideRefs = useRef<Partial<Record<SocialPlatformKey, HTMLTextAreaElement | null>>>({});
  const scheduleFieldId = useId();
  const [writingWithAi, setWritingWithAi] = useState(false);
  // The words before and after Write with AI's last change; Undo shows while they're untouched.
  const [aiUndo, setAiUndo] = useState<{ before: Words; after: Words } | null>(null);
  // "Different text for one app": open when an app has its own text, and when Write with AI adds some.
  const [overridesShown, setOverridesShown] = useState(() =>
    initial.targets.some((t) => t.textOverride),
  );
  // Tags save straight away, on any post, outside autosave.
  const [tagIds, setTagIds] = useState(initial.tagIds);
  const savedTags = useRef(initial.tagIds);
  const tagSaving = useRef<Promise<void>>(Promise.resolve());
  // A slot whose photo couldn't be read back for the logo, so its next upload gets it.
  const logoNext = useRef<"main" | SocialPlatformKey | null>(null);
  const isContent = initial.isContent;
  // The caption a content item's form edits; clamped, as Undo can take the last one away.
  const [activeCaption, setActiveCaption] = useState(0);
  const at = Math.min(activeCaption, content.altCaptions.length);
  const captions = [content.body, ...content.altCaptions];
  const view = viewOf(content, at);
  const nextCaption = clampCaption(captions, initial.nextCaption);
  const [postingFrom, setPostingFrom] = useState<"now" | "later" | null>(null);
  const [confirmingRelink, setConfirmingRelink] = useState(false);
  // Lined-up postings that won't go out: from the page, then from each save.
  const [problems, setProblems] = useState(contentItem?.problems ?? []);
  const [shownProblems, setShownProblems] = useState(contentItem?.problems);
  if (contentItem?.problems !== shownProblems) {
    setShownProblems(contentItem?.problems);
    setProblems(contentItem?.problems ?? []);
  }
  const [openedAt] = useState(() => new Date());

  // A video can take the apps minutes to process; check back until the post settles.
  useEffect(() => {
    if (initial.status !== "posting") return;
    const timer = setInterval(() => router.refresh(), POSTING_POLL_MS);
    return () => clearInterval(timer);
  }, [initial.status, router]);

  // Let go of the open local video when the composer closes.
  useEffect(
    () => () => {
      if (localVideo.current) URL.revokeObjectURL(localVideo.current.url);
    },
    [],
  );

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
    const run = callApi<{ postingProblems?: PostingProblem[] }>(
      `/api/admin/social/${initial.id}`,
      "PATCH",
      changed,
    ).then((res) => {
      if (!res.ok) {
        setSaveState("error");
        toast(res.error, { tone: "error" });
        return false;
      }
      saved.current = target;
      if (res.postingProblems) setProblems(res.postingProblems);
      onSaved?.({ name: target.name, body: target.body });
      return true;
    });
    saving.current = run;
    const ok = await run;
    saving.current = null;
    if (ok) setSaveState((s) => (s === "saving" ? "saved" : s));
    return ok;
  }, [content, editable, initial.id, onSaved, toast]);

  /**
   * Saves, then opens the post maker: the linked design, or a new one for this post.
   */
  async function openDesign(): Promise<void> {
    if (!(await save())) return;
    router.push(
      design ? `/admin/social/design/${design.id}` : `/admin/social/design?post=${initial.id}`,
    );
  }

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
    setView((v) => ({
      ...v,
      targets: v.targets.map((t) => (t.platform === platform ? { ...t, ...patch } : t)),
    }));
  }

  /**
   * Updates the fields as the form sees them, writing the words back to the picked caption.
   * @param update - The new view, or a function of the current one.
   */
  function setView(update: React.SetStateAction<Content>): void {
    setContent((c) => {
      const v = viewOf(c, at);
      return unview(typeof update === "function" ? update(v) : update, c, at);
    });
  }

  /** Adds a blank caption at the end and picks it. */
  function addCaption(): void {
    if (captions.length >= MAX_CAPTIONS) return;
    setContent((c) => ({ ...c, altCaptions: [...c.altCaptions, ""] }));
    setActiveCaption(captions.length);
    requestAnimationFrame(() => bodyRef.current?.focus());
  }

  /**
   * Swaps the picked caption with its neighbour, keeping it picked.
   * @param by - One place earlier (-1) or later (1).
   */
  function moveCaption(by: -1 | 1): void {
    const to = at + by;
    if (to < 0 || to >= captions.length) return;
    setContent((c) => {
      const list = [c.body, ...c.altCaptions];
      [list[at], list[to]] = [list[to]!, list[at]!];
      return { ...c, body: list[0]!, altCaptions: list.slice(1) };
    });
    setActiveCaption(to);
  }

  /** Removes the picked caption; removing caption 1 makes caption 2 the first. */
  function removeCaption(): void {
    setContent((c) => {
      const list = [c.body, ...c.altCaptions].filter((_, i) => i !== at);
      return { ...c, body: list[0] ?? "", altCaptions: list.slice(1) };
    });
    setActiveCaption(Math.max(0, at - 1));
  }

  /**
   * Inserts text at the cursor in the post or one platform's text, replacing any selection.
   * @param box - "body" or the platform whose own text gets it.
   * @param text - Text to insert.
   * @param line - Start on a fresh line.
   */
  function insertAt(box: "body" | SocialPlatformKey, text: string, line = false): void {
    const el = box === "body" ? bodyRef.current : (overrideRefs.current[box] ?? null);
    const current =
      box === "body"
        ? view.body
        : (view.targets.find((t) => t.platform === box)?.textOverride ?? "");
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const lead = line && start > 0 && current[start - 1] !== "\n" ? "\n" : "";
    const next = current.slice(0, start) + lead + text + current.slice(end);
    if (box === "body") setView((c) => ({ ...c, body: next }));
    else setTarget(box, { textOverride: next });
    // Restore the cursor once React has re-rendered the new value.
    const cursor = start + lead.length + text.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  /**
   * Opens the file picker for the post's picture, another picture for a set, or one app's own.
   * @param forWhat - "main", "more" or the platform the picture is for.
   */
  function pickPicture(forWhat: "main" | "more" | SocialPlatformKey): void {
    uploadFor.current = forWhat;
    fileRef.current?.click();
  }

  /**
   * Uploads a picture file.
   * @param file - JPEG to upload.
   * @returns Its address, or null after showing the error.
   */
  async function upload(file: File): Promise<string | null> {
    const form = new FormData();
    form.append("file", file);
    const res = await callApi<{ url: string }>("/api/admin/social/upload", "POST", form);
    if (res.ok) return res.url;
    toast(res.error, { tone: "error" });
    return null;
  }

  /**
   * Puts a picture in the post's slot or one app's. When only the logo changed the shape is the
   * same, so a crop OK given to the old picture moves to the new one.
   * @param forWhat - "main" or the app.
   * @param next - The new picture.
   * @param next.url - Its address.
   * @param next.originalUrl - The picture before the logo, or null when it has none.
   * @param next.width - Pixel width.
   * @param next.height - Pixel height.
   * @param sameShape - Whether it's the same photo with the logo added or taken off.
   */
  function placePicture(
    forWhat: "main" | SocialPlatformKey,
    next: { url: string; originalUrl: string | null; width: number | null; height: number | null },
    sameShape: boolean,
  ): void {
    setContent((c) => {
      const old =
        forWhat === "main"
          ? c.imageUrl
          : (c.targets.find((t) => t.platform === forWhat)?.imageUrl ?? null);
      const targets = c.targets.map((t) => {
        const own = t.platform === forWhat;
        // The main picture's crop OKs live on the apps that show it: those with no own picture.
        const showsIt = own || (forWhat === "main" && !t.imageUrl);
        const moved = sameShape && old !== null && showsIt && t.cropApprovedFor === old;
        const crop = moved ? { cropApprovedFor: next.url } : {};
        if (!own) return { ...t, ...crop };
        return {
          ...t,
          ...crop,
          imageUrl: next.url,
          imageOriginalUrl: next.originalUrl,
          imageWidth: next.width,
          imageHeight: next.height,
        };
      });
      return forWhat === "main"
        ? {
            ...c,
            targets,
            imageUrl: next.url,
            imageOriginalUrl: next.originalUrl,
            imageWidth: next.width,
            imageHeight: next.height,
          }
        : { ...c, targets };
    });
  }

  /**
   * Shrinks and uploads a picture for the post or the platform picked via {@link pickPicture}.
   * With Add my logo on, both copies go up: the marked one shows, and the plain one is kept so
   * the logo can come off again.
   * @param file - Picked image.
   */
  async function addImage(file: File): Promise<void> {
    const forWhat = uploadFor.current;
    const withLogo = watermark.on || logoNext.current === forWhat;
    setBusy(`image:${forWhat}`);
    try {
      const small = await shrinkImage(file);
      if (forWhat === "more") {
        // Later pictures in a set take the logo as they upload, with no plain copy kept.
        const marked = withLogo ? await watermarkImage(small.file, watermark) : null;
        const url = await upload((marked ?? small).file);
        if (!url) return;
        const picture: MediaItem = {
          kind: "image",
          url,
          alt: "",
          width: small.width,
          height: small.height,
          durationMs: null,
          sizeBytes: null,
          coverUrl: null,
        };
        setContent((c) => ({
          ...c,
          moreImages: [...c.moreImages, picture].slice(0, MAX_PICTURES - 1),
        }));
        return;
      }
      const marked = withLogo ? await watermarkImage(small.file, watermark) : null;
      const plain = await upload(small.file);
      if (!plain) return;
      const shown = marked ? await upload(marked.file) : plain;
      if (!shown) return;
      if (logoNext.current === forWhat) logoNext.current = null;
      placePicture(
        forWhat,
        {
          url: shown,
          originalUrl: marked ? plain : null,
          width: small.width,
          height: small.height,
        },
        false,
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't add the picture.", {
        tone: "error",
      });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /**
   * Adds the logo to a picture already in the post, or takes it off by going back to the plain
   * copy. When the browser can't read the photo back, its next upload gets the logo instead.
   * @param forWhat - "main" or the app whose own picture it is.
   * @param on - Whether the logo should be on.
   */
  async function setLogo(forWhat: "main" | SocialPlatformKey, on: boolean): Promise<void> {
    const slot = forWhat === "main" ? content : content.targets.find((t) => t.platform === forWhat);
    if (!slot?.imageUrl) return;
    const size = { width: slot.imageWidth, height: slot.imageHeight };
    if (!on) {
      if (slot.imageOriginalUrl) {
        placePicture(forWhat, { url: slot.imageOriginalUrl, originalUrl: null, ...size }, true);
      }
      return;
    }
    if (slot.imageOriginalUrl) return;
    const plain = slot.imageUrl;
    setBusy(`image:${forWhat}`);
    try {
      const marked = await watermarkImage(plain, watermark);
      const shown = await upload(marked.file);
      if (shown) {
        placePicture(
          forWhat,
          { url: shown, originalUrl: plain, width: marked.width, height: marked.height },
          true,
        );
      }
    } catch {
      logoNext.current = forWhat;
      toast(
        "Couldn't read this picture to add the logo. Pick it again with Replace and the logo goes on as it uploads.",
        { tone: "error" },
      );
    } finally {
      setBusy(null);
    }
  }

  /**
   * Switches the kind of post, switching off the apps that don't take the new kind.
   * @param next - The kind picked.
   */
  function changeFormat(next: SocialFormatKey): void {
    const off = content.targets
      .filter((t) => t.enabled && !formatTakes(next, t.platform as SocialPlatformKey))
      .map((t) => PLATFORM_LABEL[t.platform as SocialPlatformKey] ?? t.platform);
    setContent((c) => ({
      ...c,
      format: next,
      targets: c.targets.map((t) =>
        formatTakes(next, t.platform as SocialPlatformKey) ? t : { ...t, enabled: false },
      ),
    }));
    if (off.length > 0) {
      toast(
        `${off.join(" and ")} switched off: ${off.length > 1 ? "they don't" : "it doesn't"} take ${FORMAT_PLURAL[next]}.`,
      );
    }
  }

  /**
   * Opens a picked video, draws a first cover frame, then uploads both. The video goes straight
   * to the Blob store, so a big one never passes through the site.
   * @param file - MP4 or MOV the operator picked.
   */
  async function addVideo(file: File): Promise<void> {
    if (!videoTypeOf(file)) {
      toast("Pick an MP4 or MOV video.", { tone: "error" });
      return;
    }
    if (file.size > VIDEO_MAX_BYTES) {
      toast("That video is over 250 MB. Export it smaller and try again.", { tone: "error" });
      return;
    }
    const abort = new AbortController();
    videoAbort.current = abort;
    setVideoProgress(0);
    const local = URL.createObjectURL(file);
    try {
      const element = await loadVideo(local, false);
      const meta = videoMetaOf(element);
      // Half a second in skips the black frame many clips open on.
      const frame = await captureFrame(element, Math.min(500, meta.durationMs / 2));
      const url = await uploadVideo(file, (p) => setVideoProgress(Math.round(p)), abort.signal);
      const coverUrl = await uploadCoverFrame(frame);
      if (localVideo.current) URL.revokeObjectURL(localVideo.current.url);
      localVideo.current = { url: local, element };
      setContent((c) => ({
        ...c,
        video: {
          kind: "video",
          url,
          alt: null,
          width: meta.width,
          height: meta.height,
          durationMs: meta.durationMs,
          sizeBytes: file.size,
          coverUrl,
        },
      }));
    } catch (error) {
      URL.revokeObjectURL(local);
      if (!abort.signal.aborted) {
        toast(error instanceof Error ? error.message : "Couldn't add the video.", {
          tone: "error",
        });
      }
    } finally {
      videoAbort.current = null;
      setVideoProgress(null);
    }
  }

  /**
   * Draws the frame at a time as the reel's cover, from the video picked this visit when it's
   * still open, else from the stored copy.
   * @param atMs - Where in the video, in milliseconds.
   */
  async function setVideoCover(atMs: number): Promise<void> {
    const video = content.video;
    if (!video) return;
    setBusy("cover");
    try {
      const element =
        localVideo.current?.element ??
        (await loadVideo(`${video.url}${video.url.includes("?") ? "&" : "?"}cover=1`, true));
      const coverUrl = await uploadCoverFrame(await captureFrame(element, atMs));
      setContent((c) => (c.video ? { ...c, video: { ...c.video, coverUrl } } : c));
    } catch {
      toast(
        "Couldn't read the video back to draw a frame. Pick it again with Replace, then choose the frame.",
        { tone: "error" },
      );
    } finally {
      setBusy(null);
    }
  }

  /** Takes the video off the post and lets go of the open local copy. */
  function removeVideo(): void {
    if (localVideo.current) URL.revokeObjectURL(localVideo.current.url);
    localVideo.current = null;
    setContent((c) => ({ ...c, video: null }));
  }

  /** Saves, then makes a story draft from this post's design or picture. */
  async function makeStory(): Promise<void> {
    if (!(await save())) return;
    setMakingStory(true);
  }

  /**
   * Saves the post's tags straight away. Saves run one after another, so the last pick wins; a
   * failed one puts back what was last saved.
   * @param ids - The post's new tag ids.
   */
  function changeTags(ids: string[]): void {
    setTagIds(ids);
    tagSaving.current = tagSaving.current.then(async () => {
      const res = await callApi(`/api/admin/social/${initial.id}`, "PATCH", { tagIds: ids });
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        setTagIds(savedTags.current);
        return;
      }
      savedTags.current = ids;
      onSaved?.({ tagIds: ids });
    });
  }

  /**
   * Adds a tag from the picker, or gets the one that already has the name.
   * @param name - Name as typed.
   * @param colour - Swatch picked for it.
   * @returns The tag, or null after showing the error.
   */
  async function createTag(name: string, colour: TagColour): Promise<SocialTagRow | null> {
    const res = await callApi<{ tag: SocialTagRow }>("/api/admin/social/tags", "POST", {
      name,
      colour,
    });
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return null;
    }
    onTagCreated?.(res.tag);
    return res.tag;
  }

  /** Saves, then opens Email this too. */
  async function draftEmail(): Promise<void> {
    setBusy("email");
    const ok = await save();
    setBusy(null);
    if (ok) onDraftEmail?.(false);
  }

  /** Saves, then opens the linked email in Mailing with Draft with AI ready on the post's words. */
  async function redoEmail(): Promise<void> {
    if (!email) return;
    const words = postBrief({
      name: content.name,
      body: content.body,
      linkUrl: content.linkUrl.trim() || null,
      targets: content.targets,
    });
    if (!words) {
      toast("Write the post first: the email is made from its words.", { tone: "error" });
      return;
    }
    setBusy("email-redo");
    // Saved first: Mailing reads the post's words from the saved post.
    if (!(await save())) {
      setBusy(null);
      return;
    }
    router.push(`/admin/mailing/${email.id}?draft=post`);
  }

  /** Unlinks the post's email; the email stays in Mailing. */
  async function unlinkEmail(): Promise<void> {
    setBusy("email-unlink");
    const res = await callApi(`/api/admin/social/${initial.id}/email`, "DELETE");
    setBusy(null);
    if (!res.ok) toast(res.error, { tone: "error" });
    router.refresh();
  }

  /** Saves, then copies the content item over this posting again, so it follows the item. */
  async function relink(): Promise<void> {
    setConfirmingRelink(false);
    if (!(await save())) return;
    setBusy("relink");
    const res = await callApi(`/api/admin/social/${initial.id}/relink`, "POST");
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast("It follows its content item again.", { tone: "success" });
    router.refresh();
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
    const label = (t: SocialTargetRow): string => PLATFORM_LABEL[t.platform] ?? t.platform;
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
    if (mode === "now" && (posted.length > 0 || waiting.length > 0)) onDraftEmail?.(true);
    router.refresh();
  }

  /**
   * Deletes the post from every platform; a refusing platform keeps its reason, and Take down
   * again retries just that one.
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
    const label = (t: SocialTargetRow): string => PLATFORM_LABEL[t.platform] ?? t.platform;
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
    onDraftEmail?.(true);
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

  // A content item's checks and preview use the picked caption, as its postings would.
  const draft = {
    format: content.format,
    body: view.body,
    imageUrl: content.imageUrl,
    imageWidth: content.imageWidth,
    imageHeight: content.imageHeight,
    moreImages: content.format === "feed" ? content.moreImages : [],
    video: content.format === "reel" || content.format === "story" ? content.video : null,
    linkUrl: content.linkUrl.trim() || null,
    targets: view.targets,
    googleType: content.googleType,
    googleCta: content.googleCta || null,
    googleUrl: content.googleUrl.trim() || null,
    googleTitle: content.googleTitle,
    offerStart: content.offerStart,
    offerEnd: content.offerEnd,
    eventStartTime: content.eventStartTime || null,
    eventEndTime: content.eventEndTime || null,
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
    (p) => !view.targets.find((t) => t.platform === p)?.textOverride.trim(),
  );
  const strictest = usesBody.length > 0 ? Math.min(...usesBody.map((p) => MAX_CHARS[p])) : null;
  // Scheduling checks promo wording as if a promo will be running by then, the same
  // way the schedule route does; Post now needs one running today.
  const scheduleBlocked = blockingIssues(validatePost(draft, true));
  const insertGroups = insertableGroups(details, promo);
  const failedCount = initial.targets.filter((t) => t.enabled && t.status === "failed").length;
  const upOn = liveOn(initial);
  const lasting = !canTakeDown(initial.format);
  const spent = contentItem
    ? spentReason(
        {
          expiresAt: content.expiresAt ? new Date(`${content.expiresAt}T00:00:00.000Z`) : null,
          maxPosts: content.maxPosts,
        },
        { count: contentItem.stats.count, lastPostedAt: null, nextAt: null },
        openedAt,
      )
    : null;

  /**
   * What one platform's preview card shows: its own text when set, promo filled in.
   * @param p - Platform.
   * @returns Preview content.
   */
  function previewOf(p: SocialPlatformKey): PreviewPost {
    const picture = pictureFor(draft, p);
    const own = view.targets.find((t) => t.platform === p);
    return {
      format: content.format,
      text: fillPromo(textFor(draft, p), promo).trim(),
      imageUrl: picture?.url ?? null,
      imageAlt: own?.imageUrl ? own.imageAlt : content.imageAlt,
      imageWidth: picture?.width ?? null,
      imageHeight: picture?.height ?? null,
      moreImages: draft.moreImages.map((m) => ({ url: m.url, alt: m.alt ?? "" })),
      video: draft.video ? { url: draft.video.url, coverUrl: draft.video.coverUrl } : null,
      linkUrl: draft.linkUrl,
      google: {
        type: content.googleType,
        cta: content.googleCta || null,
        url: draft.googleUrl,
        title: content.googleTitle.trim(),
        start: content.offerStart || null,
        end: content.offerEnd || null,
        startTime: draft.eventStartTime,
        endTime: draft.eventEndTime,
        couponCode: content.couponCode.trim() || null,
      },
    };
  }

  const canUndoAi =
    aiUndo !== null && JSON.stringify(wordsOf(content)) === JSON.stringify(aiUndo.after);

  /**
   * Puts a Write with AI option in the post, keeping the words before it for Undo.
   * @param text - The option.
   * @param where - Over the picked caption, under it, as a new caption, or as one app's own text.
   */
  function placeCaption(text: string, where: CaptionPlacement): void {
    let next: Content;
    if (where === "replace" || where === "add") {
      const words =
        where === "replace" || !view.body.trim() ? text : `${view.body.trimEnd()}\n\n${text}`;
      next = unview({ ...view, body: words }, content, at);
    } else if (where === "caption") {
      next = { ...content, altCaptions: [...content.altCaptions, text] };
      setActiveCaption(captions.length);
    } else {
      next = {
        ...content,
        targets: content.targets.map((t) =>
          t.platform === where ? { ...t, textOverride: text } : t,
        ),
      };
      setOverridesShown(true);
    }
    setAiUndo({ before: wordsOf(content), after: wordsOf(next) });
    setContent(next);
    toast(
      where === "replace" || where === "add"
        ? "Added to the post. Undo under it takes it back."
        : where === "caption"
          ? `Added as caption ${captions.length + 1}. Undo under it takes it back.`
          : `Added as ${PLATFORM_LABEL[where]}'s own text. Undo under the post takes it back.`,
      { tone: "success" },
    );
  }

  /** Puts back the words from before Write with AI's last change. */
  function undoCaption(): void {
    if (!aiUndo) return;
    const { before } = aiUndo;
    setContent((c) => ({
      ...c,
      body: before.body,
      altCaptions: before.altCaptions,
      targets: c.targets.map((t) => ({ ...t, textOverride: before.overrides[t.platform] ?? "" })),
    }));
    setAiUndo(null);
  }

  /**
   * Problems a Write with AI option would add that the post doesn't have now.
   * @param text - The option.
   * @param only - The app it would be the own text of, or null for the post's words.
   * @returns Messages, each naming its app.
   */
  function issuesFor(text: string, only: SocialPlatformKey | null): string[] {
    const next = validatePost(
      only
        ? {
            ...draft,
            targets: draft.targets.map((t) =>
              t.platform === only ? { ...t, textOverride: text } : t,
            ),
          }
        : { ...draft, body: text },
      promo !== null,
    );
    const had = new Set(
      SOCIAL_PLATFORMS.flatMap((p) => (issues[p] ?? []).map((i) => `${p}:${i.message}`)),
    );
    return SOCIAL_PLATFORMS.flatMap((p) =>
      (next[p] ?? [])
        .filter((i) => !had.has(`${p}:${i.message}`))
        .map((i) => `${PLATFORM_LABEL[p]}: ${i.message}`),
    );
  }

  const shownPreview = enabled.includes(previewOn) ? previewOn : (enabled[0] ?? null);
  const readyMessage = spent
    ? spent
    : setupMissing.length > 0
      ? setupMissing.join(" ")
      : blocked.length > 0 && scheduleBlocked.length === 0
        ? "Post now needs a promo running for the promo wording. You can still schedule it."
        : blocked.length === 1
          ? blocked[0]
          : blocked.length > 1
            ? `${blocked.length} things to fix first. They're listed under the preview.`
            : "Ready to post.";

  /**
   * Switches form and preview below xl, remembering each pane's scroll position.
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
      showProblem={
        !initial.isPreset && (blocked.length > 0 || setupMissing.length > 0 || spent !== null)
      }
      scheduleDisabled={scheduleBlocked.length > 0 || setupMissing.length > 0 || spent !== null}
      postDisabled={blocked.length > 0 || setupMissing.length > 0 || spent !== null}
      posting={busy === "now"}
      scheduleLabel={isContent ? "Schedule a posting" : undefined}
      onSchedule={() => {
        if (isContent) {
          setPostingFrom("later");
          return;
        }
        const next = new Date(Date.now() + 60 * 60_000);
        next.setMinutes(0, 0, 0);
        setScheduling(toNzInputValue(next));
      }}
      onPostNow={() => (isContent ? setPostingFrom("now") : setConfirming(true))}
    />
  );

  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      {source && (
        <PostingSourceNote
          source={source}
          status={initial.status}
          detached={initial.detached}
          relinking={busy === "relink"}
          onRelink={() => setConfirmingRelink(true)}
        />
      )}

      <PostStatusBanner
        post={initial}
        busy={busy}
        onCancelSchedule={() => void cancelSchedule()}
        onRetry={() => void publish("retry")}
        canRetry={failedCount > 0 && (initial.status === "partial" || initial.status === "failed")}
        onTakeDown={() => setConfirmingTakeDown(true)}
        canTakeDown={upOn.length > 0 && !lasting}
        onRefresh={() => router.refresh()}
      />

      {problems.length > 0 && (
        <div
          role="status"
          className="rounded-lg border border-mustard-400 bg-mustard-50 px-4 py-3 text-sm text-admin-text"
        >
          <p className="font-bold">
            {problems.length === 1
              ? "A lined-up posting won't go out as it is:"
              : `${problems.length} lined-up postings won't go out as they are:`}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {problems.map((p) => (
              <li key={p.id}>
                {formatDateTimeShort(p.scheduledAt)}: {p.error}
              </li>
            ))}
          </ul>
        </div>
      )}

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
            content={view}
            setContent={setView}
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
            pictureBusy={
              busy?.startsWith("image:") ? busy.slice(6) : videoProgress !== null ? "video" : null
            }
            fileRef={fileRef}
            onPickPicture={pickPicture}
            onFile={(file) => void addImage(file)}
            enabled={enabled}
            overridesOpen={overridesShown}
            onOverridesOpen={setOverridesShown}
            design={design}
            onDesign={() => void openDesign()}
            onWriteWithAi={captionAi ? () => setWritingWithAi(true) : null}
            onUndoAi={canUndoAi ? undoCaption : null}
            onLogo={(forWhat, on) => void setLogo(forWhat, on)}
            tags={tags}
            tagIds={tagIds}
            onTagsChange={changeTags}
            onCreateTag={createTag}
            captions={
              isContent ? (
                <CaptionsField
                  captions={captions}
                  active={at}
                  next={nextCaption}
                  editable={editable}
                  onSelect={setActiveCaption}
                  onAdd={addCaption}
                  onMove={moveCaption}
                  onRemove={removeCaption}
                />
              ) : undefined
            }
            bodyLabel={isContent ? `Caption ${at + 1}` : "Post"}
            overridesHint={
              isContent
                ? "Leave a box empty to use caption 1. These go out only with caption 1."
                : undefined
            }
            overridesNote={
              isContent && at > 0
                ? "Different text for one app goes out with caption 1 only. Pick caption 1 to change it."
                : null
            }
            format={content.format}
            kindSwitch={
              editable ? (
                <PostKindSwitch format={content.format} editable onChange={changeFormat} />
              ) : undefined
            }
            moreMedia={
              content.format === "feed" ? (
                <MorePictures
                  pictures={content.moreImages}
                  editable={editable}
                  canUpload={canUpload}
                  busy={busy === "image:more"}
                  onAdd={() => pickPicture("more")}
                  onChange={(moreImages) => setContent((c) => ({ ...c, moreImages }))}
                />
              ) : content.format === "reel" || content.format === "story" ? (
                <PostVideo
                  video={content.video}
                  format={content.format}
                  editable={editable}
                  canUpload={canUpload}
                  progress={videoProgress}
                  coverBusy={busy === "cover"}
                  onFile={(file) => void addVideo(file)}
                  onCancel={() => videoAbort.current?.abort()}
                  onRemove={removeVideo}
                  onCover={(atMs) => void setVideoCover(atMs)}
                />
              ) : undefined
            }
            onMakeStory={
              !initial.isPreset && content.format === "feed" && (design || content.imageUrl)
                ? () => void makeStory()
                : null
            }
            makingStory={makingStory}
          />
          {contentItem && (
            <div className="mt-6 flex flex-col gap-6">
              <ContentRecycling
                value={{
                  recycle: content.recycle,
                  maxPosts: content.maxPosts,
                  expiresAt: content.expiresAt,
                }}
                onChange={(patch) => setContent((c) => ({ ...c, ...patch }))}
                stats={contentItem.stats}
                spent={spent}
              />
              <ContentSchedules
                itemId={initial.id}
                schedules={contentItem.schedules}
                recycle={content.recycle}
              />
              <ContentPostings postings={contentItem.postings} />
            </div>
          )}
          {!initial.isPreset && !initial.sourceId && usesText(content.format) && (
            <div className="mt-6">
              <PostEmailPanel
                email={email}
                aiReady={captionAi !== null}
                busy={busy}
                onDraft={() => void draftEmail()}
                onRedo={() => void redoEmail()}
                onUnlink={() => void unlinkEmail()}
              />
            </div>
          )}
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

      {writingWithAi && captionAi && (
        <CaptionAiDialog
          setup={captionAi}
          textOf={(only) => (only ? textFor(draft, only) : view.body)}
          enabled={enabled}
          promoId={promoId}
          issuesFor={issuesFor}
          onUse={placeCaption}
          onClose={() => setWritingWithAi(false)}
          canAddCaption={isContent && captions.length < MAX_CAPTIONS}
          perApp={at === 0}
        />
      )}

      {makingStory && (
        <StoryMaker
          postId={initial.id}
          designId={design?.id ?? null}
          imageUrl={content.imageUrl}
          imageAlt={content.imageAlt}
          onDone={(id) => {
            setMakingStory(false);
            toast("Story draft made. Check it, then post or schedule it.", { tone: "success" });
            router.push(`/admin/social/posts?post=${id}`);
          }}
          onFail={(message) => {
            setMakingStory(false);
            toast(message, { tone: "error" });
          }}
        />
      )}

      {postingFrom && (
        <PostingDialog
          itemId={initial.id}
          captions={captions}
          next={nextCaption}
          start={postingFrom}
          beforeSubmit={save}
          onDone={() => {
            setPostingFrom(null);
            onDraftEmail?.(true);
            router.refresh();
          }}
          onClose={() => setPostingFrom(null)}
        />
      )}

      <ConfirmDialog
        open={confirmingRelink}
        title="Follow the content item again?"
        body="Your edits to this posting are replaced with the item's words, picture and settings, and later changes to the item reach it again."
        confirmLabel="Re-link"
        busy={busy === "relink"}
        onConfirm={() => void relink()}
        onCancel={() => setConfirmingRelink(false)}
      />

      <ConfirmDialog
        open={confirming}
        title="Post this now?"
        body={
          content.format === "story"
            ? `It goes straight to ${enabled.map((p) => PLATFORM_LABEL[p]).join(" and ")} and shows for 24 hours. A story can't be taken down early.`
            : content.format === "cover"
              ? "It replaces your Facebook Page's cover photo straight away. It stays until you change it."
              : `It goes straight to ${enabled.map((p) => PLATFORM_LABEL[p]).join(" and ")}. You can take it down again from here.`
        }
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
