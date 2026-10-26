"use client";
// src/features/business/components/calculator/TasksSection.tsx
// Tasks list for the job calculator: flat-rate lines or device + action tasks priced from
// saved templates, with modifier chips on the hourly rate.

import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import {
  REMOVE_ROW_CLS,
  TEXT_ACTION_CLS,
  toggleChipClass,
} from "@/features/business/components/calculator/calculator-classes";
import { SectionClearButton } from "@/features/business/components/calculator/SectionClearButton";
import { Combobox } from "@/features/business/components/Combobox";
import { composeDescription, formatNZD, taskLineTotals } from "@/features/business/lib/business";
import { unsuccessfulShareLabel } from "@/features/business/lib/pricing-policy";
import { collectTaxonomyTags } from "@/features/business/lib/task-taxonomy";
import type { RateConfig, TaskLine, TaskTemplate } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { roundCents } from "@/shared/lib/money";
import type React from "react";

interface Props {
  tasks: TaskLine[];
  onTasksChange: (updater: (prev: TaskLine[]) => TaskLine[]) => void;
  /** Updates one TaskLine field by index. */
  onUpdateTask: (idx: number, field: keyof TaskLine, val: string | number | null) => void;
  /** Replaces the base hourly rate for a task (recomputes effective price). */
  onSetTaskBase: (idx: number, baseId: string | null) => void;
  /** Toggles a modifier chip on a task (recomputes effective price). */
  onToggleTaskModifier: (idx: number, modifierId: string) => void;
  /** Adds a fresh hourly task seeded with the default base rate. */
  onAddTask: () => void;
  /** Opens the device/action taxonomy manager modal. */
  onManageTags: () => void;
  taskTemplates: TaskTemplate[];
  baseRates: RateConfig[];
  modifierRates: RateConfig[];
  flatRates: RateConfig[];
  /** Share of the labour still charged on an unfinished task (0.5 = half price). */
  unsuccessfulFactor: number;
}

/**
 * Sorted suggestions for a Combobox axis, one per case-insensitive tag so "PC" and
 * "Pc" don't both appear.
 * @param templates - All saved templates.
 * @param key - Which axis to extract.
 * @returns Sorted canonical tag values.
 */
function tagSuggestions(templates: TaskTemplate[], key: "device" | "action"): string[] {
  return collectTaxonomyTags(templates, key).map((tag) => tag.name);
}

/**
 * Tasks list: flat-rate rows with a rate dropdown, or device + action rows priced
 * from saved templates with modifier chips.
 * @param props - Component props.
 * @param props.tasks - The current task list.
 * @param props.onTasksChange - Functional setter; used by the Combobox onChange logic that does template-aware pricing.
 * @param props.onUpdateTask - Per-field updater used by the qty/price inputs and flat-rate dropdown.
 * @param props.onSetTaskBase - Sets the base hourly rate on a task row.
 * @param props.onToggleTaskModifier - Toggles a modifier on a task row.
 * @param props.onAddTask - Appends a new empty hourly task.
 * @param props.onManageTags - Opens the taxonomy manager modal.
 * @param props.taskTemplates - Saved templates used for tag suggestions and price lookup.
 * @param props.baseRates - Base hourly rates available in the rate dropdown.
 * @param props.modifierRates - Modifier chips shown next to the base dropdown.
 * @param props.flatRates - Flat-rate options used for flat-rate rows.
 * @param props.unsuccessfulFactor - Labour share charged on an unfinished task, for the chip's tooltip.
 * @returns Tasks section element.
 */
export function TasksSection({
  tasks,
  onTasksChange,
  onUpdateTask,
  onSetTaskBase,
  onToggleTaskModifier,
  onAddTask,
  onManageTags,
  taskTemplates,
  baseRates,
  modifierRates,
  flatRates,
  unsuccessfulFactor,
}: Props): React.ReactElement {
  // The invoice's cents, not each row rounded alone: timed rows at one rate share them.
  const lineTotals = taskLineTotals(tasks);
  return (
    <Card className="space-y-3">
      <CardHeader
        title="Tasks"
        className="mb-0 items-center"
        actions={
          <div className="flex items-center gap-3">
            <button type="button" onClick={onManageTags} className={TEXT_ACTION_CLS}>
              Manage tags
            </button>
            {tasks.length > 0 && (
              <SectionClearButton onClear={() => onTasksChange(() => [])} label="tasks" />
            )}
          </div>
        }
      />
      {tasks.map((task, idx) => {
        // Flat-rate rows are single-line; task rows use the combobox layout.
        const isFlatRate = task.rateConfigId != null;
        const composed = composeDescription(
          task.device ?? null,
          task.action ?? null,
          task.details ?? null,
        );

        return (
          <div
            key={idx}
            className="rounded-lg border border-admin-border bg-admin-bg p-3 sm:bg-admin-surface"
          >
            {isFlatRate ? (
              /* Flat-rate row (Travel etc.): rate dropdown + qty/price/total/delete inline. */
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <AdminSelect
                  value={`rate:${task.rateConfigId}`}
                  onChange={(e) => onUpdateTask(idx, "rateConfigId", e.target.value.slice(5))}
                  className="sm:w-40"
                >
                  {flatRates.map((r) => (
                    <option key={r.id} value={`rate:${r.id}`}>
                      {r.label}
                    </option>
                  ))}
                </AdminSelect>
                <p className="truncate text-sm text-admin-text-secondary sm:flex-1">
                  {task.description}
                </p>
                <TaskTotalsRow
                  task={task}
                  lineTotal={lineTotals[idx]!}
                  onQty={(v) => onUpdateTask(idx, "qty", v)}
                  onPrice={(v) => onUpdateTask(idx, "unitPrice", v)}
                  onDelete={() => onTasksChange((p) => p.filter((_, i) => i !== idx))}
                />
              </div>
            ) : (
              /* Task row: Device + Action comboboxes, optional details input, composed preview, qty/price/total/delete. */
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Combobox
                    value={task.device ?? ""}
                    onChange={(v) => {
                      const next = v.trim() || null;
                      onTasksChange((prev) => {
                        const arr = [...prev];
                        const updated = { ...arr[idx]!, device: next };
                        const composedDesc = composeDescription(
                          next,
                          updated.action ?? null,
                          updated.details ?? null,
                        );
                        if (composedDesc) updated.description = composedDesc;
                        const tmpl =
                          next && updated.action
                            ? taskTemplates.find(
                                (t) =>
                                  (t.device ?? "").toLowerCase() === next.toLowerCase() &&
                                  (t.action ?? "").toLowerCase() ===
                                    (updated.action ?? "").toLowerCase(),
                              )
                            : null;
                        // Hourly lines keep the price their rate tags give; a saved
                        // template price goes stale whenever the rates change.
                        if (tmpl && !updated.baseRateId) {
                          updated.unitPrice = tmpl.defaultPrice;
                          updated.lineTotal = roundCents(updated.qty * tmpl.defaultPrice);
                        }
                        arr[idx] = updated;
                        return arr;
                      });
                    }}
                    suggestions={tagSuggestions(taskTemplates, "device")}
                    placeholder="Device"
                    ariaLabel="Device"
                  />
                  <Combobox
                    value={task.action ?? ""}
                    onChange={(v) => {
                      const next = v.trim() || null;
                      onTasksChange((prev) => {
                        const arr = [...prev];
                        const updated = { ...arr[idx]!, action: next };
                        const composedDesc = composeDescription(
                          updated.device ?? null,
                          next,
                          updated.details ?? null,
                        );
                        if (composedDesc) updated.description = composedDesc;
                        const tmpl =
                          updated.device && next
                            ? taskTemplates.find(
                                (t) =>
                                  (t.device ?? "").toLowerCase() ===
                                    (updated.device ?? "").toLowerCase() &&
                                  (t.action ?? "").toLowerCase() === next.toLowerCase(),
                              )
                            : null;
                        if (tmpl && !updated.baseRateId) {
                          updated.unitPrice = tmpl.defaultPrice;
                          updated.lineTotal = roundCents(updated.qty * tmpl.defaultPrice);
                        }
                        arr[idx] = updated;
                        return arr;
                      });
                    }}
                    suggestions={tagSuggestions(taskTemplates, "action")}
                    placeholder="Action"
                    ariaLabel="Action"
                  />
                  <AdminInput
                    type="text"
                    value={task.details ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onTasksChange((prev) => {
                        const arr = [...prev];
                        const updated = { ...arr[idx]!, details: raw === "" ? null : raw };
                        const composedDesc = composeDescription(
                          updated.device ?? null,
                          updated.action ?? null,
                          updated.details,
                        );
                        if (composedDesc) updated.description = composedDesc;
                        arr[idx] = updated;
                        return arr;
                      });
                    }}
                    placeholder="Details (optional)"
                    aria-label="Details"
                  />
                </div>
                <p
                  className={cn(
                    "truncate rounded-md bg-admin-bg px-3 py-2 text-sm text-admin-text sm:py-1.5",
                    !composed && "text-admin-muted italic",
                  )}
                  title={composed || "Pick device + action"}
                >
                  {composed || "Pick device + action"}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <AdminSelect
                    value={task.baseRateId ?? ""}
                    onChange={(e) => onSetTaskBase(idx, e.target.value || null)}
                    aria-label="Base rate"
                    className="w-auto"
                  >
                    <option value="">No base</option>
                    {baseRates.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label} ({formatNZD(r.ratePerHour ?? 0)}/hr)
                      </option>
                    ))}
                  </AdminSelect>
                  {modifierRates.map((m) => {
                    const active = task.modifierIds?.includes(m.id) ?? false;
                    let chipLabel: string;
                    if (m.percentDelta !== null) {
                      const pct = Math.round(m.percentDelta * 100);
                      chipLabel = `${m.label} ${pct >= 0 ? "+" : ""}${pct}%`;
                    } else {
                      const delta = m.hourlyDelta ?? 0;
                      const sign = delta < 0 ? "-" : "+";
                      chipLabel = `${m.label} ${sign}$${Math.abs(delta)}`;
                    }
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onToggleTaskModifier(idx, m.id)}
                        aria-pressed={active}
                        className={toggleChipClass(active)}
                      >
                        {chipLabel}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      onTasksChange((prev) =>
                        prev.map((t, i) =>
                          i === idx ? { ...t, unsuccessful: !t.unsuccessful } : t,
                        ),
                      )
                    }
                    aria-pressed={task.unsuccessful ?? false}
                    title={`Mark this task as not finished (${unsuccessfulShareLabel(unsuccessfulFactor)})`}
                    className={toggleChipClass(
                      task.unsuccessful ?? false,
                      "border-amber-300 bg-amber-50 text-amber-700",
                    )}
                  >
                    Didn&apos;t finish
                  </button>
                  <span className="ml-auto text-sm font-semibold text-admin-text">
                    = {formatNZD(task.unitPrice)}/hr
                  </span>
                </div>
                <TaskTotalsRow
                  task={task}
                  lineTotal={lineTotals[idx]!}
                  spread
                  onQty={(v) => onUpdateTask(idx, "qty", v)}
                  onPrice={(v) => onUpdateTask(idx, "unitPrice", v)}
                  onDelete={() => onTasksChange((p) => p.filter((_, i) => i !== idx))}
                />
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAddTask}
        className={cn(TEXT_ACTION_CLS, "inline-flex h-11 items-center sm:h-auto")}
      >
        + Add task
      </button>
    </Card>
  );
}

/**
 * Recomposes decimal hours from whole hours + minutes, rounded to 2dp - the same
 * convention as `withMinutes` in business.ts, so the round-trip is stable.
 * @param h - Whole hours.
 * @param m - Minutes (0-59).
 * @returns Decimal hours.
 */
function hoursFromHM(h: number, m: number): number {
  return Math.round(((h * 60 + m) / 60) * 100) / 100;
}

/**
 * Qty + unit price + total + delete strip for every row. `spread` (task rows) fills
 * the row and edits hrs + mins; `task.qty` always stays decimal.
 * @param props - Component props.
 * @param props.task - The task line to render controls for.
 * @param props.lineTotal - The line's total as the invoice prints it.
 * @param props.onQty - Called with the new decimal qty when hrs/mins/qty change.
 * @param props.onPrice - Called when the operator edits the $/unit input.
 * @param props.onDelete - Called when the × button is pressed.
 * @param props.spread - True for task rows: fill the row and split time into hrs + mins.
 * @returns Totals strip element.
 */
function TaskTotalsRow({
  task,
  lineTotal,
  onQty,
  onPrice,
  onDelete,
  spread = false,
}: {
  task: TaskLine;
  lineTotal: number;
  onQty: (v: number) => void;
  onPrice: (v: number) => void;
  onDelete: () => void;
  spread?: boolean;
}): React.ReactElement {
  // Decompose decimal qty for display; round-trips through 2dp (50 min > 0.83 > 50).
  const totalMins = Math.round(task.qty * 60);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  // Laid over AdminInput: tighter padding and right-aligned figures for the narrow boxes.
  const numInput = "number-input-clean px-2 text-right";
  return (
    <div
      className={cn(
        "grid items-center gap-2",
        spread
          ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_44px] sm:flex sm:w-full sm:items-center sm:gap-2"
          : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_44px] sm:flex sm:flex-none sm:items-center sm:gap-2",
      )}
    >
      {spread ? (
        <>
          <label className="flex flex-col gap-0.5 sm:contents">
            <span className="text-sm font-medium tracking-wide text-admin-muted uppercase sm:hidden">
              Hrs
            </span>
            <AdminInput
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={hrs || ""}
              onChange={(e) =>
                onQty(hoursFromHM(Math.max(0, parseInt(e.target.value, 10) || 0), mins))
              }
              aria-label="Hours"
              className={cn(numInput, "sm:w-14")}
            />
          </label>
          <span className="hidden text-sm text-admin-muted sm:inline">hr</span>
          <label className="flex flex-col gap-0.5 sm:contents">
            <span className="text-sm font-medium tracking-wide text-admin-muted uppercase sm:hidden">
              Min
            </span>
            <AdminInput
              type="number"
              min="0"
              max="59"
              step="5"
              inputMode="numeric"
              value={mins || ""}
              onChange={(e) =>
                onQty(
                  hoursFromHM(hrs, Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0))),
                )
              }
              aria-label="Minutes"
              className={cn(numInput, "sm:w-14")}
            />
          </label>
          <span className="hidden text-sm text-admin-muted sm:inline">min</span>
        </>
      ) : (
        <label className="flex flex-col gap-0.5 sm:contents">
          <span className="text-sm font-medium tracking-wide text-admin-muted uppercase sm:hidden">
            Qty
          </span>
          <AdminInput
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={task.qty}
            onChange={(e) => onQty(Math.max(0, parseFloat(e.target.value) || 0))}
            aria-label="Quantity"
            className={cn(numInput, "sm:w-20")}
          />
        </label>
      )}
      <label className="flex flex-col gap-0.5 sm:contents">
        <span className="text-sm font-medium tracking-wide text-admin-muted uppercase sm:hidden">
          {spread ? "$/hr" : "$/unit"}
        </span>
        <AdminInput
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={task.unitPrice || ""}
          // min="0" isn't enforced on typing; a negative rate would bill a negative surcharge.
          onChange={(e) => onPrice(Math.max(0, parseFloat(e.target.value) || 0))}
          aria-label="Unit price"
          className={cn(numInput, "sm:w-24")}
        />
      </label>
      {spread && <span className="hidden text-sm text-admin-muted sm:inline">$/hr</span>}
      <span
        className={cn(
          "self-end text-right text-sm font-semibold text-admin-text sm:w-24 sm:self-center",
          spread && "sm:ml-auto",
        )}
        aria-label="Line total"
      >
        {formatNZD(lineTotal)}
      </span>
      <button type="button" onClick={onDelete} aria-label="Remove task" className={REMOVE_ROW_CLS}>
        ×
      </button>
    </div>
  );
}
