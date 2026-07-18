// src/features/admin/components/ui/StatCard.tsx
/**
 * @description Summary stat card used by every upgraded admin list (invoices,
 * ledger, bookings, reviews). Renders a plain surface, a link when `href` is
 * given (navigates), or a button when `onClick` is given (applies a filter).
 * Server-safe without `onClick` (the link and plain forms render anywhere).
 * Follows the dashboard stat-card pattern (bold value + muted label + optional sub).
 */

import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

/** Accent tone for the stat value. */
export type StatTone = "default" | "success" | "warning" | "critical" | "violet";

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
      return "text-emerald-600";
    case "warning":
      return "text-amber-600";
    case "critical":
      return "text-coquelicot-400";
    case "violet":
      return "text-russian-violet";
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
  /** Accent tone for the value. */
  tone?: StatTone;
  /** When set, the card renders as a link to this URL. Takes precedence over onClick. */
  href?: string;
  /** When set (and no href), the card renders as a button (e.g. to apply a filter). */
  onClick?: () => void;
  /** Marks the card as the active filter (adds a ring). */
  active?: boolean;
  className?: string;
}

/**
 * Renders a summary stat card: a button when `onClick` is provided, else a div.
 * @param props - Component props.
 * @param props.label - Label under the value.
 * @param props.value - Primary value.
 * @param props.sub - Optional secondary line.
 * @param props.tone - Accent tone for the value.
 * @param props.href - When set, the card renders as a link.
 * @param props.onClick - Click handler; when set (and no href) the card renders as a button.
 * @param props.active - Marks the card as the active filter.
 * @param props.className - Extra classes.
 * @returns The stat card element.
 */
export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  href,
  onClick,
  active = false,
  className,
}: StatCardProps): React.ReactElement {
  const base = cn(
    "rounded-xl border bg-admin-surface px-4 py-4 text-left shadow-sm",
    active ? "border-russian-violet ring-1 ring-russian-violet" : "border-admin-border",
    className,
  );
  const interactive =
    "transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet";
  const content = (
    <>
      <p className={cn("text-xl font-extrabold", valueToneClass(tone))}>{value}</p>
      <p className="mt-0.5 text-xs text-admin-muted">{label}</p>
      {sub && <p className="mt-1 text-xs text-admin-faint">{sub}</p>}
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
