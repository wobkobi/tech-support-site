"use client";
// src/features/admin/components/dashboard/RunningJobPanel.tsx
// Phone dashboard card for the job you're at now: when it's due to end, and one tap to add
// 15, 30 or 60 minutes when it's running over.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useToast } from "@/features/admin/components/ui/Toast";
import { nzTimeLabel } from "@/features/calendar/lib/running-late";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

const CHOICES = [15, 30, 60];

/**
 * Running now card.
 * @param props - Component props.
 * @param props.source - Whether the job is a booking or a calendar-only job.
 * @param props.jobKey - Booking id, or the calendar event id.
 * @param props.name - Customer name or event title.
 * @param props.endAt - Current end (ISO).
 * @param props.pastEnd - Whether the end has already passed when the page loaded.
 * @param props.className - Extra classes for the panel.
 * @returns Card element.
 */
export function RunningJobPanel({
  source,
  jobKey,
  name,
  endAt,
  pastEnd,
  className,
}: {
  source: "booking" | "calendar";
  jobKey: string;
  name: string;
  endAt: string;
  pastEnd: boolean;
  className?: string;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const endMs = new Date(endAt).getTime();

  /**
   * Adds minutes to the job's end, then reloads the dashboard.
   * @param minutes - Minutes to add.
   */
  async function extend(minutes: number): Promise<void> {
    setBusy(minutes);
    try {
      const res = await fetch("/api/admin/jobs/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, key: jobKey, minutes }),
      });
      const data = (await res.json().catch(() => ({}))) as { endAt?: string; error?: string };
      if (!res.ok || !data.endAt) {
        toast(data.error ?? "Couldn't add the time. Try again.", { tone: "error" });
        return;
      }
      toast(`${name} now ends at ${nzTimeLabel(new Date(data.endAt).getTime())}.`);
      router.refresh();
    } catch {
      toast("Couldn't reach the site. Check your connection.", { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <DashboardPanel title="Running now" empty="" className={className}>
      <div className="px-4 py-4 sm:px-5">
        <p className="text-lg font-semibold wrap-break-word text-admin-text">{name}</p>
        <p className="text-admin-text-secondary">
          {pastEnd ? "Was due to end" : "Ends"} at {nzTimeLabel(endMs)}
        </p>
        <p className="mt-3 text-sm font-semibold text-admin-text">Running over? Add</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {CHOICES.map((m) => (
            <AdminButton
              key={m}
              variant="secondary"
              className="h-12 w-full text-base"
              busy={busy === m}
              disabled={busy !== null}
              onClick={() => void extend(m)}
            >
              +{m} min
            </AdminButton>
          ))}
        </div>
      </div>
    </DashboardPanel>
  );
}
