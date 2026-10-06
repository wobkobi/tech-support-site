// src/shared/components/TickList.tsx
// List with moonstone ticks or dots as markers.

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaCheck } from "react-icons/fa6";

/**
 * Unstyled list wrapper for {@link TickItem}s.
 * @param props - Component props.
 * @param props.className - Extra classes (gap overrides, columns).
 * @param props.children - The items.
 * @returns The list element.
 */
export function TickList({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return <ul className={cn("grid gap-3", className)}>{children}</ul>;
}

/**
 * One list item with a tick or a dot ahead of the text. The marker sits on the
 * first line however far the text wraps.
 * @param props - Component props.
 * @param props.variant - Tick for benefits, dot for plain lists.
 * @param props.children - Item text.
 * @returns The list item.
 */
export function TickItem({
  variant = "tick",
  children,
}: {
  variant?: "tick" | "dot";
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <li className="flex gap-3">
      {variant === "tick" ? (
        <FaCheck aria-hidden className="mt-[0.3em] size-4 shrink-0 text-moonstone-700" />
      ) : (
        <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-moonstone-700" />
      )}
      <span>{children}</span>
    </li>
  );
}
