"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/cn";
import {
  calcJobTotal,
  jobToLineItems,
  buildIncomeDescription,
  matchRateById,
  effectiveHourlyRate,
  composeDescription,
  MIN_TRAVEL_CHARGE,
  collapseToWindow,
  hourlyTaskMinutes,
  timeDiffMins,
  todayISO,
} from "@/features/business/lib/business";
import { BUSINESS_PAYMENT_TERMS_DAYS } from "@/shared/lib/business-identity";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { ContactPickerModal } from "@/features/business/components/ContactPickerModal";
import { AddToContactsModal } from "@/features/business/components/AddToContactsModal";
import { ParseConfidenceBanner } from "@/features/business/components/ParseConfidenceBanner";
import { TaxonomyManageModal } from "@/features/business/components/TaxonomyManageModal";
import { InvoicePreviewPanel } from "@/features/business/components/InvoicePreviewPanel";
import { PartsSection } from "@/features/business/components/calculator/PartsSection";
import { TravelSection } from "@/features/business/components/calculator/TravelSection";
import { ClientPickerSection } from "@/features/business/components/calculator/ClientPickerSection";
import { TasksSection } from "@/features/business/components/calculator/TasksSection";
import { RateConfigPanel } from "@/features/business/components/calculator/RateConfigPanel";
import { JobDetailsSection } from "@/features/business/components/calculator/JobDetailsSection";
import { loadPlacesLibrary } from "@/shared/lib/google-maps-loader";
import { summariseForBanner, type ActivePromo } from "@/features/business/lib/promos";
import type {
  RateConfig,
  TaskLine,
  PartLine,
  JobCalculation,
  ParseJobResponse,
  ParseJobQuestion,
  ParsedRange,
  GoogleContact,
  TaskTemplate,
  TravelEntry,
} from "@/features/business/types/business";

/**
 * Returns the YYYY-MM-DD string for today + n days.
 * @param n - Number of days to add to today.
 * @returns ISO date string (YYYY-MM-DD).
 */
function addDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

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
 * Builds a UTC ISO timestamp for an HH:MM start time interpreted as NZ wall-clock.
 * Defaults to today; if the resulting time has already passed today's wall clock,
 * rolls forward to tomorrow so quotes for "later today" don't accidentally fall
 * outside Google's traffic-prediction horizon. Returns null when the input isn't
 * a valid HH:MM string.
 * @param hhmm - Start time in HH:MM (24h) NZ wall-clock.
 * @returns ISO 8601 UTC timestamp, or null.
 */
function jobStartIsoFromTime(hhmm: string): string | null {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const nzDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, mo, d] = nzDateStr.split("-").map(Number);
  const offset = getPacificAucklandOffset(y, mo, d);
  let utc = new Date(Date.UTC(y, mo - 1, d, h - offset, m, 0));
  if (utc.getTime() < Date.now()) {
    utc = new Date(utc.getTime() + 24 * 60 * 60 * 1000);
  }
  return utc.toISOString();
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
  // Multiple time slots all lump into one billable duration. AI parse populates
  // one slot per detected HH:MM-HH:MM segment; operators can add/remove rows
  // via the Time card. No labels, dates, or per-slot travel - it's all flat.
  const [timeRanges, setTimeRanges] = useState<ParsedRange[]>([{ startTime: "", endTime: "" }]);
  // Operator override; null means "derive from sum of slots". Lets gaps inside
  // a single slot (lunch, etc.) be billed manually.
  const [durationMinsOverride, setDurationMinsOverride] = useState<number | null>(null);
  // Every travel charge (auto-lookup + any manual entries) lumped together.
  // jobToLineItems sums them into a single "Travel" invoice line.
  const [travelEntries, setTravelEntries] = useState<TravelEntry[]>([]);
  const [hourlyRateId, setHourlyRateId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskLine[]>([]);
  const [parts, setParts] = useState<PartLine[]>([]);
  const [showParts, setShowParts] = useState(false);
  const [showTaxonomyModal, setShowTaxonomyModal] = useState(false);
  const [notes, setNotes] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  // Address-to state mirrors the InvoiceBuilder's segmented control so the
  // operator picks Name/Company/Custom once and the choice rides through to
  // the invoice without re-picking.
  const [pickedContactName, setPickedContactName] = useState<string | null>(null);
  const [pickedContactCompany, setPickedContactCompany] = useState<string | null>(null);
  const [pickedContactGoogleId, setPickedContactGoogleId] = useState<string | null>(null);
  const [addressMode, setAddressModeState] = useState<"name" | "company" | "custom">("custom");
  // Direct-save (Save invoice) state. pendingInvoiceId is set after a
  // successful POST so handleAddContactClose can PATCH `contactId` once the
  // modal returns the new Contact's id, then navigate to the detail page.
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [saveInvoiceError, setSaveInvoiceError] = useState<string | null>(null);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);
  const [sheetSyncToast, setSheetSyncToast] = useState<string | null>(null);

  const [aiInput, setAiInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseJobResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasParsed, setHasParsed] = useState(false);
  const [clarifyQuestions, setClarifyQuestions] = useState<ParseJobQuestion[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});

  const [jobAddress, setJobAddress] = useState("");
  const [lookingUpTravel, setLookingUpTravel] = useState(false);
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
          // Keep the full formatted address so it matches what the AI phraser
          // receives; travel-time still resolves a suburb out of the full string.
          const next =
            place.formatted_address ??
            place.address_components?.find(
              (c) => c.types.includes("locality") || c.types.includes("sublocality_level_1"),
            )?.long_name ??
            "";
          if (next) {
            setJobAddress(next);
            // Drop any stale auto entry so the operator runs a fresh lookup;
            // manual entries (parking, etc.) survive.
            setTravelEntries((prev) => prev.filter((e) => !e.isAuto));
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
        setTimeRanges([{ startTime: now, endTime: addHour(now) }]);
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

  const sumRangesMin = timeRanges.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
  const durationMins = durationMinsOverride != null ? durationMinsOverride : sumRangesMin;
  // Aggregate first start / last end - used for the travel departure ISO and
  // the persisted JobCalculation. Sorted by startTime so out-of-order operator
  // entries still produce sensible bounds.
  const sortedRanges = [...timeRanges]
    .filter((r) => r.startTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const aggregateStart = sortedRanges[0]?.startTime ?? "";
  const aggregateEnd = sortedRanges[sortedRanges.length - 1]?.endTime ?? "";
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
    startTime: aggregateStart,
    endTime: aggregateEnd,
    durationMins,
    hourlyRate,
    tasks,
    parts,
    travelEntries,
    notes,
    gst: false,
    clientName,
    clientEmail,
  };
  const totals = calcJobTotal(job, !skipPromo ? activePromo : null);
  // Memoise the flattened line items so the preview panel's React.memo can
  // skip re-render when unrelated parent state changes (e.g. typing in the
  // AI input box). Recomputes when any meaningful input shifts.
  const previewLineItems = useMemo(
    () => jobToLineItems(job),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tasks,
      parts,
      timeRanges,
      durationMins,
      hourlyRate,
      travelEntries,
      clientName,
      clientEmail,
      notes,
    ],
  );

  /**
   * Applies a parsed job response to the calculator state, hydrating time +
   * tasks + parts + notes from the AI parse result. The auto travel entry is
   * created only when the round-trip cost clears MIN_TRAVEL_CHARGE; the
   * operator can add a manual entry afterwards if they want to bill anyway.
   * @param result - The parsed job response returned by the AI.
   * @param rateList - The current list of rate configurations (used for travel rate lookup).
   */
  const applyParseResult = useCallback((result: ParseJobResponse, rateList: RateConfig[]) => {
    // Compute the would-be travel cost first so we can gate the auto entry
    // before render.
    let travelCostForDefault = 0;
    if (result.travel && result.travel.distanceKm > 0) {
      const travelRate = rateList.find((r) => r.unit === "km" && r.flatRate !== null);
      const ratePerKm = travelRate?.flatRate ?? 1.2;
      travelCostForDefault = Math.round(result.travel.distanceKm * ratePerKm * 100) / 100;
    }
    const includeTravelDefault = travelCostForDefault >= MIN_TRAVEL_CHARGE;

    // Hydrate the time slots. Prefer the per-range list when the parser found
    // segments; otherwise synthesise one slot from startTime/endTime, or as a
    // last resort anchor the duration to "now".
    let parsedWindowMin = 0;
    if (result.ranges && result.ranges.length > 0) {
      setTimeRanges(result.ranges.map((r) => ({ startTime: r.startTime, endTime: r.endTime })));
      const sum = result.ranges.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
      const aiMin = result.durationMins ?? null;
      // When the AI-emitted duration differs from the sum (e.g. the operator
      // typed an explicit total), surface it via the override field.
      if (aiMin != null && aiMin !== sum) {
        setDurationMinsOverride(aiMin);
        parsedWindowMin = aiMin;
      } else {
        setDurationMinsOverride(null);
        parsedWindowMin = sum;
      }
    } else if (result.startTime && result.endTime) {
      setTimeRanges([{ startTime: result.startTime, endTime: result.endTime }]);
      const wallClockMin = timeDiffMins(result.startTime, result.endTime);
      const aiMin = result.durationMins ?? null;
      if (aiMin != null && aiMin !== wallClockMin) {
        setDurationMinsOverride(aiMin);
        parsedWindowMin = aiMin;
      } else {
        setDurationMinsOverride(null);
        parsedWindowMin = wallClockMin;
      }
    } else if (result.startTime) {
      const end = nowTime();
      setTimeRanges([{ startTime: result.startTime, endTime: end }]);
      setDurationMinsOverride(null);
      parsedWindowMin = timeDiffMins(result.startTime, end);
    } else if (result.durationMins !== null) {
      const now = new Date();
      const endTotalMins = now.getHours() * 60 + now.getMinutes();
      const startTotalMins = Math.max(0, endTotalMins - result.durationMins);
      const sh = Math.floor(startTotalMins / 60);
      const sm = startTotalMins % 60;
      setTimeRanges([
        {
          startTime: `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`,
          endTime: nowTime(),
        },
      ]);
      setDurationMinsOverride(null);
      parsedWindowMin = result.durationMins;
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
        isShort: t.isShort ?? false,
      };
    });
    const parsedParts = result.parts.map((p) => ({ description: p.description, cost: p.cost }));

    // Reparse semantics: the new parse result is the new truth for the auto
    // travel entry. Manual entries (parking, ferry, etc.) survive a reparse
    // so the operator doesn't have to re-type them after every AI tweak.
    setJobAddress(result.destination ?? "");

    if (
      result.travel &&
      result.travel.distanceKm > 0 &&
      // Skip the auto entry for very-short trips (below the minimum charge);
      // the operator can still add a manual entry if they want to bill anyway.
      includeTravelDefault
    ) {
      const travelRate = rateList.find((r) => r.unit === "km" && r.flatRate !== null);
      const ratePerKm = travelRate?.flatRate ?? 1.2;
      const cost = Math.round(result.travel.distanceKm * ratePerKm * 100) / 100;
      const label = result.destination?.trim() || `${result.travel.distanceKm} km`;
      setTravelEntries((prev) => [{ label, cost, isAuto: true }, ...prev.filter((e) => !e.isAuto)]);
    } else {
      // No billable travel from parse: drop any stale auto entry, leave
      // manual entries alone.
      setTravelEntries((prev) => prev.filter((e) => !e.isAuto));
    }
    // Rebalance parsed tasks to fit the listed window so an AI over-estimating
    // a single step doesn't silently over-bill. Tasks scale proportionally so
    // the over-long ones absorb more of the correction; anything that scales
    // below the minimum is dropped and the rest rescale.
    const collapsed = collapseToWindow(parsedTasks, parsedWindowMin);
    setTasks(collapsed.tasks);
    if (collapsed.rescaled || collapsed.dropped > 0) {
      const parts: string[] = ["Rebalanced tasks"];
      if (collapsed.dropped > 0) {
        parts.push(`(dropped ${collapsed.dropped} tiny task${collapsed.dropped === 1 ? "" : "s"})`);
      }
      setIncomeToast(`${parts.join(" ")} to fit the ${parsedWindowMin}-min window.`);
      setTimeout(() => setIncomeToast(null), 4000);
    }
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
   * Closes the add-to-contacts modal after a direct save. If the modal
   * created a Contact, PATCH the just-saved invoice with that contact's id
   * before navigating to the detail page. Best-effort backfill - the invoice
   * still navigates without the FK if PATCH fails.
   * @param contactDbId - DB id returned by the modal when the operator
   *   confirmed and a Contact was created. Null on dismiss / failure.
   */
  async function handleAddContactClose(contactDbId?: string | null): Promise<void> {
    const invoiceId = pendingInvoiceId;
    if (!invoiceId) return;
    setPendingInvoiceId(null);
    if (contactDbId) {
      try {
        await fetch(`/api/business/invoices/${invoiceId}`, {
          method: "PATCH",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ contactId: contactDbId }),
        });
      } catch {
        // Best-effort backfill; the invoice still saves without the FK.
      }
    }
    router.push(`/admin/business/invoices/${invoiceId}?token=${encodeURIComponent(token)}`);
  }

  /**
   * Direct save: POSTs the calculator state straight to the invoices API and
   * navigates to the detail page. Bypasses InvoiceBuilderView entirely. Used
   * by the "Save invoice" button - the primary action when the operator is
   * happy with the live preview and doesn't need to override the invoice
   * number / issue date / due date.
   *
   * Backdating / custom invoice number / custom due date is handled by
   * editing a saved DRAFT after the fact (the [id]/edit route).
   */
  async function handleSaveInvoice(): Promise<void> {
    setSaveInvoiceError(null);
    if (!clientName.trim()) {
      setSaveInvoiceError("Client name is required.");
      return;
    }
    if (!clientEmail.trim()) {
      setSaveInvoiceError("Client email is required.");
      return;
    }
    if (totals.subtotal <= 0) {
      setSaveInvoiceError("Add a task or line item with a price before saving.");
      return;
    }
    setSavingInvoice(true);
    try {
      await saveTaskTemplates(tasks);
      const lineItems = jobToLineItems(job);
      const promoActive = activePromo && !skipPromo && totals.promoDiscount > 0;
      const res = await fetch("/api/business/invoices", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          clientName,
          clientEmail,
          lineItems,
          notes: notes || null,
          promoTitle: promoActive ? activePromo.title : null,
          promoDiscount: promoActive ? totals.promoDiscount : null,
          // issueDate, dueDate, number all defaulted server-side.
        }),
      });
      const d = (await res.json()) as
        | {
            ok: true;
            invoice: { id: string };
            sheetSyncWarning?: boolean;
          }
        | { error: string };
      if ("error" in d) throw new Error(d.error);
      if (d.sheetSyncWarning) {
        setSheetSyncToast("Invoice saved - sheet counter sync failed. Update SETTINGS!B17.");
        setTimeout(() => setSheetSyncToast(null), 6000);
      }
      const invoiceId = d.invoice.id;
      // Add-to-contacts gate: same flow as InvoiceBuilderView. Defer nav
      // until the modal closes so handleAddContactClose can backfill
      // contactId via PATCH.
      if (clientEmail.trim()) {
        try {
          const checkRes = await fetch(
            `/api/admin/contacts/check?email=${encodeURIComponent(clientEmail.trim())}`,
            { headers },
          );
          const checkData = (await checkRes.json()) as { exists?: boolean };
          if (checkRes.ok && checkData.exists === false) {
            setPendingInvoiceId(invoiceId);
            setSavingInvoice(false);
            return;
          }
        } catch {
          // Fall through to navigate.
        }
      }
      router.push(`/admin/business/invoices/${invoiceId}?token=${encodeURIComponent(token)}`);
    } catch (err) {
      setSaveInvoiceError(err instanceof Error ? err.message : "Could not save invoice");
      setSavingInvoice(false);
    }
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
      const now = nowTime();
      setTimeRanges([{ startTime: now, endTime: addHour(now) }]);
      setDurationMinsOverride(null);
      setTravelEntries([]);
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

  /**
   * Calls the travel-time API with the current job address and replaces the
   * single auto travel entry. Manual entries (parking, etc.) are preserved.
   * Trips below MIN_TRAVEL_CHARGE leave no auto entry - the operator can
   * still add a manual one if they want to bill anyway.
   */
  async function handleTravelLookup(): Promise<void> {
    if (!jobAddress.trim()) return;
    setLookingUpTravel(true);
    // Drop any stale auto entry up-front so the chip disappears while the
    // lookup is in flight; manual entries survive.
    setTravelEntries((prev) => prev.filter((e) => !e.isAuto));
    try {
      const departureTimeIso = jobStartIsoFromTime(aggregateStart);
      const res = await fetch("/api/pricing/travel-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destination: jobAddress,
          ...(departureTimeIso ? { departureTimeIso } : {}),
        }),
      });
      const d = (await res.json()) as { distanceKm?: number; durationMins?: number };
      if (d.distanceKm && d.distanceKm > 0) {
        const travelRate = rates.find((r) => r.unit === "km" && r.flatRate !== null);
        const ratePerKm = travelRate?.flatRate ?? 1.2;
        const roundTripKm = Math.round(d.distanceKm * 2 * 10) / 10;
        const cost = Math.round(roundTripKm * ratePerKm * 100) / 100;
        if (cost >= MIN_TRAVEL_CHARGE) {
          const label = jobAddress.trim() || `${roundTripKm} km`;
          setTravelEntries((prev) => [
            { label, cost, isAuto: true },
            ...prev.filter((e) => !e.isAuto),
          ]);
        }
      }
    } catch {
      // silently ignore - travel is optional
    }
    setLookingUpTravel(false);
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
        "Wipe all rates and reseed the defaults (Standard, Complex, At home, Remote, Travel)? Any custom rates you've added will be deleted.",
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
            setPickedContactGoogleId(c.id || null);
            setAddressModeState("name");
          }}
          onClose={() => setShowContactPicker(false)}
        />
      )}

      {pendingInvoiceId && (
        <AddToContactsModal
          token={token}
          name={clientName}
          email={clientEmail}
          googleContactId={pickedContactGoogleId}
          onClose={(contactDbId) => void handleAddContactClose(contactDbId)}
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
        <RateConfigPanel
          rates={rates}
          form={rateForm}
          onFormChange={setRateForm}
          editingRateId={editingRateId}
          resettingRates={resettingRates}
          onSubmit={handleSubmitRate}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onDeleteRate={handleDeleteRate}
          onResetRates={() => void handleResetRates()}
        />
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
          <JobDetailsSection
            timeRanges={timeRanges}
            onTimeRangesChange={setTimeRanges}
            durationMinsOverride={durationMinsOverride}
            onDurationOverrideChange={setDurationMinsOverride}
            durationMins={durationMins}
            hourlyRateId={hourlyRateId}
            onHourlyRateIdChange={setHourlyRateId}
            baseRates={baseRates}
          />

          {/* Travel */}
          <TravelSection
            addressInputRef={addressInputRef}
            jobAddress={jobAddress}
            onJobAddressChange={setJobAddress}
            travelEntries={travelEntries}
            onTravelEntriesChange={setTravelEntries}
            lookingUpTravel={lookingUpTravel}
            onLookup={() => void handleTravelLookup()}
          />

          {/* Tasks - inline warning when hourly task minutes drift from the
              listed job window. AI parses auto-collapse in applyParseResult,
              so this only fires on manual edits or window changes. */}
          <TaskTimeWarning
            tasks={tasks}
            windowMin={durationMins}
            onFix={() => {
              const collapsed = collapseToWindow(tasks, durationMins);
              setTasks(collapsed.tasks);
            }}
          />
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

        {/* RIGHT column - live invoice preview (replaces the legacy Summary
            panel - same totals, just inside the actual invoice layout). */}
        <div className={cn("space-y-4")}>
          {/* Client - moved above the preview so it stays in reach without
              scrolling past the full A4-sized invoice render. */}
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
            {sheetSyncToast && (
              <div
                className={cn(
                  "rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800",
                )}
              >
                {sheetSyncToast}
              </div>
            )}
            {saveInvoiceError && (
              <p
                className={cn(
                  "rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700",
                )}
              >
                {saveInvoiceError}
              </p>
            )}
            <button
              onClick={() => void handleSaveInvoice()}
              disabled={savingInvoice || parsing}
              suppressHydrationWarning
              className={cn(
                "bg-russian-violet w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50",
              )}
            >
              {savingInvoice ? "Saving..." : "Save invoice"}
            </button>
            <button
              onClick={handleSaveIncome}
              suppressHydrationWarning
              disabled={savingIncome || totals.subtotal === 0 || savingInvoice}
              title="For cash jobs handled outside the invoice flow."
              className={cn(
                "w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50",
              )}
            >
              {savingIncome ? "Saving..." : "Save as income entry"}
            </button>
            <button
              onClick={() => {
                const now = nowTime();
                setTimeRanges([{ startTime: now, endTime: addHour(now) }]);
                setDurationMinsOverride(null);
                setTravelEntries([]);
                setTasks([]);
                setParts([]);
                setNotes("");
                setClientName("");
                setClientEmail("");
                setAiInput("");
                setParseResult(null);
                setHasParsed(false);
                setJobAddress("");
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

          {/* Invoice preview - below the CTAs so the Save invoice button is
              always reachable without scrolling past the full A4 render. */}
          <InvoicePreviewPanel
            number="DRAFT"
            clientName={clientName}
            clientEmail={clientEmail}
            issueDate={todayISO()}
            dueDate={addDaysISO(BUSINESS_PAYMENT_TERMS_DAYS)}
            lineItems={previewLineItems}
            notes={notes}
            promoTitle={
              activePromo && !skipPromo && totals.promoDiscount > 0 ? activePromo.title : null
            }
            promoDiscount={
              activePromo && !skipPromo && totals.promoDiscount > 0 ? totals.promoDiscount : 0
            }
          />
        </div>
      </div>
    </>
  );
}

interface TaskTimeWarningProps {
  tasks: TaskLine[];
  windowMin: number;
  onFix: () => void;
}

/**
 * Inline banner shown above the tasks panel when hourly task minutes don't
 * match the listed job window. Stays hidden when the totals line up so the
 * panel doesn't have a permanent strip of UI in the steady state.
 * @param props - Component props.
 * @param props.tasks - Current task lines (hourly + flat).
 * @param props.windowMin - Job window in minutes (`durationMins`).
 * @param props.onFix - Handler that collapses hourly tasks to fit the window.
 * @returns Warning element, or null when totals already match.
 */
function TaskTimeWarning({
  tasks,
  windowMin,
  onFix,
}: TaskTimeWarningProps): React.ReactElement | null {
  if (windowMin <= 0) return null;
  const taskMin = hourlyTaskMinutes(tasks);
  if (taskMin === 0) return null;
  // Tolerance: qty rounds to 2 dp (= 0.6-min granularity), so a 3-task split
  // can drift up to ~1.5 min from windowMin while still being "correct" after
  // collapseToWindow has snapped each row to a 5-min boundary. Without this
  // the banner shows "Tasks total 215 min - listed window is 215 min" because
  // the underlying float is 214.8 vs 215.
  if (Math.abs(taskMin - windowMin) < 2) return null;
  const over = taskMin > windowMin;
  return (
    <div
      role="status"
      className={cn(
        "mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
        over
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-sky-200 bg-sky-50 text-sky-900",
      )}
    >
      <span>
        Tasks total {Math.round(taskMin)} min - listed window is {windowMin} min.
        {!over && " Bump the end time if you actually worked the extra."}
      </span>
      {over && (
        <button
          type="button"
          onClick={onFix}
          className={cn(
            "rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100",
          )}
        >
          Fix - rebalance tasks
        </button>
      )}
    </div>
  );
}
