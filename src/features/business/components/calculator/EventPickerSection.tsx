"use client";
// src/features/business/components/calculator/EventPickerSection.tsx
/**
 * @description "Bill a calendar event" card. On a blank calculator it lists
 * recent booking-calendar events to jump into; once one is loaded it becomes
 * the billing banner and offers the day's neighbouring events as a merge, via
 * {@link findMergeSuggestions}. Merging keeps one time slot per event, so the
 * gaps between them are never billed.
 */
import { minsToHoursLabel } from "@/features/business/lib/business";
import {
  findMergeSuggestions,
  type MergeCandidateEvent,
} from "@/features/business/lib/event-merge";
import type { EventPrefill, ParsedRange } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Recent booking-calendar event as returned by the admin endpoint. */
type RecentEvent = MergeCandidateEvent;

interface Props {
  /** Prefill for the events being billed; null on a blank calculator. */
  prefill: EventPrefill | null;
  /** Current job date, which the operator may have edited below this card. */
  jobDate: string;
  /** Current time slots, which the operator may have edited below this card. */
  timeRanges: ParsedRange[];
  /** Largest gap (minutes) the merge suggestion offers across; 0 disables it. */
  mergeSuggestGapMins: number;
  /** Puts the job date and slots back to the billed events' own windows. */
  onResetToEventTimes: () => void;
  /** Loads the calculator for exactly this set of event ids. */
  onBillEvents: (eventIds: string[]) => void;
}

/** NZ-local "Mon 3 Feb, 2:15 pm" for the picker rows. */
const EVENT_STAMP = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Minutes since midnight for an HH:MM value, or null when unparseable.
 * @param hhmm - Time string from a slot input.
 * @returns Minutes since midnight, or null.
 */
function minutesOfDay(hhmm: string): number | null {
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
}

/**
 * Total unbilled time sitting between consecutive slots. This is the figure
 * the merged banner puts in front of the operator: the whole point of merging
 * rather than stretching one slot across the day is that this time is not
 * charged. Overlapping slots count as no gap - a plain subtraction, not the
 * midnight-rolling timeDiffMins, which would read an overlap as most of a day.
 * @param ranges - The job's time slots, in any order.
 * @returns Minutes between slots; 0 for a single slot.
 */
function gapMinutesBetween(ranges: ParsedRange[]): number {
  const complete = ranges
    .filter((r) => r.startTime && r.endTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  let total = 0;
  for (let i = 1; i < complete.length; i++) {
    const prevEnd = minutesOfDay(complete[i - 1].endTime);
    const nextStart = minutesOfDay(complete[i].startTime);
    if (prevEnd === null || nextStart === null) continue;
    total += Math.max(0, nextStart - prevEnd);
  }
  return total;
}

/**
 * Rebuilds the billed events as merge anchors from the prefill itself. The
 * recent-event list reaches back a fortnight and caps at 30, so the job being
 * billed is not guaranteed to appear in it - and when it does, that richer row
 * (with the calendar's own location) is preferred for address matching.
 * @param prefill - The events currently being billed.
 * @param known - Recent events fetched from the admin endpoint.
 * @returns One anchor per billed slot, in slot order.
 */
function buildAnchors(prefill: EventPrefill, known: RecentEvent[]): MergeCandidateEvent[] {
  const [y, m, d] = prefill.jobDate.split("-").map(Number);
  const offsetHours =
    Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)
      ? null
      : getPacificAucklandOffset(y, m, d);

  /**
   * NZ-local HH:MM on the job date as an ISO instant.
   * @param hhmm - Slot time.
   * @returns ISO timestamp, or null when either value is unparseable.
   */
  const toIso = (hhmm: string): string | null => {
    const mins = minutesOfDay(hhmm);
    if (mins === null || offsetHours === null) return null;
    return new Date(
      Date.UTC(y, m - 1, d, Math.floor(mins / 60) - offsetHours, mins % 60),
    ).toISOString();
  };

  return prefill.slots.flatMap((slot) => {
    const listed = known.find((e) => e.id === slot.calendarEventId);
    if (listed) return [listed];
    const start = toIso(slot.startTime);
    const end = toIso(slot.endTime);
    if (!start || !end) return [];
    return [
      {
        id: slot.calendarEventId,
        summary: slot.summary,
        start,
        end,
        location: prefill.jobAddress || null,
      },
    ];
  });
}

/**
 * "Bill a calendar event" card: the recent-event picker before a job is
 * loaded, the billing banner plus merge suggestions afterwards.
 * @param props - Component props.
 * @param props.prefill - Prefill for the events being billed; null on a blank calculator.
 * @param props.jobDate - Current job date (may differ from the events').
 * @param props.timeRanges - Current time slots (may differ from the events').
 * @param props.mergeSuggestGapMins - Largest gap the merge suggestion offers across.
 * @param props.onResetToEventTimes - Restores the job date and slots to the events' windows.
 * @param props.onBillEvents - Loads the calculator for a set of event ids.
 * @returns Event picker card element.
 */
export function EventPickerSection({
  prefill,
  jobDate,
  timeRanges,
  mergeSuggestGapMins,
  onResetToEventTimes,
  onBillEvents,
}: Props): React.ReactElement {
  const [pickerOpen, setPickerOpen] = useState(false);
  // null until the fetch resolves, which doubles as the "still loading" flag.
  const [events, setEvents] = useState<RecentEvent[] | null>(null);
  // Merge tickboxes, keyed by event id. Seeded from each suggestion's own
  // preselect once the list arrives, then owned by the operator.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  // Guards against a second fetch from the effect and the toggle racing.
  const requested = useRef(false);

  /**
   * Fetches the recent-event list, once per mount. Deliberately sets no state
   * before awaiting: called straight from an effect below, and a synchronous
   * setState there would cascade renders.
   */
  const loadEvents = useCallback((): void => {
    if (requested.current) return;
    requested.current = true;
    fetch("/api/admin/schedule/recent-events")
      .then((res) => res.json())
      .then((d) => setEvents(d.ok && d.events ? d.events : []))
      .catch(() => setEvents([]));
  }, []);

  // In billing mode the list is needed up front - it is what the merge
  // suggestion is computed from - so it loads without waiting for a click.
  // The endpoint is served from the 60s schedule cache, so this is cheap.
  useEffect(() => {
    if (prefill) loadEvents();
  }, [prefill, loadEvents]);

  /** Toggles the picker open, fetching the list on first open. */
  function togglePicker(): void {
    setPickerOpen((open) => !open);
    loadEvents();
  }

  const billedIds = prefill?.slots.map((s) => s.calendarEventId) ?? [];
  const anchors = prefill ? buildAnchors(prefill, events ?? []) : [];
  const suggestions = findMergeSuggestions(anchors, events ?? [], mergeSuggestGapMins);
  /**
   * Whether a suggested event is ticked. One the operator has not touched
   * falls back to its own verdict: same client or same address starts ticked,
   * bare time proximity does not.
   * @param id - Suggested event's calendar id.
   * @param preselected - The suggestion's own default.
   * @returns Whether the row is ticked.
   */
  function isTicked(id: string, preselected: boolean): boolean {
    return ticked[id] ?? preselected;
  }
  const chosen = suggestions.filter((s) => isTicked(s.event.id, s.preselected));

  /**
   * Adds an event to the job, or takes it back out when it is already on it.
   * Unticking the last one leaves the calculator with no event at all, which
   * {@link onBillEvents} turns back into a blank form.
   * @param eventId - The row that was toggled.
   */
  function toggleEvent(eventId: string): void {
    onBillEvents(
      billedIds.includes(eventId)
        ? billedIds.filter((id) => id !== eventId)
        : [...billedIds, eventId],
    );
  }

  const rowClasses =
    "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm";

  // One list, two behaviours: on a blank calculator a row is a button that loads the job;
  // once one is loaded every row becomes a tickbox, billed events ticked, so an accidental
  // merge is undone by unticking rather than starting over.
  const pickerList = (
    <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
      {events === null && <p className="text-xs text-slate-400">Loading events…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-xs text-slate-400">No booking-calendar events in the last two weeks.</p>
      )}
      {(events ?? []).map((ev) => {
        const billed = billedIds.includes(ev.id);
        return prefill ? (
          <label
            key={ev.id}
            className={cn(
              rowClasses,
              "cursor-pointer",
              billed
                ? "border-russian-violet/30 bg-russian-violet/5"
                : "border-slate-100 hover:border-russian-violet/30 hover:bg-russian-violet/5",
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={billed}
                onChange={() => toggleEvent(ev.id)}
                className="h-3.5 w-3.5 shrink-0"
              />
              <span className="truncate font-medium text-slate-700">{ev.summary}</span>
            </span>
            <span className="shrink-0 text-xs text-slate-500">
              {EVENT_STAMP.format(new Date(ev.start))}
            </span>
          </label>
        ) : (
          <button
            key={ev.id}
            type="button"
            onClick={() => onBillEvents([ev.id])}
            className={cn(
              rowClasses,
              "border-slate-100 hover:border-russian-violet/30 hover:bg-russian-violet/5",
            )}
          >
            <span className="truncate font-medium text-slate-700">{ev.summary}</span>
            <span className="shrink-0 text-xs text-slate-500">
              {EVENT_STAMP.format(new Date(ev.start))}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (!prefill) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-russian-violet">Bill a calendar event</h2>
          <button
            type="button"
            onClick={togglePicker}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {pickerOpen ? "Hide" : "Pick a recent event"}
          </button>
        </div>
        {pickerOpen && pickerList}
      </div>
    );
  }

  // Billing mode. The banner reflects the CURRENT job date + slots (which the
  // operator may have edited below), and flags when they drift from the
  // events' own windows so a stray edit is obvious.
  const merged = prefill.slots.length > 1;
  const slotsMatch =
    timeRanges.length === prefill.slots.length &&
    prefill.slots.every(
      (s, i) => timeRanges[i]?.startTime === s.startTime && timeRanges[i]?.endTime === s.endTime,
    );
  const drifted = jobDate !== prefill.jobDate || !slotsMatch;
  const unbilledGap = gapMinutesBetween(timeRanges);

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-5 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-slate-600">
          <span className="font-semibold text-russian-violet">
            {merged ? `Billing ${prefill.slots.length} events as one job:` : "Billing booked job:"}
          </span>{" "}
          {prefill.clientName || "(no name)"} - {jobDate},{" "}
          {timeRanges
            .filter((r) => r.startTime || r.endTime)
            .map((r) => `${r.startTime || "--:--"}-${r.endTime || "--:--"}`)
            .join(" + ") || "--:-- - --:--"}
          {prefill.bookingId && (
            <>
              {" · "}
              <a
                href={`/admin/bookings/${prefill.bookingId}`}
                className="font-medium text-russian-violet underline hover:opacity-80"
              >
                View booking ↗
              </a>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={togglePicker}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {pickerOpen ? "Hide" : "Change event"}
        </button>
      </div>

      {pickerOpen && pickerList}

      {merged && unbilledGap > 0 && (
        <p className="text-xs text-slate-500">
          {minsToHoursLabel(unbilledGap)} between visits is not billed - each event is its own slot.
        </p>
      )}

      {drifted && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-amber-700">
            Differs from the event {prefill.slots.length > 1 ? "windows" : "window"} (
            {prefill.jobDate}, {prefill.slots.map((s) => `${s.startTime}-${s.endTime}`).join(" + ")}
            ).
          </span>
          <button
            type="button"
            onClick={onResetToEventTimes}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-russian-violet hover:bg-slate-50"
          >
            Reset to event times
          </button>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-3 space-y-2 rounded-lg border border-russian-violet/20 bg-russian-violet/5 p-3">
          <p className="text-xs font-semibold text-russian-violet">
            {suggestions.length === 1
              ? "Another event that day looks like the same job"
              : `${suggestions.length} more events that day look like the same job`}
          </p>
          {suggestions.map((s) => (
            <label
              key={s.event.id}
              className="flex cursor-pointer items-start gap-2 text-xs text-slate-700"
            >
              <input
                type="checkbox"
                checked={isTicked(s.event.id, s.preselected)}
                onChange={(e) => setTicked((prev) => ({ ...prev, [s.event.id]: e.target.checked }))}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span className="min-w-0">
                <span className="font-medium">{s.event.summary}</span>{" "}
                <span className="text-slate-500">
                  {EVENT_STAMP.format(new Date(s.event.start))} · {s.reason}
                </span>
              </span>
            </label>
          ))}
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => onBillEvents([...billedIds, ...chosen.map((s) => s.event.id)])}
            className="rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {chosen.length <= 1
              ? "Bill together"
              : `Bill all ${chosen.length + billedIds.length} together`}
          </button>
        </div>
      )}
    </div>
  );
}
