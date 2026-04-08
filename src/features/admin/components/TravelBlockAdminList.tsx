"use client";
// src/features/admin/components/TravelBlockAdminList.tsx
/**
 * @file TravelBlockAdminList.tsx
 * @description Read-only admin view of travel time blocks computed for calendar events,
 * with per-event transport mode selector and custom origin override.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";

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
  createdAt: string;
}

type TransportMode = "transit" | "driving" | "walking" | "bicycling";

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
 * @returns Formatted string like "21 min → 30 min blocked".
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
  const fmt = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${fmt.format(new Date(start))} \u2013 ${new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(end))}`;
}

interface TravelBlockAdminListProps {
  blocks: TravelBlockRow[];
  /** Map of raw calendar ID to a friendly display name */
  calendarLabels?: Record<string, string>;
  /** Admin token for API calls */
  token: string;
}

/**
 * Admin list of travel blocks with per-event transport mode selector and origin override.
 * @param props - Component props.
 * @param props.blocks - Travel block rows.
 * @param props.calendarLabels - Map of raw calendar ID to a friendly display name.
 * @param props.token - Admin token for API calls.
 * @returns Travel block list element.
 */
export function TravelBlockAdminList({
  blocks: initial,
  calendarLabels = {},
  token,
}: TravelBlockAdminListProps): React.ReactElement {
  const [blocks, setBlocks] = useState<TravelBlockRow[]>(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [editingOriginId, setEditingOriginId] = useState<string | null>(null);
  const [originInput, setOriginInput] = useState<string>("");

  /**
   * Updates the transport mode for a block and clears stale travel minutes locally.
   * @param id - TravelBlock id.
   * @param mode - New transport mode.
   */
  async function setMode(id: string, mode: TransportMode): Promise<void> {
    setSaving(id);
    try {
      const res = await fetch(`/api/admin/travel/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-secret": token },
        body: JSON.stringify({ transportMode: mode }),
      });
      if (!res.ok) return;
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                transportMode: mode,
                rawTravelMinutes: null,
                roundedMinutes: null,
                rawTravelBackMinutes: null,
                roundedBackMinutes: null,
              }
            : b,
        ),
      );
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
    try {
      const res = await fetch(`/api/admin/travel/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-secret": token },
        body: JSON.stringify({ customOrigin }),
      });
      if (!res.ok) return;
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
                ...b,
                customOrigin,
                rawTravelMinutes: null,
                roundedMinutes: null,
                rawTravelBackMinutes: null,
                roundedBackMinutes: null,
              }
            : b,
        ),
      );
      setEditingOriginId(null);
    } finally {
      setSaving(null);
    }
  }

  if (blocks.length === 0) {
    return (
      <p className={cn("text-sm text-slate-400")}>
        No travel blocks yet. Run the calendar cache cron to generate them.
      </p>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 gap-3 xl:grid-cols-2")}>
      {blocks.map((b) => {
        const currentMode = (b.transportMode ?? "transit") as TransportMode;
        const isSaving = saving === b.id;
        const isEditingOrigin = editingOriginId === b.id;
        const effectiveOrigin = b.customOrigin ?? b.detectedOrigin ?? null;

        return (
          <div key={b.id} className={cn("rounded-xl border border-slate-200 bg-white/50 p-4")}>
            <div className={cn("flex flex-col gap-2")}>
              {/* Header: event identity */}
              <div className={cn("flex min-w-0 flex-wrap items-center gap-2")}>
                <span className={cn("text-russian-violet min-w-0 truncate text-sm font-semibold")}>
                  {b.summary ?? b.sourceEventId}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-400",
                  )}
                >
                  {calendarLabels[b.calendarEmail] ?? b.calendarEmail}
                </span>
              </div>

              {/* Event time */}
              <p className={cn("text-xs text-slate-600")}>
                {formatEventTime(b.eventStartAt, b.eventEndAt)}
              </p>

              {/* Transport mode selector */}
              <div>
                <p
                  className={cn("mb-1 text-xs font-medium uppercase tracking-wide text-slate-400")}
                >
                  How I&apos;m getting there
                </p>
                <div className={cn("flex flex-wrap gap-1")}>
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      disabled={isSaving}
                      onClick={() => void setMode(b.id, m.value)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                        currentMode === m.value
                          ? "bg-russian-violet text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                      )}
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>
                {(b.rawTravelMinutes === null || b.rawTravelBackMinutes === null) &&
                  b.transportMode !== null && (
                    <p className={cn("mt-1 text-xs text-amber-500")}>
                      Mode changed — recalculate to update travel times
                    </p>
                  )}
              </div>

              {/* Origin */}
              <div>
                <p
                  className={cn("mb-1 text-xs font-medium uppercase tracking-wide text-slate-400")}
                >
                  Departing from
                </p>
                {isEditingOrigin ? (
                  <div className={cn("flex flex-col gap-1.5")}>
                    <input
                      type="text"
                      value={originInput}
                      onChange={(e) => setOriginInput(e.target.value)}
                      placeholder={b.detectedOrigin ?? "Enter address…"}
                      className={cn(
                        "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-slate-400 focus:outline-none",
                      )}
                      disabled={isSaving}
                    />
                    <div className={cn("flex flex-wrap gap-1")}>
                      <button
                        disabled={isSaving || !originInput.trim()}
                        onClick={() => void saveOrigin(b.id, originInput.trim() || null)}
                        className={cn(
                          "bg-russian-violet rounded-lg px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50",
                        )}
                      >
                        Save
                      </button>
                      <button
                        disabled={isSaving}
                        onClick={() => setEditingOriginId(null)}
                        className={cn(
                          "rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 disabled:opacity-50",
                        )}
                      >
                        Cancel
                      </button>
                      {b.customOrigin && (
                        <button
                          disabled={isSaving}
                          onClick={() => void saveOrigin(b.id, null)}
                          className={cn(
                            "rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-100 disabled:opacity-50",
                          )}
                        >
                          Clear override
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={cn("flex items-center gap-2")}>
                    <span className={cn("text-xs text-slate-700")}>
                      {effectiveOrigin ?? "Home (default)"}
                    </span>
                    {b.customOrigin ? (
                      <span
                        className={cn(
                          "rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600",
                        )}
                      >
                        override
                      </span>
                    ) : b.detectedOrigin ? (
                      <span
                        className={cn("rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-400")}
                      >
                        auto
                      </span>
                    ) : null}
                    <button
                      disabled={isSaving}
                      onClick={() => {
                        setEditingOriginId(b.id);
                        setOriginInput(b.customOrigin ?? "");
                      }}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50",
                      )}
                    >
                      Edit
                    </button>
                  </div>
                )}
                {(b.rawTravelMinutes === null || b.rawTravelBackMinutes === null) &&
                  b.customOrigin !== null && (
                    <p className={cn("mt-1 text-xs text-amber-500")}>
                      Origin changed — recalculate to update travel times
                    </p>
                  )}
              </div>

              {/* Travel times grid */}
              <div className={cn("grid gap-2 sm:grid-cols-2")}>
                <div>
                  <p
                    className={cn(
                      "mb-0.5 text-xs font-medium uppercase tracking-wide text-slate-400",
                    )}
                  >
                    Travel there
                  </p>
                  <p className={cn("text-sm text-slate-700")}>
                    {formatMinutes(b.rawTravelMinutes, b.roundedMinutes)}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      !b.beforeExpiresAt || new Date(b.beforeExpiresAt) < new Date()
                        ? "text-red-500"
                        : "text-slate-400",
                    )}
                  >
                    {formatExpiry(b.beforeExpiresAt)}
                  </p>
                </div>
                <div>
                  <p
                    className={cn(
                      "mb-0.5 text-xs font-medium uppercase tracking-wide text-slate-400",
                    )}
                  >
                    Travel back
                  </p>
                  <p className={cn("text-sm text-slate-700")}>
                    {formatMinutes(b.rawTravelBackMinutes, b.roundedBackMinutes)}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      !b.afterExpiresAt || new Date(b.afterExpiresAt) < new Date()
                        ? "text-red-500"
                        : "text-slate-400",
                    )}
                  >
                    {formatExpiry(b.afterExpiresAt)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
