"use client";
// src/features/admin/components/dashboard/RunningJobPanel.tsx
// Phone dashboard card for the job you're at now: when it's due to end, and one tap to move the
// end to a later quarter-hour mark when it's running over, with an Undo for a mis-tap.

import { DashboardPanel } from "@/features/admin/components/dashboard/DashboardPanel";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { useToast } from "@/features/admin/components/ui/Toast";
import { extendChoices } from "@/features/admin/lib/dashboard-jobs";
import { nzTimeLabel } from "@/features/calendar/lib/running-late";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useState } from "react";

/**
 * Running now card.
 * @param props - Component props.
 * @param props.source - Whether the job is a booking or a calendar-only job.
 * @param props.jobKey - Booking id, or the calendar event id.
 * @param props.name - Customer name or event title.
 * @param props.endAt - Current end (ISO).
 * @param props.renderedAt - When the page was rendered (ISO), the first "now" for the choices.
 * @param props.className - Extra classes for the panel.
 * @returns Card element.
 */
export function RunningJobPanel({
  source,
  jobKey,
  name,
  endAt,
  renderedAt,
  className,
}: {
  source: "booking" | "calendar";
  jobKey: string;
  name: string;
  endAt: string;
  renderedAt: string;
  className?: string;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  // The end from before the last tap (ISO), so Undo can put it back; null once undone.
  const [undoEnd, setUndoEnd] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  // Starts at the server's time so the first render matches; then follows the clock, so a card
  // left open never offers an end that has already passed.
  const [nowMs, setNowMs] = useState(() => new Date(renderedAt).getTime());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const endMs = new Date(endAt).getTime();
  const choices = extendChoices(endMs, nowMs);

  /**
   * Sends a new end to the server, then reloads the dashboard.
   * @param target - The new end.
   * @param undo - Whether this puts back the end from before the last tap.
   * @returns The saved end (ISO), or null when it failed (already reported).
   */
  async function saveEnd(target: Date, undo: boolean): Promise<string | null> {
    try {
      const res = await fetch("/api/admin/jobs/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, key: jobKey, endAt: target.toISOString(), undo }),
      });
      const data = (await res.json().catch(() => ({}))) as { endAt?: string; error?: string };
      if (!res.ok || !data.endAt) {
        toast(data.error ?? "Couldn't change the end time. Try again.", { tone: "error" });
        return null;
      }
      toast(`${name} now ends at ${nzTimeLabel(new Date(data.endAt).getTime())}.`);
      router.refresh();
      return data.endAt;
    } catch {
      toast("Couldn't reach the site. Check your connection.", { tone: "error" });
      return null;
    }
  }

  /**
   * Moves the end later and keeps the old one for Undo.
   * @param targetMs - The new end (ms).
   */
  async function extend(targetMs: number): Promise<void> {
    setBusy(targetMs);
    const previous = endAt;
    if (await saveEnd(new Date(targetMs), false)) setUndoEnd(previous);
    setBusy(null);
  }

  /** Puts back the end from before the last tap. */
  async function undoExtend(): Promise<void> {
    if (!undoEnd) return;
    setUndoing(true);
    if (await saveEnd(new Date(undoEnd), true)) setUndoEnd(null);
    setUndoing(false);
  }

  return (
    <DashboardPanel title="Running now" empty="" className={className}>
      <div className="px-4 py-4 sm:px-5">
        <p className="text-lg font-semibold wrap-break-word text-admin-text">{name}</p>
        <p className="text-admin-text-secondary">
          {endMs < nowMs ? "Was due to end" : "Ends"} at {nzTimeLabel(endMs)}
        </p>
        {undoEnd && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-admin-text-secondary">
            <span>Moved from {nzTimeLabel(new Date(undoEnd).getTime())}.</span>
            <AdminButton
              variant="ghost"
              size="sm"
              busy={undoing}
              disabled={busy !== null || undoing}
              onClick={() => void undoExtend()}
            >
              Undo
            </AdminButton>
          </p>
        )}
        <p className="mt-3 text-sm font-semibold text-admin-text">Running over? Finish at</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {choices.map((ms) => (
            <AdminButton
              key={ms}
              variant="secondary"
              className="h-12 w-full text-base"
              busy={busy === ms}
              disabled={busy !== null || undoing}
              onClick={() => void extend(ms)}
            >
              {nzTimeLabel(ms)}
            </AdminButton>
          ))}
        </div>
      </div>
    </DashboardPanel>
  );
}
