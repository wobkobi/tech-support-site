"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  effectiveHourlyRate,
  composeDescription,
} from "@/features/business/lib/business";
import { ContactPickerModal } from "@/features/business/components/ContactPickerModal";
import { ParseConfidenceBanner } from "@/features/business/components/ParseConfidenceBanner";
import { TaxonomyManageModal } from "@/features/business/components/TaxonomyManageModal";
import { Combobox } from "@/features/business/components/Combobox";
import { loadPlacesLibrary } from "@/shared/lib/google-maps-loader";
import { summariseForBanner, type ActivePromo } from "@/features/business/lib/promos";
import type {
  RateConfig,
  TaskLine,
  PartLine,
  JobCalculation,
  ParseJobResponse,
  ParseJobQuestion,
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
 * Builds an empty hourly task line seeded with the default base rate (e.g.
 * Standard $65/hr) and no modifiers. The operator picks the device + action
 * after adding the row, and toggles modifier chips to adjust the effective
 * rate. Flat-rate rows (Travel etc.) come from AI parse or address lookup.
 * @param rates - The list of available rate configurations.
 * @returns A default hourly TaskLine.
 */
function emptyTask(rates: RateConfig[]): TaskLine {
  const defaultBase =
    rates.find((r) => r.ratePerHour !== null && r.isDefault) ??
    rates.find((r) => r.ratePerHour !== null) ??
    null;
  const price = defaultBase?.ratePerHour ?? 0;
  return {
    rateConfigId: null,
    baseRateId: defaultBase?.id ?? null,
    modifierIds: [],
    description: "",
    qty: 1,
    unitPrice: price,
    lineTotal: price,
    device: null,
    action: null,
    details: null,
  };
}

/**
 * Builds a sorted, deduplicated suggestion list for one of the combobox axes
 * (devices or actions) from the current task-template snapshot.
 * @param templates - All saved templates.
 * @param key - "device" or "action" - which field to extract.
 * @returns Sorted unique tag values for that axis.
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
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [durationOverride, setDurationOverride] = useState<number | null>(null);
  const [hourlyRateId, setHourlyRateId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskLine[]>([]);
  const [parts, setParts] = useState<PartLine[]>([]);
  const [showParts, setShowParts] = useState(false);
  const [showTaxonomyModal, setShowTaxonomyModal] = useState(false);
  const [notes, setNotes] = useState("");
  const [gst, setGst] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  // Address-to state mirrors the InvoiceBuilder's segmented control so the
  // operator picks Name/Company/Custom once and the choice rides through to
  // the invoice without re-picking.
  const [pickedContactName, setPickedContactName] = useState<string | null>(null);
  const [pickedContactCompany, setPickedContactCompany] = useState<string | null>(null);
  const [addressMode, setAddressModeState] = useState<"name" | "company" | "custom">("custom");

  const [aiInput, setAiInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseJobResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasParsed, setHasParsed] = useState(false);
  const [clarifyQuestions, setClarifyQuestions] = useState<ParseJobQuestion[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});

  const [jobAddress, setJobAddress] = useState("");
  const [travelInfo, setTravelInfo] = useState<{
    distanceKm: number;
    durationMins: number;
    cost: number;
  } | null>(null);
  const [lookingUpTravel, setLookingUpTravel] = useState(false);
  const [travelOnInvoice, setTravelOnInvoice] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);

  const [showContactPicker, setShowContactPicker] = useState(false);
  const [savingIncome, setSavingIncome] = useState(false);
  const [incomeToast, setIncomeToast] = useState<string | null>(null);

  const [showRates, setShowRates] = useState(false);
  const [rateForm, setRateForm] = useState({
    label: "",
    type: "hourly" as "flat" | "hourly" | "modifier",
    amount: "",
    unit: "hour",
    isDefault: false,
  });
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [resettingRates, setResettingRates] = useState(false);

  // Active promo + per-job skip flag (not persisted).
  const [activePromo, setActivePromo] = useState<ActivePromo | null>(null);
  const [skipPromo, setSkipPromo] = useState(false);

  useEffect(() => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey || !addressInputRef.current) return;

    let cancelled = false;
    let listener: google.maps.MapsEventListener | null = null;

    loadPlacesLibrary(apiKey)
      .then(() => {
        if (cancelled || !addressInputRef.current) return;
        const autocomplete = new google.maps.places.Autocomplete(addressInputRef.current, {
          componentRestrictions: { country: "nz" },
          fields: ["formatted_address", "address_components"],
          types: ["geocode"],
        });
        listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          // Prefer suburb (locality) since travel-time looks it up; fall back
          // to the formatted address.
          const suburb =
            place.address_components?.find(
              (c) => c.types.includes("locality") || c.types.includes("sublocality_level_1"),
            )?.long_name ??
            place.formatted_address ??
            "";
          if (suburb) {
            setJobAddress(suburb);
            setTravelInfo(null);
          }
        });
      })
      .catch((err) => {
        console.error("[calculator] Maps autocomplete failed to load:", err);
      });

    return () => {
      cancelled = true;
      if (listener) google.maps.event.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    const now = nowTime();
    Promise.all([
      fetch("/api/business/rates", { headers }).then((r) => r.json()),
      fetch("/api/business/task-templates", { headers }).then((r) => r.json()),
      // Public; auto-applies any live promo to the Summary panel.
      fetch("/api/promos/active")
        .then((r) => r.json())
        .catch(() => ({ ok: false, promo: null })),
    ]).then(
      ([ratesData, templatesData, promoData]: [
        { ok: boolean; rates: RateConfig[] },
        { ok: boolean; templates: TaskTemplate[] },
        { ok: boolean; promo: ActivePromo | null },
      ]) => {
        setStartTime(now);
        setEndTime(addHour(now));
        if (ratesData.ok) {
          setRates(ratesData.rates);
          const def = ratesData.rates.find((r) => r.isDefault);
          if (def) setHourlyRateId(def.id);
        }
        if (templatesData.ok) setTaskTemplates(templatesData.templates);
        setActivePromo(promoData.promo ?? null);
      },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const durationMins = durationOverride ?? timeDiffMins(startTime, endTime);
  const hourlyRate = matchRateById(rates, hourlyRateId);
  // Base hourly rates (e.g. Standard $65/hr) — used for the top-level Time
  // selector and as the per-task base rate.
  const baseRates = rates.filter((r) => r.ratePerHour !== null);
  // Modifier rates (signed $/hr deltas like At home -$10, Complex +$20) —
  // toggled per task to shift the effective rate.
  const modifierRates = rates
    .filter((r) => r.hourlyDelta !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
  const flatRates = rates.filter((r) => r.flatRate !== null);

  const job: JobCalculation = {
    startTime,
    endTime,
    durationMins,
    hourlyRate,
    tasks,
    parts,
    travelCost: travelOnInvoice && travelInfo ? travelInfo.cost : null,
    notes,
    gst,
    clientName,
    clientEmail,
  };
  const totals = calcJobTotal(job, !skipPromo ? activePromo : null);

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
      // Use durationMins as override when the AI provided it explicitly - handles multi-session
      // work where billed time is less than wall-clock diff due to gaps between sessions.
      setDurationOverride(result.durationMins ?? null);
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
    const parsedTasks: TaskLine[] = result.tasks.map((t) => {
      const device = t.device ?? null;
      const action = t.action ?? null;
      const details = t.details?.trim() ? t.details.trim() : null;
      // Server already composes the description, but compose locally as a
      // fallback so descriptions stay correct even if an older route shape
      // sneaks through.
      const description = composeDescription(device, action, details) || t.description || "";
      // If baseRateId is set, this is an hourly task (new rate model) - force
      // rateConfigId to null so the promo math classifies it correctly even
      // if the AI emitted a stray ID.
      const isHourly = t.baseRateId != null;
      return {
        rateConfigId: isHourly ? null : (t.rateConfigId ?? null),
        baseRateId: t.baseRateId ?? null,
        modifierIds: t.modifierIds ?? [],
        description,
        qty: t.qty,
        unitPrice: t.unitPrice,
        lineTotal: Math.round(t.qty * t.unitPrice * 100) / 100,
        device,
        action,
        details,
      };
    });
    const parsedParts = result.parts.map((p) => ({ description: p.description, cost: p.cost }));
    if (result.destination) setJobAddress(result.destination);
    if (result.travel && result.travel.distanceKm > 0) {
      const travelRate = rateList.find((r) => r.unit === "km" && r.flatRate !== null);
      const ratePerKm = travelRate?.flatRate ?? 1.2;
      const cost = Math.round(result.travel.distanceKm * ratePerKm * 100) / 100;
      setTravelInfo({
        distanceKm: result.travel.distanceKm,
        durationMins: result.travel.durationMins,
        cost,
      });
      setTravelOnInvoice(true);
    }
    setTasks(parsedTasks);
    setParts(parsedParts);
    if (result.notes) setNotes(result.notes);
  }, []);

  /**
   * Submits the free-text AI input to the parse-job API and applies the result to the calculator
   * state. If the AI needs clarification it returns questions instead of a result.
   * @param answers - Optional answers to previous clarifying questions to include in the request.
   */
  async function handleParse(answers?: Record<string, string>): Promise<void> {
    if (!aiInput.trim()) return;
    setParsing(true);
    setParseError(null);
    setParseResult(null);
    setClarifyQuestions([]);
    try {
      const body: Record<string, unknown> = { input: aiInput };
      if (answers && Object.keys(answers).length > 0) body.answers = answers;
      const res = await fetch("/api/business/parse-job", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.ok && d.clarify) {
        setClarifyQuestions(d.clarify as ParseJobQuestion[]);
      } else if (d.ok && d.result) {
        setParseResult(d.result);
        applyParseResult(d.result, rates);
        setHasParsed(true);
        setClarifyAnswers({});
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
    // Only save tasks that have BOTH device + action populated. Description-only
    // rows (e.g. flat-rate travel lines) skip templating.
    const custom = taskList.filter((t) => t.rateConfigId == null && t.device && t.action);
    await Promise.all(
      custom.map((t) =>
        fetch("/api/business/task-templates", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            defaultPrice: t.unitPrice,
            device: t.device,
            action: t.action,
            // Description fallback for the server's composeDescription() in case
            // either tag accidentally drops out before persist.
            description: t.description.trim(),
          }),
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
   * Switches address-to mode and updates clientName accordingly. Custom mode
   * keeps whatever clientName already has so the operator can keep editing.
   * @param mode - Target mode.
   */
  function setAddressMode(mode: "name" | "company" | "custom"): void {
    if (mode === "name" && pickedContactName) {
      setAddressModeState("name");
      setClientName(pickedContactName);
      return;
    }
    if (mode === "company" && pickedContactCompany) {
      setAddressModeState("company");
      setClientName(pickedContactCompany);
      return;
    }
    setAddressModeState("custom");
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
    // Carry the picked-contact + address-mode across so the InvoiceBuilder
    // restores the same Name/Company/Custom toggle state the operator chose
    // here, no re-picking.
    if (pickedContactName) q.set("pickedContactName", pickedContactName);
    if (pickedContactCompany) q.set("pickedContactCompany", pickedContactCompany);
    if (pickedContactName) q.set("addressMode", addressMode);
    // Pass promo snapshot to InvoiceBuilder; skipPromo=1 carries the opt-out.
    if (activePromo && !skipPromo && totals.promoDiscount > 0) {
      q.set("promoTitle", activePromo.title);
      q.set("promoDiscount", String(totals.promoDiscount));
    }
    if (skipPromo) q.set("skipPromo", "1");
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
      setClarifyQuestions([]);
      setClarifyAnswers({});
    }
    setSavingIncome(false);
  }

  /** Calls the travel-time API with the current job address and updates travelInfo state. */
  async function handleTravelLookup(): Promise<void> {
    if (!jobAddress.trim()) return;
    setLookingUpTravel(true);
    setTravelInfo(null);
    setTravelOnInvoice(false);
    try {
      const res = await fetch("/api/pricing/travel-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: jobAddress }),
      });
      const d = (await res.json()) as { distanceKm?: number; durationMins?: number };
      if (d.distanceKm && d.distanceKm > 0) {
        const travelRate = rates.find((r) => r.unit === "km" && r.flatRate !== null);
        const ratePerKm = travelRate?.flatRate ?? 1.2;
        const roundTripKm = Math.round(d.distanceKm * 2 * 10) / 10;
        setTravelInfo({
          distanceKm: roundTripKm,
          durationMins: (d.durationMins ?? 0) * 2,
          cost: Math.round(roundTripKm * ratePerKm * 100) / 100,
        });
      }
    } catch {
      // silently ignore - travel is optional
    }
    setLookingUpTravel(false);
  }

  /** Marks the travel charge as included in the invoice total. */
  function addTravelToInvoice(): void {
    if (!travelInfo) return;
    setTravelOnInvoice(true);
  }

  // Rate management
  /**
   * Populates the rate form with an existing rate's values and enters edit mode.
   * @param r - The rate configuration to edit.
   */
  function handleStartEdit(r: RateConfig): void {
    const type: "hourly" | "modifier" | "flat" =
      r.ratePerHour !== null ? "hourly" : r.hourlyDelta !== null ? "modifier" : "flat";
    setEditingRateId(r.id);
    setRateForm({
      label: r.label,
      type,
      amount: String(r.ratePerHour ?? r.hourlyDelta ?? r.flatRate ?? ""),
      unit: r.unit,
      isDefault: r.isDefault,
    });
  }

  /**
   * Cancels an in-progress rate edit and resets the form to its blank state.
   */
  function handleCancelEdit(): void {
    setEditingRateId(null);
    setRateForm({ label: "", type: "hourly", amount: "", unit: "hour", isDefault: false });
  }

  /**
   * Re-fetches the rates list from the API. Used after a reset and after
   * a 404 on edit/delete (which means the row was wiped server-side and our
   * local snapshot is stale).
   */
  async function refreshRates(): Promise<void> {
    try {
      const res = await fetch("/api/business/rates", { headers });
      if (!res.ok) return;
      const d = await res.json();
      if (d.ok && Array.isArray(d.rates)) setRates(d.rates);
    } catch (err) {
      console.error("[calculator] refreshRates failed:", err);
    }
  }

  /**
   * Wipes every rate row and reseeds the defaults (Standard base + modifier set
   * + Travel flat). Confirms first since this drops any custom rates. Also
   * cancels any in-progress edit so the form doesn't hold a stale ID.
   */
  async function handleResetRates(): Promise<void> {
    if (
      !confirm(
        "Wipe all rates and reseed the defaults (Standard, Complex, At home, Student, Remote, Travel)? Any custom rates you've added will be deleted.",
      )
    ) {
      return;
    }
    handleCancelEdit();
    setResettingRates(true);
    try {
      const res = await fetch("/api/business/rates", { method: "DELETE", headers });
      if (!res.ok) {
        console.error("[calculator] reset rates failed with status", res.status);
        return;
      }
      const d = await res.json();
      if (d.ok && Array.isArray(d.rates)) {
        setRates(d.rates);
        const def = d.rates.find((r: RateConfig) => r.isDefault);
        if (def) setHourlyRateId(def.id);
      }
    } finally {
      setResettingRates(false);
    }
  }

  /**
   * Toggles a modifier rate on a task and recomputes the unit price + line
   * total from the resulting base + modifiers combo.
   * @param idx - Task index.
   * @param modifierId - Modifier rate ID being toggled on/off.
   */
  function toggleTaskModifier(idx: number, modifierId: string): void {
    setTasks((prev) => {
      const arr = [...prev];
      const current = arr[idx].modifierIds ?? [];
      const next = current.includes(modifierId)
        ? current.filter((m) => m !== modifierId)
        : [...current, modifierId];
      const newPrice = effectiveHourlyRate(rates, arr[idx].baseRateId, next);
      arr[idx] = {
        ...arr[idx],
        modifierIds: next,
        unitPrice: newPrice,
        lineTotal: Math.round(arr[idx].qty * newPrice * 100) / 100,
      };
      return arr;
    });
  }

  /**
   * Sets a task's base hourly rate and recomputes its unit price + line total.
   * @param idx - Task index.
   * @param baseId - New base rate ID, or null to clear.
   */
  function setTaskBase(idx: number, baseId: string | null): void {
    setTasks((prev) => {
      const arr = [...prev];
      const newPrice = effectiveHourlyRate(rates, baseId, arr[idx].modifierIds);
      arr[idx] = {
        ...arr[idx],
        baseRateId: baseId,
        unitPrice: newPrice,
        lineTotal: Math.round(arr[idx].qty * newPrice * 100) / 100,
      };
      return arr;
    });
  }

  /**
   * Submits the rate form - PATCHes the existing rate when editing, or POSTs a new one.
   * @param e - The form submit event.
   */
  async function handleSubmitRate(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const amount = parseFloat(rateForm.amount);
    const body = {
      label: rateForm.label,
      ratePerHour: rateForm.type === "hourly" ? amount : null,
      flatRate: rateForm.type === "flat" ? amount : null,
      hourlyDelta: rateForm.type === "modifier" ? amount : null,
      unit: rateForm.type === "modifier" ? "modifier" : rateForm.unit,
      isDefault: rateForm.type === "hourly" ? rateForm.isDefault : false,
    };

    if (editingRateId) {
      const res = await fetch(`/api/business/rates/${editingRateId}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // Bail safely on non-OK - 404 typically means the rate was wiped via
      // Reset and our local snapshot is stale. Re-fetch and exit edit mode.
      if (!res.ok) {
        console.error("[calculator] PATCH rate failed with status", res.status);
        handleCancelEdit();
        await refreshRates();
        return;
      }
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
      if (!res.ok) {
        console.error("[calculator] POST rate failed with status", res.status);
        return;
      }
      const d = await res.json();
      if (d.ok) {
        setRates((prev) =>
          rateForm.isDefault
            ? prev.map((r) => ({ ...r, isDefault: false })).concat(d.rate)
            : [...prev, d.rate],
        );
        setRateForm({ label: "", type: "hourly", amount: "", unit: "hour", isDefault: false });
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
    if (!res.ok) {
      // 404 = already deleted server-side. Refresh so the row disappears
      // from the table and the user can move on.
      console.error("[calculator] DELETE rate failed with status", res.status);
      await refreshRates();
      return;
    }
    const d = await res.json();
    if (d.ok) setRates((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <>
      {showContactPicker && (
        <ContactPickerModal
          token={token}
          onSelect={(c: GoogleContact) => {
            const company = c.company?.trim() || null;
            setClientName(c.name);
            setClientEmail(c.email);
            setPickedContactName(c.name);
            setPickedContactCompany(company);
            setAddressModeState("name");
          }}
          onClose={() => setShowContactPicker(false)}
        />
      )}

      {showTaxonomyModal && (
        <TaxonomyManageModal
          token={token}
          onClose={() => setShowTaxonomyModal(false)}
          onChanged={() => {
            // Re-fetch templates so the picker dropdown reflects cleared tags.
            void fetch("/api/business/task-templates", { headers })
              .then((r) => r.json())
              .then((d: { ok: boolean; templates: TaskTemplate[] }) => {
                if (d.ok) setTaskTemplates(d.templates);
              });
          }}
        />
      )}

      {/* Promo chip with per-job skip toggle. */}
      {activePromo && (
        <div
          className={cn(
            "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3",
          )}
        >
          <div className={cn("flex items-center gap-2 text-sm text-amber-800")}>
            <span aria-hidden="true">⚡</span>
            <span className={cn("font-semibold")}>Promo: {activePromo.title}</span>
            <span className={cn("text-xs text-amber-700")}>
              ({summariseForBanner(activePromo)})
            </span>
            {skipPromo && <span className={cn("text-xs italic")}>- skipped for this job</span>}
          </div>
          <label className={cn("flex items-center gap-2 text-xs text-amber-800")}>
            <input
              type="checkbox"
              checked={skipPromo}
              onChange={(e) => setSkipPromo(e.target.checked)}
              className={cn("h-3.5 w-3.5")}
            />
            Skip promo for this job
          </label>
        </div>
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
          <div className={cn("mb-3 flex items-center justify-between gap-2")}>
            <h2 className={cn("text-russian-violet text-sm font-semibold")}>Rate config</h2>
            <button
              type="button"
              onClick={() => void handleResetRates()}
              disabled={resettingRates}
              className={cn(
                "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50",
              )}
            >
              {resettingRates ? "Resetting..." : "Reset to defaults"}
            </button>
          </div>
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
                      : r.hourlyDelta !== null
                        ? `${r.hourlyDelta < 0 ? "-" : "+"}$${Math.abs(r.hourlyDelta)}/hr`
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
          <form
            onSubmit={handleSubmitRate}
            className={cn("grid grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-5")}
          >
            <input
              type="text"
              placeholder="Label"
              required
              value={rateForm.label}
              onChange={(e) => setRateForm((p) => ({ ...p, label: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
              )}
            />
            <select
              value={rateForm.type}
              onChange={(e) =>
                setRateForm((p) => ({
                  ...p,
                  type: e.target.value as "flat" | "hourly" | "modifier",
                }))
              }
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
              )}
            >
              <option value="hourly">Hourly base</option>
              <option value="modifier">Modifier (+/-)</option>
              <option value="flat">Flat</option>
            </select>
            <input
              type="number"
              placeholder={rateForm.type === "modifier" ? "Delta (+/-)" : "Amount"}
              required
              step="0.01"
              // Modifier rates carry a signed delta added to the base $/hr
              // (e.g. -10 for At home). Flat and hourly rates must be >= 0.
              min={rateForm.type === "modifier" ? undefined : 0}
              value={rateForm.amount}
              onChange={(e) => setRateForm((p) => ({ ...p, amount: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
              )}
            />
            <input
              type="text"
              placeholder="Unit"
              value={rateForm.unit}
              onChange={(e) => setRateForm((p) => ({ ...p, unit: e.target.value }))}
              className={cn(
                "focus:ring-russian-violet/30 rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
              )}
            />
            <div className={cn("flex gap-2")}>
              <button
                type="submit"
                className={cn(
                  "bg-russian-violet rounded-lg px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 sm:py-2 sm:text-xs",
                )}
              >
                {editingRateId ? "Update" : "Add"}
              </button>
              {editingRateId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className={cn(
                    "rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:py-2 sm:text-xs",
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
              onChange={(e) => {
                setAiInput(e.target.value);
                if (clarifyQuestions.length > 0) {
                  setClarifyQuestions([]);
                  setClarifyAnswers({});
                }
              }}
              rows={6}
              placeholder="e.g. Was at Dave's for 2 hours, removed some malware, set up his new router, had to drive out to Papakura"
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
              )}
            />
            {parseError && <p className={cn("mt-1 text-xs text-red-600")}>{parseError}</p>}
            <div className={cn("mt-3 flex gap-2")}>
              <button
                onClick={() => void handleParse()}
                suppressHydrationWarning
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
            {clarifyQuestions.length > 0 && (
              <div className={cn("mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4")}>
                <p className={cn("mb-3 text-xs font-medium text-amber-800")}>
                  A few quick questions to fill in the gaps:
                </p>
                <div className={cn("space-y-3")}>
                  {clarifyQuestions.map((q) => (
                    <div key={q.id}>
                      <label className={cn("mb-1 block text-xs font-medium text-slate-700")}>
                        {q.question}
                      </label>
                      <input
                        type="text"
                        placeholder={q.hint}
                        value={clarifyAnswers[q.id] ?? ""}
                        onChange={(e) =>
                          setClarifyAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                        className={cn(
                          "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-2",
                        )}
                      />
                    </div>
                  ))}
                </div>
                <div className={cn("mt-3 flex gap-2")}>
                  <button
                    onClick={() => void handleParse(clarifyAnswers)}
                    disabled={parsing}
                    className={cn(
                      "bg-russian-violet rounded-lg px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50",
                    )}
                  >
                    {parsing ? "Parsing..." : "Submit answers"}
                  </button>
                  <button
                    onClick={() => {
                      setClarifyQuestions([]);
                      setClarifyAnswers({});
                    }}
                    className={cn(
                      "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    Skip
                  </button>
                </div>
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
                  {billableMins(durationMins) !== durationMins && (
                    <span className={cn("ml-1 text-slate-300")}>
                      → {minsToHoursLabel(billableMins(durationMins))} billed
                    </span>
                  )}
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
                  {baseRates.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} ({formatNZD(r.ratePerHour ?? 0)}/hr)
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Travel */}
          <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
            <h2 className={cn("text-russian-violet mb-3 text-sm font-semibold")}>Travel</h2>
            <div className={cn("flex gap-2")}>
              <input
                ref={addressInputRef}
                type="text"
                placeholder="Client address or suburb"
                value={jobAddress}
                onChange={(e) => {
                  setJobAddress(e.target.value);
                  setTravelInfo(null);
                  setTravelOnInvoice(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleTravelLookup();
                  }
                }}
                className={cn(
                  "focus:ring-russian-violet/30 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                )}
              />
              <button
                type="button"
                onClick={() => {
                  void handleTravelLookup();
                }}
                suppressHydrationWarning
                disabled={lookingUpTravel || !jobAddress.trim()}
                className={cn(
                  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50",
                )}
              >
                {lookingUpTravel ? "..." : "Look up"}
              </button>
            </div>
            {travelInfo && (
              <div
                className={cn(
                  "mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600",
                )}
              >
                <span>
                  {travelInfo.distanceKm} km
                  {travelInfo.durationMins > 0
                    ? ` - approx ${travelInfo.durationMins} min drive`
                    : ""}{" "}
                  -{" "}
                  <span className="font-medium text-slate-800">${travelInfo.cost.toFixed(2)}</span>
                </span>
                {travelOnInvoice ? (
                  <span className={cn("ml-3 text-xs font-medium text-green-600")}>Added</span>
                ) : (
                  <button
                    type="button"
                    onClick={addTravelToInvoice}
                    className={cn(
                      "ml-3 rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-300",
                    )}
                  >
                    Add to invoice
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tasks */}
          <div
            className={cn(
              "space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5",
            )}
          >
            <div className={cn("flex items-center justify-between gap-2")}>
              <h2 className={cn("text-russian-violet text-sm font-semibold")}>Tasks</h2>
              <button
                type="button"
                onClick={() => setShowTaxonomyModal(true)}
                className={cn("text-xs font-medium text-slate-500 underline hover:text-slate-700")}
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
                  className={cn(
                    "rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:bg-white",
                  )}
                >
                  {isFlatRate ? (
                    /* Flat-rate row (Travel etc.): rate dropdown + qty/price/total/delete inline. */
                    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center")}>
                      <select
                        value={`rate:${task.rateConfigId}`}
                        onChange={(e) => updateTask(idx, "rateConfigId", e.target.value.slice(5))}
                        className={cn(
                          "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:w-40 sm:py-2 sm:text-xs",
                        )}
                      >
                        {flatRates.map((r) => (
                          <option key={r.id} value={`rate:${r.id}`}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <p
                        className={cn(
                          "truncate text-sm text-slate-600 sm:flex-1 sm:text-xs sm:text-slate-500",
                        )}
                      >
                        {task.description}
                      </p>
                      <TaskTotalsRow
                        task={task}
                        onQty={(v) => updateTask(idx, "qty", v)}
                        onPrice={(v) => updateTask(idx, "unitPrice", v)}
                        onDelete={() => setTasks((p) => p.filter((_, i) => i !== idx))}
                      />
                    </div>
                  ) : (
                    /* Task row: Device + Action comboboxes, optional details input, composed preview, qty/price/total/delete. */
                    <div className={cn("flex flex-col gap-2")}>
                      <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-3")}>
                        <Combobox
                          value={task.device ?? ""}
                          onChange={(v) => {
                            const next = v.trim() || null;
                            setTasks((prev) => {
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
                            setTasks((prev) => {
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
                            setTasks((prev) => {
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
                          className={cn(
                            "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
                          )}
                        />
                      </div>
                      <p
                        className={cn(
                          "truncate rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 sm:py-1.5 sm:text-xs",
                          !composed && "italic text-slate-400",
                        )}
                        title={composed || "Pick device + action"}
                      >
                        {composed || "Pick device + action"}
                      </p>
                      <div className={cn("flex flex-wrap items-center gap-1.5")}>
                        <select
                          value={task.baseRateId ?? ""}
                          onChange={(e) => setTaskBase(idx, e.target.value || null)}
                          aria-label="Base rate"
                          className={cn(
                            "focus:ring-russian-violet/30 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2",
                          )}
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
                          const delta = m.hourlyDelta ?? 0;
                          const sign = delta < 0 ? "-" : "+";
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => toggleTaskModifier(idx, m.id)}
                              aria-pressed={active}
                              className={cn(
                                "rounded-full border px-2 py-1 text-xs font-medium transition-colors",
                                active
                                  ? "border-russian-violet/40 bg-russian-violet/10 text-russian-violet"
                                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                              )}
                            >
                              {m.label} {sign}${Math.abs(delta)}
                            </button>
                          );
                        })}
                        <span className={cn("ml-auto text-xs font-semibold text-slate-700")}>
                          = {formatNZD(task.unitPrice)}/hr
                        </span>
                      </div>
                      <TaskTotalsRow
                        task={task}
                        onQty={(v) => updateTask(idx, "qty", v)}
                        onPrice={(v) => updateTask(idx, "unitPrice", v)}
                        onDelete={() => setTasks((p) => p.filter((_, i) => i !== idx))}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => setTasks((p) => [...p, emptyTask(rates)])}
              className={cn(
                "hover:text-russian-violet inline-flex h-11 items-center text-sm text-slate-500 underline sm:h-auto sm:text-xs",
              )}
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
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_44px] items-center gap-2",
                      "sm:grid-cols-[minmax(0,1fr)_88px_28px]",
                    )}
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
                        "focus:ring-russian-violet/30 col-span-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:col-span-1 sm:py-2 sm:text-xs",
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
                        "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 sm:py-2 sm:text-xs",
                      )}
                    />
                    <button
                      onClick={() => setParts((p) => p.filter((_, i) => i !== idx))}
                      aria-label="Remove part"
                      className={cn(
                        "inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl leading-none text-slate-400 hover:bg-red-50 hover:text-red-500 sm:h-auto sm:w-auto sm:rounded-none sm:text-lg sm:hover:bg-transparent",
                      )}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setParts((p) => [...p, { description: "", cost: 0 }])}
                  className={cn(
                    "hover:text-russian-violet inline-flex h-11 items-center text-sm text-slate-500 underline sm:h-auto sm:text-xs",
                  )}
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
              {/* Promo sits immediately under the labor lines so it's visually
                  attached to what it discounts. Travel + parts are appended
                  AFTER, at full price - never touched by the promo. */}
              {totals.promoDiscount > 0 && activePromo && (
                <div className={cn("flex justify-between text-amber-700")}>
                  <span>Promo: {activePromo.title}</span>
                  <span>-{formatNZD(totals.promoDiscount)}</span>
                </div>
              )}
              {totals.partsTotal > 0 && (
                <div className={cn("flex justify-between text-slate-600")}>
                  <span>Parts</span>
                  <span>{formatNZD(totals.partsTotal)}</span>
                </div>
              )}
              {totals.travelTotal > 0 && (
                <div className={cn("flex justify-between text-slate-600")}>
                  <span>Travel</span>
                  <span>{formatNZD(totals.travelTotal)}</span>
                </div>
              )}
              <div
                className={cn(
                  "flex justify-between border-t border-slate-100 pt-2 font-medium text-slate-700",
                )}
              >
                <span>Subtotal</span>
                <span>{formatNZD(totals.subtotal - totals.promoDiscount)}</span>
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
            {pickedContactName && (
              <div className={cn("flex flex-wrap items-center gap-2")}>
                <span className={cn("text-xs font-medium text-slate-600")}>Address to:</span>
                {(["name", "company", "custom"] as const).map((mode) => {
                  const disabled = mode === "company" && !pickedContactCompany;
                  const active = addressMode === mode;
                  const label =
                    mode === "name" ? "Name" : mode === "company" ? "Company" : "Custom";
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={disabled}
                      onClick={() => setAddressMode(mode)}
                      title={disabled ? "Picked contact has no company" : undefined}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-russian-violet/40 bg-russian-violet/10 text-russian-violet"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                        disabled && "cursor-not-allowed opacity-40 hover:border-slate-200",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              type="text"
              placeholder="Name"
              value={clientName}
              readOnly={addressMode !== "custom"}
              onChange={(e) => setClientName(e.target.value)}
              className={cn(
                "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
                addressMode !== "custom" && "bg-slate-50 text-slate-700",
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
              suppressHydrationWarning
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
                setJobAddress("");
                setTravelInfo(null);
                setClarifyQuestions([]);
                setClarifyAnswers({});
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

/**
 * Compact qty + unit-price + total + delete row shared by both flat-rate and
 * device/action task rows. Stacks on mobile (qty/price/total in a 3-up grid
 * with the delete button to the right) and collapses to an inline strip at
 * sm+ so it sits next to the device/action picker.
 * @param props - Component props.
 * @param props.task - The task line to render controls for.
 * @param props.onQty - Called when the operator edits the hours / qty input.
 * @param props.onPrice - Called when the operator edits the $/unit input.
 * @param props.onDelete - Called when the × button is pressed.
 * @returns Totals strip element.
 */
function TaskTotalsRow({
  task,
  onQty,
  onPrice,
  onDelete,
}: {
  task: TaskLine;
  onQty: (v: number) => void;
  onPrice: (v: number) => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_44px] items-center gap-2",
        "sm:flex sm:flex-none sm:items-center sm:gap-2",
      )}
    >
      <label className={cn("flex flex-col gap-0.5 sm:contents")}>
        <span
          className={cn("text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:hidden")}
        >
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
          className={cn(
            "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-right text-sm focus:outline-none focus:ring-2 sm:w-16 sm:py-2 sm:text-xs",
          )}
        />
      </label>
      <label className={cn("flex flex-col gap-0.5 sm:contents")}>
        <span
          className={cn("text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:hidden")}
        >
          $/unit
        </span>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={task.unitPrice}
          onChange={(e) => onPrice(parseFloat(e.target.value) || 0)}
          aria-label="Unit price"
          className={cn(
            "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-right text-sm focus:outline-none focus:ring-2 sm:w-20 sm:py-2 sm:text-xs",
          )}
        />
      </label>
      <span
        className={cn(
          "self-end text-right text-sm font-semibold text-slate-700 sm:w-20 sm:text-xs",
        )}
        aria-label="Line total"
      >
        {formatNZD(task.lineTotal)}
      </span>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Remove task"
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-lg text-xl leading-none text-slate-400 hover:bg-red-50 hover:text-red-500 sm:h-auto sm:w-auto sm:rounded-none sm:text-lg sm:hover:bg-transparent",
        )}
      >
        ×
      </button>
    </div>
  );
}
