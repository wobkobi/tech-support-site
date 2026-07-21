// src/features/admin/components/ui/Card.tsx
/**
 * @description Canonical admin surface. Replaces the copy-pasted
 * `rounded-xl border ... bg-white shadow-sm` class strings with a tokenised
 * {@link Card} plus an optional {@link CardHeader}. Server-safe.
 */

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
}

/**
 * Padding utility for the given preset.
 * @param padding - Padding preset.
 * @returns Class string.
 */
function paddingClass(padding: CardPadding): string {
  switch (padding) {
    case "none":
      return "";
    case "sm":
      return "p-3";
    case "md":
      return "p-4 sm:p-5";
  }
}

/**
 * Bordered surface used across the admin back office.
 * @param props - Component props.
 * @param props.children - Card contents.
 * @param props.className - Extra classes.
 * @param props.padding - Inner padding preset (defaults to "md").
 * @returns The card element.
 */
export function Card({ children, className, padding = "md" }: CardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "rounded-xl border border-admin-border bg-admin-surface shadow-sm",
        paddingClass(padding),
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
 * Title / description / actions row for the top of a {@link Card}.
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
    <div className={cn("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-bold text-admin-text">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-admin-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
