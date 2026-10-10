// src/features/admin/components/ui/Card.tsx
// Canonical admin surface: a bordered 8px panel with no shadow, matching the public
// site's panels, plus an optional CardHeader: a title row ruled off across the card's
// full width. Server-safe.

import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Inner padding preset for a {@link Card}. */
type CardPadding = "none" | "sm" | "md";

/** Props for {@link Card}. */
interface CardProps {
  children: React.ReactNode;
  className?: string;
  /** Inner padding: "none" (self-managed), "sm", or "md" (default). */
  padding?: CardPadding;
  /**
   * Drop the surface below `sm`. For a card that wraps a list of cards: on a
   * phone the extra border and padding only narrow the cards inside it.
   */
  flushOnPhone?: boolean;
}

/** Strips the card surface below `sm`; see {@link CardProps.flushOnPhone}. */
export const FLUSH_ON_PHONE =
  "max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:[--card-pad-x:0px] max-sm:[--card-pad:0px]";

/**
 * Padding for the given preset. The padding is also published as --card-pad (and the
 * header's side inset as --card-pad-x), so a CardHeader can pull itself out to the
 * card's edges whatever the preset; a "none" card still gives its header a side inset.
 * @param padding - Padding preset.
 * @returns Class string.
 */
function paddingClass(padding: CardPadding): string {
  switch (padding) {
    case "none":
      return "[--card-pad-x:1rem] [--card-pad:0px] sm:[--card-pad-x:1.25rem]";
    case "sm":
      return "p-(--card-pad) [--card-pad-x:0.75rem] [--card-pad:0.75rem]";
    case "md":
      return "p-(--card-pad) [--card-pad-x:1rem] [--card-pad:1rem] sm:[--card-pad-x:1.25rem] sm:[--card-pad:1.25rem]";
  }
}

/**
 * Bordered surface used across the admin back office.
 * @param props - Component props.
 * @param props.children - Card contents.
 * @param props.className - Extra classes.
 * @param props.padding - Inner padding preset (defaults to "md").
 * @param props.flushOnPhone - Drop the surface below `sm`.
 * @returns The card element.
 */
export function Card({
  children,
  className,
  padding = "md",
  flushOnPhone = false,
}: CardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "rounded-lg border border-admin-border bg-admin-surface",
        paddingClass(padding),
        flushOnPhone && FLUSH_ON_PHONE,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Props for {@link CardHeader}. */
interface CardHeaderProps {
  /** Header title. */
  title: React.ReactNode;
  /** Optional supporting description below the title. */
  description?: React.ReactNode;
  /** Optional right-aligned actions (buttons, links). */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Title / description / actions row for the top of a {@link Card}. As the card's first
 * child it runs edge to edge with a rule under it (negative margins cancel the card's
 * padding); anywhere else it keeps the rule and loses the pull-out.
 * @param props - Component props.
 * @param props.title - Header title.
 * @param props.description - Optional supporting description.
 * @param props.actions - Optional right-aligned actions.
 * @param props.className - Extra classes.
 * @returns The header element.
 */
export function CardHeader({
  title,
  description,
  actions,
  className,
}: CardHeaderProps): React.ReactElement {
  return (
    <div
      className={cn(
        "-mx-(--card-pad,0px) mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-admin-border px-(--card-pad-x,0px) py-3.5 first:-mt-(--card-pad,0px)",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-admin-text">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-admin-muted">{description}</p>}
      </div>
      {/* Wraps under a long title on phones rather than squeezing it into a sliver. */}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
