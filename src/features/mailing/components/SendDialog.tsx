"use client";
// src/features/mailing/components/SendDialog.tsx
// The last step before an email goes out: everyone on the list starts ticked, the
// operator unticks anyone who shouldn't get it, then sends now or picks a time.
// Mirrors the server's quiet-hours rules so the operator sees them before confirming:
// inside quiet hours Send now becomes a send at the end of them (with "Send now anyway"
// beside it), and a scheduled time inside them moves to the end of them.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import type { CampaignRow } from "@/features/mailing/lib/campaign-row";
import type { Recipient } from "@/features/mailing/lib/recipients";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { nextSendTime, type QuietHours } from "@/shared/lib/quiet-hours";
import { fromNzInputValue, toNzInputValue } from "@/shared/lib/timezone-utils";
import React, { useEffect, useMemo, useState } from "react";

/** Send straight away, or hand to the scheduled-send cron. */
export type SendMode = "now" | "schedule";

/** What a footer button does: schedule, send now, or send now inside quiet hours. */
type SubmitKind = "schedule" | "now" | "nowAnyway";

/**
 * Formats an hour of the day as "9pm" / "7am".
 * @param hour - Hour 0-23.
 * @returns Short label.
 */
function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

/**
 * Default time for the schedule picker: the end of quiet hours if it's quiet now,
 * otherwise an hour from now on the hour.
 * @param quiet - Live quiet-hours window.
 * @returns NZ datetime-local value.
 */
function defaultScheduleValue(quiet: QuietHours): string {
  const held = nextSendTime(quiet);
  if (held) return toNzInputValue(held);
  const next = new Date(Date.now() + 60 * 60_000);
  next.setMinutes(0, 0, 0);
  return toNzInputValue(next);
}

/**
 * Send / schedule dialog for one email.
 * @param props - Component props.
 * @param props.open - Whether the dialog is showing.
 * @param props.initialMode - Which button opened it.
 * @param props.campaign - The email being sent.
 * @param props.quiet - Live quiet-hours window.
 * @param props.onClose - Closes without sending.
 * @param props.onDone - Runs after a successful send or schedule.
 * @returns Dialog element.
 */
export function SendDialog({
  open,
  initialMode,
  campaign,
  quiet,
  onClose,
  onDone,
}: {
  open: boolean;
  initialMode: SendMode;
  campaign: CampaignRow;
  quiet: QuietHours;
  onClose: () => void;
  onDone: () => void;
}): React.ReactElement {
  const { toast } = useToast();
  const [mode, setMode] = useState<SendMode>(initialMode);
  const [when, setWhen] = useState(() => defaultScheduleValue(quiet));
  const [subscribed, setSubscribed] = useState<Recipient[] | null>(null);
  const [unsubscribed, setUnsubscribed] = useState<Recipient[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set(campaign.excludedContactIds));
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<SubmitKind | null>(null);

  // Reset to the button that opened it each time it opens.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMode(initialMode);
      setWhen(defaultScheduleValue(quiet));
    }
  }

  // The list is fetched fresh on every open, so someone who unsubscribed a
  // minute ago is already greyed out.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void callApi<{ subscribed: Recipient[]; unsubscribed: Recipient[] }>(
      "/api/admin/mailing/recipients",
    ).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setLoadError(null);
      setSubscribed(res.subscribed);
      setUnsubscribed(res.unsubscribed);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (subscribed ?? []).filter(
        (r) => !q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
      ),
    [subscribed, q],
  );
  const count = (subscribed ?? []).filter((r) => !excluded.has(r.contactId)).length;
  const heldUntil = mode === "now" ? nextSendTime(quiet) : null;
  const scheduledDate = when ? safeParse(when) : null;
  // Where the server will move a scheduled time that falls inside quiet hours.
  const scheduleMovedTo =
    mode === "schedule" && scheduledDate !== null ? nextSendTime(quiet, scheduledDate) : null;

  /**
   * Ticks or unticks one contact.
   * @param id - Contact id.
   * @param on - True to include them.
   */
  function toggle(id: string, on: boolean): void {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Ticks or unticks everyone currently shown by the search.
   * @param on - True to include them.
   */
  function setAllShown(on: boolean): void {
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const r of shown) {
        if (on) next.delete(r.contactId);
        else next.add(r.contactId);
      }
      return next;
    });
  }

  /**
   * Sends or schedules with the current selection.
   * @param kind - Schedule (Send now inside quiet hours schedules for the end of them),
   *   send now, or send now anyway inside quiet hours.
   */
  async function submit(kind: SubmitKind): Promise<void> {
    // Only ids still on the list count; anyone who unsubscribed since is skipped anyway.
    const excludedContactIds = (subscribed ?? [])
      .filter((r) => excluded.has(r.contactId))
      .map((r) => r.contactId);
    if (kind === "schedule") {
      const at = mode === "now" ? heldUntil : (scheduleMovedTo ?? scheduledDate);
      if (!at) {
        toast("Pick a date and time.", { tone: "error" });
        return;
      }
      setBusy(kind);
      const res = await callApi<{ scheduledAt: string }>(
        `/api/admin/mailing/${campaign.id}/schedule`,
        "POST",
        { scheduledAt: at.toISOString(), excludedContactIds },
      );
      setBusy(null);
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return;
      }
      toast(`Scheduled for ${formatDateTimeShort(res.scheduledAt)}.`, { tone: "success" });
    } else {
      setBusy(kind);
      const res = await callApi<{ sent: number; failed: number }>(
        `/api/admin/mailing/${campaign.id}/send`,
        "POST",
        { mode: "now", excludedContactIds, sendDuringQuietHours: kind === "nowAnyway" },
      );
      setBusy(null);
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return;
      }
      toast(
        res.failed > 0
          ? `Sent to ${res.sent}. ${res.failed} didn't go - you can retry them on this page.`
          : `Sent to ${res.sent} ${res.sent === 1 ? "person" : "people"}.`,
        { tone: res.failed > 0 ? "warning" : "success" },
      );
    }
    onDone();
  }

  const people = `${count} ${count === 1 ? "person" : "people"}`;
  const noOne = subscribed === null || count === 0;
  // Inside quiet hours the main button schedules for the end of them.
  const primaryKind: SubmitKind = mode === "now" && !heldUntil ? "now" : "schedule";
  let primaryLabel = `Schedule for ${people}`;
  if (busy === "schedule") primaryLabel = "Scheduling...";
  else if (busy === "now") primaryLabel = "Sending...";
  else if (heldUntil) primaryLabel = `Send at ${formatDateTimeShort(heldUntil)}`;
  else if (mode === "now") primaryLabel = `Send to ${people}`;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={mode === "now" ? "Send this email" : "Schedule this email"}
      description={campaign.subject}
      size="lg"
      footer={
        <>
          <AdminButton variant="secondary" onClick={onClose} disabled={busy !== null}>
            Cancel
          </AdminButton>
          {heldUntil && (
            <AdminButton
              variant="secondary"
              onClick={() => void submit("nowAnyway")}
              busy={busy === "nowAnyway"}
              disabled={noOne || busy !== null}
            >
              {busy === "nowAnyway" ? "Sending..." : "Send now anyway"}
            </AdminButton>
          )}
          <AdminButton
            onClick={() => void submit(primaryKind)}
            busy={busy === primaryKind}
            disabled={noOne || busy !== null}
          >
            {primaryLabel}
          </AdminButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="send-mode"
              checked={mode === "now"}
              onChange={() => setMode("now")}
            />
            Send now
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="send-mode"
              checked={mode === "schedule"}
              onChange={() => setMode("schedule")}
            />
            Send later
          </label>
        </div>

        {heldUntil && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            It&apos;s quiet hours ({hourLabel(quiet.startHour)} to {hourLabel(quiet.endHour)}), so
            it goes to {people} at {formatDateTimeShort(heldUntil)}. Only send now anyway if it
            can&apos;t wait until morning.
          </div>
        )}

        {mode === "schedule" && (
          <label className="flex flex-col gap-1 text-sm font-medium text-admin-text">
            When (NZ time)
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={`${ADMIN_INPUT_CLS} max-w-xs`}
            />
            {scheduleMovedTo && (
              <span className="font-normal text-amber-800">
                That&apos;s inside quiet hours ({hourLabel(quiet.startHour)} to{" "}
                {hourLabel(quiet.endHour)}), so it&apos;ll go at{" "}
                {formatDateTimeShort(scheduleMovedTo)}.
              </span>
            )}
          </label>
        )}

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-admin-text">
              Who gets it{subscribed !== null && ` - ${count} of ${subscribed.length}`}
            </p>
            <div className="flex gap-2">
              <AdminButton size="xs" variant="ghost" onClick={() => setAllShown(true)}>
                Select all
              </AdminButton>
              <AdminButton size="xs" variant="ghost" onClick={() => setAllShown(false)}>
                Select none
              </AdminButton>
            </div>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search recipients"
            className={`${ADMIN_INPUT_CLS} mb-2`}
          />
          {loadError && <p className="text-sm text-red-700">{loadError}</p>}
          {subscribed === null && !loadError && (
            <p className="text-sm text-admin-muted">Loading the list...</p>
          )}
          {subscribed !== null && (
            <ul className="max-h-72 divide-y divide-admin-border overflow-y-auto rounded-lg border border-admin-border">
              {shown.map((r) => (
                <li key={r.contactId} className="px-3 py-2">
                  <AdminCheckbox
                    checked={!excluded.has(r.contactId)}
                    onChange={(on) => toggle(r.contactId, on)}
                    label={`${r.name} - ${r.email}`}
                  />
                </li>
              ))}
              {!q &&
                unsubscribed.map((r) => (
                  <li key={r.contactId} className="px-3 py-2 text-sm text-admin-faint">
                    {r.name} - {r.email} (unsubscribed)
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Reads a datetime-local value as NZ time.
 * @param value - Input value.
 * @returns The instant, or null when the field is incomplete.
 */
function safeParse(value: string): Date | null {
  try {
    const d = fromNzInputValue(value);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}
