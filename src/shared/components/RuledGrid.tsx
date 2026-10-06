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
 * One block with a 3px moonstone rule on top and an h3.
 * @param props - Component props.
 * @param props.title - The h3 text.
 * @param props.id - Anchor id (scroll margin clears the sticky header).
 * @param props.className - Extra classes.
 * @param props.children - Block body.
 * @returns The block element.
 */
export function RuledBlock({
  title,
  id,
  className,
  children,
}: {
  title: React.ReactNode;
  id?: string;
  className?: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      id={id}
      className={cn("border-t-[3px] border-moonstone-500 pt-3", id && "scroll-mt-28", className)}
    >
      <h3 className="mb-2 text-[1.1875rem] font-extrabold sm:text-xl">{title}</h3>
      {children}
    </div>
  );
}
