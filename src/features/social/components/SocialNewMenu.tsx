"use client";
// src/features/social/components/SocialNewMenu.tsx
// The Social header's New button: start a post, a story, a cover photo, a content item, or a
// picture in the Post maker, from any Social tab.

import { adminButtonClass } from "@/features/admin/components/ui/button-classes";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { postHref } from "@/features/social/lib/links";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  FaChevronDown,
  FaImage,
  FaLayerGroup,
  FaMobileScreen,
  FaPalette,
  FaPenToSquare,
  FaPlus,
} from "react-icons/fa6";

type Kind = "post" | "story" | "cover" | "content";

/** The kinds of blank post the menu starts, besides a content item. */
const POST_KINDS: {
  kind: Exclude<Kind, "content">;
  label: string;
  busy: string;
  hint: string;
  Icon: typeof FaPlus;
}[] = [
  {
    kind: "post",
    label: "Post",
    busy: "Starting a post...",
    hint: "Write one post to send now or later. Add more pictures or a reel from it.",
    Icon: FaPenToSquare,
  },
  {
    kind: "story",
    label: "Story",
    busy: "Starting a story...",
    hint: "A tall picture or video on Facebook and Instagram for 24 hours.",
    Icon: FaMobileScreen,
  },
  {
    kind: "cover",
    label: "Cover photo",
    busy: "Starting a cover photo...",
    hint: "The wide picture across the top of your Facebook Page.",
    Icon: FaImage,
  },
];

const ITEM_CLS =
  "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left hover:bg-admin-bg focus-visible:bg-admin-bg disabled:opacity-50 pointer-coarse:min-h-11";

/**
 * New menu.
 * @returns The button and its menu.
 */
export function SocialNewMenu(): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState<Kind | null>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    /**
     * Closes the menu when a click lands outside it.
     * @param e - The pointer event.
     */
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  /**
   * Escape closes; up and down move between the items.
   * @param e - The key event.
   */
  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [],
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  /**
   * Makes a blank post, story, cover photo or content item and opens it.
   * @param kind - Which to make.
   */
  async function make(kind: Kind): Promise<void> {
    setMaking(kind);
    const res =
      kind !== "content"
        ? await callApi<{ post: SocialPostRow }>("/api/admin/social", "POST", {
            source: "blank",
            format: kind === "post" ? null : kind,
          })
        : await callApi<{ item: SocialPostRow }>("/api/admin/social/content", "POST", {
            source: "blank",
          });
    if (!res.ok) {
      setMaking(null);
      toast(res.error, { tone: "error" });
      return;
    }
    setOpen(false);
    setMaking(null);
    router.push(postHref("post" in res ? res.post : res.item));
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={adminButtonClass({ variant: "primary" })}
      >
        <FaPlus aria-hidden className="size-3.5" /> New
        <FaChevronDown aria-hidden className="size-3" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="New"
          className="absolute right-0 z-30 mt-2 w-72 rounded-lg border border-admin-border bg-admin-surface p-1 shadow-lg"
        >
          {POST_KINDS.map(({ kind, label, busy, hint, Icon }) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              disabled={making !== null}
              onClick={() => void make(kind)}
              className={ITEM_CLS}
            >
              <Icon aria-hidden className="mt-1 size-4 shrink-0 text-russian-violet" />
              <span>
                <span className="block font-semibold text-admin-text">
                  {making === kind ? busy : label}
                </span>
                <span className="block text-sm text-admin-muted">{hint}</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            disabled={making !== null}
            onClick={() => void make("content")}
            className={ITEM_CLS}
          >
            <FaLayerGroup aria-hidden className="mt-1 size-4 shrink-0 text-russian-violet" />
            <span>
              <span className="block font-semibold text-admin-text">
                {making === "content" ? "Starting an item..." : "Content item"}
              </span>
              <span className="block text-sm text-admin-muted">
                A post you&apos;ll use again, with captions that take turns.
              </span>
            </span>
          </button>
          <Link
            href="/admin/social/design"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(ITEM_CLS, "no-underline")}
          >
            <FaPalette aria-hidden className="mt-1 size-4 shrink-0 text-russian-violet" />
            <span>
              <span className="block font-semibold text-admin-text">Design a picture</span>
              <span className="block text-sm text-admin-muted">Make one in the Post maker.</span>
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
