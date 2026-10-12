// src/shared/components/Disclosure.tsx
// Open/close question row used by the FAQ, Business and Pricing pages.

import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaCaretDown } from "react-icons/fa6";

/**
 * One native details/summary row: bold title with a caret that flips when open, ruled above
 * and below so a run of rows reads as one list. Works without JavaScript.
 * @param props - Component props.
 * @param props.title - Question or section name shown in the closed row.
 * @param props.titleAs - Element for the title; "h3" when the rows sit under a section heading.
 * @param props.bodyClassName - Extra classes for the answer wrapper.
 * @param props.children - Answer shown when the row is open.
 * @returns The details element.
 */
export function Disclosure({
  title,
  titleAs: Title = "span",
  bodyClassName,
  children,
}: {
  title: React.ReactNode;
  titleAs?: "span" | "h3";
  bodyClassName?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <details className="group border-b border-seasalt-100 first:border-t">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet [&::-webkit-details-marker]:hidden">
        <Title className="text-lg font-bold">{title}</Title>
        <FaCaretDown
          aria-hidden
          className="mt-1.5 h-4 w-4 shrink-0 text-moonstone-700 transition-[rotate] group-open:rotate-180"
        />
      </summary>
      <div className={cn("space-y-3 pb-5", bodyClassName)}>{children}</div>
    </details>
  );
}
