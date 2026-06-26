"use client";

import { validateEmail } from "@/features/booking/lib/booking";
import { AddToContactsModal } from "@/features/business/components/AddToContactsModal";
import { InvoicePreviewPanel } from "@/features/business/components/InvoicePreviewPanel";
import { ParseConfidenceBanner } from "@/features/business/components/ParseConfidenceBanner";
import { TaxonomyManageModal } from "@/features/business/components/TaxonomyManageModal";
import { ClientPickerSection } from "@/features/business/components/calculator/ClientPickerSection";
import { JobDetailsSection } from "@/features/business/components/calculator/JobDetailsSection";
import { PartsSection } from "@/features/business/components/calculator/PartsSection";
import { RateConfigPanel } from "@/features/business/components/calculator/RateConfigPanel";
import { TasksSection } from "@/features/business/components/calculator/TasksSection";
import { TravelSection } from "@/features/business/components/calculator/TravelSection";
import {
  buildIncomeDescription,
  calcJobTotal,
  collapseToWindow,
  composeDescription,
  effectiveHourlyRate,
  hourlyTaskMinutes,
  jobToLineItems,
  matchRateById,
  timeDiffMins,
  todayISO,
  type JobPricing,
} from "@/features/business/lib/business";
import { calcTravelCharge } from "@/features/business/lib/pricing-policy";
import { summariseForBanner, type ActivePromo } from "@/features/business/lib/promos";
import type {
  GoogleContact,
  JobCalculation,
  ParseJobQuestion,
  ParseJobResponse,
  ParsedRange,
  PartLine,
  RateConfig,
  TaskLine,
  TaskTemplate,
  TravelEntry,
} from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { loadPlacesLibrary } from "@/shared/lib/google-maps-loader";
import type { IdentitySettings } from "@/shared/lib/settings/types";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
 * localStorage key for the calculator draft. Bump the version suffix when
 * CalculatorDraft fields change so stale shapes can't crash the form.
 */
const DRAFT_KEY = "calculator-draft-v1";

/**
 * Subset of CalculatorView state worth persisting across refreshes. Excludes
 * server-fetched data (rates, taskTemplates, contacts, activePromo), UI flags
 * (showParts, showRates etc), loading state, and the AI-parse results/clarify
 * session. The "Describe the job" input text itself IS persisted (`aiInput`).
 */
interface CalculatorDraft {
  v: 1;
  savedAt: number;
  /**
   * The "Describe the job" textarea text. Additive field: older v1 drafts saved
   * before this existed simply lack it and default to "" on load (safe, no bump).
   */
  aiInput: string;
  /** Date the job was done (YYYY-MM-DD); drives the holiday + promo lookup. Additive - older drafts default to today. */
  jobDate: string;
  timeRanges: ParsedRange[];
  durationMinsOverride: number | null;
  hourlyRateId: string | null;
  travelEntries: TravelEntry[];
  jobAddress: string;
  tasks: TaskLine[];
  parts: PartLine[];
  notes: string;
  clientName: string;
  clientEmail: string;
  pickedContactName: string | null;
  pickedContactCompany: string | null;
  pickedContactGoogleId: string | null;
  addressMode: "name" | "company" | "custom";
  unsuccessful: boolean;
}

/**
 * True when the draft has at least one field the operator clearly typed or
 * picked - used to decide whether to show the "Draft restored" toast.
 * Auto-seeded values (time slots, default hourly rate) on their own aren't
 * worth surfacing as a restore notification.
 * @param d - Parsed draft.
 * @returns Whether the draft is worth announcing on restore.
 */
function isMeaningfulDraft(d: CalculatorDraft): boolean {
  return (
    (d.aiInput?.trim().length ?? 0) > 0 ||
    d.tasks.length > 0 ||
    d.parts.length > 0 ||
    d.travelEntries.length > 0 ||
    d.notes.trim().length > 0 ||
    d.clientName.trim().length > 0 ||
    d.clientEmail.trim().length > 0 ||
    d.jobAddress.trim().length > 0 ||
    d.pickedContactName !== null ||
    d.pickedContactCompany !== null ||
    d.unsuccessful ||
    d.durationMinsOverride !== null
  );
}

/**
 * Reads the saved draft from localStorage. Returns null when no draft exists,
 * the JSON is corrupt, or the schema version doesn't match (so old shapes are
 * ignored after a bump rather than crashing the form).
 * @returns Parsed draft, or null.
 */
function loadDraft(): CalculatorDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalculatorDraft;
    if (parsed?.v !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Writes the draft to localStorage with a fresh savedAt timestamp. Failures
 * (quota, private mode etc) are swallowed so persistence never blocks editing.
 * @param draft - Form-state fields to persist (savedAt + v are added here).
 */
function saveDraft(draft: Omit<CalculatorDraft, "v" | "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CalculatorDraft = { v: 1, savedAt: Date.now(), ...draft };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
  } catch {
    /* QuotaExceeded or private mode - silently degrade */
  }
}

/** Drops the saved draft so the next mount starts clean. */
function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Renders a "X min ago" label given a stable now timestamp for the
 * draft-restored toast.
 * @param savedAt - When the draft was saved.
 * @param now - Reference now (captured once at mount to keep render pure).
 * @returns Display label.
 */
function timeAgo(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Builds an empty hourly task line seeded with the default base rate (e.g.
 * Standard $65/hr) and no modifiers. Flat-rate rows (Travel etc.) come from
 * AI parse or address lookup.
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
 * Today's date as an NZ-local YYYY-MM-DD string - the calculator's job-date default.
 * @returns ISO date string in Pacific/Auckland.
 */
function todayNZDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
}

interface CalculatorViewProps {
  /** Live business identity, threaded into the invoice preview. */
  identity: IdentitySettings;
  /** Live pricing (GST, min travel, billing increment) for the job calculations. */
  pricing: JobPricing;
}

/**
 * Interactive job calculator that lets an admin build a job quote using AI parsing, time tracking,
 * tasks, parts, and client details, then save it as income or convert it to an invoice.
 * @param props - Component props.
 * @param props.identity - Live business identity for the invoice preview.
 * @param props.pricing - Live pricing for the job calculations.
 * @returns The rendered calculator view element.
 */
export function CalculatorView({ identity, pricing }: CalculatorViewProps): React.ReactElement {
  const router = useRouter();
  const headers = {};

  // Lazy-read the saved draft once at mount. Non-meaningful drafts (just the
  // auto-seeded "now" times from a previous session, nothing the operator
  // typed) are treated as "no draft" so a refresh after Clear gets
  // fresh times instead of restoring stale timestamps.
  const initialDraft = useMemo(() => {
    const d = loadDraft();
    if (!d || !isMeaningfulDraft(d)) return null;
    return d;
  }, []);
  // True when a meaningful draft was loaded; readable inside async .then()
  // callbacks without being a React dependency.
  const draftLoadedRef = useRef(initialDraft !== null);
  // Captured once to keep timeAgo() pure for the toast label.
  const [mountedAt] = useState(() => Date.now());
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(
    initialDraft?.savedAt ?? null,
  );

  // Server-fetched reference data
  const [rates, setRates] = useState<RateConfig[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>([]);
  // Multiple time slots all lump into one billable duration. AI parse populates
  // one slot per detected HH:MM-HH:MM segment; operators can add/remove rows
  // via the Time card. No labels, dates, or per-slot travel - it's all flat.
  const [timeRanges, setTimeRanges] = useState<ParsedRange[]>(
    () => initialDraft?.timeRanges ?? [{ startTime: "", endTime: "" }],
  );
  // Operator override; null means "derive from sum of slots". Lets gaps inside
  // a single slot (lunch, etc.) be billed manually.
  const [durationMinsOverride, setDurationMinsOverride] = useState<number | null>(
    () => initialDraft?.durationMinsOverride ?? null,
  );
  // Every travel charge (auto-lookup + any manual entries) lumped together.
  // jobToLineItems sums them into a single "Travel" invoice line.
  const [travelEntries, setTravelEntries] = useState<TravelEntry[]>(
    () => initialDraft?.travelEntries ?? [],
  );
  const [hourlyRateId, setHourlyRateId] = useState<string | null>(
    () => initialDraft?.hourlyRateId ?? null,
  );
  // Tasks, parts, and notes
  const [tasks, setTasks] = useState<TaskLine[]>(() => initialDraft?.tasks ?? []);
  const [parts, setParts] = useState<PartLine[]>(() => initialDraft?.parts ?? []);
  const [showParts, setShowParts] = useState(false);
  const [showTaxonomyModal, setShowTaxonomyModal] = useState(false);
  const [notes, setNotes] = useState(() => initialDraft?.notes ?? "");
  // Half off labour when ticked (per pricing-policy.unsuccessfulWorkCopy).
  const [unsuccessful, setUnsuccessful] = useState(() => initialDraft?.unsuccessful ?? false);
  // Client details
  const [clientName, setClientName] = useState(() => initialDraft?.clientName ?? "");
  const [clientEmail, setClientEmail] = useState(() => initialDraft?.clientEmail ?? "");
  // Address-to state mirrors the InvoiceBuilder's segmented control so the
  // operator picks Name/Company/Custom once and the choice rides through to
  // the invoice without re-picking.
  const [pickedContactName, setPickedContactName] = useState<string | null>(
    () => initialDraft?.pickedContactName ?? null,
  );
  const [pickedContactCompany, setPickedContactCompany] = useState<string | null>(
    () => initialDraft?.pickedContactCompany ?? null,
  );
  const [pickedContactGoogleId, setPickedContactGoogleId] = useState<string | null>(
    () => initialDraft?.pickedContactGoogleId ?? null,
  );
  const [addressMode, setAddressModeState] = useState<"name" | "company" | "custom">(
    () => initialDraft?.addressMode ?? "custom",
  );
  // Direct-save (Save invoice) state. pendingInvoiceId is set after a
  // successful POST so handleAddContactClose can PATCH `contactId` once the
  // modal returns the new Contact's id, then navigate to the detail page.
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [saveInvoiceError, setSaveInvoiceError] = useState<string | null>(null);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);
  const [sheetSyncToast, setSheetSyncToast] = useState<string | null>(null);

  // AI parse session
  const [aiInput, setAiInput] = useState(() => initialDraft?.aiInput ?? "");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseJobResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasParsed, setHasParsed] = useState(false);
  const [clarifyQuestions, setClarifyQuestions] = useState<ParseJobQuestion[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});

  // Travel lookup
  const [jobAddress, setJobAddress] = useState(() => initialDraft?.jobAddress ?? "");
  const [lookingUpTravel, setLookingUpTravel] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);

  // Contacts and income save
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [savingIncome, setSavingIncome] = useState(false);
  const [incomeToast, setIncomeToast] = useState<string | null>(null);

  // Rate management
  const [showRates, setShowRates] = useState(false);
  const [rateForm, setRateForm] = useState({
    label: "",
    type: "hourly" as "flat" | "hourly" | "modifier" | "percent",
    amount: "",
    unit: "hour",
    isDefault: false,
  });
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [resettingRates, setResettingRates] = useState(false);

  // Active promo + per-job skip flag (not persisted). activePromo holds the
  // promo for the selected job date (refined by the job-context effect below).
  const [activePromo, setActivePromo] = useState<ActivePromo | null>(null);
  const [skipPromo, setSkipPromo] = useState(false);

  // Job date drives the holiday + promo lookup so a past job is priced by what
  // applied THEN, not today. Persisted in the draft; defaults to today (NZ).
  const [jobDate, setJobDate] = useState<string>(() => initialDraft?.jobDate ?? todayNZDate());
  // Holiday context for the selected date: name (for the UI) + the live labour
  // uplift fraction (0 when the date isn't a public holiday).
  const [holiday, setHoliday] = useState<{ name: string | null; uplift: number }>({
    name: null,
    uplift: 0,
  });

  // Resolve the job date > { holiday, promo } whenever the date changes. Best
  // effort: failures leave the prior context in place. Overwrites activePromo
  // with the date-resolved promo so every downstream consumer is date-aware.
  useEffect(() => {
    if (!jobDate) return;
    let cancelled = false;
    fetch(`/api/business/job-context?date=${encodeURIComponent(jobDate)}`)
      .then((r) => r.json())
      .then(
        (d: {
          ok?: boolean;
          holidayName?: string | null;
          holidayUplift?: number;
          promo?: ActivePromo | null;
        }) => {
          if (cancelled || !d?.ok) return;
          setHoliday({
            name: d.holidayName ?? null,
            uplift: typeof d.holidayUplift === "number" ? d.holidayUplift : 0,
          });
          setActivePromo(d.promo ?? null);
        },
      )
      .catch(() => {
        /* leave the prior context in place */
      });
    return () => {
      cancelled = true;
    };
  }, [jobDate]);

  // Google Maps address autocomplete
  useEffect(() => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey || !addressInputRef.current) return;

    const inputEl = addressInputRef.current;
    let cancelled = false;
    let listener: google.maps.MapsEventListener | null = null;

    loadPlacesLibrary(apiKey)
      .then(() => {
        if (cancelled || !inputEl) return;
        const autocomplete = new google.maps.places.Autocomplete(inputEl, {
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

  // Initial data fetch
  useEffect(() => {
    const now = nowTime();
    Promise.all([
      fetch("/api/business/rates", { headers }).then((r) => r.json()),
      fetch("/api/business/task-templates", { headers }).then((r) => r.json()),
      // Public; auto-applies any live promo to the Summary panel.
      fetch("/api/promos/active")
        .then((r) => r.json())
        .catch(() => ({ ok: false, promo: null })),
      fetch("/api/business/contacts", { headers: {} })
        .then((r) => r.json())
        .catch(() => ({ ok: false, contacts: [] })),
    ]).then(
      ([ratesData, templatesData, promoData, contactsData]: [
        { ok: boolean; rates: RateConfig[] },
        { ok: boolean; templates: TaskTemplate[] },
        { ok: boolean; promo: ActivePromo | null },
        { ok: boolean; contacts: GoogleContact[] },
      ]) => {
        // Skip the "now" + default-rate seeding when a draft was restored on
        // mount - the draft's values are the source of truth in that case.
        if (!draftLoadedRef.current) {
          setTimeRanges([{ startTime: now, endTime: addHour(now) }]);
        }
        if (ratesData.ok) {
          setRates(ratesData.rates);
          if (!draftLoadedRef.current) {
            const def = ratesData.rates.find((r) => r.isDefault);
            if (def) setHourlyRateId(def.id);
          }
        }
        if (templatesData.ok) setTaskTemplates(templatesData.templates);
        setActivePromo(promoData.promo ?? null);
        if (contactsData.ok) setContacts(contactsData.contacts);
      },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced draft writer. Any change to a persisted form field schedules a
  // write 500ms later; rapid edits coalesce into one localStorage hit.
  useEffect(() => {
    const t = setTimeout(() => {
      saveDraft({
        aiInput,
        jobDate,
        timeRanges,
        durationMinsOverride,
        hourlyRateId,
        travelEntries,
        jobAddress,
        tasks,
        parts,
        notes,
        clientName,
        clientEmail,
        pickedContactName,
        pickedContactCompany,
        pickedContactGoogleId,
        addressMode,
        unsuccessful,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [
    aiInput,
    jobDate,
    timeRanges,
    durationMinsOverride,
    hourlyRateId,
    travelEntries,
    jobAddress,
    tasks,
    parts,
    notes,
    clientName,
    clientEmail,
    pickedContactName,
    pickedContactCompany,
    pickedContactGoogleId,
    addressMode,
    unsuccessful,
  ]);

  // Auto-dismiss the "Draft restored" toast 8s after it appears.
  useEffect(() => {
    if (draftRestoredAt == null) return;
    const t = setTimeout(() => setDraftRestoredAt(null), 8000);
    return () => clearTimeout(t);
  }, [draftRestoredAt]);

  // Derived durations and rate groupings
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
  // Base hourly rates (e.g. Standard $65/hr) used for the top-level Time
  // selector and as the per-task base rate.
  const baseRates = rates.filter((r) => r.ratePerHour !== null);
  // Modifier rates: either signed $/hr deltas (At home -$10, Remote -$10)
  // or percent uplifts (Public Holiday +25%). Toggled per task to shift the
  // effective rate.
  const modifierRates = rates
    .filter((r) => r.hourlyDelta !== null || r.percentDelta !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
  const flatRates = rates.filter((r) => r.flatRate !== null);

  // Assemble the job and totals
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
    unsuccessful,
    clientName,
    clientEmail,
  };
  // Apply the date's public-holiday uplift to labour (0 when not a holiday).
  const jobPricing = { ...pricing, holidayUplift: holiday.uplift };
  const totals = calcJobTotal(job, !skipPromo ? activePromo : null, jobPricing);
  // Memoise the flattened line items so the preview panel's React.memo can
  // skip re-render when unrelated parent state changes (e.g. typing in the
  // AI input box). Recomputes when any meaningful input shifts.
  const previewLineItems = useMemo(
    () =>
      jobToLineItems(
        job,
        pricing.billingIncrementMins,
        holiday.uplift,
        pricing.minTravelCharge,
        pricing.minBillableMins,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tasks,
      parts,
      timeRanges,
      durationMins,
      hourlyRate,
      holiday.uplift,
      travelEntries,
      clientName,
      clientEmail,
      notes,
      unsuccessful,
    ],
  );

  /**
   * Applies a parsed job response to the calculator state, hydrating time +
   * tasks + parts + notes from the AI parse result. The auto travel entry is
   * created whenever the parser found any drive time; {@link calcTravelCharge}
   * applies the $10 minimum so a 1-min drive still bills the published floor.
   * @param result - The parsed job response returned by the AI.
   * @param rateList - The current list of rate configurations (used for travel rate lookup).
   */
  const applyParseResult = useCallback(
    (result: ParseJobResponse, rateList: RateConfig[]) => {
      const includeTravelDefault = (result.travel?.durationMins ?? 0) > 0;

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

      // Hydrate rate, task, and part lines
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
          isExplicit: t.isExplicit ?? false,
        };
      });
      const parsedParts = result.parts.map((p) => ({ description: p.description, cost: p.cost }));

      // Reparse semantics: the new parse result is the new truth for the auto
      // travel entry. Manual entries (parking, ferry, etc.) survive a reparse
      // so the operator doesn't have to re-type them after every AI tweak.
      setJobAddress(result.destination ?? "");

      if (result.travel && includeTravelDefault) {
        const travelRatePerHour =
          rateList.find((r) => r.unit === "travel-hour" && r.ratePerHour !== null)?.ratePerHour ??
          40;
        const cost = calcTravelCharge(
          result.travel.durationMins,
          travelRatePerHour,
          pricing.minTravelCharge,
        );
        const label = result.destination?.trim() || `${result.travel.durationMins} min drive`;
        setTravelEntries((prev) => [
          {
            label,
            cost,
            isAuto: true,
            destination: result.destination ?? label,
            durationMinsOneWay: result.travel?.durationMins,
            distanceKmOneWay: result.travel?.distanceKmOneWay,
          },
          ...prev.filter((e) => !e.isAuto),
        ]);
      } else {
        // No drive time from the parse (remote work or geocode-to-origin): drop
        // any stale auto entry, leave manual entries alone.
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
          parts.push(
            `(dropped ${collapsed.dropped} tiny task${collapsed.dropped === 1 ? "" : "s"})`,
          );
        }
        setIncomeToast(`${parts.join(" ")} to fit the ${parsedWindowMin}-min window.`);
        setTimeout(() => setIncomeToast(null), 4000);
      }
      setParts(parsedParts);
      if (result.notes) setNotes(result.notes);
    },
    [pricing.minTravelCharge],
  );

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
    clearDraft();
    router.push(`/admin/business/invoices/${invoiceId}`);
  }

  /**
   * Resets every persisted form field back to its mount-time default and
   * drops the saved draft. Single source of truth for "start fresh".
   */
  function resetFormState(): void {
    const now = nowTime();
    setTimeRanges([{ startTime: now, endTime: addHour(now) }]);
    setDurationMinsOverride(null);
    setHourlyRateId(rates.find((r) => r.isDefault)?.id ?? null);
    setTravelEntries([]);
    setJobAddress("");
    setTasks([]);
    setParts([]);
    setNotes("");
    setClientName("");
    setClientEmail("");
    setPickedContactName(null);
    setPickedContactCompany(null);
    setPickedContactGoogleId(null);
    setAddressModeState("custom");
    setUnsuccessful(false);
    setAiInput("");
    // Non-persisted parse-session results, but still part of "starting fresh".
    setParseResult(null);
    setHasParsed(false);
    setClarifyQuestions([]);
    setClarifyAnswers({});
    setDraftRestoredAt(null);
    clearDraft();
  }

  /**
   * Direct save: POSTs the calculator state straight to the invoices API and
   * navigates to the detail page. Backdating / custom invoice number / custom
   * due date is handled by editing a saved DRAFT after the fact (the [id]/edit
   * route).
   */
  async function handleSaveInvoice(): Promise<void> {
    // Validate required fields
    setSaveInvoiceError(null);
    if (!clientName.trim()) {
      setSaveInvoiceError("Client name is required.");
      return;
    }
    // Validate the email format before the POST so a malformed address blocks
    // invoice creation entirely. Otherwise the draft saves first and the bad
    // email only surfaces later when the add-to-contacts step rejects it.
    const emailCheck = validateEmail(clientEmail);
    if (emailCheck === "empty") {
      setSaveInvoiceError("Client email is required.");
      return;
    }
    if (emailCheck === "invalid") {
      setSaveInvoiceError("Enter a valid email address.");
      return;
    }
    if (emailCheck === "too-long") {
      setSaveInvoiceError("Email is too long.");
      return;
    }
    if (totals.subtotal <= 0) {
      setSaveInvoiceError("Add a task or line item with a price before saving.");
      return;
    }
    setSavingInvoice(true);
    try {
      // Build and POST the invoice
      await saveTaskTemplates(tasks);
      const lineItems = jobToLineItems(
        job,
        pricing.billingIncrementMins,
        holiday.uplift,
        pricing.minTravelCharge,
        pricing.minBillableMins,
      );
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
          unsuccessful,
          unsuccessfulDiscount:
            totals.unsuccessfulDiscount > 0 ? totals.unsuccessfulDiscount : null,
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
      // Add-to-contacts gate: defer nav until the modal closes so
      // handleAddContactClose can backfill contactId via PATCH.
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
      // Drop the saved draft so the calculator starts blank next time the
      // operator opens it (mirrors the AddToContactsModal-gated path: the
      // backfill handler in handleAddContactClose ALSO clears the draft).
      clearDraft();
      router.push(`/admin/business/invoices/${invoiceId}`);
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
      resetFormState();
    }
    setSavingIncome(false);
  }

  /**
   * Calls the travel-time API with the current job address and replaces the
   * single auto travel entry. Manual entries (parking, etc.) are preserved.
   * Drive time of 0 (geocoded to origin or no match) leaves no auto entry;
   * any non-zero drive time bills the $10 minimum via {@link calcTravelCharge}.
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
      if (d.durationMins && d.durationMins > 0) {
        const travelRatePerHour =
          rates.find((r) => r.unit === "travel-hour" && r.ratePerHour !== null)?.ratePerHour ?? 40;
        // calcTravelCharge doubles to round-trip internally and floors at
        // MIN_TRAVEL_CHARGE, so a 1-min drive still bills the $10 minimum.
        const cost = calcTravelCharge(d.durationMins, travelRatePerHour, pricing.minTravelCharge);
        const label = jobAddress.trim() || `${d.durationMins} min drive`;
        setTravelEntries((prev) => [
          {
            label,
            cost,
            isAuto: true,
            destination: jobAddress.trim() || label,
            durationMinsOneWay: d.durationMins,
            distanceKmOneWay: d.distanceKm,
          },
          ...prev.filter((e) => !e.isAuto),
        ]);
      }
    } catch {
      // silently ignore - travel is optional
    }
    setLookingUpTravel(false);
  }

  /**
   * Populates the rate form with an existing rate's values and enters edit mode.
   * @param r - The rate configuration to edit.
   */
  function handleStartEdit(r: RateConfig): void {
    const type: "hourly" | "modifier" | "flat" | "percent" =
      r.ratePerHour !== null
        ? "hourly"
        : r.percentDelta !== null
          ? "percent"
          : r.hourlyDelta !== null
            ? "modifier"
            : "flat";
    const modifierAmount = r.percentDelta !== null ? r.percentDelta * 100 : r.hourlyDelta;
    setEditingRateId(r.id);
    setRateForm({
      label: r.label,
      type,
      amount: String(r.ratePerHour ?? modifierAmount ?? r.flatRate ?? ""),
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
   * a 404 on edit/delete (which means the row was wiped server-side and the
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
        "Wipe all rates and reseed the defaults (Standard, At home, Remote, Public Holiday, Travel)? Any custom rates you've added will be deleted.",
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
      // Percent modifiers store a fraction (25 entered > 0.25).
      percentDelta: rateForm.type === "percent" ? amount / 100 : null,
      unit:
        rateForm.type === "modifier" || rateForm.type === "percent" ? "modifier" : rateForm.unit,
      isDefault: rateForm.type === "hourly" ? rateForm.isDefault : false,
    };

    if (editingRateId) {
      const res = await fetch(`/api/business/rates/${editingRateId}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // Bail safely on non-OK - 404 typically means the rate was wiped via
      // Reset and the local snapshot is stale. Re-fetch and exit edit mode.
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
      {pendingInvoiceId && (
        <AddToContactsModal
          name={clientName}
          email={clientEmail}
          googleContactId={pickedContactGoogleId}
          onClose={(contactDbId) => void handleAddContactClose(contactDbId)}
        />
      )}

      {showTaxonomyModal && (
        <TaxonomyManageModal
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

      {/* Job date - drives the public-holiday + promo lookup for this job. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <label htmlFor="job-date" className="text-sm font-semibold text-slate-700">
          Job date
        </label>
        <input
          id="job-date"
          type="date"
          value={jobDate}
          onChange={(e) => setJobDate(e.target.value || todayNZDate())}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
        />
        <span className="text-xs text-slate-500">
          Sets which promo and public-holiday rate apply.
        </span>
        {holiday.name && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
            {holiday.name} - labour +{Math.round(holiday.uplift * 100)}%
          </span>
        )}
      </div>

      {/* Promo chip with per-job skip toggle. */}
      {activePromo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <span aria-hidden="true">⚡</span>
            <span className="font-semibold">Promo: {activePromo.title}</span>
            <span className="text-xs text-amber-700">({summariseForBanner(activePromo)})</span>
            {skipPromo && <span className="text-xs italic">- skipped for this job</span>}
          </div>
          <label className="flex items-center gap-2 text-xs text-amber-800">
            <input
              type="checkbox"
              checked={skipPromo}
              onChange={(e) => setSkipPromo(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Skip promo for this job
          </label>
        </div>
      )}

      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowRates((p) => !p)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT column */}
        <div className="space-y-5">
          {/* AI input */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-russian-violet">Describe the job</h2>
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
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
            />
            {parseError && <p className="mt-1 text-xs text-red-600">{parseError}</p>}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void handleParse()}
                suppressHydrationWarning
                disabled={parsing || !aiInput.trim()}
                className="rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {parsing ? "Parsing..." : hasParsed ? "Re-parse" : "Parse with AI"}
              </button>
              <span className="self-center text-xs text-slate-400">or build manually below</span>
            </div>
            {parseResult && !parseError && (
              <div className="mt-3">
                <ParseConfidenceBanner
                  confidence={parseResult.confidence}
                  warnings={parseResult.warnings}
                  onDismiss={() => setParseResult(null)}
                />
              </div>
            )}
            {clarifyQuestions.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="mb-3 text-xs font-medium text-amber-800">
                  A few quick questions to fill in the gaps:
                </p>
                <div className="space-y-3">
                  {clarifyQuestions.map((q) => (
                    <div key={q.id}>
                      <label className="mb-1 block text-xs font-medium text-slate-700">
                        {q.question}
                      </label>
                      <input
                        type="text"
                        placeholder={q.hint}
                        value={clarifyAnswers[q.id] ?? ""}
                        onChange={(e) =>
                          setClarifyAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void handleParse(clarifyAnswers)}
                    disabled={parsing}
                    className="rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {parsing ? "Parsing..." : "Submit answers"}
                  </button>
                  <button
                    onClick={() => {
                      setClarifyQuestions([]);
                      setClarifyAnswers({});
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
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
            billingIncrementMins={pricing.billingIncrementMins}
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
            travelRatePerHour={
              rates.find((r) => r.unit === "travel-hour" && r.ratePerHour !== null)?.ratePerHour ??
              40
            }
            minTravelCharge={pricing.minTravelCharge}
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
            jobUnsuccessful={unsuccessful}
          />

          {/* Parts */}
          <PartsSection
            parts={parts}
            onPartsChange={setParts}
            show={showParts}
            onToggle={() => setShowParts((p) => !p)}
          />

          {/* Notes */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
            />
          </div>
        </div>

        {/* RIGHT column - live invoice preview (replaces the legacy Summary
            panel - same totals, just inside the actual invoice layout). */}
        <div className="min-w-0 space-y-4">
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
            contacts={contacts}
            onSelectContact={(c) => {
              const company = c.company?.trim() || null;
              setClientName(c.name);
              setClientEmail(c.email);
              setPickedContactName(c.name);
              setPickedContactCompany(company);
              setPickedContactGoogleId(c.id || null);
              // Bypass the setAddressMode wrapper - it reads pickedContactName
              // from this same render's closure (still null), which would flip
              // the mode to "custom". The name is already set explicitly above.
              setAddressModeState("name");
            }}
            onClearContact={() => {
              setPickedContactName(null);
              setPickedContactCompany(null);
              setPickedContactGoogleId(null);
              setAddressMode("custom");
              setClientName("");
              setClientEmail("");
            }}
          />

          {/* Half off labour when ticked (couldn't fix AND couldn't diagnose). */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <label
              className="flex cursor-pointer items-start gap-2 text-sm"
              title="Tick only when you left with neither a fix nor a diagnosis."
            >
              <input
                type="checkbox"
                checked={unsuccessful}
                onChange={(e) => setUnsuccessful(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-russian-violet focus:ring-russian-violet/30"
              />
              <span>
                <span className="font-medium text-slate-700">
                  Mark as unsuccessful (half-price labour)
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Half off the labour portion. Travel + parts unchanged.
                </span>
              </span>
            </label>
            {unsuccessful && totals.unsuccessfulDiscount > 0 && (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                -${totals.unsuccessfulDiscount.toFixed(2)} applied to labour
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            {draftRestoredAt !== null && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
                <span>Draft restored - last edited {timeAgo(draftRestoredAt, mountedAt)}.</span>
                <button
                  type="button"
                  onClick={resetFormState}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  Discard
                </button>
              </div>
            )}
            {incomeToast && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
                {incomeToast}
              </div>
            )}
            {sheetSyncToast && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                {sheetSyncToast}
              </div>
            )}
            {saveInvoiceError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {saveInvoiceError}
              </p>
            )}
            <button
              onClick={() => void handleSaveInvoice()}
              disabled={savingInvoice || parsing}
              suppressHydrationWarning
              className="w-full rounded-lg bg-russian-violet px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {savingInvoice ? "Saving..." : "Save invoice"}
            </button>
            <button
              onClick={handleSaveIncome}
              suppressHydrationWarning
              disabled={savingIncome || totals.subtotal === 0 || savingInvoice}
              title="For cash jobs handled outside the invoice flow."
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {savingIncome ? "Saving..." : "Save as income entry"}
            </button>
            <button
              onClick={resetFormState}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>

          {/* Invoice preview - below the CTAs so the Save invoice button is
              always reachable without scrolling past the full A4 render. */}
          <InvoicePreviewPanel
            identity={identity}
            number="DRAFT"
            clientName={clientName}
            clientEmail={clientEmail}
            issueDate={todayISO()}
            dueDate={addDaysISO(identity.paymentTermsDays)}
            lineItems={previewLineItems}
            notes={notes}
            unsuccessfulDiscount={totals.unsuccessfulDiscount}
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
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          Fix - rebalance tasks
        </button>
      )}
    </div>
  );
}
