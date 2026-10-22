"use client";
// src/features/social/components/MediaPreview.tsx
// Look-alike story, reel and Facebook cover photo for the composer's preview, marking what the
// apps cover up: a story's top and bottom bars, and the sides of a cover that phones cut off.

import {
  AVATAR_SRC,
  SYSTEM_FONT,
  type PreviewPost,
} from "@/features/social/components/PlatformPreview";
import type { SocialPlatformKey } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";
import {
  FaEllipsis,
  FaRegComment,
  FaRegHeart,
  FaRegPaperPlane,
  FaRegThumbsUp,
  FaShare,
} from "react-icons/fa6";

/** The story bars' share of the screen; matches the Post maker's story safe zone. */
const STORY_TOP = 0.14;
const STORY_BOTTOM = 0.2;
/** Phones show the middle 16:9 of a 1640 x 624 cover: 162 pixels in 1000 go each side. */
const COVER_SIDE = 0.162;

/**
 * The picture or video filling a tall frame.
 * @param props - Component props.
 * @param props.post - Filled post content.
 * @returns Media element, or a note when there's nothing to show.
 */
function TallMedia({ post }: { post: PreviewPost }): React.ReactElement {
  if (post.video) {
    return (
      <video
        src={post.video.url}
        poster={post.video.coverUrl ?? undefined}
        muted
        loop
        autoPlay
        playsInline
        className="absolute inset-0 size-full object-cover"
      />
    );
  }
  if (post.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={post.imageUrl}
        alt={post.imageAlt}
        className="absolute inset-0 size-full object-cover"
      />
    );
  }
  return (
    <span className="absolute inset-0 flex items-center justify-center px-6 text-center text-[14px] text-white/80">
      {post.format === "reel" ? "Add a video" : "Add a picture or a video"}
    </span>
  );
}

/**
 * A story on a phone: the progress bar and name across the top, the reply box along the bottom,
 * and a switch that shades the strips those cover.
 * @param props - Component props.
 * @param props.post - Filled post content.
 * @param props.platform - Facebook or Instagram.
 * @param props.name - The Page name or username.
 * @returns Story element.
 */
export function StoryPreview({
  post,
  platform,
  name,
}: {
  post: PreviewPost;
  platform: SocialPlatformKey;
  name: string;
}): React.ReactElement {
  const [zones, setZones] = useState(true);
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        style={SYSTEM_FONT}
        className="relative aspect-9/16 w-full max-w-67.5 overflow-hidden rounded-xl bg-[#1c1e21] text-white"
      >
        <TallMedia post={post} />
        {zones && (
          <>
            <div
              aria-hidden
              style={{ height: `${STORY_TOP * 100}%` }}
              className="absolute inset-x-0 top-0 border-b border-dashed border-white/70 bg-coquelicot-600/30"
            />
            <div
              aria-hidden
              style={{ height: `${STORY_BOTTOM * 100}%` }}
              className="absolute inset-x-0 bottom-0 border-t border-dashed border-white/70 bg-coquelicot-600/30"
            />
          </>
        )}
        <div className="absolute inset-x-0 top-0 flex flex-col gap-2 p-2">
          <span className="h-0.5 w-full rounded-full bg-white/50">
            <span className="block h-full w-1/3 rounded-full bg-white" />
          </span>
          <span className="flex items-center gap-2 text-[13px] font-semibold drop-shadow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={AVATAR_SRC} alt="" className="size-8 rounded-full" />
            <span className="truncate">{name}</span>
            <span className="font-normal text-white/80">Just now</span>
            <FaEllipsis aria-hidden className="ml-auto size-4" />
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-3">
          <span className="flex-1 rounded-full border border-white/80 px-3 py-1.5 text-[13px]">
            {platform === "instagram" ? `Reply to ${name}...` : "Send message"}
          </span>
          {platform === "instagram" ? (
            <>
              <FaRegHeart aria-hidden className="size-5" />
              <FaRegPaperPlane aria-hidden className="size-5" />
            </>
          ) : (
            <FaRegThumbsUp aria-hidden className="size-5" />
          )}
        </div>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-admin-text">
        <input
          type="checkbox"
          checked={zones}
          onChange={(e) => setZones(e.target.checked)}
          className="size-4 accent-russian-violet"
        />
        Shade what the app covers
      </label>
    </div>
  );
}

/**
 * A reel on a phone: the video full screen, the buttons down the right and the caption's first
 * line at the bottom.
 * @param props - Component props.
 * @param props.post - Filled post content.
 * @param props.platform - Facebook or Instagram.
 * @param props.name - The Page name or username.
 * @returns Reel element.
 */
export function ReelPreview({
  post,
  platform,
  name,
}: {
  post: PreviewPost;
  platform: SocialPlatformKey;
  name: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const firstLine = post.text.split("\n")[0] ?? "";
  const cut = firstLine.length > 60 || post.text.includes("\n");
  return (
    <div
      style={SYSTEM_FONT}
      className="relative mx-auto aspect-9/16 w-full max-w-67.5 overflow-hidden rounded-xl bg-[#1c1e21] text-white"
    >
      <TallMedia post={post} />
      <div className="absolute right-2 bottom-24 flex flex-col items-center gap-5 drop-shadow">
        {platform === "instagram" ? (
          <FaRegHeart aria-hidden className="size-6" />
        ) : (
          <FaRegThumbsUp aria-hidden className="size-6" />
        )}
        <FaRegComment aria-hidden className="size-6 -scale-x-100" />
        {platform === "instagram" ? (
          <FaRegPaperPlane aria-hidden className="size-6" />
        ) : (
          <FaShare aria-hidden className="size-6" />
        )}
        <FaEllipsis aria-hidden className="size-6" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-linear-to-t from-black/60 to-transparent p-3 pr-12">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={AVATAR_SRC} alt="" className="size-7 rounded-full" />
          {name}
        </span>
        {post.text && (
          <p className={cn("text-[13px] leading-4 whitespace-pre-wrap", !open && "line-clamp-1")}>
            {open ? post.text : firstLine}
            {cut && !open && (
              <button type="button" onClick={() => setOpen(true)} className="ml-1 text-white/70">
                more
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The top of a Facebook Page: the cover with the strips phones cut off shaded, and the profile
 * picture over its corner.
 * @param props - Component props.
 * @param props.post - Filled post content.
 * @param props.pageName - The Page's name.
 * @returns Cover element.
 */
export function CoverPreview({
  post,
  pageName,
}: {
  post: PreviewPost;
  pageName: string;
}): React.ReactElement {
  return (
    <div
      style={SYSTEM_FONT}
      className="mx-auto w-full max-w-125 overflow-hidden rounded-lg bg-white text-[#050505] shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
    >
      <div className="relative aspect-1640/624 w-full bg-[#e4e6eb]">
        {post.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.imageUrl}
            alt={post.imageAlt}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[14px] text-[#65676b]">
            Add a picture
          </span>
        )}
        <div
          aria-hidden
          style={{ width: `${COVER_SIDE * 100}%` }}
          className="absolute inset-y-0 left-0 border-r border-dashed border-white/80 bg-black/35"
        />
        <div
          aria-hidden
          style={{ width: `${COVER_SIDE * 100}%` }}
          className="absolute inset-y-0 right-0 border-l border-dashed border-white/80 bg-black/35"
        />
      </div>
      <div className="flex items-end gap-3 px-4 pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={AVATAR_SRC}
          alt=""
          className="-mt-8 size-20 shrink-0 rounded-full border-4 border-white"
        />
        <p className="truncate pb-1 text-[20px] font-bold">{pageName}</p>
      </div>
      <p className="border-t border-[#ced0d4] px-4 py-2 text-[13px] text-[#65676b]">
        The shaded sides show on computers only; phones show the middle.
      </p>
    </div>
  );
}
