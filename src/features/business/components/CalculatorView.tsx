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
import { TotalsPanel } from "@/features/business/components/calculator/TotalsPanel";
import { PartsSection } from "@/features/business/components/calculator/PartsSection";
import { TravelSection } from "@/features/business/components/calculator/TravelSection";
import { ClientPickerSection } from "@/features/business/components/calculator/ClientPickerSection";
import { TasksSection } from "@/features/business/components/calculator/TasksSection";
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
          <TravelSection
            addressInputRef={addressInputRef}
            jobAddress={jobAddress}
            onJobAddressChange={setJobAddress}
            travelInfo={travelInfo}
            onTravelInfoChange={setTravelInfo}
            lookingUpTravel={lookingUpTravel}
            travelOnInvoice={travelOnInvoice}
            onTravelOnInvoiceChange={setTravelOnInvoice}
            onLookup={() => void handleTravelLookup()}
            onAddToInvoice={addTravelToInvoice}
          />

          {/* Tasks */}
          <TasksSection
            tasks={tasks}
            onTasksChange={setTasks}
            onUpdateTask={updateTask}
            onSetTaskBase={setTaskBase}
            onToggleTaskModifier={toggleTaskModifier}
            onAddTask={() => setTasks((p) => [...p, emptyTask(rates)])}
            onManageTags={() => setShowTaxonomyModal(true)}
            taskTemplates={taskTemplates}
            baseRates={baseRates}
            modifierRates={modifierRates}
            flatRates={flatRates}
          />

          {/* Parts */}
          <PartsSection
            parts={parts}
            onPartsChange={setParts}
            show={showParts}
            onToggle={() => setShowParts((p) => !p)}
          />

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
          <TotalsPanel
            durationMins={durationMins}
            hourlyRate={hourlyRate}
            totals={totals}
            activePromo={activePromo}
            gst={gst}
            onGstChange={setGst}
          />

          {/* Client */}
          <ClientPickerSection
            clientName={clientName}
            onClientNameChange={setClientName}
            clientEmail={clientEmail}
            onClientEmailChange={setClientEmail}
            pickedContactName={pickedContactName}
            pickedContactCompany={pickedContactCompany}
            addressMode={addressMode}
            onAddressModeChange={setAddressMode}
            onPickContact={() => setShowContactPicker(true)}
          />

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
