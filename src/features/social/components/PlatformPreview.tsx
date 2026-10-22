"use client";
// src/features/social/components/PlatformPreview.tsx
// Look-alike Facebook, Instagram and Google Business posts for the composer, copying each app's
// light-mode layout and "See more" fold so the operator sees where a long post cuts.

import type { GoogleFields } from "@/features/social/lib/adapter";
import { GOOGLE_CTA_LABEL, shownRatio } from "@/features/social/lib/validate";
import { cn } from "@/shared/lib/cn";
import React, { useState } from "react";
import {
  FaEarthAmericas,
  FaEllipsis,
  FaRegBookmark,
  FaRegComment,
  FaRegHeart,
  FaRegPaperPlane,
  FaRegThumbsUp,
  FaShare,
} from "react-icons/fa6";

/** Same profile picture both accounts use. */
const AVATAR_SRC = "/instagram-profile-320.jpg";

// The apps render in the device's system font, not the admin's.
const SYSTEM_FONT: React.CSSProperties = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

// Facebook folds a feed post after about five lines or 480 characters; Instagram
// after two lines or about 125 characters. Observed in the apps, not documented.
const FACEBOOK_FOLD = { chars: 480, lines: 5 };
const INSTAGRAM_FOLD = { chars: 125, lines: 2 };
// Facebook shows a short text-only post in large type.
const FACEBOOK_BIG_TEXT_MAX = 85;

// Hashtags and @mentions start a word, so an email address's "@" doesn't match.
const TAG_RE = /(?<=^|\s)(?:#[\p{L}\p{N}_]+|@[\w.]+)/u;
const URL_RE = /https?:\/\/\S+/u;

/** The parts of a post the previews need. */
export interface PreviewPost {
  text: string;
  imageUrl: string | null;
  imageAlt: string;
  imageWidth: number | null;
  imageHeight: number | null;
  linkUrl: string | null;
  google: GoogleFields;
}

/**
 * Cuts text where the app folds it.
 * @param text - Full text.
 * @param fold - Character and line limits.
 * @param fold.chars - Characters shown before the fold.
 * @param fold.lines - Lines shown before the fold.
 * @returns The visible part and whether anything was hidden.
 */
function foldText(
  text: string,
  fold: { chars: number; lines: number },
): { head: string; cut: boolean } {
  let head = text.split("\n").slice(0, fold.lines).join("\n");
  // Back off to the last whole word, as the apps do.
  if (head.length > fold.chars) head = head.slice(0, fold.chars).replace(/\s+\S*$/, "");
  return { head: head.trimEnd(), cut: head.length < text.trimEnd().length };
}

/**
 * Renders text with the parts the app turns blue: hashtags, mentions and optionally URLs.
 * @param text - Text to render.
 * @param linkClass - Colour for the highlighted parts.
 * @param withUrls - Whether web addresses are highlighted too.
 * @returns Text and highlighted spans.
 */
function highlight(text: string, linkClass: string, withUrls: boolean): React.ReactNode[] {
  const pattern = new RegExp(withUrls ? `${TAG_RE.source}|${URL_RE.source}` : TAG_RE.source, "gu");
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <span key={m.index} className={linkClass}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * The host name shown on a link card, upper-cased as Facebook shows it.
 * @param url - Link URL.
 * @returns Host without "www.", or the raw text if it doesn't parse.
 */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toUpperCase();
  } catch {
    return url;
  }
}

/**
 * A Facebook Page feed post. Photo posts carry the link at the end of the caption, as
 * publishing sends it; text posts show a link card.
 * @param props - Component props.
 * @param props.post - Filled post content.
 * @param props.pageName - The Page's name.
 * @returns Facebook post element.
 */
export function FacebookPreview({
  post,
  pageName,
}: {
  post: PreviewPost;
  pageName: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const caption =
    post.imageUrl && post.linkUrl
      ? `${post.text}${post.text ? "\n\n" : ""}${post.linkUrl}`
      : post.text;
  const { head, cut } = foldText(caption, FACEBOOK_FOLD);
  const big =
    !post.imageUrl &&
    !post.linkUrl &&
    caption.length <= FACEBOOK_BIG_TEXT_MAX &&
    !caption.includes("\n");
  const link = "text-[#0064d1]";

  return (
    <article
      style={SYSTEM_FONT}
      className="mx-auto w-full max-w-125 overflow-hidden rounded-lg bg-white font-normal text-[#050505] shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
    >
      <header className="flex items-start gap-2 px-4 pt-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={AVATAR_SRC} alt="" className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] leading-5 font-semibold">{pageName}</p>
          <p className="flex items-center gap-1 text-[13px] leading-4 text-[#65676b]">
            Just now <span aria-hidden>·</span>
            <FaEarthAmericas aria-label="Public" className="size-3" />
          </p>
        </div>
        <FaEllipsis aria-hidden className="mt-2 size-5 text-[#65676b]" />
      </header>

      {caption ? (
        <p
          className={cn(
            "px-4 pt-2 pb-3 wrap-break-word whitespace-pre-wrap",
            big ? "text-[24px] leading-7" : "text-[15px] leading-5",
          )}
        >
          {highlight(open ? caption : head, link, true)}
          {cut && !open && (
            <>
              {"... "}
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="font-semibold hover:underline"
              >
                See more
              </button>
            </>
          )}
        </p>
      ) : (
        <div className="h-3" />
      )}

      {post.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.imageUrl}
          alt={post.imageAlt}
          style={{ aspectRatio: shownRatio("facebook", post.imageWidth, post.imageHeight) }}
          className="w-full bg-[#f0f2f5] object-cover"
        />
      )}
      {!post.imageUrl && post.linkUrl && (
        <div className="border-y border-[#ced0d4] bg-[#f0f2f5] px-4 py-2.5">
          <p className="text-[13px] leading-4 text-[#65676b]">{domainOf(post.linkUrl)}</p>
          <p className="truncate text-[17px] leading-6 font-semibold">{post.linkUrl}</p>
          <p className="text-[13px] leading-4 text-[#65676b]">
            Facebook fills in the page&apos;s own picture and title.
          </p>
        </div>
      )}

      <footer className="mx-4 flex justify-around border-t border-[#ced0d4] py-1 text-[15px] font-semibold text-[#65676b]">
        <span className="flex items-center gap-2 px-3 py-1.5">
          <FaRegThumbsUp aria-hidden className="size-4.5" /> Like
        </span>
        <span className="flex items-center gap-2 px-3 py-1.5">
          <FaRegComment aria-hidden className="size-4.5" /> Comment
        </span>
        <span className="flex items-center gap-2 px-3 py-1.5">
          <FaShare aria-hidden className="size-4.5" /> Share
        </span>
      </footer>
    </article>
  );
}

/**
 * An Instagram feed post: picture at Instagram's shape, action row, then caption. Links stay
 * plain text, as Instagram shows them.
 * @param props - Component props.
 * @param props.post - Filled post content.
 * @param props.username - The account's username, without the "@".
 * @returns Instagram post element.
 */
export function InstagramPreview({
  post,
  username,
}: {
  post: PreviewPost;
  username: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { head, cut } = foldText(post.text, INSTAGRAM_FOLD);
  const ratio = shownRatio("instagram", post.imageWidth, post.imageHeight);

  return (
    <article
      style={SYSTEM_FONT}
      className="mx-auto w-full max-w-117.5 overflow-hidden rounded-lg border border-[#dbdbdb] bg-white font-normal text-black"
    >
      <header className="flex items-center gap-3 px-3 py-2.5">
        <span className="rounded-full bg-linear-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] p-0.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={AVATAR_SRC} alt="" className="size-8 rounded-full border-2 border-white" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{username}</p>
        <FaEllipsis aria-hidden className="size-5" />
      </header>

      {post.imageUrl ? (
        <div style={{ aspectRatio: ratio }} className="w-full bg-[#efefef]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.imageUrl} alt={post.imageAlt} className="size-full object-cover" />
        </div>
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-[#efefef] px-6 text-center text-[14px] text-[#737373]">
          Instagram needs a picture
        </div>
      )}

      <div className="flex items-center gap-4 px-3 pt-3 text-[24px]">
        <FaRegHeart aria-hidden />
        <FaRegComment aria-hidden className="-scale-x-100" />
        <FaRegPaperPlane aria-hidden />
        <FaRegBookmark aria-hidden className="ml-auto" />
      </div>

      <p className="px-3 pt-2 text-[14px] leading-4.5 wrap-break-word whitespace-pre-wrap">
        <span className="font-semibold">{username}</span>{" "}
        {highlight(open ? post.text : head, "text-[#00376b]", false)}
        {cut && !open && (
          <>
            {"... "}
            <button type="button" onClick={() => setOpen(true)} className="text-[#737373]">
              more
            </button>
          </>
        )}
      </p>
      <p className="px-3 pt-1.5 pb-3 text-[12px] text-[#737373]">Just now</p>
    </article>
  );
}

/**
 * A YYYY-MM-DD day as Google prints it on an offer, like "14 Oct".
 * @param key - Date key.
 * @returns Short date, or the raw text if it doesn't parse.
 */
function offerDay(key: string): string {
  const day = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(day.getTime())) return key;
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(day);
}

/**
 * An HH:MM time as Google prints it, like "9:30am".
 * @param time - 24-hour time.
 * @returns Short time.
 */
function clockTime(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/**
 * When an event runs, as Google prints it under the title.
 * @param google - The post's Google fields.
 * @returns Like "14 Oct, 9:30am - 5:00pm" or "14 Oct - 17 Oct".
 */
function eventWhen(google: GoogleFields): string {
  if (!google.start || !google.end) return "Pick the event dates";
  const sameDay = google.start === google.end;
  if (!google.startTime || !google.endTime) {
    return sameDay ? offerDay(google.start) : `${offerDay(google.start)} - ${offerDay(google.end)}`;
  }
  const from = `${offerDay(google.start)}, ${clockTime(google.startTime)}`;
  const to = sameDay
    ? clockTime(google.endTime)
    : `${offerDay(google.end)}, ${clockTime(google.endTime)}`;
  return `${from} - ${to}`;
}

/**
 * A Business Profile post as shown under Updates. Offers show title, dates, code and "Redeem
 * online" as published; events show title and when; updates and events show a button only when
 * it will be sent.
 * @param props - Component props.
 * @param props.post - Filled post content.
 * @param props.businessName - The profile's business name.
 * @returns Google post element.
 */
export function GooglePreview({
  post,
  businessName,
}: {
  post: PreviewPost;
  businessName: string;
}): React.ReactElement {
  const { google } = post;
  const offer = google.type === "OFFER";
  const event = google.type === "EVENT";
  const link = google.url ?? post.linkUrl;
  // Call now rings the profile's number, so it needs no link, but Google won't put it on an event.
  const button =
    !offer && google.cta && (google.cta === "CALL" ? !event : link)
      ? GOOGLE_CTA_LABEL[google.cta]
      : null;

  return (
    <article
      style={SYSTEM_FONT}
      className="mx-auto w-full max-w-110 overflow-hidden rounded-lg border border-[#dadce0] bg-white font-normal text-[#202124]"
    >
      <header className="flex items-center gap-3 px-4 pt-3 pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={AVATAR_SRC} alt="" className="size-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] leading-5 font-medium">{businessName}</p>
          <p className="text-[12px] leading-4 text-[#70757a]">Just now</p>
        </div>
      </header>

      {post.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.imageUrl}
          alt={post.imageAlt}
          style={{ aspectRatio: shownRatio("google", post.imageWidth, post.imageHeight) }}
          className="w-full bg-[#f1f3f4] object-cover"
        />
      )}

      <div className="flex flex-col gap-2 px-4 pt-3 pb-4">
        {offer && (
          <div>
            <p className="text-[18px] leading-6 font-medium">{google.title || "Offer title"}</p>
            <p className="text-[13px] leading-5 text-[#70757a]">
              {google.start && google.end
                ? `${offerDay(google.start)} - ${offerDay(google.end)}`
                : "Pick the offer dates"}
            </p>
          </div>
        )}
        {event && (
          <div>
            <p className="text-[18px] leading-6 font-medium">{google.title || "Event title"}</p>
            <p className="text-[13px] leading-5 text-[#70757a]">{eventWhen(google)}</p>
          </div>
        )}
        {post.text && (
          <p className="text-[14px] leading-5 wrap-break-word whitespace-pre-wrap">{post.text}</p>
        )}
        {offer && google.couponCode && (
          <div className="rounded-md border border-dashed border-[#dadce0] px-3 py-2 text-center">
            <p className="text-[12px] text-[#70757a]">Show this code at the store</p>
            <p className="text-[16px] font-medium tracking-wide">{google.couponCode}</p>
          </div>
        )}
        {offer && post.linkUrl && (
          <p className="text-[14px] font-medium text-[#1a73e8]">Redeem online</p>
        )}
        {button && (
          <span className="mt-1 inline-flex self-start rounded-full border border-[#dadce0] px-4 py-1.5 text-[14px] font-medium text-[#1a73e8]">
            {button}
          </span>
        )}
      </div>
    </article>
  );
}
