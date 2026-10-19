// src/features/admin/components/ui/Card.tsx
// Canonical admin surface (bordered, no shadow) plus an optional full-width CardHeader.
// Server-safe.

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
   * Drop the surface below `sm`, for a card wrapping a list of cards.
   */
  flushOnPhone?: boolean;
}

/** Strips the card surface below `sm`; see {@link CardProps.flushOnPhone}. */
export const FLUSH_ON_PHONE =
  "max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:p-0 max-sm:[--card-pad-x:0px] max-sm:[--card-pad:0px]";

/**
 * Padding for the given preset, also published as --card-pad / --card-pad-x so a
 * CardHeader can pull out to the card's edges.
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
 * Title / description / actions row for a {@link Card}. As the first child it runs edge
 * to edge via negative margins; elsewhere it just keeps the rule.
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
