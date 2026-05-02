"use client";

import { useState, useEffect, useCallback } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import {
  formatNZD,
  calcJobTotal,
  jobToLineItems,
  buildIncomeDescription,
  minsToHoursLabel,
  billableMins,
  matchRateById,
} from "@/features/business/lib/business";
import { ContactPickerModal } from "@/features/business/components/ContactPickerModal";
import { ParseConfidenceBanner } from "@/features/business/components/ParseConfidenceBanner";
import type {
  RateConfig,
  TaskLine,
  PartLine,
  JobCalculation,
  ParseJobResponse,
  GoogleContact,
  TaskTemplate,
} from "@/features/business/types/business";

/**
 * Returns the current local time formatted as HH:MM.
 * @returns The current time string in HH:MM format.
 */
function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/**
 * Adds one hour to a time string, wrapping around at midnight.
 * @param t - A time string in HH:MM format.
 * @returns A new time string one hour later, in HH:MM format.
 */
function addHour(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
/**
 * Calculates the difference in minutes between two HH:MM time strings.
 * @param start - The start time in HH:MM format.
 * @param end - The end time in HH:MM format.
 * @returns The number of minutes between start and end, or 0 if end is not after start.
 */
function timeDiffMins(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const diff = eh * 60 + em - (sh * 60 + sm);
  return diff > 0 ? diff : 0;
}

/**
 * Builds an empty task line seeded from the first non-default flat rate in the given rate list.
 * @param rates - The list of available rate configurations.
 * @returns A default TaskLine pre-filled with the first matching flat rate, or zeroed values.
 */
function emptyTask(rates: RateConfig[]): TaskLine {
  const flat = rates.find((r) => r.flatRate !== null && !r.isDefault);
  return {
    rateConfigId: flat?.id ?? null,
    description: flat?.label ?? "",
    qty: 1,
    unitPrice: flat?.flatRate ?? 0,
    lineTotal: flat?.flatRate ?? 0,
  };
}

/**
 * Interactive job calculator that lets an admin build a job quote using AI parsing, time tracking,
 * tasks, parts, and client details, then save it as income or convert it to an invoice.
 * @param props - Component props.
 * @param props.token - The admin authentication token used for API requests.
 * @returns The rendered calculator view element.
 */
export function CalculatorView({ token }: { token: string }): React.ReactElement {
  const router = useRouter();
  const headers = { "X-Admin-Secret": token };

  const [rates, setRates] = useState<RateConfig[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  const [startTime, setStartTime] = useState(nowTime());
  const [endTime, setEndTime] = useState(addHour(nowTime()));
  const [durationOverride, setDurationOverride] = useState<number | null>(null);
  const [hourlyRateId, setHourlyRateId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskLine[]>([]);
  const [parts, setParts] = useState<PartLine[]>([]);
  const [showParts, setShowParts] = useState(false);
  const [notes, setNotes] = useState("");
  const [gst, setGst] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");

  const [aiInput, setAiInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseJobResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasParsed, setHasParsed] = useState(false);

  const [showContactPicker, setShowContactPicker] = useState(false);
  const [savingIncome, setSavingIncome] = useState(false);
  const [incomeToast, setIncomeToast] = useState<string | null>(null);

  const [showRates, setShowRates] = useState(false);
  const [rateForm, setRateForm] = useState({
    label: "",
    type: "flat" as "flat" | "hourly",
    amount: "",
    unit: "job",
    isDefault: false,
  });
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([
      fetch("/api/business/rates", { headers }).then((r) => r.json()),
      fetch("/api/business/task-templates", { headers }).then((r) => r.json()),
    ]).then(
      ([ratesData, templatesData]: [
        { ok: boolean; rates: RateConfig[] },
        { ok: boolean; templates: TaskTemplate[] },
      ]) => {
        if (ratesData.ok) {
          setRates(ratesData.rates);
          const def = ratesData.rates.find((r) => r.isDefault);
          if (def) setHourlyRateId(def.id);
        }
        if (templatesData.ok) setTaskTemplates(templatesData.templates);
      },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const durationMins = durationOverride ?? timeDiffMins(startTime, endTime);
  const hourlyRate = matchRateById(rates, hourlyRateId);
  const hourlyRates = rates.filter((r) => r.ratePerHour !== null);
  const flatRates = rates.filter((r) => r.flatRate !== null);

  const job: JobCalculation = {
    startTime,
    endTime,
    durationMins,
    hourlyRate,
    tasks,
    parts,
    notes,
    gst,
    clientName,
    clientEmail,
  };
  const totals = calcJobTotal(job);

  /**
   * Applies a parsed job response to the calculator state, setting duration, hourly rate, tasks,
   * parts, and notes from the AI parse result.
   * @param result - The parsed job response returned by the AI.
   * @param rateList - The current list of rate configurations (unused directly but kept for future use).
   */
  const applyParseResult = useCallback((result: ParseJobResponse, rateList: RateConfig[]) => {
    if (result.startTime && result.endTime) {
      setStartTime(result.startTime);
      setEndTime(result.endTime);
      setDurationOverride(null);
    } else if (result.startTime) {
      setStartTime(result.startTime);
      setEndTime(nowTime());
      setDurationOverride(null);
    } else if (result.durationMins !== null) {
      const now = new Date();
      const endTotalMins = now.getHours() * 60 + now.getMinutes();
      const startTotalMins = Math.max(0, endTotalMins - result.durationMins);
      const sh = Math.floor(startTotalMins / 60);
      const sm = startTotalMins % 60;
      setStartTime(`${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`);
      setEndTime(nowTime());
      setDurationOverride(null);
    }
    setHourlyRateId(result.hourlyRateId);
    setTasks(
      result.tasks.map((t) => ({
        rateConfigId: t.rateConfigId,
        description: t.description,
        qty: t.qty,
        unitPrice: t.unitPrice,
        lineTotal: Math.round(t.qty * t.unitPrice * 100) / 100,
      })),
    );
    setParts(result.parts.map((p) => ({ description: p.description, cost: p.cost })));
    if (result.notes) setNotes(result.notes);
    void rateList;
  }, []);

  /**
   * Submits the free-text AI input to the parse-job API and applies the result to the calculator
   * state, or sets an error message if parsing fails.
   */
  async function handleParse(): Promise<void> {
    if (!aiInput.trim()) return;
    setParsing(true);
    setParseError(null);
    setParseResult(null);
    try {
      const res = await fetch("/api/business/parse-job", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ input: aiInput }),
      });
      const d = await res.json();
      if (d.ok) {
        setParseResult(d.result);
        applyParseResult(d.result, rates);
        setHasParsed(true);
      } else {
        setParseError("Couldn't parse that - try being more specific, or build manually below.");
      }
    } catch {
      setParseError("Couldn't parse that - try being more specific, or build manually below.");
    }
    setParsing(false);
  }

  /**
   * Updates a single field on a task line, recalculating the line total when quantity or unit price
   * changes, and auto-filling description and price when a rate config is selected.
   * @param idx - The zero-based index of the task in the tasks array.
   * @param field - The field on the TaskLine to update.
   * @param val - The new value for the field.
   */
  function updateTask(idx: number, field: keyof TaskLine, val: string | number | null): void {
    setTasks((prev) => {
      const t = [...prev];
      const item = { ...t[idx], [field]: val };
      if (field === "rateConfigId") {
        const rate = rates.find((r) => r.id === val);
        if (rate) {
          item.description = rate.label;
          item.unitPrice = rate.flatRate ?? rate.ratePerHour ?? 0;
          item.lineTotal = Math.round(item.qty * item.unitPrice * 100) / 100;
        }
      }
      if (field === "qty" || field === "unitPrice") {
        item.lineTotal = Math.round(Number(item.qty) * Number(item.unitPrice) * 100) / 100;
      }
      t[idx] = item;
      return t;
    });
  }

  /**
   * Saves custom task descriptions to the template library for future reuse.
   * @param taskList - Tasks from the current job to persist as templates
   */
  async function saveTaskTemplates(taskList: TaskLine[]): Promise<void> {
    const custom = taskList.filter((t) => t.rateConfigId === null && t.description.trim());
    await Promise.all(
      custom.map((t) =>
        fetch("/api/business/task-templates", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ description: t.description.trim(), defaultPrice: t.unitPrice }),
        })
          .then((r) => r.json())
          .then((d: { ok: boolean; template: TaskTemplate }) => {
            if (d.ok) {
              setTaskTemplates((prev) => {
                const exists = prev.find((p) => p.id === d.template.id);
                return exists
                  ? prev.map((p) => (p.id === d.template.id ? d.template : p))
                  : [...prev, d.template].sort((a, b) => b.usageCount - a.usageCount);
              });
            }
          }),
      ),
    );
  }

  /**
   * Saves task templates then navigates to the new-invoice page with the job pre-populated.
   */
  async function handleCreateInvoice(): Promise<void> {
    await saveTaskTemplates(tasks);
    const lineItems = jobToLineItems(job);
    const q = new URLSearchParams({
      clientName,
      clientEmail,
      lineItems: JSON.stringify(lineItems),
      gst: String(gst),
      notes,
    });
    router.push(`/admin/business/invoices/new?token=${encodeURIComponent(token)}&${q.toString()}`);
  }

  /**
   * Posts the current job to the income API to record it as an income entry, then resets the
   * calculator state and shows a confirmation toast on success.
   */
  async function handleSaveIncome(): Promise<void> {
    setSavingIncome(true);
    await saveTaskTemplates(tasks);
    const res = await fetch("/api/business/income", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        customer: clientName || "Walk-in",
        description: buildIncomeDescription(job),
        amount: totals.subtotal,
        method: "Business Account",
      }),
    });
    const d = await res.json();
    if (d.ok) {
      setIncomeToast("Income entry saved.");
      setTimeout(() => setIncomeToast(null), 3000);
      // Reset
      setDurationOverride(null);
      setTasks([]);
      setParts([]);
      setNotes("");
      setClientName("");
      setClientEmail("");
      setAiInput("");
      setParseResult(null);
      setHasParsed(false);
    }
    setSavingIncome(false);
  }

  // Rate management
  /**
   * Populates the rate form with an existing rate's values and enters edit mode.
   * @param r - The rate configuration to edit.
   */
  function handleStartEdit(r: RateConfig): void {
    setEditingRateId(r.id);
    setRateForm({
      label: r.label,
      type: r.ratePerHour !== null ? "hourly" : "flat",
      amount: String(r.ratePerHour ?? r.flatRate ?? ""),
      unit: r.unit,
      isDefault: r.isDefault,
    });
  }

  /**
   * Cancels an in-progress rate edit and resets the form to its blank state.
   */
  function handleCancelEdit(): void {
    setEditingRateId(null);
    setRateForm({ label: "", type: "flat", amount: "", unit: "job", isDefault: false });
  }

  /**
   * Submits the rate form - PATCHes the existing rate when editing, or POSTs a new one.
   * @param e - The form submit event.
   */
  async function handleSubmitRate(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const body = {
      label: rateForm.label,
      ratePerHour: rateForm.type === "hourly" ? parseFloat(rateForm.amount) : null,
      flatRate: rateForm.type === "flat" ? parseFloat(rateForm.amount) : null,
      unit: rateForm.unit,
      isDefault: rateForm.isDefault,
    };

    if (editingRateId) {
      const res = await fetch(`/api/business/rates/${editingRateId}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.ok) {
        setRates((prev) =>
          rateForm.isDefault
            ? prev.map((r) => (r.id === editingRateId ? d.rate : { ...r, isDefault: false }))
            : prev.map((r) => (r.id === editingRateId ? d.rate : r)),
        );
        handleCancelEdit();
      }
    } else {
      const res = await fetch("/api/business/rates", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.ok) {
        setRates((prev) =>
          rateForm.isDefault
            ? prev.map((r) => ({ ...r, isDefault: false })).concat(d.rate)
            : [...prev, d.rate],
        );
        setRateForm({ label: "", type: "flat", amount: "", unit: "job", isDefault: false });
      }
    }
  }

  /**
   * Prompts the user to confirm deletion, then sends a DELETE request for the given rate and
   * removes it from the local rates list on success.
   * @param id - The ID of the rate configuration to delete.
   */
  async function handleDeleteRate(id: string): Promise<void> {
    if (!confirm("Delete this rate?")) return;
    const res = await fetch(`/api/business/rates/${id}`, { method: "DELETE", headers });
    if ((await res.json()).ok) setRates((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <>
      {showContactPicker && (
        <ContactPickerModal
          token={token}
          onSelect={(c: GoogleContact) => {
            setClientName(c.name);
            setClientEmail(c.email);
          }}
          onClose={() => setShowContactPicker(false)}
        />
      )}

      <div className={cn("mb-4 flex justify-end")}>
        <button
          onClick={() => setShowRates((p) => !p)}
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50",
          )}
        >
          {showRates ? "Hide rates" : "Manage rates"}
        </button>
      </div>

      {/* Rate settings panel */}
      {showRates && (
        <div className={cn("mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
          <h2 className={cn("text-russian-violet mb-3 text-sm font-semibold")}>Rate config</h2>
          <table className={cn("mb-4 w-full text-xs")}>
            <thead>
              <tr className={cn("border-b border-slate-100")}>
                {["Label", "Rate", "Unit", "Default", ""].map((h) => (
                  <th key={h} className={cn("pb-2 text-left text-xs font-semibold text-slate-400")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={cn("divide-y divide-slate-50")}>
              {rates.map((r) => (
                <tr key={r.id} className={cn(editingRateId === r.id ? "bg-russian-violet/5" : "")}>
                  <td className={cn("py-1.5 text-slate-700")}>{r.label}</td>
                  <td className={cn("py-1.5 text-slate-500")}>
                    {r.ratePerHour !== null
                      ? `$${r.ratePerHour}/hr`
                      : r.flatRate !== null
                        ? `$${r.flatRate}`
                        : "-"}
                  </td>
                  <td className={cn("py-1.5 text-slate-400")}>{r.unit}</td>
                  <td className={cn("py-1.5")}>{r.isDefault ? "✓" : ""}</td>
                  <td className={cn("flex gap-2 py-1.5")}>
                    <button
                      onClick={() => handleStartEdit(r)}
                      className={cn("text-slate-400 hover:text-slate-700")}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteRate(r.id)}
                      className={cn("text-red-400 hover:text-red-600")}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form onSubmit={handleSubmitRate} className={cn("grid items-end gap-2 sm:grid-cols-5")}>
            <input
              type="text"
              placeholder="Label"
              required
              value={rateForm.label}
              onChange={(e) => setRateForm((p) => ({ ...p, label: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
              )}
            />
            <select
              value={rateForm.type}
              onChange={(e) =>
                setRateForm((p) => ({ ...p, type: e.target.value as "flat" | "hourly" }))
              }
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
              )}
            >
              <option value="flat">Flat</option>
              <option value="hourly">Hourly</option>
            </select>
            <input
              type="number"
              placeholder="Amount"
              required
              step="0.01"
              min="0"
              value={rateForm.amount}
              onChange={(e) => setRateForm((p) => ({ ...p, amount: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
              )}
            />
            <input
              type="text"
              placeholder="Unit"
              value={rateForm.unit}
              onChange={(e) => setRateForm((p) => ({ ...p, unit: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
              )}
            />
            <div className={cn("flex gap-2")}>
              <button
                type="submit"
                className={cn(
                  "bg-russian-violet rounded-lg px-3 py-1.5 text-xs font-medium text-white hover:opacity-90",
                )}
              >
                {editingRateId ? "Update" : "Add"}
              </button>
              {editingRateId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className={cn(
                    "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50",
                  )}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      <div className={cn("grid gap-6 lg:grid-cols-2")}>
        {/* LEFT column */}
        <div className={cn("space-y-5")}>
          {/* AI input */}
          <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
            <h2 className={cn("text-russian-violet mb-3 text-sm font-semibold")}>
              Describe the job
            </h2>
            <textarea
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              rows={3}
              placeholder="e.g. Was at Dave's for 2 hours, removed some malware, set up his new router, had to drive out to Papakura"
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
            {parseError && <p className={cn("mt-1 text-xs text-red-600")}>{parseError}</p>}
            <div className={cn("mt-3 flex gap-2")}>
              <button
                onClick={handleParse}
                disabled={parsing || !aiInput.trim()}
                className={cn(
                  "bg-russian-violet rounded-lg px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50",
                )}
              >
                {parsing ? "Parsing..." : hasParsed ? "Re-parse" : "Parse with AI"}
              </button>
              <span className={cn("self-center text-xs text-slate-400")}>
                or build manually below
              </span>
            </div>
            {parseResult && !parseError && (
              <div className={cn("mt-3")}>
                <ParseConfidenceBanner
                  confidence={parseResult.confidence}
                  warnings={parseResult.warnings}
                  onDismiss={() => setParseResult(null)}
                />
              </div>
            )}
          </div>

          {/* Time */}
          <div
            className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
          >
            <h2 className={cn("text-russian-violet text-sm font-semibold")}>Time</h2>
            <div className={cn("grid grid-cols-2 gap-3")}>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>Start</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => {
                    setStartTime(e.target.value);
                    setDurationOverride(null);
                  }}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                  )}
                />
              </div>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>End</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => {
                    setEndTime(e.target.value);
                    setDurationOverride(null);
                  }}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                  )}
                />
              </div>
            </div>
            <div className={cn("grid grid-cols-2 gap-3")}>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>
                  Duration (override)
                </label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={durationOverride ?? durationMins}
                  onChange={(e) => setDurationOverride(parseInt(e.target.value) || 0)}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                  )}
                />
                <p className={cn("mt-1 text-xs text-slate-400")}>
                  {minsToHoursLabel(durationMins)}
                </p>
              </div>
              <div>
                <label className={cn("mb-1 block text-xs font-medium text-slate-500")}>
                  Hourly rate
                </label>
                <select
                  value={hourlyRateId ?? ""}
                  onChange={(e) => setHourlyRateId(e.target.value || null)}
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                  )}
                >
                  <option value="">None</option>
                  {hourlyRates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} ({formatNZD(r.ratePerHour ?? 0)}/hr)
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Tasks */}
          <div
            className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
          >
            <h2 className={cn("text-russian-violet text-sm font-semibold")}>Tasks</h2>
            {tasks.map((task, idx) => (
              <div
                key={idx}
                className={cn("grid grid-cols-[120px_auto_60px_80px_80px_24px] items-center gap-2")}
              >
                <select
                  value={task.rateConfigId ? `rate:${task.rateConfigId}` : "custom"}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "custom") {
                      updateTask(idx, "rateConfigId", null);
                    } else if (val.startsWith("template:")) {
                      const tmpl = taskTemplates.find((t) => t.id === val.slice(9));
                      if (tmpl) {
                        setTasks((prev) => {
                          const next = [...prev];
                          next[idx] = {
                            ...next[idx],
                            rateConfigId: null,
                            description: tmpl.description,
                            unitPrice: tmpl.defaultPrice,
                            lineTotal: tmpl.defaultPrice,
                          };
                          return next;
                        });
                      }
                    } else {
                      updateTask(idx, "rateConfigId", val.slice(5));
                    }
                  }}
                  className={cn(
                    "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
                  )}
                >
                  <option value="custom">Custom</option>
                  {taskTemplates.length > 0 && (
                    <optgroup label="Saved services">
                      {taskTemplates.map((t) => (
                        <option key={t.id} value={`template:${t.id}`}>
                          {t.description}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {flatRates.length > 0 && (
                    <optgroup label="Flat rates">
                      {flatRates.map((r) => (
                        <option key={r.id} value={`rate:${r.id}`}>
                          {r.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {task.rateConfigId === null ? (
                  <input
                    type="text"
                    placeholder="Description"
                    value={task.description}
                    onChange={(e) => updateTask(idx, "description", e.target.value)}
                    className={cn(
                      "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
                    )}
                  />
                ) : (
                  <div className={cn("truncate text-xs text-slate-500")}>{task.description}</div>
                )}
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  title="Hours"
                  value={task.qty}
                  onChange={(e) => updateTask(idx, "qty", parseFloat(e.target.value) || 0)}
                  className={cn(
                    "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
                  )}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={task.unitPrice}
                  onChange={(e) => updateTask(idx, "unitPrice", parseFloat(e.target.value) || 0)}
                  className={cn(
                    "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
                  )}
                />
                <p className={cn("text-right text-xs font-medium text-slate-700")}>
                  {formatNZD(task.lineTotal)}
                </p>
                <button
                  onClick={() => setTasks((p) => p.filter((_, i) => i !== idx))}
                  className={cn("text-lg leading-none text-slate-300 hover:text-red-500")}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => setTasks((p) => [...p, emptyTask(rates)])}
              className={cn("hover:text-russian-violet text-xs text-slate-500 underline")}
            >
              + Add task
            </button>
          </div>

          {/* Parts */}
          <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
            <button
              onClick={() => setShowParts((p) => !p)}
              className={cn(
                "text-russian-violet flex w-full items-center justify-between text-left text-sm font-semibold",
              )}
            >
              Parts / materials
              <span className={cn("text-xs text-slate-400")}>{showParts ? "▲" : "▼"}</span>
            </button>
            {showParts && (
              <div className={cn("mt-3 space-y-2")}>
                {parts.map((part, idx) => (
                  <div
                    key={idx}
                    className={cn("grid grid-cols-[1fr_80px_24px] items-center gap-2")}
                  >
                    <input
                      type="text"
                      placeholder="Description"
                      value={part.description}
                      onChange={(e) =>
                        setParts((p) => {
                          const n = [...p];
                          n[idx] = { ...n[idx], description: e.target.value };
                          return n;
                        })
                      }
                      className={cn(
                        "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
                      )}
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Cost"
                      value={part.cost}
                      onChange={(e) =>
                        setParts((p) => {
                          const n = [...p];
                          n[idx] = { ...n[idx], cost: parseFloat(e.target.value) || 0 };
                          return n;
                        })
                      }
                      className={cn(
                        "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
                      )}
                    />
                    <button
                      onClick={() => setParts((p) => p.filter((_, i) => i !== idx))}
                      className={cn("text-lg leading-none text-slate-300 hover:text-red-500")}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setParts((p) => [...p, { description: "", cost: 0 }])}
                  className={cn("hover:text-russian-violet text-xs text-slate-500 underline")}
                >
                  + Add part
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
            <label className={cn("mb-1 block text-xs font-medium text-slate-600")}>Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </div>
        </div>

        {/* RIGHT column - live summary */}
        <div className={cn("space-y-4")}>
          <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
            <h2 className={cn("text-russian-violet mb-4 text-sm font-semibold")}>Summary</h2>
            <div className={cn("space-y-2 text-sm")}>
              {durationMins > 0 && hourlyRate && hourlyRate.ratePerHour !== null && (
                <div className={cn("flex justify-between text-slate-600")}>
                  <span>
                    Time ({minsToHoursLabel(billableMins(durationMins))} @{" "}
                    {formatNZD(hourlyRate.ratePerHour)}/hr)
                  </span>
                  <span>{formatNZD(totals.timeCharge)}</span>
                </div>
              )}
              {totals.tasksTotal > 0 && (
                <div className={cn("flex justify-between text-slate-600")}>
                  <span>Tasks</span>
                  <span>{formatNZD(totals.tasksTotal)}</span>
                </div>
              )}
              {totals.partsTotal > 0 && (
                <div className={cn("flex justify-between text-slate-600")}>
                  <span>Parts</span>
                  <span>{formatNZD(totals.partsTotal)}</span>
                </div>
              )}
              <div
                className={cn(
                  "flex justify-between border-t border-slate-100 pt-2 font-medium text-slate-700",
                )}
              >
                <span>Subtotal</span>
                <span>{formatNZD(totals.subtotal)}</span>
              </div>
              <div className={cn("flex items-center justify-between")}>
                <label className={cn("flex cursor-pointer items-center gap-2 text-slate-600")}>
                  <input
                    type="checkbox"
                    checked={gst}
                    onChange={(e) => setGst(e.target.checked)}
                    className={cn("h-3.5 w-3.5")}
                  />
                  GST (15%)
                </label>
                <span className={cn("text-slate-600")}>{formatNZD(totals.gstAmount)}</span>
              </div>
              <div
                className={cn(
                  "text-russian-violet flex justify-between border-t border-slate-200 pt-2 text-base font-extrabold",
                )}
              >
                <span>Total</span>
                <span>{formatNZD(totals.total)}</span>
              </div>
            </div>
          </div>

          {/* Client */}
          <div
            className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}
          >
            <div className={cn("flex items-center justify-between")}>
              <h2 className={cn("text-russian-violet text-sm font-semibold")}>Client</h2>
              <button
                onClick={() => setShowContactPicker(true)}
                className={cn("hover:text-russian-violet text-xs text-slate-500 underline")}
              >
                Pick from contacts
              </button>
            </div>
            <input
              type="text"
              placeholder="Name"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
            <input
              type="email"
              placeholder="Email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
          </div>

          {/* Actions */}
          <div className={cn("space-y-2")}>
            {incomeToast && (
              <div
                className={cn(
                  "rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700",
                )}
              >
                {incomeToast}
              </div>
            )}
            <button
              onClick={handleCreateInvoice}
              className={cn(
                "bg-russian-violet w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90",
              )}
            >
              Create invoice from this job
            </button>
            <button
              onClick={handleSaveIncome}
              disabled={savingIncome || totals.subtotal === 0}
              className={cn(
                "w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50",
              )}
            >
              {savingIncome ? "Saving..." : "Save as income entry"}
            </button>
            <button
              onClick={() => {
                setDurationOverride(null);
                setTasks([]);
                setParts([]);
                setNotes("");
                setClientName("");
                setClientEmail("");
                setAiInput("");
                setParseResult(null);
                setHasParsed(false);
                setGst(false);
              }}
              className={cn(
                "w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500 hover:bg-slate-50",
              )}
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
