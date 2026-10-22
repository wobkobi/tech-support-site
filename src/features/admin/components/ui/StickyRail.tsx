"use client";
// src/features/admin/components/ui/StickyRail.tsx
// Side column that stays in view on lg+ while the main column scrolls past it.

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useRef, useState } from "react";

/** Props for {@link StickyRail}. */
interface StickyRailProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Pins a side column on lg+. A rail shorter than the screen sticks 1rem under the 3.5rem
 * top bar; a taller one scrolls until its bottom is 1rem off the screen edge, then sticks
 * there, so every part of it can be reached without an inner scrollbar (which would also
 * clip any dropdown inside it). The grid it sits in needs `items-start`, or the rail
 * stretches to the row and has nowhere to stick.
 * @param props - Component props.
 * @param props.children - Rail contents.
 * @param props.className - Extra classes, usually the rail's own flex or grid layout.
 * @returns The rail element.
 */
export function StickyRail({ children, className }: StickyRailProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.borderBoxSize[0]?.blockSize ?? el.offsetHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      // Before the first measure height is 0, so the rail starts at the short-rail offset.
      style={
        { "--rail-top": `min(4.5rem, calc(100dvh - ${height}px - 1rem))` } as React.CSSProperties
      }
      className={cn("min-w-0 lg:sticky lg:top-(--rail-top) lg:self-start", className)}
    >
      {children}
    </div>
  );
}
