"use client";
// src/features/admin/components/ui/StickyList.tsx
// List frame that pins its toolbar under the top bar on lg+, and hands the toolbar's
// height to the table so its column names pin just below it.

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useRef } from "react";

/** Props for {@link StickyList}. */
interface StickyListProps {
  /** The list's toolbar (usually a ListToolbar): search, filters, count. */
  toolbar: React.ReactNode;
  /** The rows: a table using STICKY_THEAD_CLS, a card grid, or both. */
  children: React.ReactNode;
  /** The toolbar sits on a card on lg+ rather than the page, so its backdrop matches the card. */
  onCard?: boolean;
  className?: string;
}

/**
 * Wraps a toolbar and its rows. The wrapper holds both, so the toolbar stays pinned the
 * whole way down the rows and lets go once they end. A ResizeObserver writes the
 * toolbar's height to `--list-toolbar-h` on the wrapper, which STICKY_THEAD_CLS adds to
 * the top bar's 3.5rem; the height changes when the filters wrap onto a second line.
 * @param props - Component props.
 * @param props.toolbar - The toolbar to pin.
 * @param props.children - The rows below it.
 * @param props.onCard - Give the pinned toolbar the card's backdrop instead of the page's.
 * @param props.className - Extra classes on the wrapper.
 * @returns The list frame.
 */
export function StickyList({
  toolbar,
  children,
  onCard = false,
  className,
}: StickyListProps): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const bar = barRef.current;
    if (!wrap || !bar) return;
    // The fractional height, not offsetHeight: rem padding makes the bar e.g. 82.5px, and
    // rounding to 83 would leave a half-pixel line under it where rows show through.
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize[0]?.blockSize ?? bar.getBoundingClientRect().height;
      wrap.style.setProperty("--list-toolbar-h", `${height}px`);
    });
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className={cn("min-w-0", className)}>
      {/* flow-root keeps the toolbar's bottom margin inside this box, so the opaque
          backdrop covers it and rows can't show through the gap above the header. The
          bar tucks about 1px under the 3.5rem top bar: both sit on half pixels at the
          15px root size, and snapping them apart would open a line of rows between them. */}
      <div
        ref={barRef}
        className={cn(
          "flow-root lg:sticky lg:top-13.75 lg:z-10 lg:pt-2",
          onCard ? "lg:bg-admin-surface" : "lg:bg-admin-bg",
        )}
      >
        {toolbar}
      </div>
      {children}
    </div>
  );
}
