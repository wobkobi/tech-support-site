"use client";
// src/features/admin/components/DayAgendaList.tsx
// Timed-events list of the mobile day agenda: event cards, "free" gap rows between
// bookings and the current-time marker. Booking cards expand on tap and report long-presses
// back to DayAgendaView, which owns the expand and action-sheet state.

import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import {
  KIND_BAR_BG,
  formatTimeRange,
  type BookingStatus,
  type WeekEvent,
} from "@/features/admin/lib/schedule-types";
import { parseBookingNotes } from "@/features/booking/lib/booking";
import { cn } from "@/shared/lib/cn";
import { NZ_TZ } from "@/shared/lib/timezone-utils";
import type React from "react";

/** One row of the agenda: an event card, a free-time gap, or the now marker. */
export type AgendaItem =
  | { type: "event"; ev: WeekEvent }
  | { type: "gap"; minutes: number }
  | { type: "now"; atMs: number };

/** StatusPill tone per booking status, as on the bookings list. */
const BOOKING_STATUS_TONE: Record<BookingStatus, StatusTone> = {
  confirmed: "info",
  held: "warning",
  completed: "success",
  cancelled: "critical",
};

/** Classes for the call / email / maps links on an expanded card. */
const CARD_LINK_CLS =
  "inline-flex h-10 items-center gap-1.5 rounded-md bg-russian-violet/10 px-3 text-sm font-semibold text-russian-violet hover:bg-russian-violet/20";

/**
 * Formats a positive minute count as "Xh Ym free" / "Xh free" / "Ym free".
 * @param minutes - Gap length in minutes.
 * @returns Display label.
 */
function formatGap(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m free`;
  if (h > 0) return `${h}h free`;
  return `${m}m free`;
}

/**
 * Notes row on a booking card, showing only what the person actually typed. The
 * rest of the blob is the machine-written metadata mirror, and its Address line
 * already renders as its own row above this one.
 * @param props - Component props.
 * @param props.notes - Raw booking notes blob.
 * @returns The notes row, or null when nothing was typed.
 */
function BookingNotesRow({ notes }: { notes: string | null }): React.ReactElement | null {
  const { userNotes } = parseBookingNotes(notes);
  if (!userNotes) return null;
  return (
    <div className="text-sm whitespace-pre-wrap text-admin-text-secondary">
      <span className="text-admin-faint">Notes: </span>
      {userNotes}
    </div>
  );
}

/** Props for {@link DayAgendaList}. */
interface DayAgendaListProps {
  /** Agenda rows in order. */
  agendaItems: AgendaItem[];
  /** Id of the expanded booking card, or null. */
  expandedEventId: string | null;
  /** Starts the long-press timer on a booking card. */
  onCardPointerDown: (e: React.PointerEvent<HTMLDivElement>, ev: WeekEvent) => void;
  /** Cancels the long-press when the finger drifts. */
  onCardPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Clears the long-press timer. */
  onClearLongPress: () => void;
  /** Toggles a booking card's expanded view. */
  onCardClick: (eventId: string) => void;
}

/**
 * The agenda's timed-events list.
 * @param props - Component props.
 * @param props.agendaItems - Agenda rows in order.
 * @param props.expandedEventId - Expanded booking card id.
 * @param props.onCardPointerDown - Long-press start handler.
 * @param props.onCardPointerMove - Long-press drift handler.
 * @param props.onClearLongPress - Long-press clear handler.
 * @param props.onCardClick - Tap-to-expand handler.
 * @returns The list element.
 */
export function DayAgendaList({
  agendaItems,
  expandedEventId,
  onCardPointerDown,
  onCardPointerMove,
  onClearLongPress,
  onCardClick,
}: DayAgendaListProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {agendaItems.length === 0 ? (
        <p className="rounded-lg border border-dashed border-admin-border-strong bg-admin-surface px-4 py-8 text-center text-sm text-admin-faint">
          No timed events on this day.
        </p>
      ) : (
        agendaItems.map((item, idx) => {
          if (item.type === "now") {
            return (
              <div
                key="now"
                className="flex items-center gap-2 px-2 text-sm font-semibold tracking-wide uppercase"
              >
                <span className="h-0.5 flex-1 rounded-full bg-red-500" />
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-white">
                  {new Intl.DateTimeFormat("en-NZ", {
                    timeZone: NZ_TZ,
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(item.atMs))}
                </span>
                <span className="h-0.5 flex-1 rounded-full bg-red-500" />
              </div>
            );
          }
          if (item.type === "gap") {
            return (
              <div
                key={`gap-${idx}`}
                className="flex items-center gap-2 px-2 text-sm font-medium tracking-wide text-admin-faint uppercase"
                aria-hidden
              >
                <span className="h-px flex-1 bg-admin-border" />
                {formatGap(item.minutes)}
                <span className="h-px flex-1 bg-admin-border" />
              </div>
            );
          }
          const ev = item.ev;
          const isInteractive = ev.kind === "booking" && Boolean(ev.booking);
          const isExpanded = expandedEventId === ev.id;
          return (
            <div
              key={ev.id}
              data-no-swipe
              onPointerDown={isInteractive ? (e) => onCardPointerDown(e, ev) : undefined}
              onPointerMove={isInteractive ? onCardPointerMove : undefined}
              onPointerUp={isInteractive ? onClearLongPress : undefined}
              onPointerCancel={isInteractive ? onClearLongPress : undefined}
              onPointerLeave={isInteractive ? onClearLongPress : undefined}
              onClick={isInteractive ? () => onCardClick(ev.id) : undefined}
              role={isInteractive ? "button" : undefined}
              tabIndex={isInteractive ? 0 : undefined}
              aria-expanded={isInteractive ? isExpanded : undefined}
              className={cn(
                "flex overflow-hidden rounded-lg border border-admin-border bg-admin-surface",
                isInteractive && "cursor-pointer transition-colors hover:bg-admin-bg",
              )}
            >
              <div className={cn("w-1.5 shrink-0", KIND_BAR_BG[ev.kind])} />
              <div className="min-w-0 flex-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-admin-muted">
                    {formatTimeRange(ev.startAt, ev.endAt)}
                  </div>
                  {ev.booking && (
                    <StatusPill tone={BOOKING_STATUS_TONE[ev.booking.status]}>
                      {ev.booking.status}
                    </StatusPill>
                  )}
                </div>
                <div className="truncate text-[0.9375rem] font-semibold text-admin-text">
                  {ev.title}
                </div>
                {ev.location && (
                  <div className="truncate text-sm text-admin-muted">{ev.location}</div>
                )}
                {isExpanded && ev.booking && (
                  <div className="mt-3 flex flex-col gap-3 border-t border-admin-border pt-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      {ev.booking.phone && (
                        <a
                          href={`tel:${ev.booking.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className={CARD_LINK_CLS}
                        >
                          Call {ev.booking.phone}
                        </a>
                      )}
                      <a
                        href={`mailto:${ev.booking.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className={CARD_LINK_CLS}
                      >
                        Email
                      </a>
                      {ev.booking.address && (
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent(
                            ev.booking.address,
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className={CARD_LINK_CLS}
                        >
                          Open in Maps
                        </a>
                      )}
                    </div>
                    {ev.booking.address && (
                      <div className="text-sm text-admin-muted">
                        <span className="text-admin-faint">Address: </span>
                        {ev.booking.address}
                      </div>
                    )}
                    <BookingNotesRow notes={ev.booking.notes} />
                    <div className="mt-1 flex items-center justify-between gap-2 text-sm text-admin-faint">
                      <span className="font-mono">#{ev.booking.id}</span>
                      <span className="italic">Hold to edit</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
