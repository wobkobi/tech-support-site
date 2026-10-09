"use client";
// src/features/business/components/calculator/PhoneTotalBar.tsx
// Sticky running-total bar for phones, with a jump down to the client and save buttons.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { formatNZD } from "@/features/business/lib/business";
import { cn } from "@/shared/lib/cn";
import type React from "react";

interface Props {
  show: boolean;
  total: number;
  onJumpToFinish: () => void;
}

/**
 * Phone total bar. Below lg the invoice preview, and the total in it, sits
 * under every section, so the running figure stays pinned here while the job
 * is built. It stays hidden until the job has a total, so an empty calculator
 * isn't topped by a $0.00 bar.
 * @param props - Component props.
 * @param props.show - Whether the bar is pinned (hidden otherwise).
 * @param props.total - Job total after discounts.
 * @param props.onJumpToFinish - Scrolls to the client and save buttons.
 * @returns Phone total bar element.
 */
export function PhoneTotalBar({ show, total, onJumpToFinish }: Props): React.ReactElement {
  return (
    <div
      data-phone-bar={show ? "sticky" : undefined}
      className={cn(
        "sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-admin-border bg-admin-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:-mx-6 sm:px-6 lg:hidden",
        !show && "hidden",
      )}
    >
      <p className="text-sm text-admin-text-secondary">
        Total <span className="text-lg font-bold text-russian-violet">{formatNZD(total)}</span>
      </p>
      <AdminButton variant="outline" onClick={onJumpToFinish}>
        Client &amp; save
      </AdminButton>
    </div>
  );
}
