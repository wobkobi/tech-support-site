"use client";
// src/features/business/components/CalculatorView.tsx
// Job-pricing calculator and invoice builder. Assembles client, tasks, parts, travel, and
// rate config into line items, supports AI parsing of a plain-English job description,
// and renders a live invoice preview.

import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { useToast } from "@/features/admin/components/ui/Toast";
import { validateEmail } from "@/features/booking/lib/booking";
import { AddToContactsModal } from "@/features/business/components/AddToContactsModal";
import { InvoicePreviewPanel } from "@/features/business/components/InvoicePreviewPanel";
import { ParseConfidenceBanner } from "@/features/business/components/ParseConfidenceBanner";
import { TaxonomyManageModal } from "@/features/business/components/TaxonomyManageModal";
import { CancelFeeSection } from "@/features/business/components/calculator/CancelFeeSection";
import { ClientPickerSection } from "@/features/business/components/calculator/ClientPickerSection";
import { EventPickerSection } from "@/features/business/components/calculator/EventPickerSection";
import { JobDetailsSection } from "@/features/business/components/calculator/JobDetailsSection";
import { PartsSection } from "@/features/business/components/calculator/PartsSection";
import { RateConfigPanel } from "@/features/business/components/calculator/RateConfigPanel";
import { TasksSection } from "@/features/business/components/calculator/TasksSection";
import { TravelSection } from "@/features/business/components/calculator/TravelSection";
import {
  JOB_DESCRIPTION_BOOKED_HINT,
  JOB_DESCRIPTION_HINT,
  JOB_DESCRIPTION_PLACEHOLDER,
} from "@/features/business/lib/ai-input-copy";
import {
  buildIncomeDescription,
  calcJobTotal,
  collapseToWindow,
  effectiveHourlyRate,
  enforceMinBillable,
  explicitRoundingAllowanceMins,
  formatNZD,
  hourlyTaskMinutes,
  isChannelModifier,
  jobToLineItems,
  timeDiffMins,
  todayISO,
  type JobPricing,
} from "@/features/business/lib/business";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import {
  buildParseInput,
  describeFit,
  fitTasksToWindow,
  hydrateParsedTasks,
  parsedAutoTravel,
  parsedCostEntries,
  parsedWindow,
} from "@/features/business/lib/parse-hydrate";
import {
  assessCancellation,
  calcTravelCharge,
  cancellationFeeLabel,
  cancellationNotes,
  type CancellationPolicy,
  type CancellationReason,
  type CancelMeetingType,
} from "@/features/business/lib/pricing-policy";
import { summariseForBanner, type ActivePromo } from "@/features/business/lib/promos";
import type {
  EventPrefill,
  GoogleContact,
  JobCalculation,
  ParsedRange,
  ParseJobQuestion,
  ParseJobResponse,
  PartLine,
  RateConfig,
  TaskLine,
  TaskTemplate,
  TravelEntry,
} from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import type { IdentitySettings } from "@/shared/lib/settings/types";
import {
  addDaysToDateKey,
  dateKeyParts,
  getPacificAucklandOffset,
  nzDateParts,
  nzNowTime,
  timeParts,
} from "@/shared/lib/timezone-utils";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Returns the NZ calendar date (YYYY-MM-DD) n days from today.
 * @param n - Number of days to add to today.
 * @returns ISO date string (YYYY-MM-DD).
 */
function addDaysISO(n: number): string {
  return addDaysToDateKey(todayISO(), n);
}

/**
 * Adds one hour to a time string, wrapping around at midnight.
 * @param t - A time string in HH:MM format.
 * @returns A new time string one hour later, in HH:MM format.
 */
function addHour(t: string): string {
  const [h, m] = timeParts(t);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Builds a UTC ISO timestamp for an HH:MM NZ wall-clock start on the next
 * occurrence of the job date's WEEKDAY (today counts while the time is still
 * ahead). Google only quotes traffic for future departures, so a past job is
 * priced at the same weekday + time as a proxy for that day's actual traffic.
 * Returns null when the input isn't a valid HH:MM string.
 * @param hhmm - Start time in HH:MM (24h) NZ wall-clock.
 * @param anchorDate - NZ-local YYYY-MM-DD whose weekday to match (the job date); malformed values fall back to today.
 * @returns ISO 8601 UTC timestamp, or null.
 */
function jobStartIsoFromTime(hhmm: string, anchorDate?: string): string | null {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = timeParts(hhmm);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const [y, mo, d] = nzDateParts(new Date());
  // Weekday of a Y-M-D is timezone-independent when computed in UTC.
  const todayDow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  let daysAhead = 0;
  if (anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    const [ay, am, ad] = dateKeyParts(anchorDate);
    const targetDow = new Date(Date.UTC(ay, am - 1, ad)).getUTCDay();
    daysAhead = (targetDow - todayDow + 7) % 7;
  }
  const offset = getPacificAucklandOffset(y, mo, d);
  let utc = new Date(Date.UTC(y, mo - 1, d + daysAhead, h - offset, m, 0));
  if (utc.getTime() < Date.now()) {
    // Same-day time already passed: next day without an anchor, next week
    // with one (keeping the weekday).
    utc = new Date(utc.getTime() + (daysAhead === 0 && !anchorDate ? 1 : 7) * 24 * 60 * 60 * 1000);
  }
  return utc.toISOString();
}

/**
 * localStorage key for the calculator draft. Bump the version suffix when
 * CalculatorDraft fields change so stale shapes can't crash the form.
 */
const DRAFT_KEY = "calculator-draft-v2";

/**
 * sessionStorage key for the one-shot "Describe the job" handoff across the
 * event picker's navigation. The page keys this component by eventId, so
 * picking an event remounts it and resets all state; a part-typed description
 * is stashed here just before the push and consumed on the next mount.
 */
const AI_INPUT_HANDOFF_KEY = "calculator-ai-input-handoff";

/**
 * Blank state for the rate panel's add/edit form. Shared by the mount default,
 * the cancel-edit path, and the full clear so they cannot drift apart.
 */
const BLANK_RATE_FORM = {
  label: "",
  type: "hourly" as "flat" | "hourly" | "modifier" | "percent",
  amount: "",
  unit: "hour",
  isDefault: false,
};

/**
 * Subset of CalculatorView state persisted across refreshes. Excludes
 * server-fetched data, UI flags, and the AI-parse session; the "Describe the
 * job" text itself IS persisted (`aiInput`).
 */
interface CalculatorDraft {
  v: 2;
  savedAt: number;
  /** The "Describe the job" textarea text. */
  aiInput: string;
  /** Date the job was done (YYYY-MM-DD); drives the holiday + promo lookup. */
  jobDate: string;
  /** Applied promo code, uppercase, or "" for none. */
  promoCode: string;
  timeRanges: ParsedRange[];
  /** Out-of-session minutes added to the slot sum (0 = none). */
  followUpMins: number;
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
}

/**
 * True when the draft has at least one operator-entered field - auto-seeded
 * values alone aren't worth a "Draft restored" toast.
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
    d.followUpMins > 0
  );
}

/**
 * Reads the saved draft from localStorage. Returns null when missing, corrupt,
 * or schema-version mismatched (old shapes are ignored, not crashed on).
 * @returns Parsed draft, or null.
 */
function loadDraft(): CalculatorDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalculatorDraft;
    if (parsed?.v !== 2) return null;
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
    const payload: CalculatorDraft = { v: 2, savedAt: Date.now(), ...draft };
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

interface CalculatorViewProps {
  /** Live business identity, threaded into the invoice preview. */
  identity: IdentitySettings;
  /**
   * Live pricing (GST, min travel, travel $/hr from settings) for the job
   * calculations, plus the event picker's merge-suggestion window.
   */
  pricing: JobPricing & { travelRatePerHour: number; mergeSuggestGapMins: number };
  /**
   * Live cancellation policy driving cancel mode: the notice windows decide
   * whether a fee and the round trip apply, and callOutFee is the amount. Sits
   * outside {@link JobPricing} because none of it is a calcJobTotal input.
   */
  cancellation: CancellationPolicy;
  /** Rate configs resolved server-side so the calculator renders without a fetch waterfall. */
  initialRates: RateConfig[];
  /** Task templates resolved server-side, ordered by usage. */
  initialTaskTemplates: TaskTemplate[];
  /** Active promo resolved server-side; refined per job date by the job-context effect. */
  initialPromo: ActivePromo | null;
  /** Job prefill from a schedule event ("Bill in calculator"); null on a normal load. */
  eventPrefill: EventPrefill | null;
}

// The prefill shapes live in the shared business types so the event picker
// can read them without importing back from this module.
export type { EventPrefill, EventPrefillSlot } from "@/features/business/types/business";

/**
 * Interactive job calculator that lets an admin build a job quote using AI parsing, time tracking,
 * tasks, parts, and client details, then save it as income or convert it to an invoice.
 * @param props - Component props.
 * @param props.identity - Live business identity for the invoice preview.
 * @param props.pricing - Live pricing for the job calculations.
 * @param props.cancellation - Live cancellation policy driving cancel mode.
 * @param props.initialRates - Server-resolved rate configs.
 * @param props.initialTaskTemplates - Server-resolved task templates.
 * @param props.initialPromo - Server-resolved active promo, or null.
 * @param props.eventPrefill - Schedule-event job prefill, or null on a normal load.
 * @returns The rendered calculator view element.
 */
export function CalculatorView({
  identity,
  pricing,
  cancellation,
  initialRates,
  initialTaskTemplates,
  initialPromo,
  eventPrefill,
}: CalculatorViewProps): React.ReactElement {
  const router = useRouter();

  // Draft restore runs in the mount effect below: reading localStorage during render made
  // server HTML and hydration disagree. State starts at server-consistent defaults.
  // The ref reads true once a meaningful draft was restored, and is usable inside async
  // .then() callbacks without becoming a React dependency.
  const draftLoadedRef = useRef(false);
  // Captured once to keep timeAgo() pure for the toast label.
  const [mountedAt] = useState(() => Date.now());
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);

  // Server-resolved reference data; setters keep the rate panel's refresh path working.
  const [rates, setRates] = useState<RateConfig[]>(initialRates);
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>(initialTaskTemplates);
  // Multiple time slots all lump into one billable duration. AI parse populates
  // one slot per detected HH:MM-HH:MM segment; operators can add/remove rows
  // via the Time card. No labels, dates, or per-slot travel - it's all flat.
  const [timeRanges, setTimeRanges] = useState<ParsedRange[]>(() => {
    // One slot per merged event. The slot sum ignores the gaps between them,
    // so billing two events an hour apart charges the two visits, not the wait.
    if (eventPrefill) {
      return eventPrefill.slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
    }
    return [{ startTime: "", endTime: "" }];
  });
  // Out-of-session work (a call after the visit, a remote fix later) billed on
  // top of the slot sum. The AI parse seeds it from outOfSessionMins.
  const [followUpMins, setFollowUpMins] = useState(0);
  // Every travel charge (auto-lookup + manual) together; jobToLineItems sums them into
  // one "Round-trip travel" line. An event prefill seeds from the frozen TravelBlock /
  // booking snapshot - a fresh lookup on a past job could only quote tomorrow's traffic.
  const [travelEntries, setTravelEntries] = useState<TravelEntry[]>(() => {
    if (!eventPrefill?.travelMinsThere || eventPrefill.travelMinsThere <= 0) return [];
    const there = eventPrefill.travelMinsThere;
    const back = eventPrefill.travelMinsBack ?? there;
    return [
      {
        label: eventPrefill.jobAddress || `${there} min drive`,
        cost: calcTravelCharge(there, back, pricing.travelRatePerHour, pricing.minTravelCharge),
        isAuto: true,
        destination: eventPrefill.jobAddress || `${there} min drive`,
        durationMinsOneWay: there,
        durationMinsBack: back,
      },
    ];
  });
  // Tasks, parts, and notes
  const [tasks, setTasks] = useState<TaskLine[]>([]);
  const [parts, setParts] = useState<PartLine[]>([]);
  const [showParts, setShowParts] = useState(false);
  const [showTaxonomyModal, setShowTaxonomyModal] = useState(false);
  const [notes, setNotes] = useState("");
  // Cancel mode: a cancelled job has no work to bill, so the job-shaped sections
  // are swapped for CancelFeeSection and the fee is written into tasks as one
  // flat line. Client picker, travel, invoice preview, and save are reused as-is.
  const [cancelMode, setCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancellationReason>("late-cancellation");
  const [includeCancelTravel, setIncludeCancelTravel] = useState(true);
  // The booking's start and the moment the client called it off. The policy
  // windows are measured between these two, so both are operator-entered rather
  // than read off the clock - this is usually written up after the fact.
  const [cancelBookingTime, setCancelBookingTime] = useState("09:00");
  const [cancelledAtDate, setCancelledAtDate] = useState("");
  const [cancelledAtTime, setCancelledAtTime] = useState("09:00");
  // On site or remote. The fee covers the held slot either way, but only an
  // in-person booking has a drive, so the travel window never applies remotely.
  const [cancelMeetingType, setCancelMeetingType] = useState<CancelMeetingType>("in-person");
  const cancelSectionRef = useRef<HTMLDivElement>(null);
  // Client, save buttons and preview. The phone total bar stands down while
  // any of it is on screen, since the real buttons and total are showing.
  const finishRef = useRef<HTMLDivElement>(null);
  const [finishInView, setFinishInView] = useState(false);
  useEffect(() => {
    const el = finishRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) =>
      setFinishInView(entry?.isIntersecting ?? false),
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Travel entries parked while the policy says no round trip, so flipping the
  // decision back restores the figure instead of forcing a fresh lookup.
  const [stashedTravel, setStashedTravel] = useState<TravelEntry[]>([]);
  // Client details
  const [clientName, setClientName] = useState(() => eventPrefill?.clientName ?? "");
  // Normalised on seed as well as on typing: a Booking row written before
  // emails were normalised can still carry capitals, and the invoice preview
  // must show exactly what gets saved.
  const [clientEmail, setClientEmail] = useState(() => normaliseEmail(eventPrefill?.clientEmail));
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
  // True while the in-flight save is a "Save & send" (routes to ?send=1 and
  // skips the calculator's add-to-contacts gate); drives the two button labels.
  const [saveSendMode, setSaveSendMode] = useState(false);
  // True while the in-flight save is a "Save as quote"; drives its busy label.
  const [saveQuoteMode, setSaveQuoteMode] = useState(false);
  const [saveInvoiceError, setSaveInvoiceError] = useState<string | null>(null);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);
  // Name of an existing contact (matched by Google link) that lacks the typed email,
  // so the add-to-contacts popup offers to add the email instead of a new contact.
  const [pendingExistingName, setPendingExistingName] = useState<string | null>(null);
  // That contact's id, so the invoice still links to it when the operator declines.
  const [pendingExistingId, setPendingExistingId] = useState<string | null>(null);
  const { toast } = useToast();
  // Rate confirm dialogs (replacing window.confirm on reset / delete-rate).
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmDeleteRateId, setConfirmDeleteRateId] = useState<string | null>(null);
  // Full-clear confirm: clearing also deletes the saved draft, so it can't be undone.
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  /**
   * Loads the calculator for a set of calendar events, keeping a part-typed
   * description across the remount the navigation forces. The page keys this
   * component by the id set, so choosing events MUST remount it - the prefill
   * only lands through useState initialisers, never a prop update.
   * @param eventIds - Google Calendar event ids to bill as one job.
   */
  function handleBillEvents(eventIds: string[]): void {
    try {
      if (aiInput.trim()) sessionStorage.setItem(AI_INPUT_HANDOFF_KEY, aiInput);
    } catch {
      // Storage unavailable; the description won't carry over.
    }
    // Unticking the last event leaves nothing to bill: fall back to a blank
    // calculator rather than an empty eventIds= that would resolve to null.
    if (eventIds.length === 0) {
      router.push("/admin/business/calculator");
      return;
    }
    const query =
      eventIds.length === 1
        ? `eventId=${encodeURIComponent(eventIds[0]!)}`
        : `eventIds=${encodeURIComponent(eventIds.join(","))}`;
    router.push(`/admin/business/calculator?${query}`);
  }

  /** Puts the job date and time slots back to the billed events' own windows. */
  function resetToEventTimes(): void {
    if (!eventPrefill) return;
    setJobDate(eventPrefill.jobDate);
    setTimeRanges(eventPrefill.slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime })));
  }

  // AI parse session
  const [aiInput, setAiInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseJobResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasParsed, setHasParsed] = useState(false);
  const [clarifyQuestions, setClarifyQuestions] = useState<ParseJobQuestion[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});

  // Travel lookup
  const [jobAddress, setJobAddress] = useState(() => eventPrefill?.jobAddress ?? "");
  const [lookingUpTravel, setLookingUpTravel] = useState(false);

  // Contacts and income save
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [savingIncome, setSavingIncome] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);

  // Rate management
  const [showRates, setShowRates] = useState(false);
  const [rateForm, setRateForm] = useState(BLANK_RATE_FORM);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [resettingRates, setResettingRates] = useState(false);

  // Active promo + per-job skip flag (not persisted). activePromo holds the
  // promo for the selected job date (refined by the job-context effect below).
  const [activePromo, setActivePromo] = useState<ActivePromo | null>(initialPromo);
  const [skipPromo, setSkipPromo] = useState(false);
  // Two fields, not one: the box the operator types in, and the code actually
  // applied. Only the applied one is in the lookup's deps, so the job is not
  // repriced on every keystroke.
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoCode, setPromoCode] = useState("");

  // Job date drives the holiday + promo lookup so a past job is priced by what
  // applied THEN, not today. Persisted in the draft; defaults to today (NZ).
  const [jobDate, setJobDate] = useState<string>(() => eventPrefill?.jobDate ?? todayISO());
  // Holiday context for the selected date: name (for the UI) + the live labour
  // uplift fraction (0 when the date isn't a public holiday).
  const [holiday, setHoliday] = useState<{ name: string | null; uplift: number }>({
    name: null,
    uplift: 0,
  });

  // The job's earliest start, so a time-of-day promo is judged at the real start
  // rather than the lookup's midday default. HH:MM strings sort as times.
  const jobStartTime =
    timeRanges
      .map((r) => r.startTime)
      .filter((t) => /^\d{2}:\d{2}$/.test(t))
      .sort()[0] ?? "";
  const prefillBookingId = eventPrefill?.bookingId ?? null;

  // Resolve the job date > { holiday, promo } whenever the date changes. Best
  // effort: failures leave the prior context in place. Overwrites activePromo
  // with the date-resolved promo so every downstream consumer is date-aware.
  useEffect(() => {
    if (!jobDate) return;
    let cancelled = false;
    const query = new URLSearchParams({ date: jobDate });
    if (jobStartTime) query.set("time", jobStartTime);
    if (promoCode) query.set("code", promoCode);
    // Sent so per-customer and new-customer limits bind an operator-priced job
    // the same way they bind a public booking. Debounced below, since this is
    // typed a character at a time.
    if (clientEmail.trim()) query.set("email", clientEmail.trim());
    // A booked job keeps the promo it was booked with, and its own redemption
    // does not count against the customer's limits.
    if (prefillBookingId) query.set("bookingId", prefillBookingId);
    /** Fetches the holiday + promo context for the current date, code and customer. */
    const run = (): void => {
      fetch(`/api/business/job-context?${query.toString()}`)
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
    };
    // 400ms: long enough that typing an email is one request, short enough that
    // the promo chip does not visibly lag a date change.
    const timer = setTimeout(run, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobDate, jobStartTime, promoCode, clientEmail, prefillBookingId]);

  /**
   * Applies a picked Places suggestion: keep the full formatted address and
   * drop the stale auto travel entry (manual entries survive).
   * @param formattedAddress - The selected address.
   */
  function handleAddressSelected(formattedAddress: string): void {
    setJobAddress(formattedAddress);
    setTravelEntries((prev) => prev.filter((e) => !e.isAuto));
  }

  // Mount seeding + contacts fetch. The "now" times must seed in an effect - nzNowTime() at
  // render would mismatch between server render and hydration. Contacts stay a client
  // fetch: the People API pages through every connection, far too slow to block on.
  useEffect(() => {
    // Restore the saved draft after mount (localStorage is client-only). An event prefill
    // is a deliberate fresh billing task and outranks any draft; a non-meaningful draft
    // (just auto-seeded times) reseeds "now" rather than restoring stale timestamps.
    const draft = eventPrefill ? null : loadDraft();
    if (draft && isMeaningfulDraft(draft)) {
      draftLoadedRef.current = true;
      /* eslint-disable react-hooks/set-state-in-effect -- one-shot restore from
         localStorage (an external store); doing this during render caused the
         hydration mismatch this effect replaces */
      setDraftRestoredAt(draft.savedAt ?? null);
      setAiInput(draft.aiInput ?? "");
      setJobDate(draft.jobDate ?? todayISO());
      setPromoCode(draft.promoCode ?? "");
      setPromoCodeInput(draft.promoCode ?? "");
      setTimeRanges(draft.timeRanges ?? [{ startTime: "", endTime: "" }]);
      setFollowUpMins(draft.followUpMins ?? 0);
      setTravelEntries(draft.travelEntries ?? []);
      setJobAddress(draft.jobAddress ?? "");
      setTasks(draft.tasks ?? []);
      setParts(draft.parts ?? []);
      setNotes(draft.notes ?? "");
      setClientName(draft.clientName ?? "");
      setClientEmail(normaliseEmail(draft.clientEmail));
      setPickedContactName(draft.pickedContactName ?? null);
      setPickedContactCompany(draft.pickedContactCompany ?? null);
      setPickedContactGoogleId(draft.pickedContactGoogleId ?? null);
      setAddressModeState(draft.addressMode ?? "custom");
      /* eslint-enable react-hooks/set-state-in-effect */
    } else if (!eventPrefill) {
      const now = nzNowTime();
      setTimeRanges([{ startTime: now, endTime: addHour(now) }]);
    }
    // The prefill outranks the draft for dates/client/travel, but the description is the
    // operator's own words, so it survives: prefer the picker's sessionStorage stash
    // (fresher than the 500ms-debounced draft), else the draft text, which covers the
    // schedule's "Bill in calculator" path. Read before the draft writer's first tick.
    try {
      const handoff = sessionStorage.getItem(AI_INPUT_HANDOFF_KEY);
      if (handoff) sessionStorage.removeItem(AI_INPUT_HANDOFF_KEY);
      const carried = handoff ?? (eventPrefill ? (loadDraft()?.aiInput ?? "") : "");
      if (carried) {
        setAiInput(carried);
      }
    } catch {
      // Storage unavailable; nothing to restore.
    }
    fetch("/api/business/contacts")
      .then((r) => r.json())
      .then((d: { ok: boolean; contacts: GoogleContact[] }) => {
        if (d.ok) setContacts(d.contacts);
      })
      .catch(() => {
        /* picker stays empty; manual client entry still works */
      });
    // Run once on mount - eventPrefill is fixed per page load, and re-running
    // would clobber edited state and refetch contacts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced draft writer. Any change to a persisted form field schedules a
  // write 500ms later; rapid edits coalesce into one localStorage hit.
  useEffect(() => {
    const t = setTimeout(() => {
      saveDraft({
        aiInput,
        jobDate,
        promoCode,
        timeRanges,
        followUpMins,
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
      });
    }, 500);
    return () => clearTimeout(t);
  }, [
    aiInput,
    jobDate,
    promoCode,
    timeRanges,
    followUpMins,
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
  ]);

  // Auto-dismiss the "Draft restored" toast 8s after it appears.
  useEffect(() => {
    if (draftRestoredAt == null) return;
    const t = setTimeout(() => setDraftRestoredAt(null), 8000);
    return () => clearTimeout(t);
  }, [draftRestoredAt]);

  // Derived durations and rate groupings. Billable window = slot sum plus any
  // out-of-session follow-up minutes.
  const sumRangesMin = timeRanges.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
  const durationMins = sumRangesMin + followUpMins;
  // Aggregate first start / last end - used for the travel departure ISOs.
  // Sorted by startTime so out-of-order operator entries still produce
  // sensible bounds.
  const sortedRanges = [...timeRanges]
    .filter((r) => r.startTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const aggregateStart = sortedRanges[0]?.startTime ?? "";
  const aggregateEnd = sortedRanges[sortedRanges.length - 1]?.endTime ?? "";
  // Base hourly rates (e.g. Standard $65/hr) used as the per-task base rate.
  const baseRates = rates.filter((r) => r.ratePerHour !== null);
  // Modifier rates: either signed $/hr deltas (At home -$10, Remote -$10)
  // or percent uplifts (Public Holiday +25%). Toggled per task to shift the
  // effective rate.
  const modifierRates = rates
    .filter((r) => r.hourlyDelta !== null || r.percentDelta !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
  const flatRates = rates.filter((r) => r.flatRate !== null);

  // Assemble the job and totals. Labour bills entirely through the per-task
  // base + modifier rates; durationMins is the rebalance window, not a charge.
  const job: JobCalculation = {
    durationMins,
    tasks,
    parts,
    travelEntries,
    notes,
    clientName,
    clientEmail,
  };
  // Cancel-mode verdict for the form's explanation, measured from the booking's start back
  // to when the client called it off. Pure: new Date(string) is deterministic, unlike the
  // argless new Date() / Date.now() the React Compiler purity rule rejects in render.
  const cancelBookingStart = new Date(`${jobDate}T${cancelBookingTime || "00:00"}`);
  const cancelledAtStamp = new Date(`${cancelledAtDate || jobDate}T${cancelledAtTime || "00:00"}`);
  const cancelNoticeHours =
    (cancelBookingStart.getTime() - cancelledAtStamp.getTime()) / (60 * 60 * 1000);
  // Same helper the charge itself goes through, so the explanation can never
  // disagree with what lands on the invoice.
  const cancelCharge = assessCancellation(cancelBookingStart, cancelledAtStamp, {
    reason: cancelReason,
    meetingType: cancelMeetingType,
    policy: cancellation,
  });

  // Apply the date's public-holiday uplift to labour (0 when not a holiday),
  // and tell the totals which modifier marks business labour so a promo skips
  // it - promos are a home-rate offer.
  // Same predicate getPublicPricing uses to derive the business rate, so the
  // page and the invoice cannot disagree about which modifier means business.
  const businessModifierId =
    rates.find((r) => r.label === "Business" && r.unit === "modifier")?.id ?? null;
  const jobPricing = { ...pricing, holidayUplift: holiday.uplift, businessModifierId };
  const totals = calcJobTotal(job, !skipPromo ? activePromo : null, jobPricing);
  const showTotalBar = !finishInView && totals.total > 0;
  // Memoise the flattened line items so the preview panel's React.memo can
  // skip re-render when unrelated parent state changes (e.g. typing in the
  // AI input box). Recomputes when any meaningful input shifts.
  const previewLineItems = useMemo(
    () => jobToLineItems(job, holiday.uplift, pricing.minTravelCharge, pricing.minBillableMins),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tasks,
      parts,
      timeRanges,
      durationMins,
      holiday.uplift,
      travelEntries,
      clientName,
      clientEmail,
      notes,
      // Both feed jobToLineItems above. Omitted, a settings change that
      // re-rendered this component without remounting left the preview on stale
      // line items while `totals` below recomputed - the two then disagree.
      pricing.minTravelCharge,
      pricing.minBillableMins,
    ],
  );

  /**
   * Applies a parsed job response to the calculator state, hydrating time +
   * tasks + parts + notes from the AI parse result. The auto travel entry is
   * created whenever the parser found any drive time; {@link calcTravelCharge}
   * applies the $10 minimum so a 1-min drive still bills the published floor.
   * @param result - The parsed job response returned by the AI.
   */
  function applyParseResult(result: ParseJobResponse): void {
    const slots = eventPrefill?.slots ?? [];
    const span = parsedWindow(result, slots, nzNowTime());
    setFollowUpMins(span.followUpMins);
    // A merged job's slots are the corrected calendar windows, so the parse fills
    // everything but the times. On a single event the description wins, and "Reset to
    // event times" undoes a bad guess.
    if (span.timeRanges) setTimeRanges(span.timeRanges);

    // A reparse is the new truth for the auto travel entry and the parsed out-of-pocket
    // costs (parking, tolls). Operator-typed manual entries survive it, so they don't have
    // to be re-typed after every AI tweak.
    setJobAddress(result.destination ?? "");
    const parsedCosts = parsedCostEntries(result);
    const freshAuto = parsedAutoTravel(result, pricing.travelRatePerHour, pricing.minTravelCharge);
    if (freshAuto) {
      setTravelEntries((prev) => {
        // Google's live predictions drift between calls (minutes, and even the
        // route), so a reparse of the same destination keeps the existing auto
        // entry rather than silently moving the price. "Look up" is the refresh.
        const existingAuto = prev.find((e) => e.isAuto);
        const sameDestination =
          existingAuto?.destination?.trim().toLowerCase() ===
          freshAuto.destination?.trim().toLowerCase();
        return [
          existingAuto && sameDestination ? existingAuto : freshAuto,
          ...parsedCosts,
          ...prev.filter((e) => !e.isAuto && !e.isParsedCost),
        ];
      });
    } else {
      // No drive time from the parse (remote, or geocoded to origin): drop the stale auto
      // entry, keep manual ones, and still carry parsed disbursements - a walking-distance
      // job can still have parking.
      //
      // Booked jobs are the exception: their auto entry comes from the frozen TravelBlock,
      // a drive that was actually measured, and a description that just never mentions the
      // trip is not evidence it did not happen. noTravelCharge still wins - that is the
      // parser being told the trip was on foot or on the house, not an omission.
      const keepSeededTravel = eventPrefill !== null && !result.noTravelCharge;
      setTravelEntries((prev) => [
        ...(keepSeededTravel ? prev.filter((e) => e.isAuto) : []),
        ...parsedCosts,
        ...prev.filter((e) => !e.isAuto && !e.isParsedCost),
      ]);
    }

    const fit = fitTasksToWindow(
      hydrateParsedTasks(result),
      span.windowMins,
      pricing.taskTiming,
      pricing.minBillableMins,
    );
    setTasks(fit.tasks);
    const fitNote = describeFit(fit, span.windowMins);
    if (fitNote) toast(fitNote, { tone: "info" });
    setParts(result.parts.map((p) => ({ description: p.description, cost: p.cost })));
    if (result.notes) setNotes(result.notes);
  }

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
      // jobDate quotes travel at the job's weekday traffic pattern, not today's.
      const input = buildParseInput(aiInput, eventPrefill?.slots ?? []);
      const body: Record<string, unknown> = { input, jobDate };
      // Typed descriptions rarely repeat the address, so hand the current job address
      // (event prefill or Travel card) to the route as a travel fallback. The AI's own
      // extracted destination still wins, and a remote booking sends nothing.
      const fallbackDestination = jobAddress.trim();
      if (fallbackDestination && eventPrefill?.meetingType !== "remote") {
        body.fallbackDestination = fallbackDestination;
      }
      if (answers && Object.keys(answers).length > 0) body.answers = answers;
      const res = await fetch("/api/business/parse-job", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.ok && d.clarify) {
        setClarifyQuestions(d.clarify as ParseJobQuestion[]);
      } else if (d.ok && d.result) {
        setParseResult(d.result);
        applyParseResult(d.result);
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
      const existing = t[idx];
      if (!existing) return prev;
      const item = { ...existing, [field]: val };
      // Minutes are the billed unit on hourly rows, so a hand-edited qty must rewrite them
      // or the stale value keeps winning downstream. The row edits hrs + mins, so the
      // incoming qty is already whole minutes: snap it, and carry qty unrounded.
      if (field === "qty") {
        const mins = Math.round(Number(val) * 60);
        if (item.baseRateId != null) {
          item.minutes = mins;
          item.qty = mins / 60;
        } else {
          // Flat rows (Travel etc.) count units, not time.
          item.minutes = undefined;
          item.qty = Math.round(Number(val) * 100) / 100;
        }
      }
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
    const tagged = taskList.filter((t) => t.rateConfigId == null && t.device && t.action);
    // One request per distinct tag pair. The endpoint upserts by looking the row
    // up and then creating it, so two line items sharing a pair would both miss
    // the lookup in this parallel batch and insert a duplicate template - which
    // is how a second "Software repair" row appeared at a different price. The
    // last occurrence wins, matching the sequential upsert's final state.
    const byPair = new Map<string, TaskLine>();
    for (const t of tagged) {
      byPair.set(`${t.device?.toLowerCase()}|${t.action?.toLowerCase()}`, t);
    }
    await Promise.all(
      [...byPair.values()].map((t) =>
        fetch("/api/business/task-templates", {
          method: "POST",
          headers: { "content-type": "application/json" },
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
   * Attaches a saved invoice to a Contact. Best-effort: the invoice still
   * stands without the FK, but losing it costs the review link and the
   * contact's invoice history.
   * @param invoiceId - The saved invoice.
   * @param contactDbId - Contact to attach it to.
   * @returns Promise that resolves once the write has been attempted.
   */
  async function linkInvoiceToContact(invoiceId: string, contactDbId: string): Promise<void> {
    try {
      await fetch(`/api/business/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: contactDbId }),
      });
    } catch {
      // Best-effort backfill; the invoice still saves without the FK.
    }
  }

  /**
   * Closes the add-to-contacts modal after a direct save. If the modal
   * created a Contact, PATCH the just-saved invoice with that contact's id
   * before navigating to the detail page. Best-effort backfill - the invoice
   * still navigates without the FK if PATCH fails.
   * @param contactDbId - DB id returned by the modal when the operator
   *   confirmed and a Contact was created or updated. Null on dismiss / failure,
   *   in which case an already-known contact missing the email is linked instead.
   */
  async function handleAddContactClose(contactDbId?: string | null): Promise<void> {
    const invoiceId = pendingInvoiceId;
    if (!invoiceId) return;
    setPendingInvoiceId(null);
    // Declining to add the email still links the invoice to the contact it belongs to.
    const linkId = contactDbId ?? pendingExistingId;
    if (linkId) {
      await linkInvoiceToContact(invoiceId, linkId);
    }
    clearDraft();
    router.push(`/admin/business/invoices/${invoiceId}`);
  }

  /**
   * Resets every form field - persisted and session-only - back to a blank
   * calculator and drops the saved draft. Single source of truth for "start
   * fresh": also rewinds the job date to today, un-skips the promo, drops any
   * promo code, resets the
   * cancel-policy inputs, and clears any error banners. When billing a
   * calendar event, navigates off `?eventId=` so the keyed view remounts
   * without the prefill.
   */
  function resetFormState(): void {
    const now = nzNowTime();
    setJobDate(todayISO());
    setSkipPromo(false);
    setPromoCode("");
    setPromoCodeInput("");
    setTimeRanges([{ startTime: now, endTime: addHour(now) }]);
    setFollowUpMins(0);
    setTravelEntries([]);
    setJobAddress("");
    setTasks([]);
    setParts([]);
    setShowParts(false);
    setNotes("");
    setClientName("");
    setClientEmail("");
    setPickedContactName(null);
    setPickedContactCompany(null);
    setPickedContactGoogleId(null);
    setAddressModeState("custom");
    setAiInput("");
    // Non-persisted parse-session results, but still part of "starting fresh".
    setParseResult(null);
    setParseError(null);
    setHasParsed(false);
    setClarifyQuestions([]);
    setClarifyAnswers({});
    setDraftRestoredAt(null);
    // Cancel mode and its policy inputs go back to their mount defaults.
    setCancelMode(false);
    setCancelReason("late-cancellation");
    setCancelMeetingType("in-person");
    setCancelBookingTime("09:00");
    setCancelledAtDate("");
    setCancelledAtTime("09:00");
    setIncludeCancelTravel(true);
    setStashedTravel([]);
    // Stale save errors would otherwise sit above the buttons on a blank form.
    setIncomeError(null);
    setSaveInvoiceError(null);
    // In-flight save bookkeeping. saveSendMode/saveQuoteMode are only ever set
    // when a save starts, so a failed Save & send leaves them true and puts the
    // next save's "Saving..." label on the wrong button.
    setSaveSendMode(false);
    setSaveQuoteMode(false);
    setPendingInvoiceId(null);
    // Transient panel/dialog state - a half-typed rate edit survives an
    // otherwise-blank form without this.
    setShowRates(false);
    setEditingRateId(null);
    setRateForm(BLANK_RATE_FORM);
    setShowTaxonomyModal(false);
    setConfirmDeleteRateId(null);
    clearDraft();
    // Billing a booked job: the prefill is a server prop keyed by eventId, so
    // state resets alone can't remove the banner - drop the query param and
    // let the remount start truly blank.
    if (eventPrefill) router.replace("/admin/business/calculator");
  }

  /**
   * The cancellation fee as a single flat task. baseRateId stays null so
   * business.ts treats it as flat: bills qty * unitPrice, contributes no
   * labour minutes, and collapseToWindow ignores it. No RateConfig needed -
   * rateConfigId only links flat rate rows like Travel.
   * @param reason - Which fee is being billed.
   * @param date - The cancelled booking's date (YYYY-MM-DD).
   * @param fee - Fee amount in NZD.
   * @returns The single flat task representing the fee.
   */
  function buildCancelFeeTask(reason: CancellationReason, date: string, fee: number): TaskLine {
    return {
      rateConfigId: null,
      baseRateId: null,
      description: cancellationFeeLabel(reason, date),
      qty: 1,
      unitPrice: fee,
      lineTotal: fee,
    };
  }

  /**
   * Bills the round trip or parks it. Parking stashes the entries rather than
   * dropping them, so reversing the decision restores the figure instead of
   * forcing a fresh address lookup.
   * @param include - Whether to bill travel.
   */
  function applyCancelTravel(include: boolean): void {
    setIncludeCancelTravel(include);
    if (include) {
      setTravelEntries((prev) => (prev.length === 0 ? stashedTravel : prev));
    } else {
      setTravelEntries((prev) => {
        if (prev.length > 0) setStashedTravel(prev);
        return [];
      });
    }
  }

  /**
   * Applies the cancellation policy to the entered times and rewrites the fee
   * line, note, and travel decision. Every cancel input funnels through here
   * so the invoice always reflects the policy: more than freeNoticeHours'
   * notice zeroes the fee, a no-show always bills (no notice to measure), and
   * travel only ever applies to an in-person booking.
   * @param next - The changed inputs; anything omitted keeps its current value.
   * @param next.reason - Late cancellation or no-show.
   * @param next.meetingType - On site or remote.
   * @param next.bookingDate - The booking's date (YYYY-MM-DD).
   * @param next.bookingTime - The booking's start time (HH:MM).
   * @param next.cancelledDate - Date the client called it off (YYYY-MM-DD).
   * @param next.cancelledTime - Time the client called it off (HH:MM).
   */
  function applyCancelPolicy(next: {
    reason?: CancellationReason;
    meetingType?: CancelMeetingType;
    bookingDate?: string;
    bookingTime?: string;
    cancelledDate?: string;
    cancelledTime?: string;
  }): void {
    const reason = next.reason ?? cancelReason;
    const meetingType = next.meetingType ?? cancelMeetingType;
    const bookingDate = next.bookingDate ?? jobDate;
    const bookingTime = next.bookingTime ?? cancelBookingTime;
    const offDate = (next.cancelledDate ?? cancelledAtDate) || bookingDate;
    const offTime = next.cancelledTime ?? cancelledAtTime;

    const charge = assessCancellation(
      new Date(`${bookingDate}T${bookingTime}`),
      new Date(`${offDate}T${offTime}`),
      { reason, meetingType, policy: cancellation },
    );

    setTasks([buildCancelFeeTask(reason, bookingDate, charge.fee)]);
    setNotes(cancellationNotes(reason, bookingDate));
    applyCancelTravel(charge.travelApplies);
  }

  /**
   * Enters cancel mode, replacing job work with the policy's verdict. Tasks
   * and parts clear (nothing was done on site); the cancel moment seeds at the
   * booking start so the worst case shows until the real time is entered.
   */
  function enterCancelMode(): void {
    const bookingTime = eventPrefill?.slots[0]?.startTime ?? timeRanges[0]?.startTime ?? "09:00";
    // Prefer the booking's own answer. Without one (an event created straight on
    // the calendar), infer from whether there is anywhere to drive to.
    const meetingType: CancelMeetingType =
      eventPrefill?.meetingType ??
      (jobAddress.trim() || travelEntries.length > 0 ? "in-person" : "remote");
    setCancelMode(true);
    setCancelReason("late-cancellation");
    setCancelMeetingType(meetingType);
    setCancelBookingTime(bookingTime);
    setCancelledAtDate(jobDate);
    setCancelledAtTime(bookingTime);
    setParts([]);
    applyCancelPolicy({
      reason: "late-cancellation",
      meetingType,
      bookingTime,
      cancelledDate: jobDate,
      cancelledTime: bookingTime,
    });
  }

  /**
   * Leaves cancel mode and clears the fee line so a half-finished cancel cannot
   * leak into a job invoice.
   */
  function exitCancelMode(): void {
    setCancelMode(false);
    setTasks([]);
    setNotes("");
  }

  // The button that opens cancel mode sits at the bottom of the column while the form
  // renders at the top, so without this the click looks like it did nothing. Runs after
  // the form exists; exiting is left alone, as that button is already under the cursor.
  useEffect(() => {
    if (!cancelMode) return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cancelSectionRef.current?.scrollIntoView({
      block: "start",
      behavior: prefersReduced ? "auto" : "smooth",
    });
  }, [cancelMode]);

  /**
   * Switches the fee type and re-applies the policy.
   * @param reason - The newly-picked fee type.
   */
  function handleCancelReasonChange(reason: CancellationReason): void {
    setCancelReason(reason);
    applyCancelPolicy({ reason });
  }

  /**
   * Switches between an on-site and a remote booking and re-applies the policy.
   * Flipping to remote parks the round trip; flipping back restores it when the
   * timing still warrants one.
   * @param meetingType - The newly-picked meeting type.
   */
  function handleCancelMeetingTypeChange(meetingType: CancelMeetingType): void {
    setCancelMeetingType(meetingType);
    applyCancelPolicy({ meetingType });
  }

  /**
   * Corrects the booking's date and re-applies the policy.
   * @param date - The new date (YYYY-MM-DD).
   */
  function handleCancelledDateChange(date: string): void {
    setJobDate(date);
    applyCancelPolicy({ bookingDate: date });
  }

  /**
   * Corrects the booking's start time and re-applies the policy.
   * @param time - The new start time (HH:MM).
   */
  function handleCancelBookingTimeChange(time: string): void {
    setCancelBookingTime(time);
    applyCancelPolicy({ bookingTime: time });
  }

  /**
   * Corrects the date the client called it off and re-applies the policy.
   * @param date - The new date (YYYY-MM-DD).
   */
  function handleCancelledAtDateChange(date: string): void {
    setCancelledAtDate(date);
    applyCancelPolicy({ cancelledDate: date });
  }

  /**
   * Corrects the time the client called it off and re-applies the policy.
   * @param time - The new time (HH:MM).
   */
  function handleCancelledAtTimeChange(time: string): void {
    setCancelledAtTime(time);
    applyCancelPolicy({ cancelledTime: time });
  }

  /**
   * Direct save: POSTs the calculator state straight to the invoices API and
   * navigates to the detail page. Backdating / custom invoice number / custom
   * due date is handled by editing a saved DRAFT after the fact.
   * @param send - When true ("Save & send"), skip the add-to-contacts gate and
   *   route to the detail page with `?send=1` so it auto-opens the send preview
   *   (which has its own add-to-contacts hook-in + contactId backfill).
   * @param quote - When true ("Save as quote"), the row saves as a QUOTE: a
   *   Q- number from the quote counter, QUOTE PDF, 30-day validity default,
   *   convertible to a real invoice from the detail page.
   */
  async function handleSaveInvoice(send = false, quote = false): Promise<void> {
    // Validate required fields
    setSaveInvoiceError(null);
    setSaveSendMode(send);
    setSaveQuoteMode(quote);
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
        holiday.uplift,
        pricing.minTravelCharge,
        pricing.minBillableMins,
      );
      const promoActive = activePromo && !skipPromo && totals.promoDiscount > 0;
      const res = await fetch("/api/business/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName,
          clientEmail,
          lineItems,
          notes: notes || null,
          promoTitle: promoActive ? activePromo.title : null,
          promoDiscount: promoActive ? totals.promoDiscount : null,
          // The id, not just the title: the redemption this settles is keyed by
          // promo, and matching on a title would break the moment one is edited.
          promoId: promoActive ? activePromo.id : null,
          // Send the flag alongside its discount: the server stores
          // `unsuccessful === true`, so omitting it records every calculator-raised
          // invoice as successful even when the half-price reduction was applied.
          unsuccessful: totals.unsuccessfulDiscount > 0,
          unsuccessfulDiscount:
            totals.unsuccessfulDiscount > 0 ? totals.unsuccessfulDiscount : null,
          // Match back to the billed job when the session came from the schedule's
          // "Bill in calculator" action. calendarEventId stays the earliest event for
          // existing readers; the full set lets every merged event find this invoice.
          bookingId: eventPrefill?.bookingId ?? null,
          calendarEventId: eventPrefill?.calendarEventId ?? null,
          calendarEventIds: eventPrefill?.slots.map((slot) => slot.calendarEventId) ?? [],
          // Quote mode: server allocates a Q- number + 30-day validity.
          isQuote: quote || undefined,
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
        toast(
          quote
            ? "Quote saved - sheet counter sync failed. Update SETTINGS!B12."
            : "Invoice saved - sheet counter sync failed. Update SETTINGS!B19.",
          { tone: "warning" },
        );
      }
      const invoiceId = d.invoice.id;
      // Add-to-contacts gate: defer nav until the modal closes so
      // handleAddContactClose can backfill contactId via PATCH. "Save & send"
      // skips this - the detail send flow runs its own add-to-contacts hook-in.
      // Only the "new contact" path ever set contactId, via the prompt below,
      // so an invoice for a customer already on file was never linked to them.
      // That link is what the review-link check and the contact's invoice
      // history read, so resolve it here whether or not the prompt fires.
      if (clientEmail.trim()) {
        try {
          const checkParams = new URLSearchParams({ email: clientEmail.trim() });
          if (pickedContactGoogleId) checkParams.set("googleContactId", pickedContactGoogleId);
          const checkRes = await fetch(`/api/admin/contacts/check?${checkParams.toString()}`);
          const checkData = (await checkRes.json()) as {
            exists?: boolean;
            contactId?: string | null;
            existingContactId?: string | null;
            existingContactName?: string | null;
          };
          if (checkRes.ok) {
            const existingId = checkData.existingContactId ?? null;
            if (checkData.contactId) {
              await linkInvoiceToContact(invoiceId, checkData.contactId);
            } else if (existingId && send) {
              // Client picked from Google is already a contact, just without this
              // email. Link now so the send page finds the contact instead of
              // offering to add a duplicate.
              await linkInvoiceToContact(invoiceId, existingId);
            } else if (checkData.exists === false && !send) {
              // Unknown email (or a known contact missing it): defer nav so
              // handleAddContactClose can create or update the contact and link
              // it. "Save & send" skips the prompt - the detail send flow runs
              // its own add-to-contacts hook-in.
              setPendingExistingId(existingId);
              setPendingExistingName(checkData.existingContactName ?? null);
              setPendingInvoiceId(invoiceId);
              setSavingInvoice(false);
              return;
            }
          }
        } catch {
          // Fall through to navigate.
        }
      }
      // Drop the saved draft so the calculator starts blank next time the
      // operator opens it (mirrors the AddToContactsModal-gated path: the
      // backfill handler in handleAddContactClose ALSO clears the draft).
      clearDraft();
      router.push(`/admin/business/invoices/${invoiceId}${send ? "?send=1" : ""}`);
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
    setIncomeError(null);
    try {
      await saveTaskTemplates(tasks);
      const res = await fetch("/api/business/income", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Record against the selected job date (NZ-local), not UTC "now",
          // and store the discounted total the customer actually pays.
          date: jobDate,
          customer: clientName || "Walk-in",
          description: buildIncomeDescription(job),
          amount: totals.total,
          // Not a literal: this is income, and "Business Account" is an expense
          // method that INCOME_METHODS does not contain.
          method: INCOME_METHODS[0],
        }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        error?: string;
        sheetSyncWarning?: boolean;
      };
      if (d.ok) {
        // Surface a failed Cashbook append, as IncomeView and ExpensesView do.
        // recordIncome swallows the sheet error so the entry still saves, so a
        // plain success toast here hid money that never reached the sheet.
        if (d.sheetSyncWarning) {
          toast("Income saved, but the Cashbook sheet update didn't go through.", {
            tone: "warning",
          });
        } else {
          toast("Income entry saved.", { tone: "success" });
        }
        resetFormState();
      } else {
        setIncomeError(d.error || "Could not save income entry.");
      }
    } catch {
      setIncomeError("Could not save income entry. Please try again.");
    } finally {
      setSavingIncome(false);
    }
  }

  /**
   * Calls the travel-time API and replaces the single auto travel entry
   * (manual entries survive). Each leg quotes at its own departure: outbound
   * at job start, return at job end. Zero drive time leaves no auto entry;
   * any non-zero drive bills the $10 minimum via {@link calcTravelCharge}.
   */
  async function handleTravelLookup(): Promise<void> {
    if (!jobAddress.trim()) return;
    setLookingUpTravel(true);
    // Drop any stale auto entry up-front so the chip disappears while the
    // lookup is in flight; manual entries survive.
    setTravelEntries((prev) => prev.filter((e) => !e.isAuto));
    try {
      // Both legs anchor to the JOB DATE's weekday so a past job is quoted
      // with the traffic pattern of the day it actually happened.
      const departureTimeIso = jobStartIsoFromTime(aggregateStart, jobDate);
      // Return departure: the job's end time, guarded against
      // jobStartIsoFromTime's independent roll-forward inverting the pair;
      // falls back to departure + estimated duration, else the server's default.
      let returnDepartureTimeIso = jobStartIsoFromTime(aggregateEnd, jobDate);
      if (
        departureTimeIso &&
        returnDepartureTimeIso &&
        returnDepartureTimeIso <= departureTimeIso
      ) {
        returnDepartureTimeIso = new Date(
          new Date(returnDepartureTimeIso).getTime() + 24 * 60 * 60 * 1000,
        ).toISOString();
      }
      if (departureTimeIso && !returnDepartureTimeIso && durationMins > 0) {
        returnDepartureTimeIso = new Date(
          new Date(departureTimeIso).getTime() + durationMins * 60_000,
        ).toISOString();
      }
      const res = await fetch("/api/pricing/travel-time", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destination: jobAddress,
          ...(departureTimeIso ? { departureTimeIso } : {}),
          ...(returnDepartureTimeIso ? { returnDepartureTimeIso } : {}),
        }),
      });
      const d = (await res.json()) as {
        distanceKm?: number;
        durationMinsThere?: number;
        durationMinsBack?: number;
      };
      if (d.durationMinsThere && d.durationMinsThere > 0) {
        const backMins = d.durationMinsBack || d.durationMinsThere;
        // calcTravelCharge sums the legs and floors at MIN_TRAVEL_CHARGE, so
        // a 1-min drive still bills the $10 minimum.
        const cost = calcTravelCharge(
          d.durationMinsThere,
          backMins,
          pricing.travelRatePerHour,
          pricing.minTravelCharge,
        );
        const label = jobAddress.trim() || `${d.durationMinsThere} min drive`;
        setTravelEntries((prev) => [
          {
            label,
            cost,
            isAuto: true,
            destination: jobAddress.trim() || label,
            durationMinsOneWay: d.durationMinsThere,
            durationMinsBack: backMins,
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
    setRateForm(BLANK_RATE_FORM);
  }

  /**
   * Re-fetches the rates list from the API. Used after a reset and after
   * a 404 on edit/delete (which means the row was wiped server-side and the
   * local snapshot is stale).
   */
  async function refreshRates(): Promise<void> {
    try {
      const res = await fetch("/api/business/rates");
      if (!res.ok) return;
      const d = await res.json();
      if (d.ok && Array.isArray(d.rates)) setRates(d.rates);
    } catch (err) {
      console.error("[calculator] refreshRates failed:", err);
    }
  }

  /**
   * Wipes every rate row and reseeds the defaults (Standard base + modifier
   * set). Confirms first since this drops any custom rates. Also cancels any
   * in-progress edit so the form doesn't hold a stale ID.
   */
  async function handleResetRates(): Promise<void> {
    handleCancelEdit();
    setResettingRates(true);
    try {
      const res = await fetch("/api/business/rates", { method: "DELETE" });
      if (!res.ok) {
        console.error("[calculator] reset rates failed with status", res.status);
        return;
      }
      const d = await res.json();
      if (d.ok && Array.isArray(d.rates)) setRates(d.rates);
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
      const target = arr[idx];
      if (!target) return prev;
      const current = target.modifierIds ?? [];
      const picked = rates.find((r) => r.id === modifierId);
      let next: string[];
      if (current.includes(modifierId)) {
        next = current.filter((m) => m !== modifierId);
      } else if (picked && isChannelModifier(picked)) {
        // One task, one delivery channel: picking a second SWAPS rather than stacking,
        // which would compound both discounts into a rate the invoice never charges.
        const channelIds = new Set(rates.filter(isChannelModifier).map((r) => r.id));
        next = [...current.filter((m) => !channelIds.has(m)), modifierId];
      } else {
        next = [...current, modifierId];
      }
      const newPrice = effectiveHourlyRate(rates, target.baseRateId, next);
      arr[idx] = {
        ...target,
        modifierIds: next,
        unitPrice: newPrice,
        lineTotal: Math.round(target.qty * newPrice * 100) / 100,
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
      const target = arr[idx];
      if (!target) return prev;
      const newPrice = effectiveHourlyRate(rates, baseId, target.modifierIds);
      arr[idx] = {
        ...target,
        baseRateId: baseId,
        unitPrice: newPrice,
        lineTotal: Math.round(target.qty * newPrice * 100) / 100,
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
        headers: { "content-type": "application/json" },
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
        headers: { "content-type": "application/json" },
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
    const res = await fetch(`/api/business/rates/${id}`, { method: "DELETE" });
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
          existingContactName={pendingExistingName}
          onClose={(contactDbId) => void handleAddContactClose(contactDbId)}
        />
      )}

      {showTaxonomyModal && (
        <TaxonomyManageModal
          onClose={() => setShowTaxonomyModal(false)}
          onChanged={() => {
            // Re-fetch templates so the picker dropdown reflects cleared tags.
            void fetch("/api/business/task-templates")
              .then((r) => r.json())
              .then((d: { ok: boolean; templates: TaskTemplate[] }) => {
                if (d.ok) setTaskTemplates(d.templates);
              });
          }}
        />
      )}

      <ConfirmDialog
        open={confirmResetOpen}
        title="Reset all rates?"
        body="This wipes every rate and reseeds the defaults (Standard, Business, At home, Remote, Phone, Public Holiday). Any custom rates you've added will be deleted."
        confirmLabel="Reset rates"
        tone="danger"
        onConfirm={() => {
          setConfirmResetOpen(false);
          void handleResetRates();
        }}
        onCancel={() => setConfirmResetOpen(false)}
      />

      <ConfirmDialog
        open={confirmDeleteRateId !== null}
        title="Delete this rate?"
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          const id = confirmDeleteRateId;
          setConfirmDeleteRateId(null);
          if (id) void handleDeleteRate(id);
        }}
        onCancel={() => setConfirmDeleteRateId(null)}
      />

      <ConfirmDialog
        open={confirmClearOpen}
        title="Clear the whole form?"
        body="Wipes the job date, times, tasks, parts, travel, client details, and the description, and deletes the saved draft. This can't be undone."
        confirmLabel="Clear everything"
        tone="danger"
        onConfirm={() => {
          setConfirmClearOpen(false);
          resetFormState();
        }}
        onCancel={() => setConfirmClearOpen(false)}
      />

      {/* Job settings strip: the date, the promo code and the form tools share
          one box, so the first screen reaches the event picker and the job
          description. The date drives the public-holiday and promo lookup. */}
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            {/* Matching label widths line the two boxes up when they stack on a phone. */}
            <label
              htmlFor="job-date"
              className="shrink-0 text-sm font-semibold text-slate-700 max-sm:w-22"
            >
              Job date
            </label>
            <input
              id="job-date"
              type="date"
              value={jobDate}
              onChange={(e) => setJobDate(e.target.value || todayISO())}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
            />
          </div>

          {/* Code entry for a job taken over the phone. It renders whether or
              not a promo resolved - without it there would be nowhere to type a
              code when no automatic promo is running, which is exactly when a
              code matters. */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="calc-promo-code"
              className="shrink-0 text-sm font-semibold text-slate-700 max-sm:w-22"
            >
              Promo code
            </label>
            <input
              id="calc-promo-code"
              value={promoCodeInput}
              onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setPromoCode(promoCodeInput.trim());
                }
              }}
              placeholder="None"
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tracking-wider uppercase focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setPromoCode(promoCodeInput.trim())}
              disabled={promoCodeInput.trim() === promoCode}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Apply
            </button>
          </div>

          {/* The full clear lives up here rather than under the save buttons: it
              is the "start over" action, reached mid-form far more often than at
              the end, and destructive styling keeps it from reading as a fifth
              way to save. */}
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => setConfirmClearOpen(true)}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Clear form
            </button>
            <button
              onClick={() => setShowRates((p) => !p)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {showRates ? "Hide rates" : "Manage rates"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>The job date sets which promo and public-holiday rate apply.</span>
          {holiday.name && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">
              {holiday.name} - labour +{Math.round(holiday.uplift * 100)}%
            </span>
          )}
        </div>

        {/* The verdict comes from the job-date lookup, not a live check: a
            code can be valid today and not on the day the job was done. */}
        {promoCode !== "" && activePromo?.code !== promoCode && (
          <p className="text-sm font-medium text-red-700">
            {promoCode} isn&apos;t valid on {jobDate} - pricing uses whatever promo applied that
            day.
          </p>
        )}

        {/* The promo that applies, with a per-job skip toggle. */}
        {activePromo && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <span aria-hidden="true">⚡</span>
              <span className="font-semibold">Promo: {activePromo.title}</span>
              <span className="text-xs text-amber-700">({summariseForBanner(activePromo)})</span>
              {activePromo.code && (
                <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-semibold tracking-wider">
                  {activePromo.code}
                </span>
              )}
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
          onDeleteRate={(id) => setConfirmDeleteRateId(id)}
          onResetRates={() => setConfirmResetOpen(true)}
        />
      )}

      {/* Draft-restored banner sits above the grid so the Discard action is
          visible without scrolling on mobile, where cached values otherwise
          look like a mystery pre-filled form. */}
      {draftRestoredAt !== null && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT column - min-w-0 stops intrinsically wide children (task rows,
            travel breakdown) from blowing the grid track past the viewport;
            mirrors the guard on the right column. */}
        <div className="min-w-0 space-y-5">
          <EventPickerSection
            prefill={eventPrefill}
            jobDate={jobDate}
            timeRanges={timeRanges}
            mergeSuggestGapMins={pricing.mergeSuggestGapMins}
            onResetToEventTimes={resetToEventTimes}
            onBillEvents={handleBillEvents}
          />

          {/* Early cancel: bills the call-out fee instead of job work, so every
              job-shaped section below is swapped out while it is on. The button
              that gets you here lives at the bottom - it is a rare action and
              should not compete with the normal job flow. */}
          {cancelMode && (
            <div ref={cancelSectionRef}>
              <CancelFeeSection
                reason={cancelReason}
                onReasonChange={handleCancelReasonChange}
                meetingType={cancelMeetingType}
                onMeetingTypeChange={handleCancelMeetingTypeChange}
                bookingDate={jobDate}
                onBookingDateChange={handleCancelledDateChange}
                bookingTime={cancelBookingTime}
                onBookingTimeChange={handleCancelBookingTimeChange}
                cancelledAtDate={cancelledAtDate}
                onCancelledAtDateChange={handleCancelledAtDateChange}
                cancelledAtTime={cancelledAtTime}
                onCancelledAtTimeChange={handleCancelledAtTimeChange}
                fee={cancelCharge.fee}
                includeTravel={includeCancelTravel}
                hasTravel={travelEntries.length > 0 || stashedTravel.length > 0}
                noticeHours={cancelNoticeHours}
                feeApplies={cancelCharge.fee > 0}
                travelApplies={cancelCharge.travelApplies}
                isFullCallOut={cancelCharge.isFullCallOut}
                freeNoticeHours={
                  cancelMeetingType === "remote"
                    ? cancellation.remoteFreeNoticeHours
                    : cancellation.freeNoticeHours
                }
                travelChargeHours={cancellation.travelChargeHours}
                onExit={exitCancelMode}
              />
            </div>
          )}

          {/* AI input */}
          {!cancelMode && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h2 className="mb-1 text-sm font-semibold text-russian-violet">Describe the job</h2>
              <p className="mb-3 text-sm text-slate-600">
                {JOB_DESCRIPTION_HINT}
                {eventPrefill && ` ${JOB_DESCRIPTION_BOOKED_HINT}`} The AI fills in the time, tasks,
                travel and parts below for you to check.
              </p>
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
                placeholder={JOB_DESCRIPTION_PLACEHOLDER}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
              />
              {parseError && <p className="mt-1 text-sm text-red-600">{parseError}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void handleParse()}
                  suppressHydrationWarning
                  disabled={parsing || !aiInput.trim()}
                  className="rounded-lg bg-russian-violet px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {parsing ? "Parsing..." : hasParsed ? "Re-parse" : "Parse with AI"}
                </button>
                {/* Clear the cached description + parse session (the textarea is
                  draft-persisted, so old text reappears on every visit).
                  Parsed tasks/travel below stay - only the AI box resets. */}
                {(aiInput.trim() !== "" || hasParsed || clarifyQuestions.length > 0) && (
                  <button
                    onClick={() => {
                      setAiInput("");
                      setParseResult(null);
                      setParseError(null);
                      setHasParsed(false);
                      setClarifyQuestions([]);
                      setClarifyAnswers({});
                    }}
                    disabled={parsing}
                    aria-label="Clear job description"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
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
                  <p className="mb-3 text-sm font-medium text-amber-800">
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
          )}

          {/* Time */}
          {!cancelMode && (
            <JobDetailsSection
              timeRanges={timeRanges}
              onTimeRangesChange={setTimeRanges}
              followUpMins={followUpMins}
              onFollowUpMinsChange={setFollowUpMins}
              durationMins={durationMins}
            />
          )}

          {/* Tasks, straight under Time: they are most of the bill, and the
              inline warning compares their minutes against that job window.
              AI parses auto-collapse in applyParseResult, so the warning only
              fires on manual edits or window changes. Cancel mode has no work
              lines, so the whole block goes. */}
          {!cancelMode && (
            <>
              <TaskTimeWarning
                tasks={tasks}
                windowMin={durationMins}
                minBillableMins={pricing.minBillableMins}
                snapMins={pricing.taskTiming?.snapMins}
                onFix={() => {
                  const collapsed = collapseToWindow(tasks, durationMins, pricing.taskTiming);
                  setTasks(enforceMinBillable(collapsed.tasks, pricing.minBillableMins));
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
            </>
          )}

          {/* Travel. Stays available in cancel mode while the round trip is
              being billed, so the amount can still be looked up or corrected. */}
          {(!cancelMode || includeCancelTravel) && (
            <TravelSection
              jobAddress={jobAddress}
              onJobAddressChange={setJobAddress}
              onAddressSelected={handleAddressSelected}
              travelEntries={travelEntries}
              onTravelEntriesChange={setTravelEntries}
              lookingUpTravel={lookingUpTravel}
              onLookup={() => void handleTravelLookup()}
              travelRatePerHour={pricing.travelRatePerHour}
              minTravelCharge={pricing.minTravelCharge}
            />
          )}

          {/* Parts. Nothing was fitted on a cancelled job, so it is hidden and
              enterCancelMode clears whatever was there. */}
          {!cancelMode && (
            <PartsSection
              parts={parts}
              onPartsChange={setParts}
              show={showParts}
              onToggle={() => setShowParts((p) => !p)}
            />
          )}

          {/* Notes */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
            />
          </div>

          {/* Early cancel entry. Parked at the bottom: billing a job that never
              happened is the rare case, so it stays out of the normal flow. */}
          {!cancelMode && (
            <button
              type="button"
              onClick={enterCancelMode}
              className="rounded-lg border border-coquelicot-500/40 px-3 py-1.5 text-sm font-semibold text-coquelicot-600 transition-colors hover:bg-coquelicot-500/10"
            >
              Make early cancel
            </button>
          )}
        </div>

        {/* RIGHT column - live invoice preview (replaces the legacy Summary
            panel - same totals, just inside the actual invoice layout). */}
        <div ref={finishRef} className="min-w-0 scroll-mt-16 space-y-4">
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
              setClientEmail(normaliseEmail(c.email));
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

          {/* Actions */}
          <div className="space-y-2">
            {incomeError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {incomeError}
              </div>
            )}
            {saveInvoiceError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {saveInvoiceError}
              </p>
            )}
            <button
              onClick={() => void handleSaveInvoice(false)}
              disabled={savingInvoice || parsing}
              suppressHydrationWarning
              className="w-full rounded-lg bg-russian-violet px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {savingInvoice && !saveSendMode ? "Saving..." : "Save invoice"}
            </button>
            <button
              onClick={() => void handleSaveInvoice(true)}
              disabled={savingInvoice || parsing}
              suppressHydrationWarning
              title="Save the invoice and jump straight to the send-to-client step."
              className="w-full rounded-lg border border-russian-violet px-4 py-2 text-sm font-semibold text-russian-violet hover:bg-russian-violet/5 disabled:opacity-50"
            >
              {savingInvoice && saveSendMode ? "Saving..." : "Save & send"}
            </button>
            <button
              onClick={() => void handleSaveInvoice(false, true)}
              disabled={savingInvoice || parsing}
              suppressHydrationWarning
              title="Save as a Q-numbered quote - convert it to an invoice once the client accepts."
              className="w-full rounded-lg border border-russian-violet px-4 py-2 text-sm font-semibold text-russian-violet hover:bg-russian-violet/5 disabled:opacity-50"
            >
              {savingInvoice && saveQuoteMode ? "Saving..." : "Save as quote"}
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
            gstRegistered={pricing.gstRegistered}
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

      {/* Phone total bar. Below lg the preview, and the total in it, sits under
          every section, so the running figure stays pinned here while the job
          is built, with a jump down to the client and save buttons. It stays
          hidden until the job has a total, so an empty calculator isn't
          topped by a $0.00 bar. */}
      <div
        data-phone-bar={showTotalBar ? "sticky" : undefined}
        className={cn(
          "sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:-mx-6 sm:px-6 lg:hidden",
          !showTotalBar && "hidden",
        )}
      >
        <p className="text-sm text-slate-600">
          Total{" "}
          <span className="text-lg font-bold text-russian-violet">{formatNZD(totals.total)}</span>
        </p>
        <button
          type="button"
          onClick={() => finishRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="rounded-lg bg-russian-violet px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Client &amp; save
        </button>
      </div>
    </>
  );
}

interface TaskTimeWarningProps {
  tasks: TaskLine[];
  windowMin: number;
  minBillableMins: number;
  /** Live billing increment; sizes the pinned-task overshoot allowance. */
  snapMins?: number;
  onFix: () => void;
}

/**
 * Inline banner shown above the tasks panel when hourly task minutes don't
 * match the listed job window, or when a short job sits below the minimum
 * billable time. Stays hidden when everything lines up so the panel doesn't
 * carry a permanent strip of UI in the steady state.
 * @param props - Component props.
 * @param props.tasks - Current task lines (hourly + flat).
 * @param props.windowMin - Job window in minutes (`durationMins`).
 * @param props.minBillableMins - Minimum billable labour minutes; below this the floor banner shows.
 * @param props.snapMins - Live billing increment sizing the pinned-task overshoot allowance.
 * @param props.onFix - Handler that collapses tasks to the window and floors to the minimum.
 * @returns Warning element, or null when totals already match.
 */
function TaskTimeWarning({
  tasks,
  windowMin,
  minBillableMins,
  snapMins,
  onFix,
}: TaskTimeWarningProps): React.ReactElement | null {
  const taskMin = hourlyTaskMinutes(tasks);
  if (taskMin === 0) return null;

  // Sub-minimum job: whole-job labour sits under the billable floor, so offer to bill at
  // the minimum (Fix floors the tasks). Checked before the window comparison - a short job
  // usually has taskMin == windowMin, which the drift tolerance below would swallow.
  if (taskMin < minBillableMins) {
    return (
      <div
        role="status"
        className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"
      >
        <span>
          Tasks total {Math.round(taskMin)} min - minimum charge is {minBillableMins} min.
        </span>
        <button
          type="button"
          onClick={onFix}
          className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-sky-100"
        >
          Fix - bill the minimum
        </button>
      </div>
    );
  }

  if (windowMin <= 0) return null;
  // Explicit durations round UP to the snap grid, so their sum can top the
  // raw window by one step per pinned task without being an over-estimate.
  // Suppress that expected overshoot - Fix never rescales pinned tasks.
  const overshoot = taskMin - windowMin;
  if (overshoot > 0 && overshoot <= explicitRoundingAllowanceMins(tasks, snapMins)) return null;
  // Tolerance: qty rounds to 2 dp (0.6-min granularity), so a 3-task split can sit ~1.5
  // min off windowMin and still be correct after collapseToWindow. Without it the banner
  // reads "Tasks total 215 min - listed window is 215 min" off a 214.8 vs 215 float.
  if (Math.abs(taskMin - windowMin) < 2) return null;
  const over = taskMin > windowMin;
  // Billing to the minimum floor legitimately exceeds a shorter worked window,
  // so a floored job (taskMin at the minimum, window below it) isn't an
  // over-estimate - only flag "over" when the tasks also clear the floor.
  if (over && taskMin <= minBillableMins) return null;
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
