"use client";
// src/features/admin/components/TravelBlockAdminList.tsx
/**
 * @description Read-only admin view of travel time blocks computed for calendar events,
 * with per-event transport mode selector and custom origin override.
 */

import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import type React from "react";
import { useEffect, useState } from "react";

export interface TravelBlockRow {
  id: string;
  sourceEventId: string;
  calendarEmail: string;
  summary: string | null;
  eventStartAt: string;
  eventEndAt: string;
  rawTravelMinutes: number | null;
  roundedMinutes: number | null;
  rawTravelBackMinutes: number | null;
  roundedBackMinutes: number | null;
  beforeEventId: string | null;
  afterEventId: string | null;
  beforeExpiresAt: string | null;
  afterExpiresAt: string | null;
  transportMode: string | null;
  customOrigin: string | null;
  detectedOrigin: string | null;
  destination: string | null;
  /**
   * True when the travel-back cache is intentionally absent because the next
   * event was chained (no time to go home in between).
   */
  travelBackSuppressed: boolean;
  /** True when admin has marked this Car event as "I have the car that day". */
  ignored: boolean;
  /** True when the source event lives on the Car calendar. */
  isCarEvent: boolean;
  createdAt: string;
}

type TransportMode = "transit" | "driving" | "walking" | "bicycling";

/** Minutes returned by the travel PATCH route after its immediate reprice. */
interface TravelPatchResponse {
  ok?: boolean;
  travel?: {
    rawTravelMinutes: number | null;
    roundedMinutes: number | null;
    rawTravelBackMinutes: number | null;
    roundedBackMinutes: number | null;
  } | null;
}

const MODES: { value: TransportMode; label: string; icon: string }[] = [
  { value: "transit", label: "Transit", icon: "🚌" },
  { value: "driving", label: "Driving", icon: "🚗" },
  { value: "walking", label: "Walking", icon: "🚶" },
  { value: "bicycling", label: "Cycling", icon: "🚲" },
];

/**
 * Formats a minutes value for display.
 * @param raw - Raw minutes from API, or null.
 * @param rounded - Rounded minutes used for blocking, or null.
 * @returns Formatted string like "21 min > 30 min blocked".
 */
function formatMinutes(raw: number | null, rounded: number | null): string {
  if (raw === null) return "\u2013";
  return `${raw} min \u2192 ${rounded ?? "?"} min blocked`;
}

/**
 * Formats an expiry time as "expires in X min" or "expired" or "no cache entry".
 * @param expiresAt - ISO expiry string or null.
 * @returns Human-readable expiry string.
 */
function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "no cache entry";
  const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 60000);
  if (diff <= 0) return "expired";
  return `expires in ${diff} min`;
}

/**
 * Formats a UTC ISO date range as NZ local time.
 * @param start - ISO start string or null.
 * @param end - ISO end string or null.
 * @returns Formatted time range string.
 */
function formatEventTime(start: string, end: string): string {
  // Start uses the canonical "Mon 11 May, 2:30 pm" formatter; the end is
  // time-only (no canonical formatter for that) so it stays inline.
  const endTime = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(end));
  return `${formatDateTimeShort(start)} \u2013 ${endTime}`;
}

interface TravelBlockAdminListProps {
  blocks: TravelBlockRow[];
  /** Map of raw calendar ID to a friendly display name */
  calendarLabels?: Record<string, string>;
}

/**
 * Admin list of travel blocks with per-event transport mode selector and origin override.
 * @param props - Component props.
 * @param props.blocks - Travel block rows.
 * @param props.calendarLabels - Map of raw calendar ID to a friendly display name.
 * @returns Travel block list element.
 */
export function TravelBlockAdminList({
  blocks: initial,
  calendarLabels = {},
}: TravelBlockAdminListProps): React.ReactElement {
  const [blocks, setBlocks] = useState<TravelBlockRow[]>(initial);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBlocks(initial);
  }, [initial]);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingOriginId, setEditingOriginId] = useState<string | null>(null);
  const [originInput, setOriginInput] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Updates the transport mode for a block and clears stale travel minutes locally.
   * @param id - TravelBlock id.
   * @param mode - New transport mode.
   */
  async function setMode(id: string, mode: TransportMode): Promise<void> {
    setSaving(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/travel/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transportMode: mode }),
      });
      if (!res.ok) {
        setActionError("Couldn't update the transport mode - try again.");
        return;
      }
      // The route reprices immediately and returns the fresh minutes; apply them
      // so the card updates without a reload (null legs mean the API had none).
      const t = ((await res.json()) as TravelPatchResponse).travel ?? null;
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                transportMode: mode,
                rawTravelMinutes: t?.rawTravelMinutes ?? null,
                roundedMinutes: t?.roundedMinutes ?? null,
                rawTravelBackMinutes: t?.rawTravelBackMinutes ?? null,
                roundedBackMinutes: t?.roundedBackMinutes ?? null,
              }
            : b,
        ),
      );
    } catch {
      setActionError("Network error - the change wasn't saved.");
    } finally {
      setSaving(null);
    }
  }

  /**
   * Toggles the "ignored" flag on a Car-cal event so the booking page stops
   * treating it as a no-car window and the travel-to-home block is dropped.
   * @param id - TravelBlock id.
   * @param next - Desired ignored state.
   */
  async function setIgnored(id: string, next: boolean): Promise<void> {
    setSaving(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/travel/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ignored: next }),
      });
      if (!res.ok) {
        setActionError("Couldn't update the ignore flag - try again.");
        return;
      }
      setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ignored: next } : b)));
    } catch {
      setActionError("Network error - the change wasn't saved.");
    } finally {
      setSaving(null);
    }
  }

  /**
   * Saves a custom origin override (or clears it when null).
   * @param id - TravelBlock id.
   * @param customOrigin - New origin address, or null to clear.
   */
  async function saveOrigin(id: string, customOrigin: string | null): Promise<void> {
    setSaving(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/travel/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customOrigin }),
      });
      if (!res.ok) {
        setActionError("Couldn't save the origin - try again.");
        return;
      }
      // Apply the freshly repriced minutes the route returns for the new origin.
      const t = ((await res.json()) as TravelPatchResponse).travel ?? null;
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                customOrigin,
                rawTravelMinutes: t?.rawTravelMinutes ?? null,
                roundedMinutes: t?.roundedMinutes ?? null,
                rawTravelBackMinutes: t?.rawTravelBackMinutes ?? null,
                roundedBackMinutes: t?.roundedBackMinutes ?? null,
              }
            : b,
        ),
      );
      setEditingOriginId(null);
    } catch {
      setActionError("Network error - the change wasn't saved.");
    } finally {
      setSaving(null);
    }
  }

  if (blocks.length === 0) {
    return (
      <p className="text-sm text-admin-faint">
        No travel blocks yet. Run the calendar cache cron to generate them.
      </p>
    );
  }

  return (
    <>
      {actionError && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800"
        >
          {actionError}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {blocks.map((b) => {
          const currentMode = (b.transportMode ?? "driving") as TransportMode;
          const isSaving = saving === b.id;
          const isEditingOrigin = editingOriginId === b.id;
          const effectiveOrigin = b.customOrigin ?? b.detectedOrigin ?? null;
          // Past jobs have no live cache and the cron won't revisit them, so the
          // cache-expiry and "recalculate" hints below are noise - hide them. A
          // finished job is past by a wide margin, so this stays stable across
          // SSR + hydration (unlike the sub-minute expiry text it gates).
          const isPast = new Date(b.eventEndAt) < new Date();

          return (
            <div
              key={b.id}
              className={cn(
                "rounded-xl border border-admin-border p-4",
                b.ignored ? "bg-admin-bg/60 opacity-70" : "bg-admin-surface/50",
              )}
            >
              <div className="flex flex-col gap-2">
                {/* Header: event identity */}
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-russian-violet">
                    {b.summary ?? b.sourceEventId}
                  </span>
                  <span className="shrink-0 rounded bg-admin-bg px-1.5 py-0.5 text-xs text-admin-faint">
                    {calendarLabels[b.calendarEmail] ?? b.calendarEmail}
                  </span>
                  {b.ignored && (
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                      Ignored - I have the car
                    </span>
                  )}
                  {b.isCarEvent && (
                    <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-admin-text-secondary">
                      <input
                        type="checkbox"
                        checked={b.ignored}
                        disabled={isSaving}
                        onChange={(e) => void setIgnored(b.id, e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      Ignore (I have the car)
                    </label>
                  )}
                </div>

                {/* Event time */}
                <p className="text-xs text-admin-text-secondary">
                  {formatEventTime(b.eventStartAt, b.eventEndAt)}
                </p>

                {/* Destination address - wrap long unbroken strings on mobile. */}
                {b.destination && (
                  <p className="text-xs wrap-break-word text-admin-muted">
                    <span className="font-medium text-admin-faint">To: </span>
                    {b.destination}
                  </p>
                )}

                {/* Transport mode selector */}
                <div>
                  <p className="mb-1 text-xs font-medium tracking-wide text-admin-faint uppercase">
                    How I'm getting there
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {MODES.map((m) => (
                      <button
                        key={m.value}
                        disabled={isSaving}
                        onClick={() => void setMode(b.id, m.value)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                          currentMode === m.value
                            ? "bg-russian-violet text-white"
                            : "bg-admin-bg text-admin-muted hover:bg-admin-border",
                        )}
                      >
                        {m.icon} {m.label}
                      </button>
                    ))}
                  </div>
                  {!isPast &&
                    (b.rawTravelMinutes === null || b.rawTravelBackMinutes === null) &&
                    b.transportMode !== null && (
                      <p className="mt-1 text-xs text-amber-500">
                        Mode changed - recalculate to update travel times
                      </p>
                    )}
                </div>

                {/* Origin */}
                <div>
                  <p className="mb-1 text-xs font-medium tracking-wide text-admin-faint uppercase">
                    Departing from
                  </p>
                  {isEditingOrigin ? (
                    <div className="flex flex-col gap-1.5">
                      <input
                        type="text"
                        value={originInput}
                        autoComplete="off"
                        onChange={(e) => setOriginInput(e.target.value)}
                        placeholder={b.detectedOrigin ?? "Enter address…"}
                        className="w-full rounded-lg border border-admin-border-strong px-2.5 py-1.5 text-xs focus:border-russian-violet focus:outline-none"
                        disabled={isSaving}
                      />
                      <div className="flex flex-wrap gap-1">
                        <button
                          disabled={isSaving || !originInput.trim()}
                          onClick={() => void saveOrigin(b.id, originInput.trim() || null)}
                          className="rounded-lg bg-russian-violet px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          disabled={isSaving}
                          onClick={() => setEditingOriginId(null)}
                          className="rounded-lg bg-admin-bg px-2.5 py-1 text-xs font-medium text-admin-muted hover:bg-admin-border disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        {b.customOrigin && (
                          <button
                            disabled={isSaving}
                            onClick={() => void saveOrigin(b.id, null)}
                            className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-100 disabled:opacity-50"
                          >
                            Clear override
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-admin-text">
                        {effectiveOrigin ?? "Home (default)"}
                      </span>
                      {b.customOrigin ? (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600">
                          override
                        </span>
                      ) : b.detectedOrigin ? (
                        <span className="rounded bg-admin-bg px-1.5 py-0.5 text-xs text-admin-faint">
                          auto
                        </span>
                      ) : null}
                      <button
                        disabled={isSaving}
                        onClick={() => {
                          setEditingOriginId(b.id);
                          setOriginInput(b.customOrigin ?? "");
                        }}
                        className="rounded px-1.5 py-0.5 text-xs text-admin-faint hover:bg-admin-bg hover:text-admin-text-secondary disabled:opacity-50"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                  {!isPast &&
                    (b.rawTravelMinutes === null || b.rawTravelBackMinutes === null) &&
                    b.customOrigin !== null && (
                      <p className="mt-1 text-xs text-amber-500">
                        Origin changed - recalculate to update travel times
                      </p>
                    )}
                </div>

                {/* Travel times grid */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="mb-0.5 text-xs font-medium tracking-wide text-admin-faint uppercase">
                      Travel there
                    </p>
                    <p className="text-sm text-admin-text">
                      {formatMinutes(b.rawTravelMinutes, b.roundedMinutes)}
                    </p>
                    {!isPast && (
                      <p
                        className={cn(
                          "text-xs",
                          !b.beforeExpiresAt || new Date(b.beforeExpiresAt) < new Date()
                            ? "text-red-500"
                            : "text-admin-faint",
                        )}
                        suppressHydrationWarning
                      >
                        {formatExpiry(b.beforeExpiresAt)}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="mb-0.5 text-xs font-medium tracking-wide text-admin-faint uppercase">
                      Travel back
                    </p>
                    <p className="text-sm text-admin-text">
                      {b.travelBackSuppressed
                        ? "chained to next event"
                        : formatMinutes(b.rawTravelBackMinutes, b.roundedBackMinutes)}
                    </p>
                    {b.travelBackSuppressed ? (
                      <p className="text-xs text-admin-faint">
                        no return trip - suppressed by design
                      </p>
                    ) : !isPast ? (
                      <p
                        className={cn(
                          "text-xs",
                          !b.afterExpiresAt || new Date(b.afterExpiresAt) < new Date()
                            ? "text-red-500"
                            : "text-admin-faint",
                        )}
                        suppressHydrationWarning
                      >
                        {formatExpiry(b.afterExpiresAt)}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
