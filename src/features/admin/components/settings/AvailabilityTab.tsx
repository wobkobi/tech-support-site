"use client";
// src/features/admin/components/settings/AvailabilityTab.tsx
/**
 * @description Editor for the availability group: the master accepting-bookings
 * switch + paused message, the per-weekday hours (with optional midday break and
 * day-off), the booking-window rules, job durations, and daily caps. Saves
 * through the shared settings form hook; guardrails (e.g. a day too short for a
 * job) come back from the API and surface inline.
 */

import { AvailabilityPreview } from "@/features/admin/components/settings/AvailabilityPreview";
import {
  FieldShell,
  NumberField,
  ToggleField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { SettingsSaveBar } from "@/features/admin/components/settings/SettingsSaveBar";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { hourLabel } from "@/features/booking/lib/booking";
import { cn } from "@/shared/lib/cn";
import { AVAILABILITY_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { AvailabilitySettings, DayWindow, MorningGuard } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: AvailabilitySettings;
  defaults: AvailabilitySettings;
}

/** Weekday order shown in the editor (Mon-Sun) with their `getUTCDay()` index. */
const DAY_ORDER: { index: number; name: string }[] = [
  { index: 1, name: "Monday" },
  { index: 2, name: "Tuesday" },
  { index: 3, name: "Wednesday" },
  { index: 4, name: "Thursday" },
  { index: 5, name: "Friday" },
  { index: 6, name: "Saturday" },
  { index: 0, name: "Sunday" },
];

/**
 * Labels an hour for the close dropdown, where 24 means midnight (end of day).
 * @param h - Hour 1-24.
 * @returns Display label.
 */
function closeLabel(h: number): string {
  return h === 24 ? "12am" : hourLabel(h);
}

interface HourSelectProps {
  value: number;
  onChange: (h: number) => void;
  /** Inclusive hour range for the options. */
  from: number;
  to: number;
  /** Use the close-style label (24 = midnight). */
  close?: boolean;
}

/**
 * Small hour dropdown used for open/close/break times.
 * @param props - Component props.
 * @param props.value - Selected hour.
 * @param props.onChange - Called with the new hour.
 * @param props.from - First selectable hour.
 * @param props.to - Last selectable hour.
 * @param props.close - Whether to label 24 as midnight.
 * @returns Hour select element.
 */
function HourSelect({ value, onChange, from, to, close }: HourSelectProps): React.ReactElement {
  const opts: number[] = [];
  for (let h = from; h <= to; h++) opts.push(h);
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-lg border border-admin-border-strong px-2 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
    >
      {opts.map((h) => (
        <option key={h} value={h}>
          {close ? closeLabel(h) : hourLabel(h)}
        </option>
      ))}
    </select>
  );
}

/**
 * Availability settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current availability settings.
 * @param props.defaults - Code default availability settings.
 * @returns Availability tab element.
 */
export function AvailabilityTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("availability", initial, defaults);
  const { draft, setDraft, dirty, saving, fieldErrors, blocks, warns, savedAt } = form;
  const m = AVAILABILITY_FIELD_META;

  /**
   * Patches one weekday's window in the draft.
   * @param index - The weekday's `getUTCDay()` index.
   * @param patch - Partial day-window fields to merge.
   * @returns void
   */
  const setDay = (index: number, patch: Partial<DayWindow>): void =>
    setDraft((p) => ({
      ...p,
      schedule: { ...p.schedule, [index]: { ...p.schedule[index], ...patch } },
    }));

  /**
   * Merges a top-level availability patch into the draft.
   * @param patch - Partial availability fields.
   * @returns void
   */
  const setTop = (patch: Partial<AvailabilitySettings>): void =>
    setDraft((p) => ({ ...p, ...patch }));

  /**
   * Patches one morning-guard rule in the draft.
   * @param index - The rule's position in the list.
   * @param patch - Partial rule fields to merge.
   * @returns void
   */
  const setGuard = (index: number, patch: Partial<MorningGuard>): void =>
    setDraft((p) => ({
      ...p,
      morningGuards: p.morningGuards.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    }));

  /**
   * Appends a new guard, defaulting to the weekend lie-in shape.
   * @returns void
   */
  const addGuard = (): void =>
    setDraft((p) => ({
      ...p,
      morningGuards: [
        ...p.morningGuards,
        {
          enabled: true,
          label: "New guard",
          triggerDay: 5,
          triggerHour: 18,
          protectedDays: [6],
          earliestHour: 12,
        },
      ],
    }));

  /**
   * Removes the guard at the given index.
   * @param index - The rule's position in the list.
   * @returns void
   */
  const removeGuard = (index: number): void =>
    setDraft((p) => ({ ...p, morningGuards: p.morningGuards.filter((_, i) => i !== index) }));

  /**
   * Toggles a protected day on/off for one guard.
   * @param index - The rule's position in the list.
   * @param dayIndex - The weekday's `getUTCDay()` index.
   * @returns void
   */
  const toggleProtectedDay = (index: number, dayIndex: number): void =>
    setGuard(index, {
      protectedDays: draft.morningGuards[index].protectedDays.includes(dayIndex)
        ? draft.morningGuards[index].protectedDays.filter((d) => d !== dayIndex)
        : [...draft.morningGuards[index].protectedDays, dayIndex].sort((a, b) => a - b),
    });

  return (
    <div>
      {/* Master switch + paused message */}
      <div className="divide-y divide-admin-border">
        <ToggleField
          id="acceptingBookings"
          meta={m.acceptingBookings}
          value={draft.acceptingBookings}
          customised={draft.acceptingBookings !== defaults.acceptingBookings}
          onChange={(v) => setTop({ acceptingBookings: v })}
        />
        <FieldShell
          id="closedMessage"
          meta={m.closedMessage}
          customised={draft.closedMessage !== defaults.closedMessage}
        >
          <textarea
            id="closedMessage"
            value={draft.closedMessage}
            rows={2}
            onChange={(e) => setTop({ closedMessage: e.target.value })}
            className="w-full rounded-lg border border-admin-border-strong px-3 py-2 text-base focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
          />
        </FieldShell>
      </div>

      {/* Weekly hours */}
      <h3 className="mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase">
        Weekly hours
      </h3>
      <p className="mt-1 text-sm text-admin-muted">
        Set the hours you take bookings each day. Turn a day off, or add a midday break that splits
        it into two windows.
      </p>
      <div className="mt-3 space-y-2">
        {DAY_ORDER.map(({ index, name }) => {
          const d = draft.schedule[index];
          return (
            <div key={index} className="rounded-lg border border-admin-border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-24 text-sm font-semibold text-admin-text">{name}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={d.enabled}
                  onClick={() => setDay(index, { enabled: !d.enabled })}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    d.enabled ? "bg-russian-violet" : "bg-admin-border-strong",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-admin-surface shadow transition-[translate]",
                      d.enabled ? "translate-x-6" : "translate-x-1",
                    )}
                  />
                </button>
                {d.enabled ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-admin-text-secondary">
                    <HourSelect
                      value={d.open}
                      from={0}
                      to={23}
                      onChange={(h) => setDay(index, { open: h })}
                    />
                    <span>to</span>
                    <HourSelect
                      value={d.close}
                      from={1}
                      to={24}
                      close
                      onChange={(h) => setDay(index, { close: h })}
                    />
                    <label className="ml-2 flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={d.break !== null}
                        onChange={(e) =>
                          setDay(index, {
                            break: e.target.checked ? { start: 13, end: 14 } : null,
                          })
                        }
                      />
                      Break
                    </label>
                    {d.break && (
                      <span className="flex items-center gap-2">
                        <HourSelect
                          value={d.break.start}
                          from={d.open}
                          to={d.close}
                          onChange={(h) =>
                            setDay(index, { break: { start: h, end: d.break!.end } })
                          }
                        />
                        <span>to</span>
                        <HourSelect
                          value={d.break.end}
                          from={d.open}
                          to={d.close}
                          close
                          onChange={(h) =>
                            setDay(index, { break: { start: d.break!.start, end: h } })
                          }
                        />
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-admin-faint italic">Day off</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Booking rules */}
      <h3 className="mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase">
        Booking rules
      </h3>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="maxAdvanceDays"
          meta={m.maxAdvanceDays}
          value={draft.maxAdvanceDays}
          min={1}
          max={365}
          error={fieldErrors.maxAdvanceDays}
          customised={draft.maxAdvanceDays !== defaults.maxAdvanceDays}
          onChange={(v) => setTop({ maxAdvanceDays: v ?? 1 })}
        />
        <NumberField
          id="minHoursNotice"
          meta={m.minHoursNotice}
          value={draft.minHoursNotice}
          min={0}
          error={fieldErrors.minHoursNotice}
          customised={draft.minHoursNotice !== defaults.minHoursNotice}
          onChange={(v) => setTop({ minHoursNotice: v ?? 0 })}
        />
        <FieldShell
          id="sameDayCutoffHour"
          meta={m.sameDayCutoffHour}
          error={fieldErrors.sameDayCutoffHour}
          customised={draft.sameDayCutoffHour !== defaults.sameDayCutoffHour}
        >
          <select
            id="sameDayCutoffHour"
            value={draft.sameDayCutoffHour ?? ""}
            onChange={(e) =>
              setTop({ sameDayCutoffHour: e.target.value === "" ? null : Number(e.target.value) })
            }
            className="rounded-lg border border-admin-border-strong px-2 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
          >
            <option value="">No cutoff</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </FieldShell>
        <NumberField
          id="bufferMin"
          meta={m.bufferMin}
          value={draft.bufferMin}
          min={0}
          minutesHint
          error={fieldErrors.bufferMin}
          customised={draft.bufferMin !== defaults.bufferMin}
          onChange={(v) => setTop({ bufferMin: v ?? 0 })}
        />
        <NumberField
          id="bookingBufferAfterMin"
          meta={m.bookingBufferAfterMin}
          value={draft.bookingBufferAfterMin}
          min={0}
          minutesHint
          error={fieldErrors.bookingBufferAfterMin}
          customised={draft.bookingBufferAfterMin !== defaults.bookingBufferAfterMin}
          onChange={(v) => setTop({ bookingBufferAfterMin: v ?? 0 })}
        />
      </div>

      {/* Durations + daily caps */}
      <h3 className="mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase">
        Job lengths &amp; daily limits
      </h3>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="durations.short"
          meta={m["durations.short"]}
          value={draft.durations.short}
          min={5}
          minutesHint
          error={fieldErrors["durations.short"]}
          customised={draft.durations.short !== defaults.durations.short}
          onChange={(v) =>
            setDraft((p) => ({ ...p, durations: { ...p.durations, short: v ?? 5 } }))
          }
        />
        <NumberField
          id="durations.long"
          meta={m["durations.long"]}
          value={draft.durations.long}
          min={5}
          minutesHint
          error={fieldErrors["durations.long"]}
          customised={draft.durations.long !== defaults.durations.long}
          onChange={(v) => setDraft((p) => ({ ...p, durations: { ...p.durations, long: v ?? 5 } }))}
        />
        <NumberField
          id="maxJobsPerDay"
          meta={m.maxJobsPerDay}
          value={draft.maxJobsPerDay}
          nullable
          min={0}
          error={fieldErrors.maxJobsPerDay}
          customised={draft.maxJobsPerDay !== defaults.maxJobsPerDay}
          onChange={(v) => setTop({ maxJobsPerDay: v })}
        />
        <NumberField
          id="maxBillableHoursPerDay"
          meta={m.maxBillableHoursPerDay}
          value={draft.maxBillableHoursPerDay}
          nullable
          min={0}
          error={fieldErrors.maxBillableHoursPerDay}
          customised={draft.maxBillableHoursPerDay !== defaults.maxBillableHoursPerDay}
          onChange={(v) => setTop({ maxBillableHoursPerDay: v })}
        />
      </div>

      {/* Morning guards - protect early slots once the night-before arrives. */}
      <h3 className="mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase">
        Morning guards
      </h3>
      <p className="mt-1 text-sm text-admin-muted">
        Protect early slots once the night before arrives - e.g. from Friday evening, block Saturday
        and Sunday before noon. Slots stay bookable if reserved earlier in the week.
      </p>
      <div className="mt-3 space-y-2">
        {draft.morningGuards.map((g, gi) => (
          <div key={gi} className="rounded-lg border border-admin-border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={g.enabled}
                onClick={() => setGuard(gi, { enabled: !g.enabled })}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  g.enabled ? "bg-russian-violet" : "bg-admin-border-strong",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 rounded-full bg-admin-surface shadow transition-[translate]",
                    g.enabled ? "translate-x-6" : "translate-x-1",
                  )}
                />
              </button>
              <input
                type="text"
                value={g.label}
                aria-label="Guard name"
                onChange={(e) => setGuard(gi, { label: e.target.value })}
                className="flex-1 rounded-lg border border-admin-border px-3 py-1.5 text-sm text-admin-text focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeGuard(gi)}
                className="text-sm font-medium text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-admin-text-secondary">
              <span>From</span>
              <select
                value={g.triggerDay}
                aria-label="Trigger day"
                onChange={(e) => setGuard(gi, { triggerDay: Number(e.target.value) })}
                className="rounded-lg border border-admin-border px-2 py-2 text-sm text-admin-text focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
              >
                {DAY_ORDER.map((d) => (
                  <option key={d.index} value={d.index}>
                    {d.name}
                  </option>
                ))}
              </select>
              <span>at</span>
              <HourSelect
                value={g.triggerHour}
                from={0}
                to={23}
                onChange={(h) => setGuard(gi, { triggerHour: h })}
              />
              <span>, block</span>
              {DAY_ORDER.map((d) => (
                <button
                  key={d.index}
                  type="button"
                  aria-pressed={g.protectedDays.includes(d.index)}
                  onClick={() => toggleProtectedDay(gi, d.index)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                    g.protectedDays.includes(d.index)
                      ? "bg-russian-violet text-white"
                      : "border border-admin-border text-admin-muted hover:border-russian-violet",
                  )}
                >
                  {d.name.slice(0, 3)}
                </button>
              ))}
              <span>before</span>
              <HourSelect
                value={g.earliestHour}
                from={1}
                to={23}
                onChange={(h) => setGuard(gi, { earliestHour: h })}
              />
            </div>
            {fieldErrors[`morningGuards.${gi}.protectedDays`] && (
              <p className="mt-2 text-xs font-medium text-red-600">
                {fieldErrors[`morningGuards.${gi}.protectedDays`]}
              </p>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addGuard}
          className="rounded-lg border border-admin-border px-3 py-1.5 text-sm font-medium text-admin-text hover:border-russian-violet"
        >
          + Add guard
        </button>
      </div>

      {/* Guardrail blocks */}
      {blocks.length > 0 && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">Can&apos;t save yet:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-700">
            {blocks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <AvailabilityPreview config={draft} />

      {/* Guardrail warnings */}
      {warns.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">Heads up:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800">
            {warns.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void form.save(true)}
            disabled={saving}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Save anyway
          </button>
        </div>
      )}

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        onSave={() => void form.save()}
        onReset={form.resetToDefault}
      />

      <SettingsHistory group="availability" onRestore={(v: AvailabilitySettings) => setDraft(v)} />
    </div>
  );
}
