"use client";

import { Combobox } from "@/features/business/components/Combobox";
import { composeDescription, formatNZD } from "@/features/business/lib/business";
import type { RateConfig, TaskLine, TaskTemplate } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
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
  /** Whole-job unsuccessful flag; when set it already halves every task, so per-task flags show as subsumed. */
  jobUnsuccessful: boolean;
}

/**
 * Sorted, deduplicated suggestions for a Combobox axis (device or action),
 * extracted from the current template snapshot.
 * @param templates - All saved templates.
 * @param key - Which axis to extract.
 * @returns Sorted unique tag values.
 */
function tagSuggestions(templates: TaskTemplate[], key: "device" | "action"): string[] {
  const set = new Set<string>();
  for (const t of templates) {
    const v = t[key];
    if (typeof v === "string" && v.trim().length > 0) set.add(v.trim());
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

/**
 * Tasks list - the core of the job calculator. Each row is either a flat-rate
 * line (Travel etc.) with a rate dropdown + qty/price/total, or a regular task
 * with device + action comboboxes that auto-look up a saved template for
 * pricing. Modifier chips (urgent, weekend, etc.) toggle on each row to nudge
 * the effective hourly rate.
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
 * @param props.jobUnsuccessful - Whole-job unsuccessful flag; dims per-task flags it already covers.
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
  jobUnsuccessful,
}: Props): React.ReactElement {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-russian-violet">Tasks</h2>
        <button
          type="button"
          onClick={onManageTags}
          className="text-xs font-medium text-slate-500 underline hover:text-slate-700"
        >
          Manage tags
        </button>
      </div>
      {tasks.map((task, idx) => {
        // Flat-rate rows (e.g. Travel) keep their old single-line look;
        // task rows use the device + action combobox layout.
        const isFlatRate = task.rateConfigId != null;
        const composed = composeDescription(
          task.device ?? null,
          task.action ?? null,
          task.details ?? null,
        );

        return (
          <div
            key={idx}
            className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:bg-white"
          >
            {isFlatRate ? (
              /* Flat-rate row (Travel etc.): rate dropdown + qty/price/total/delete inline. */
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  value={`rate:${task.rateConfigId}`}
                  onChange={(e) => onUpdateTask(idx, "rateConfigId", e.target.value.slice(5))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none sm:w-40 sm:py-2 sm:text-xs"
                >
                  {flatRates.map((r) => (
                    <option key={r.id} value={`rate:${r.id}`}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <p className="truncate text-sm text-slate-600 sm:flex-1 sm:text-xs sm:text-slate-500">
                  {task.description}
                </p>
                <TaskTotalsRow
                  task={task}
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
                        const updated = { ...arr[idx], device: next };
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
                        if (tmpl) {
                          updated.unitPrice = tmpl.defaultPrice;
                          updated.lineTotal =
                            Math.round(updated.qty * tmpl.defaultPrice * 100) / 100;
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
                        const updated = { ...arr[idx], action: next };
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
                        if (tmpl) {
                          updated.unitPrice = tmpl.defaultPrice;
                          updated.lineTotal =
                            Math.round(updated.qty * tmpl.defaultPrice * 100) / 100;
                        }
                        arr[idx] = updated;
                        return arr;
                      });
                    }}
                    suggestions={tagSuggestions(taskTemplates, "action")}
                    placeholder="Action"
                    ariaLabel="Action"
                  />
                  <input
                    type="text"
                    value={task.details ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onTasksChange((prev) => {
                        const arr = [...prev];
                        const updated = { ...arr[idx], details: raw === "" ? null : raw };
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
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none sm:py-2 sm:text-xs"
                  />
                </div>
                <p
                  className={cn(
                    "truncate rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 sm:py-1.5 sm:text-xs",
                    !composed && "text-slate-400 italic",
                  )}
                  title={composed || "Pick device + action"}
                >
                  {composed || "Pick device + action"}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={task.baseRateId ?? ""}
                    onChange={(e) => onSetTaskBase(idx, e.target.value || null)}
                    aria-label="Base rate"
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
                  >
                    <option value="">No base</option>
                    {baseRates.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label} ({formatNZD(r.ratePerHour ?? 0)}/hr)
                      </option>
                    ))}
                  </select>
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
                        className={cn(
                          "rounded-full border px-2 py-1 text-xs font-medium transition-colors",
                          active
                            ? "border-russian-violet/40 bg-russian-violet/10 text-russian-violet"
                            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                        )}
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
                    title={
                      jobUnsuccessful
                        ? "Whole job is marked unsuccessful, so this task is already half price"
                        : "Mark this task as not finished (half price)"
                    }
                    className={cn(
                      "rounded-full border px-2 py-1 text-xs font-medium transition-colors",
                      task.unsuccessful
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                      jobUnsuccessful && "opacity-50",
                    )}
                  >
                    Didn&apos;t finish
                  </button>
                  <span className="ml-auto text-xs font-semibold text-slate-700">
                    = {formatNZD(task.unitPrice)}/hr
                  </span>
                </div>
                <TaskTotalsRow
                  task={task}
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
        onClick={onAddTask}
        className="inline-flex h-11 items-center text-sm text-slate-500 underline hover:text-russian-violet sm:h-auto sm:text-xs"
      >
        + Add task
      </button>
    </div>
  );
}

/**
 * Compact qty + unit-price + total + delete row shared by both flat-rate and
 * device/action task rows. Stacks on mobile; at sm+ it becomes an inline strip -
 * compact for flat-rate rows, or full width when `spread` is set so the line
 * total lines up under the effective-rate readout above.
 * @param props - Component props.
 * @param props.task - The task line to render controls for.
 * @param props.onQty - Called when the operator edits the hours / qty input.
 * @param props.onPrice - Called when the operator edits the $/unit input.
 * @param props.onDelete - Called when the × button is pressed.
 * @param props.spread - When true (task rows) the strip fills the row and right-aligns the total; flat-rate rows leave it false to stay compact.
 * @returns Totals strip element.
 */
function TaskTotalsRow({
  task,
  onQty,
  onPrice,
  onDelete,
  spread = false,
}: {
  task: TaskLine;
  onQty: (v: number) => void;
  onPrice: (v: number) => void;
  onDelete: () => void;
  spread?: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_44px] items-center gap-2",
        spread
          ? "sm:flex sm:w-full sm:items-center sm:gap-2"
          : "sm:flex sm:flex-none sm:items-center sm:gap-2",
      )}
    >
      <label className="flex flex-col gap-0.5 sm:contents">
        <span className="text-[10px] font-medium tracking-wide text-slate-400 uppercase sm:hidden">
          Hrs
        </span>
        <input
          type="number"
          min="0"
          step="0.25"
          inputMode="decimal"
          value={task.qty}
          onChange={(e) => onQty(parseFloat(e.target.value) || 0)}
          aria-label="Quantity"
          className="number-input-clean w-full rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-right text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none sm:w-20 sm:py-2 sm:text-xs"
        />
      </label>
      {spread && <span className="hidden text-xs text-slate-400 sm:inline">hrs</span>}
      <label className="flex flex-col gap-0.5 sm:contents">
        <span className="text-[10px] font-medium tracking-wide text-slate-400 uppercase sm:hidden">
          {spread ? "$/hr" : "$/unit"}
        </span>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={task.unitPrice || ""}
          onChange={(e) => onPrice(parseFloat(e.target.value) || 0)}
          aria-label="Unit price"
          className="number-input-clean w-full rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-right text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none sm:w-24 sm:py-2 sm:text-xs"
        />
      </label>
      {spread && <span className="hidden text-xs text-slate-400 sm:inline">$/hr</span>}
      <span
        className={cn(
          "self-end text-right text-sm font-semibold text-slate-700 sm:w-24 sm:self-center sm:text-xs",
          spread && "sm:ml-auto",
        )}
        aria-label="Line total"
      >
        {formatNZD(task.lineTotal)}
      </span>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Remove task"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl leading-none text-slate-400 hover:bg-red-50 hover:text-red-500 sm:h-9 sm:w-9 sm:rounded-lg sm:text-lg sm:hover:bg-red-50"
      >
        ×
      </button>
    </div>
  );
}
