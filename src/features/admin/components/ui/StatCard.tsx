// src/features/admin/components/ui/StatCard.tsx
// Summary stat card used by every upgraded admin list (invoices, ledger, bookings,
// reviews). Renders a plain surface, a link when `href` is given (navigates), or a button
// when `onClick` is given (applies a filter). Server-safe without `onClick` (the link and
// plain forms render anywhere). Reads label, value, then an optional sub line; inside a
// StatStrip the cards share one panel.

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

/** Accent tone for the stat value. */
export type StatTone = "default" | "success" | "warning" | "critical" | "violet" | "info";

/**
 * Value-colour class for the given tone.
 * @param tone - Accent tone.
 * @returns Class string.
 */
function valueToneClass(tone: StatTone): string {
  switch (tone) {
    case "default":
      return "text-admin-text";
    case "success":
      return "text-green-700";
    case "warning":
      return "text-amber-700";
    case "critical":
      return "text-coquelicot-700";
    case "violet":
      return "text-russian-violet";
    case "info":
      return "text-moonstone-700";
  }
}

/** Props for {@link StatCard}. */
interface StatCardProps {
  /** Small label under the value. */
  label: string;
  /** Primary value (pre-formatted). */
  value: React.ReactNode;
  /** Optional secondary line (e.g. an urgency hint or count). */
  sub?: React.ReactNode;
  /** Optional trend graphic under the text, e.g. a Sparkline. */
  trend?: React.ReactNode;
  /** Accent tone for the value. */
  tone?: StatTone;
  /** When set, the card renders as a link to this URL. Takes precedence over onClick. */
  href?: string;
  /** When set (and no href), the card renders as a button (e.g. to apply a filter). */
  onClick?: () => void;
  /** Marks the card as the active filter (adds a ring). */
  active?: boolean;
  /** "md" (default) for dense card rows; "lg" for a page's few headline figures. */
  size?: "md" | "lg";
  className?: string;
}

/**
 * Renders a summary stat card: a button when `onClick` is provided, else a div.
 * @param props - Component props.
 * @param props.label - Label under the value.
 * @param props.value - Primary value.
 * @param props.sub - Optional secondary line.
 * @param props.trend - Optional trend graphic under the text.
 * @param props.tone - Accent tone for the value.
 * @param props.href - When set, the card renders as a link.
 * @param props.onClick - Click handler; when set (and no href) the card renders as a button.
 * @param props.active - Marks the card as the active filter.
 * @param props.size - "md" for dense rows, "lg" for headline figures.
 * @param props.className - Extra classes.
 * @returns The stat card element.
 */
export function StatCard({
  label,
  value,
  sub,
  trend,
  tone = "default",
  href,
  onClick,
  active = false,
  size = "md",
  className,
}: StatCardProps): React.ReactElement {
  const lg = size === "lg";
  const base = cn(
    "rounded-lg border border-admin-border bg-admin-surface text-left",
    lg ? "p-4 sm:px-5" : "px-4 py-3.5",
    // Inset, so the ring stays inside the card when it sits in a StatStrip.
    active && "ring-2 ring-russian-violet ring-inset",
    className,
  );
  // select-none unifies the link and button forms: clickable cards act as
  // controls, so neither should offer text selection (the static div still does).
  const interactive = "select-none transition-colors hover:bg-admin-bg";
  const content = (
    <>
      <p className="text-sm font-medium text-admin-muted">{label}</p>
      <p
        className={cn(
          "mt-0.5 leading-tight font-semibold tracking-tight tabular-nums",
          lg ? "text-[1.625rem] sm:text-[1.875rem]" : "text-2xl",
          valueToneClass(tone),
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-sm text-admin-muted">{sub}</p>}
      {trend}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cn(base, "block", interactive)}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(base, interactive)}
      >
        {content}
      </button>
    );
  }

  return <div className={base}>{content}</div>;
}
