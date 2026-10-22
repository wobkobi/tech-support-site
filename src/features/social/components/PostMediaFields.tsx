"use client";
// src/features/social/components/PostMediaFields.tsx
// The composer's media parts: the Kind of post switch, pictures 2 to 10 of an ordinary post, and
// a reel's or story's video with its cover frame. The composer owns the values and the uploads.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import {
  FORMAT_LABEL,
  FORMAT_PLATFORMS,
  MAX_PICTURES,
  SOCIAL_FORMATS,
  STORY_VIDEO_MAX_MS,
  VIDEO_MAX_MS,
  type MediaItem,
  type SocialFormatKey,
} from "@/features/social/lib/media";
import { PLATFORM_LABEL } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId, useRef, useState } from "react";
import { FaArrowLeft, FaArrowRight } from "react-icons/fa6";

/** What each kind is, under the switch. */
const FORMAT_HINT: Record<SocialFormatKey, string> = {
  feed: "Words with up to 10 pictures.",
  reel: "A video of 3 to 90 seconds with a caption.",
  story:
    "A picture or a video of up to a minute, shown for 24 hours. It can't be taken down early.",
  cover: "Changes the banner across the top of your Facebook Page. It stays until you change it.",
};

/**
 * A length in milliseconds as m:ss.
 * @param ms - Length.
 * @returns For example "1:05".
 */
export function clockOf(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The Kind of post switch.
 * @param props - Component props.
 * @param props.format - The picked kind.
 * @param props.editable - Whether the post can still be changed.
 * @param props.onChange - Called with a newly picked kind.
 * @returns Switch element.
 */
export function PostKindSwitch({
  format,
  editable,
  onChange,
}: {
  format: SocialFormatKey;
  editable: boolean;
  onChange: (format: SocialFormatKey) => void;
}): React.ReactElement {
  const name = useId();
  const apps = FORMAT_PLATFORMS[format];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={ADMIN_LABEL_CLS}>Kind of post</legend>
      <div className="flex flex-wrap gap-2">
        {SOCIAL_FORMATS.map((f) => (
          <label
            key={f}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
              editable && "cursor-pointer",
              f === format
                ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                : "border-admin-border-strong text-admin-muted hover:border-russian-violet/50",
            )}
          >
            <input
              type="radio"
              name={name}
              checked={f === format}
              disabled={!editable}
              onChange={() => onChange(f)}
              className="size-4 accent-russian-violet"
            />
            {FORMAT_LABEL[f]}
          </label>
        ))}
      </div>
      <p className="text-sm text-admin-muted">
        {FORMAT_HINT[format]}
        {apps.length < 3 && ` ${apps.map((p) => PLATFORM_LABEL[p]).join(" and ")} only.`}
      </p>
    </fieldset>
  );
}

/**
 * Pictures 2 to 10 of an ordinary post: each with its description, moved with Earlier and Later.
 * @param props - Component props.
 * @param props.pictures - Pictures after the first.
 * @param props.editable - Whether the post can still be changed.
 * @param props.canUpload - Whether image uploads are configured.
 * @param props.busy - Whether a picture is uploading.
 * @param props.onAdd - Opens the file picker for another picture.
 * @param props.onChange - Called with the new list.
 * @returns List element.
 */
export function MorePictures({
  pictures,
  editable,
  canUpload,
  busy,
  onAdd,
  onChange,
}: {
  pictures: MediaItem[];
  editable: boolean;
  canUpload: boolean;
  busy: boolean;
  onAdd: () => void;
  onChange: (pictures: MediaItem[]) => void;
}): React.ReactElement | null {
  const fieldId = useId();
  if (!editable && pictures.length === 0) return null;

  /**
   * Swaps a picture with its neighbour.
   * @param i - The picture's place in the list.
   * @param by - One place earlier (-1) or later (1).
   */
  function move(i: number, by: -1 | 1): void {
    const to = i + by;
    if (to < 0 || to >= pictures.length) return;
    const next = [...pictures];
    [next[i], next[to]] = [next[to]!, next[i]!];
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {pictures.map((p, i) => (
        <div
          key={`${i}-${p.url}`}
          className="flex flex-col gap-3 rounded-lg border border-admin-border p-3 sm:flex-row sm:items-start"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.url}
            alt={p.alt ?? ""}
            className="h-20 w-auto self-start rounded-md border border-admin-border"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <AdminField label={`Picture ${i + 2}: description`} htmlFor={`${fieldId}-${i}`}>
              <AdminInput
                id={`${fieldId}-${i}`}
                value={p.alt ?? ""}
                onChange={(e) =>
                  onChange(pictures.map((o, j) => (j === i ? { ...o, alt: e.target.value } : o)))
                }
                disabled={!editable}
                maxLength={300}
              />
            </AdminField>
            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <AdminButton
                  size="xs"
                  variant="ghost"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <FaArrowLeft aria-hidden /> Earlier
                </AdminButton>
                <AdminButton
                  size="xs"
                  variant="ghost"
                  disabled={i === pictures.length - 1}
                  onClick={() => move(i, 1)}
                >
                  Later <FaArrowRight aria-hidden />
                </AdminButton>
                <AdminButton
                  size="xs"
                  variant="ghost"
                  onClick={() => onChange(pictures.filter((_, j) => j !== i))}
                >
                  Remove
                </AdminButton>
              </div>
            )}
          </div>
        </div>
      ))}
      {editable && pictures.length < MAX_PICTURES - 1 && (
        <button
          type="button"
          disabled={!canUpload || busy}
          onClick={onAdd}
          className="flex h-12 items-center justify-center rounded-lg border border-dashed border-admin-border-strong text-sm font-semibold text-admin-muted transition-colors hover:border-russian-violet hover:text-russian-violet disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy
            ? "Adding the picture..."
            : `+ Add another picture (${pictures.length + 1} of ${MAX_PICTURES})`}
        </button>
      )}
      {pictures.length > 0 && (
        <p className="text-sm text-admin-muted">
          Facebook shows the pictures as a grid and Instagram as a set to swipe through, each cut to
          picture 1&apos;s shape. Google shows picture 1 only.
        </p>
      )}
    </div>
  );
}

/**
 * A reel's or story's video: upload with progress, a player, and for a reel the cover frame.
 * @param props - Component props.
 * @param props.video - The stored video, or null.
 * @param props.format - Reel or story, for the limits and whether a cover applies.
 * @param props.editable - Whether the post can still be changed.
 * @param props.canUpload - Whether uploads are configured.
 * @param props.progress - Share uploaded so far while uploading, else null.
 * @param props.coverBusy - Whether a cover frame is being drawn and stored.
 * @param props.onFile - Uploads a picked video.
 * @param props.onCancel - Stops the upload.
 * @param props.onRemove - Takes the video off the post.
 * @param props.onCover - Draws and stores the frame at a time as the cover.
 * @returns Video section element.
 */
export function PostVideo({
  video,
  format,
  editable,
  canUpload,
  progress,
  coverBusy,
  onFile,
  onCancel,
  onRemove,
  onCover,
}: {
  video: MediaItem | null;
  format: "reel" | "story";
  editable: boolean;
  canUpload: boolean;
  progress: number | null;
  coverBusy: boolean;
  onFile: (file: File) => void;
  onCancel: () => void;
  onRemove: () => void;
  onCover: (atMs: number) => void;
}): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<HTMLVideoElement>(null);
  const sliderId = useId();
  const [frameAt, setFrameAt] = useState(0);
  const maxMs = format === "story" ? STORY_VIDEO_MAX_MS : VIDEO_MAX_MS;
  const facts = video
    ? [
        video.durationMs ? `${clockOf(video.durationMs)} long` : null,
        video.width && video.height ? `${video.width} x ${video.height}` : null,
        video.sizeBytes ? `${(video.sizeBytes / 1024 / 1024).toFixed(1)} MB` : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="flex flex-col gap-2">
      <span className={cn(ADMIN_LABEL_CLS, "mb-0")}>Video</span>
      {progress !== null ? (
        <div
          className="flex flex-col gap-2 rounded-lg border border-admin-border p-3"
          role="status"
        >
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Uploading the video... {progress}%</span>
            <AdminButton size="xs" variant="ghost" onClick={onCancel}>
              Cancel
            </AdminButton>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-admin-bg">
            <div
              className="h-full rounded-full bg-russian-violet transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : video ? (
        <div className="flex flex-col gap-3 rounded-lg border border-admin-border p-3 sm:flex-row sm:items-start">
          <video
            ref={playerRef}
            src={video.url}
            poster={video.coverUrl ?? undefined}
            controls
            muted
            playsInline
            preload="metadata"
            className="max-h-72 w-auto self-start rounded-md border border-admin-border bg-black"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {facts.length > 0 && <p className="text-sm text-admin-muted">{facts.join(", ")}</p>}
            {format === "reel" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  {video.coverUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.coverUrl}
                      alt=""
                      className="h-16 w-auto rounded border border-admin-border"
                    />
                  )}
                  <span className="text-sm">
                    {video.coverUrl ? "Cover" : "No cover yet: Instagram uses the first frame."}
                  </span>
                </div>
                {editable && video.durationMs && (
                  <>
                    <label htmlFor={sliderId} className="text-sm font-semibold">
                      Pick a frame: {clockOf(frameAt)}
                    </label>
                    <input
                      id={sliderId}
                      type="range"
                      min={0}
                      max={video.durationMs}
                      step={100}
                      value={frameAt}
                      onChange={(e) => {
                        const at = Number(e.target.value);
                        setFrameAt(at);
                        if (playerRef.current) playerRef.current.currentTime = at / 1000;
                      }}
                      className="w-full accent-russian-violet"
                    />
                    <AdminButton
                      size="xs"
                      variant="secondary"
                      busy={coverBusy}
                      disabled={!canUpload}
                      onClick={() => onCover(frameAt)}
                      className="self-start"
                    >
                      Use this frame as the cover
                    </AdminButton>
                  </>
                )}
              </div>
            )}
            {editable && (
              <div className="flex flex-wrap gap-2">
                <AdminButton
                  size="xs"
                  variant="secondary"
                  disabled={!canUpload}
                  onClick={() => fileRef.current?.click()}
                >
                  Replace
                </AdminButton>
                <AdminButton size="xs" variant="ghost" onClick={onRemove}>
                  Remove
                </AdminButton>
              </div>
            )}
          </div>
        </div>
      ) : editable ? (
        <button
          type="button"
          disabled={!canUpload}
          onClick={() => fileRef.current?.click()}
          className="flex h-20 items-center justify-center rounded-lg border border-dashed border-admin-border-strong text-sm font-semibold text-admin-muted transition-colors hover:border-russian-violet hover:text-russian-violet disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Add a video
        </button>
      ) : (
        <p className="text-sm text-admin-muted">No video</p>
      )}
      {editable && (
        <p className="text-sm text-admin-muted">
          MP4 or MOV, 3 seconds to {clockOf(maxMs)}, up to 250 MB. Filmed upright (9:16) it fills
          the screen.
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
