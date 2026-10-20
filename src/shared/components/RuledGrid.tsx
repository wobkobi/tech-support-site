// src/shared/components/RuledGrid.tsx
// Blocks topped with a moonstone rule instead of a boxed card, and the grid that lays them out.

import { cn } from "@/shared/lib/cn";
import type React from "react";

const COLS: Record<2 | 3 | 4, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * Responsive grid of {@link RuledBlock}s: one column on phones, two from sm,
 * then the requested count from lg.
 * @param props - Component props.
 * @param props.cols - Column count from lg.
 * @param props.className - Extra classes.
 * @param props.children - The blocks.
 * @returns The grid element.
 */
export function RuledGrid({
  cols = 3,
  className,
  children,
}: {
  cols?: 2 | 3 | 4;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return <div className={cn("grid gap-x-7 gap-y-9", COLS[cols], className)}>{children}</div>;
}

/**
 * One block with a 3px moonstone rule on top and a heading (h3 by default).
 * @param props - Component props.
 * @param props.title - The heading text.
 * @param props.as - Heading level; h2 when the section has no h2 of its own, so the outline skips no level.
 * @param props.id - Anchor id (scroll margin clears the sticky header).
 * @param props.className - Extra classes.
 * @param props.children - Block body.
 * @returns The block element.
 */
export function RuledBlock({
  title,
  as: Heading = "h3",
  id,
  className,
  children,
}: {
  title: React.ReactNode;
  as?: "h2" | "h3";
  id?: string;
  className?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      id={id}
      className={cn("border-t-[3px] border-moonstone-500 pt-3", id && "scroll-mt-28", className)}
    >
      <Heading className="mb-2 text-[1.1875rem] font-extrabold sm:text-xl">{title}</Heading>
      {children}
    </div>
  );
}
