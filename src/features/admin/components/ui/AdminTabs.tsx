// src/features/admin/components/ui/AdminTabs.tsx
// Underline tab strip for admin pages: Link tabs when `href` is set, else buttons calling
// `onSelect`. Roving tabindex with manual activation, so arrowing never navigates.

"use client";

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";
import { useEffect, useRef } from "react";

/** One tab in an {@link AdminTabs} strip. */
export interface AdminTab<K extends string> {
  /** Stable key, compared against `active`. */
  key: K;
  /** Visible label. */
  label: React.ReactNode;
  /** Link target; when set the tab navigates instead of calling `onSelect`. */
  href?: string;
  /** Optional trailing marker (a count, a "Current" chip). */
  badge?: React.ReactNode;
}

/** Props for {@link AdminTabs}. */
interface AdminTabsProps<K extends string> {
  /** Tabs in display order. */
  tabs: ReadonlyArray<AdminTab<K>>;
  /** Key of the selected tab. */
  active: K;
  /** Called with the key of a button tab when it is activated. */
  onSelect?: (key: K) => void;
  /** Accessible name for the tablist. */
  "aria-label": string;
  className?: string;
}

/**
 * Renders the tab strip.
 * @param props - Component props.
 * @param props.tabs - Tabs in display order.
 * @param props.active - Key of the selected tab.
 * @param props.onSelect - Called with the key of an activated button tab.
 * @param props.className - Extra classes on the tablist.
 * @returns The tablist element.
 */
export function AdminTabs<K extends string>({
  tabs,
  active,
  onSelect,
  className,
  ...aria
}: AdminTabsProps<K>): React.ReactElement {
  const tabRefs = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndex = tabs.findIndex((t) => t.key === active);

  // Bring the selected tab into the strip's sideways scroll via scrollLeft, since
  // scrollIntoView can also scroll the page vertically.
  useEffect(() => {
    const list = listRef.current;
    const tab = tabRefs.current[activeIndex];
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    // Position within the scrolled content, from the boxes so a positioned ancestor
    // can't skew it the way offsetLeft would.
    const left =
      tab.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft;
    const right = left + tab.offsetWidth;
    if (left >= list.scrollLeft && right <= list.scrollLeft + list.clientWidth) return;
    // Centre it; the browser clamps scrollLeft at either end.
    list.scrollLeft = left - (list.clientWidth - tab.offsetWidth) / 2;
  }, [activeIndex]);

  /**
   * Moves focus between tabs on arrow / Home / End. Space on a link tab follows the link,
   * since browsers only activate anchors on Enter.
   * @param e - Key event from a tab.
   * @param index - Index of the focused tab.
   */
  const onKeyDown = (e: React.KeyboardEvent, index: number): void => {
    if (e.key === " " && tabs[index]?.href) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).click();
      return;
    }
    const last = tabs.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
  };

  return (
    // Scrolls sideways on phones, wraps from md up so every tab shows.
    <div
      ref={listRef}
      role="tablist"
      aria-label={aria["aria-label"]}
      className={cn(
        "flex gap-x-1 overflow-x-auto border-b border-admin-border md:flex-wrap md:overflow-visible",
        className,
      )}
    >
      {tabs.map((tab, i) => {
        const selected = tab.key === active;
        const cls = cn(
          "-mb-px inline-flex items-center gap-2 border-b-[3px] px-3 py-2 text-[0.9375rem] font-bold whitespace-nowrap transition-colors select-none",
          selected
            ? "border-russian-violet text-russian-violet"
            : "border-transparent text-admin-muted hover:text-admin-text",
        );
        const common = {
          role: "tab" as const,
          "aria-selected": selected,
          tabIndex: selected ? 0 : -1,
          /**
           * Routes arrow / Home / End to the roving-focus handler with this tab's index.
           * @param e - The key event.
           */
          onKeyDown: (e: React.KeyboardEvent) => {
            onKeyDown(e, i);
          },
          className: cls,
        };
        const body = (
          <>
            {tab.label}
            {tab.badge}
          </>
        );
        return tab.href ? (
          <Link
            key={tab.key}
            href={tab.href}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            {...common}
          >
            {body}
          </Link>
        ) : (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSelect?.(tab.key)}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            {...common}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
