"use client";
// src/features/social/components/SlotGrid.tsx
// A schedule's weekly times: Monday to Sunday, each with its own times in 15-minute steps, plus
// quick picks that set the same time on a group of days.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import {
  MAX_SLOTS,
  WEEK_ORDER,
  minuteLabel,
  slotMinutes,
  sortSlots,
  type QueueSlot,
} from "@/features/social/lib/queue-slots";
import { DAY_NAMES } from "@/shared/lib/timezone-utils";
import type React from "react";
import { FaPlus, FaXmark } from "react-icons/fa6";

const MINUTES = slotMinutes();

/** Quick picks, each setting one time on these days. */
const PRESETS: { label: string; days: number[] }[] = [
  { label: "Mon, Wed, Fri", days: [1, 3, 5] },
  { label: "Tue, Thu", days: [2, 4] },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Every day", days: [1, 2, 3, 4, 5, 6, 0] },
];

/**
 * The first free time on a day, starting at the default and stepping on 15 minutes.
 * @param taken - Times already on the day.
 * @param start - The time to try first.
 * @returns A free time, or null when the day is full.
 */
function freeMinute(taken: readonly number[], start: number): number | null {
  const from = MINUTES.indexOf(start);
  const order = [...MINUTES.slice(Math.max(from, 0)), ...MINUTES.slice(0, Math.max(from, 0))];
  return order.find((m) => !taken.includes(m)) ?? null;
}

/**
 * Slot grid.
 * @param props - Component props.
 * @param props.slots - The schedule's times now.
 * @param props.onChange - Called with the new times, sorted.
 * @param props.defaultMinute - The time a new slot starts at.
 * @param props.disabled - Greys the grid out while saving.
 * @returns Grid element.
 */
export function SlotGrid({
  slots,
  onChange,
  defaultMinute,
  disabled,
}: {
  slots: QueueSlot[];
  onChange: (slots: QueueSlot[]) => void;
  defaultMinute: number;
  disabled?: boolean;
}): React.ReactElement {
  const full = slots.length >= MAX_SLOTS;

  /**
   * Replaces the times and keeps them in order.
   * @param next - The new times.
   */
  function set(next: QueueSlot[]): void {
    onChange(sortSlots(next));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-admin-muted">
          Quick pick at {minuteLabel(defaultMinute)}:
        </span>
        {PRESETS.map((p) => (
          <AdminButton
            key={p.label}
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => set(p.days.map((weekday) => ({ weekday, minute: defaultMinute })))}
          >
            {p.label}
          </AdminButton>
        ))}
        {slots.length > 0 && (
          <AdminButton size="sm" variant="ghost" disabled={disabled} onClick={() => set([])}>
            Clear all
          </AdminButton>
        )}
      </div>
      <ul className="divide-y divide-admin-border rounded-lg border border-admin-border">
        {WEEK_ORDER.map((weekday) => {
          const times = slots.filter((s) => s.weekday === weekday).map((s) => s.minute);
          const next = freeMinute(times, defaultMinute);
          return (
            <li
              key={weekday}
              className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="w-28 shrink-0 font-semibold text-admin-text">
                {DAY_NAMES[weekday]}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {times.map((minute) => (
                  <span key={minute} className="flex items-center gap-1">
                    <AdminSelect
                      aria-label={`${DAY_NAMES[weekday]} time`}
                      value={minute}
                      disabled={disabled}
                      onChange={(e) =>
                        set(
                          slots.map((s) =>
                            s.weekday === weekday && s.minute === minute
                              ? { weekday, minute: Number(e.target.value) }
                              : s,
                          ),
                        )
                      }
                      className="h-9 w-auto py-1"
                    >
                      {MINUTES.map((m) => (
                        <option key={m} value={m} disabled={m !== minute && times.includes(m)}>
                          {minuteLabel(m)}
                        </option>
                      ))}
                    </AdminSelect>
                    <button
                      type="button"
                      aria-label={`Take off ${DAY_NAMES[weekday]} at ${minuteLabel(minute)}`}
                      disabled={disabled}
                      onClick={() =>
                        set(slots.filter((s) => !(s.weekday === weekday && s.minute === minute)))
                      }
                      className="grid size-8 place-items-center rounded-md text-admin-muted hover:bg-admin-bg hover:text-admin-text disabled:opacity-50"
                    >
                      <FaXmark aria-hidden />
                    </button>
                  </span>
                ))}
                <AdminButton
                  size="sm"
                  variant="ghost"
                  disabled={disabled || full || next === null}
                  onClick={() => next !== null && set([...slots, { weekday, minute: next }])}
                >
                  <FaPlus aria-hidden /> Add time
                </AdminButton>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-admin-muted">
        {full
          ? `That's the most a schedule can have: ${MAX_SLOTS} times a week.`
          : "Times are New Zealand time and stay put when the clocks change."}
      </p>
    </div>
  );
}
