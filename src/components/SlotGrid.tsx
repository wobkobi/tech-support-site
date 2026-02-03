// src/components/SlotGrid.tsx
"use client";
/**
 * Slot grid showing available times grouped by day.
 */

import type React from "react";
import { useMemo } from "react";
import { cn } from "@/lib/cn";
import type { BookingSlot } from "@/types/booking";

/**
 * Props for the SlotGrid component.
 */
export interface SlotGridProps {
  /**
   * Available booking slots.
   */
  slots: BookingSlot[];
  /**
   * ISO start time of the selected slot.
   */
  selectedStartIso?: string;
  /**
   * Called when the user selects a slot.
   */
  onSelectSlot: (slot: BookingSlot) => void;
}

/**
 * Group slots by dayKey for rendering.
 * @param slots Flat list of slots.
 * @returns Map keyed by dayKey.
 */
function groupByDay(slots: BookingSlot[]): Map<string, { dayLabel: string; slots: BookingSlot[] }> {
  const map = new Map<string, { dayLabel: string; slots: BookingSlot[] }>();

  for (const slot of slots) {
    const existing = map.get(slot.dayKey);
    if (existing) {
      existing.slots.push(slot);
    } else {
      map.set(slot.dayKey, { dayLabel: slot.dayLabel, slots: [slot] });
    }
  }

  return map;
}

/**
 * Slot grid UI.
 * @param root0 Component props.
 * @param root0.slots Available booking slots.
 * @param root0.selectedStartIso ISO start time of the selected slot.
 * @param root0.onSelectSlot Called when a slot is selected.
 * @returns Slot grid element.
 */
export default function SlotGrid({
  slots,
  selectedStartIso,
  onSelectSlot,
}: SlotGridProps): React.ReactElement {
  const grouped = useMemo(() => groupByDay(slots), [slots]);

  if (slots.length === 0) {
    return (
      <p className={cn("text-rich-black/80 text-sm")}>
        No online slots are available in the next two weeks. Please call to arrange a time.
      </p>
    );
  }

  const dayKeys = Array.from(grouped.keys()).sort();

  return (
    <div className={cn("flex flex-col gap-4")}>
      {dayKeys.map((dayKey) => {
        const group = grouped.get(dayKey);
        if (!group) return null;

        return (
          <div key={dayKey} className={cn("flex flex-col gap-2")}>
            <div className={cn("text-rich-black text-sm font-semibold sm:text-base")}>
              {group.dayLabel}
            </div>
            <div className={cn("flex flex-wrap gap-2")}>
              {group.slots.map((slot) => {
                const selected = selectedStartIso === slot.startIso;
                return (
                  <button
                    key={slot.startIso}
                    type="button"
                    onClick={() => onSelectSlot(slot)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-semibold",
                      "border-seasalt-300/80 border",
                      "hover:bg-moonstone-600/10",
                      selected
                        ? "bg-moonstone-600/20 text-russian-violet"
                        : "bg-seasalt text-rich-black",
                    )}
                  >
                    {slot.timeLabel}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
