"use client";
// src/features/admin/components/TravelBlockAdminList.tsx
/**
 * @file TravelBlockAdminList.tsx
 * @description Read-only admin view of travel time blocks computed for calendar events.
 */

import type React from "react";
import { cn } from "@/shared/lib/cn";

export interface TravelBlockRow {
  id: string;
  sourceEventId: string;
  calendarEmail: string;
  summary: string | null;
  eventStartAt: string | null;
  eventEndAt: string | null;
  rawTravelMinutes: number | null;
  roundedMinutes: number | null;
  rawTravelBackMinutes: number | null;
  roundedBackMinutes: number | null;
  beforeEventId: string | null;
  afterEventId: string | null;
  beforeExpiresAt: string | null;
  afterExpiresAt: string | null;
  createdAt: string;
}

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
function formatEventTime(start: string | null, end: string | null): string {
  if (!start || !end) return "\u2013";
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
}

/**
 * Admin read-only list of travel blocks for calendar events.
 * @param props - Component props.
 * @param props.blocks - Travel block rows.
 * @returns Travel block list element.
 */
export function TravelBlockAdminList({ blocks }: TravelBlockAdminListProps): React.ReactElement {
  if (blocks.length === 0) {
    return (
      <p className="text-rich-black/40 text-sm">
        No travel blocks yet. Run the calendar cache cron to generate them.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((b) => (
        <div key={b.id} className="border-seasalt-400/30 rounded-xl border bg-white/50 p-4">
          <div className="flex flex-col gap-2">
            {/* Header: event identity */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-russian-violet text-sm font-semibold">
                {b.summary ?? b.sourceEventId}
              </span>
              <span className="text-rich-black/40 bg-seasalt-400/30 rounded px-1.5 py-0.5 text-xs">
                {b.calendarEmail}
              </span>
            </div>

            {/* Event time */}
            <p className="text-rich-black/60 text-xs">
              {formatEventTime(b.eventStartAt, b.eventEndAt)}
            </p>

            {/* Travel times grid */}
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-rich-black/40 mb-0.5 text-xs font-medium uppercase tracking-wide">
                  Travel there
                </p>
                <p className="text-rich-black/80 text-sm">
                  {formatMinutes(b.rawTravelMinutes, b.roundedMinutes)}
                </p>
                <p
                  className={cn(
                    "text-xs",
                    !b.beforeExpiresAt || new Date(b.beforeExpiresAt) < new Date()
                      ? "text-red-500"
                      : "text-rich-black/40",
                  )}
                >
                  {formatExpiry(b.beforeExpiresAt)}
                </p>
              </div>
              <div>
                <p className="text-rich-black/40 mb-0.5 text-xs font-medium uppercase tracking-wide">
                  Travel back
                </p>
                <p className="text-rich-black/80 text-sm">
                  {formatMinutes(b.rawTravelBackMinutes, b.roundedBackMinutes)}
                </p>
                <p
                  className={cn(
                    "text-xs",
                    !b.afterExpiresAt || new Date(b.afterExpiresAt) < new Date()
                      ? "text-red-500"
                      : "text-rich-black/40",
                  )}
                >
                  {formatExpiry(b.afterExpiresAt)}
                </p>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
