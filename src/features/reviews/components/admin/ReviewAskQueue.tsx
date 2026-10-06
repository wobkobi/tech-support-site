"use client";
// src/features/reviews/components/admin/ReviewAskQueue.tsx
// The "Review asks" card on the admin reviews page: invoices whose automatic review ask
// is still to come (with a warning when it's going to be skipped), and what happened to
// the asks decided in the last two weeks. Skip and Send now act on one invoice.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useToast } from "@/features/admin/components/ui/Toast";
import { apiFetch } from "@/shared/lib/api-client";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** One invoice whose ask is still to come. */
export interface UpcomingReviewAsk {
  invoiceId: string;
  number: string;
  name: string;
  /** "Due 8 Oct 2026", or "Goes out at the next run". */
  when: string;
  /** Why it will be skipped if nothing changes, or null. */
  warning: string | null;
}

/** One ask decided recently. */
export interface RecentReviewAsk {
  invoiceId: string;
  number: string;
  name: string;
  outcome: "sending" | "sent" | "skipped" | "cancelled" | "failed";
  /** Reason or failure text. */
  detail: string | null;
  /** "6 Oct 2026". */
  date: string;
}

const OUTCOME_LABEL: Record<RecentReviewAsk["outcome"], string> = {
  sending: "Sending",
  sent: "Sent",
  skipped: "Skipped",
  cancelled: "Cancelled",
  failed: "Failed",
};

/**
 * Upcoming and recent review asks with Skip / Send now.
 * @param props - Component props.
 * @param props.enabled - Whether automatic asks are switched on.
 * @param props.upcoming - Asks still to come, soonest first.
 * @param props.recent - Asks decided in the last two weeks, newest first.
 * @returns Card body element.
 */
export function ReviewAskQueue({
  enabled,
  upcoming,
  recent,
}: {
  enabled: boolean;
  upcoming: UpcomingReviewAsk[];
  recent: RecentReviewAsk[];
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * Skips or sends one invoice's ask, then refreshes the lists.
   * @param invoiceId - Invoice id.
   * @param action - Which route to call.
   */
  async function act(invoiceId: string, action: "skip" | "send"): Promise<void> {
    setBusy(`${invoiceId}:${action}`);
    const res = await apiFetch(`/api/admin/review-asks/${invoiceId}/${action}`, {
      method: "POST",
    });
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    toast(action === "send" ? "Review ask sent." : "Review ask skipped.", { tone: "success" });
    router.refresh();
  }

  /**
   * Skip and Send now buttons for one row.
   * @param invoiceId - Invoice id.
   * @param showSkip - Whether Skip applies to this row.
   * @returns Button group.
   */
  function actions(invoiceId: string, showSkip: boolean): React.ReactElement {
    return (
      <div className="flex shrink-0 gap-1.5">
        {showSkip && (
          <AdminButton
            size="xs"
            variant="ghost"
            busy={busy === `${invoiceId}:skip`}
            disabled={busy !== null}
            onClick={() => void act(invoiceId, "skip")}
          >
            Skip
          </AdminButton>
        )}
        <AdminButton
          size="xs"
          variant="secondary"
          busy={busy === `${invoiceId}:send`}
          disabled={busy !== null}
          onClick={() => void act(invoiceId, "send")}
        >
          Send now
        </AdminButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="mb-2 text-xs font-semibold text-admin-muted uppercase">Coming up</h3>
        {!enabled ? (
          <p className="text-sm text-admin-muted">
            Automatic review asks are off. Turn them on in Settings &gt; Reviews.
          </p>
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-admin-muted">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-admin-border">
            {upcoming.map((row) => (
              <li key={row.invoiceId} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-admin-text">{row.name}</p>
                  <p className="text-xs text-admin-muted">
                    {row.number} · {row.when}
                  </p>
                  {row.warning && (
                    <p className="text-xs text-coquelicot-700">Will skip: {row.warning}</p>
                  )}
                </div>
                {actions(row.invoiceId, true)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold text-admin-muted uppercase">Last 14 days</h3>
          <ul className="divide-y divide-admin-border">
            {recent.map((row) => (
              <li key={row.invoiceId} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-admin-text">{row.name}</p>
                  <p className="text-xs text-admin-muted">
                    {row.number} · {OUTCOME_LABEL[row.outcome]} {row.date}
                    {row.detail ? ` · ${row.detail}` : ""}
                  </p>
                </div>
                {row.outcome === "failed" && actions(row.invoiceId, true)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
