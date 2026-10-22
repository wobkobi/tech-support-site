"use client";
// src/features/business/components/CalculatorView.tsx
// Job-pricing calculator and invoice builder: line items from tasks, parts and travel,
// AI parsing of a job description, and a live invoice preview.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StickyActionBar } from "@/features/admin/components/ui/StickyActionBar";
import { AddToContactsModal } from "@/features/business/components/AddToContactsModal";
import { InvoicePreviewPanel } from "@/features/business/components/InvoicePreviewPanel";
import { TaxonomyManageModal } from "@/features/business/components/TaxonomyManageModal";
import { CancelFeeSection } from "@/features/business/components/calculator/CancelFeeSection";
import { ClientPickerSection } from "@/features/business/components/calculator/ClientPickerSection";
import { DescribeJobSection } from "@/features/business/components/calculator/DescribeJobSection";
import { DraftRestoredBanner } from "@/features/business/components/calculator/DraftRestoredBanner";
import { EventPickerSection } from "@/features/business/components/calculator/EventPickerSection";
import { JobDetailsSection } from "@/features/business/components/calculator/JobDetailsSection";
import { JobSettingsStrip } from "@/features/business/components/calculator/JobSettingsStrip";
import { NotesSection } from "@/features/business/components/calculator/NotesSection";
import { PartsSection } from "@/features/business/components/calculator/PartsSection";
import { PhoneTotalBar } from "@/features/business/components/calculator/PhoneTotalBar";
import { ReissueBanner } from "@/features/business/components/calculator/ReissueBanner";

import { SaveActions } from "@/features/business/components/calculator/SaveActions";
import { SaveButtons } from "@/features/business/components/calculator/SaveButtons";
import { TaskTimeWarning } from "@/features/business/components/calculator/TaskTimeWarning";
import { TasksSection } from "@/features/business/components/calculator/TasksSection";
import { TravelSection } from "@/features/business/components/calculator/TravelSection";

import { useCalculatorSave } from "@/features/business/hooks/use-calculator-save";
import { useCancelMode } from "@/features/business/hooks/use-cancel-mode";
import { useJobContext } from "@/features/business/hooks/use-job-context";
import { useJobParse } from "@/features/business/hooks/use-job-parse";
import {
  alreadyPaidAmount,
  EMPTY_ALREADY_PAID,
  type AlreadyPaidState,
} from "@/features/business/lib/already-paid-input";
import {
  calcJobTotal,
  formatNZD,
  isTripDrive,
  jobToLineItems,
  timeDiffMins,
  todayISO,
  type JobPricing,
} from "@/features/business/lib/business";
import {
  AI_INPUT_HANDOFF_KEY,
  clearDraft,
  isMeaningfulDraft,
  isPlaceholderHour,
  loadDraft,
  saveDraft,
} from "@/features/business/lib/calculator-draft";
import {
  addDaysISO,
  addHour,
  emptyTask,
  lookupAutoTravel,
  repriceHourlyTasks,
  setTaskBaseLine,
  toggleTaskModifierLine,
  updateTaskField,
} from "@/features/business/lib/calculator-helpers";
import type { ReissuePrefill } from "@/features/business/lib/invoice-reissue";
import { fitTasksToWindow } from "@/features/business/lib/parse-hydrate";
import { calcTravelCharge, type CancellationPolicy } from "@/features/business/lib/pricing-policy";
import type { ActivePromo } from "@/features/business/lib/promos";
import type {
  EventPrefill,
  GoogleContact,
  JobCalculation,
  ParsedRange,
  PartLine,
  RateConfig,
  TaskLine,
  TaskTemplate,
  TravelEntry,
} from "@/features/business/types/business";
import { matchedByCompanyOnly } from "@/features/contacts/lib/contact-search";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import type { IdentitySettings } from "@/shared/lib/settings/types";
import { nzNowTime } from "@/shared/lib/timezone-utils";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

interface CalculatorViewProps {
  /** Live business identity, threaded into the invoice preview. */
  identity: IdentitySettings;
  /** Live pricing for the job calculations, plus the event picker's merge-suggestion window. */
  pricing: JobPricing & { travelRatePerHour: number; mergeSuggestGapMins: number };
  /** Live cancellation policy for cancel mode; not part of {@link JobPricing}. */
  cancellation: CancellationPolicy;
  /** Rate configs resolved server-side so the calculator renders without a fetch waterfall. */
  initialRates: RateConfig[];
  /** Task templates resolved server-side, ordered by usage. */
  initialTaskTemplates: TaskTemplate[];
  /** Active promo resolved server-side; refined per job date by the job-context effect. */
  initialPromo: ActivePromo | null;
  /** Job prefill from a schedule event ("Bill in calculator"); null on a normal load. */
  eventPrefill: EventPrefill | null;
  /** What a voided invoice being re-issued carries over; null on a normal load. */
  reissue: ReissuePrefill | null;
  /** Opened from "New quote": the save area leads with Save quote and drops the payment boxes. */
  quoteMode: boolean;
}

// Prefill shapes live in shared types so the event picker needn't import this module.
export type { EventPrefill, EventPrefillSlot } from "@/features/business/types/business";

/**
 * Job calculator that builds a quote, then saves it as income or converts it to an invoice.
 * @param props - Component props.
 * @param props.identity - Live business identity for the invoice preview.
 * @param props.pricing - Live pricing for the job calculations.
 * @param props.cancellation - Live cancellation policy driving cancel mode.
 * @param props.initialRates - Server-resolved rate configs.
 * @param props.initialTaskTemplates - Server-resolved task templates.
 * @param props.initialPromo - Server-resolved active promo, or null.
 * @param props.eventPrefill - Schedule-event job prefill, or null on a normal load.
 * @param props.reissue - Voided invoice being re-issued, or null on a normal load.
 * @param props.quoteMode - Whether the calculator was opened to make a quote.
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
  reissue,
  quoteMode,
}: CalculatorViewProps): React.ReactElement {
  const router = useRouter();

  // Draft restore runs in the mount effect to keep hydration consistent. The ref marks a
  // restored draft for async callbacks without becoming a dependency.
  const draftLoadedRef = useRef(false);
  // Captured once to keep timeAgo() pure for the toast label.
  const [mountedAt] = useState(() => Date.now());
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);

  // Server-resolved; rates are edited on the Settings > Rates tab, so a reload picks up changes.
  const rates = initialRates;
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>(initialTaskTemplates);
  // Time slots lump into one billable duration; the AI parse adds one per HH:MM-HH:MM segment.
  const [timeRanges, setTimeRanges] = useState<ParsedRange[]>(() => {
    // One slot per merged event; the gaps between them aren't billed.
    if (eventPrefill) {
      return eventPrefill.slots.map((s) => ({ startTime: s.startTime, endTime: s.endTime }));
    }
    return [{ startTime: "", endTime: "" }];
  });
  // Whether the Time card holds real times rather than a seeded placeholder. Only real
  // times go to the parser, or a placeholder gets billed.
  const [timesSet, setTimesSet] = useState(false);
  /**
   * Applies a Time card edit; changing or removing a row makes the times real, appending doesn't.
   * @param next - The card's new ranges.
   */
  function handleTimeRangesChange(next: ParsedRange[]): void {
    const edited =
      next.length < timeRanges.length ||
      timeRanges.some(
        (r, i) => next[i]?.startTime !== r.startTime || next[i]?.endTime !== r.endTime,
      );
    setTimeRanges(next);
    if (edited) setTimesSet(true);
  }
  // Out-of-session work billed on top of the slot sum.
  const [followUpMins, setFollowUpMins] = useState(0);
  // Every travel charge, summed into one line. An event prefill seeds from the frozen
  // TravelBlock, since a fresh lookup on a past job would quote tomorrow's traffic.
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
  const [notes, setNotes] = useState(() => reissue?.notes ?? "");
  // Paid in cash on the day: invoices save as paid, income entries record Cash.
  const [paidCash, setPaidCash] = useState(false);
  // Part of the bill handed over on the day: shown on the invoice, recorded in income.
  const [alreadyPaid, setAlreadyPaid] = useState<AlreadyPaidState>(EMPTY_ALREADY_PAID);
  // Client, save buttons and preview; the phone total bar hides while any is on screen.
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
  // Client details
  // A re-issue's own client details fill in when no calendar event backs it.
  const [clientName, setClientName] = useState(
    () => eventPrefill?.clientName ?? reissue?.clientName ?? "",
  );
  // Normalised on seed too, so the preview shows exactly what gets saved.
  const [clientEmail, setClientEmail] = useState(() =>
    normaliseEmail(eventPrefill?.clientEmail ?? reissue?.clientEmail),
  );
  // Address-to choice (Name/Company/Custom) carries through to the invoice.
  const [pickedContactName, setPickedContactName] = useState<string | null>(null);
  const [pickedContactCompany, setPickedContactCompany] = useState<string | null>(null);
  const [pickedContactGoogleId, setPickedContactGoogleId] = useState<string | null>(null);
  const [addressMode, setAddressModeState] = useState<"name" | "company" | "custom">("custom");
  // "Also update the contact" box, shown once a picked contact's name is edited.
  const [renameContact, setRenameContact] = useState(true);
  // The typed name, when it is a hand edit of a picked contact's name.
  const typedClientName = clientName.trim();
  const contactRenameOffer =
    pickedContactName &&
    pickedContactGoogleId &&
    addressMode === "custom" &&
    typedClientName &&
    typedClientName !== pickedContactName &&
    typedClientName !== pickedContactCompany
      ? typedClientName
      : null;

  // Full-clear confirm: clearing also deletes the saved draft, so it can't be undone.
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  /**
   * Loads the calculator for a set of calendar events, keeping a part-typed description.
   * Must remount: the prefill only lands through useState initialisers.
   * @param eventIds - Google Calendar event ids to bill as one job.
   */
  function handleBillEvents(eventIds: string[]): void {
    try {
      if (aiInput.trim()) sessionStorage.setItem(AI_INPUT_HANDOFF_KEY, aiInput);
    } catch {
      // Storage unavailable; the description won't carry over.
    }
    // No events left: fall back to a blank calculator.
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
    setTimesSet(false);
  }

  // Travel lookup
  const [jobAddress, setJobAddress] = useState(() => eventPrefill?.jobAddress ?? "");
  // Drove or walked, for the logged trip. null follows the job: charged travel means drove,
  // otherwise the base suburb counts as walked.
  const [walkedChoice, setWalkedChoice] = useState<boolean | null>(null);
  const homeLocality = identity.baseAddress.locality.trim().toLowerCase();
  const travelCharged = travelEntries.some((e) => e.kind !== "storeRun" && e.cost > 0);
  const walked =
    walkedChoice ??
    (!travelCharged && homeLocality.length > 0 && jobAddress.toLowerCase().includes(homeLocality));
  const [lookingUpTravel, setLookingUpTravel] = useState(false);

  // Contacts
  const [contacts, setContacts] = useState<GoogleContact[]>([]);

  // Per-job promo skip flag (not persisted).
  const [skipPromo, setSkipPromo] = useState(false);
  // Typed box and applied code are separate so the job isn't repriced on every keystroke.
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoCode, setPromoCode] = useState("");

  // Job date drives the surcharge + promo lookup, so a past job is priced by what applied
  // then. Defaults to today (NZ), or a re-issue's voided invoice date.
  const [jobDate, setJobDate] = useState<string>(
    () => eventPrefill?.jobDate ?? reissue?.issueDate ?? todayISO(),
  );

  // Earliest start, for time-of-day promos; HH:MM strings sort as times.
  const jobStartTime =
    timeRanges
      .map((r) => r.startTime)
      .filter((t) => /^\d{2}:\d{2}$/.test(t))
      .sort()[0] ?? "";
  const prefillBookingId = eventPrefill?.bookingId ?? null;

  // Date surcharge (public holiday or weekend) + date-resolved promo for the job date.
  const { surcharge: dateSurcharge, activePromo } = useJobContext({
    jobDate,
    jobStartTime,
    promoCode,
    clientEmail,
    prefillBookingId,
    initialPromo,
  });

  // AI parse session
  const {
    aiInput,
    setAiInput,
    parsing,
    parseResult,
    setParseResult,
    parseError,
    hasParsed,
    clarifyQuestions,
    clarifyAnswers,
    setClarifyAnswers,
    handleParse,
    skipClarify,
    clearAiInput,
  } = useJobParse({
    pricing,
    eventPrefill,
    jobDate,
    jobAddress,
    timeRanges,
    timesSet,
    billedToCompany: addressMode === "company",
    setFollowUpMins,
    setTimeRanges,
    setTimesSet,
    setJobAddress,
    setTravelEntries,
    setTasks,
    setParts,
    setNotes,
    setPaidCash,
    setAlreadyPaid,
  });

  const {
    cancelMode,
    cancelReason,
    includeCancelTravel,
    cancelBookingTime,
    cancelledAtDate,
    cancelledAtTime,
    cancelMeetingType,
    stashedTravel,
    cancelSectionRef,
    cancelNoticeHours,
    cancelCharge,
    enterCancelMode,
    exitCancelMode,
    resetCancelMode,
    handleCancelReasonChange,
    handleCancelMeetingTypeChange,
    handleCancelledDateChange,
    handleCancelBookingTimeChange,
    handleCancelledAtDateChange,
    handleCancelledAtTimeChange,
  } = useCancelMode({
    cancellation,
    eventPrefill,
    jobDate,
    setJobDate,
    timeRanges,
    jobAddress,
    travelEntries,
    setTravelEntries,
    setTasks,
    setNotes,
    setParts,
  });

  // Where you drove, for the logged trip: any addressed job except a walk, remote event or
  // a cancellation without a round trip.
  const tripAddress =
    jobAddress.trim() &&
    !walked &&
    eventPrefill?.meetingType !== "remote" &&
    (!cancelMode || includeCancelTravel)
      ? jobAddress.trim()
      : null;

  /**
   * Edits the job address and resets drove/walked to the suburb default.
   * @param value - Address text.
   */
  function changeJobAddress(value: string): void {
    setJobAddress(value);
    setWalkedChoice(null);
  }

  // A cancellation fee is flat: no date surcharge and no promo redemption.
  const pricedPromo = cancelMode ? null : activePromo;
  const surcharge = cancelMode ? null : dateSurcharge;

  /**
   * Applies a picked Places suggestion and drops the stale trip (manual entries survive).
   * @param formattedAddress - The selected address.
   */
  function handleAddressSelected(formattedAddress: string): void {
    changeJobAddress(formattedAddress);
    setTravelEntries((prev) => prev.filter((e) => !isTripDrive(e)));
  }

  // Mount seeding + contacts fetch. "now" seeds in an effect to avoid a hydration mismatch;
  // contacts stay a client fetch as the People API is too slow to block on.
  useEffect(() => {
    // Restore the draft after mount. An event prefill outranks it; a draft of only seeded
    // times reseeds "now".
    const draft = eventPrefill || reissue ? null : loadDraft();
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
      // Without the flag, times count as real unless they're the lone seeded one-hour row.
      setTimesSet(draft.timesSet ?? !isPlaceholderHour(draft.timeRanges));
      setFollowUpMins(draft.followUpMins ?? 0);
      setTravelEntries(draft.travelEntries ?? []);
      setJobAddress(draft.jobAddress ?? "");
      setTasks(repriceHourlyTasks(draft.tasks ?? [], rates));
      setParts(draft.parts ?? []);
      setNotes(draft.notes ?? "");
      setPaidCash(draft.paidCash ?? false);
      setAlreadyPaid(draft.alreadyPaid ?? EMPTY_ALREADY_PAID);
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
    // The description survives a prefill: prefer the picker's sessionStorage stash (fresher
    // than the debounced draft), else the draft text. Read before the writer's first tick.
    try {
      const handoff = sessionStorage.getItem(AI_INPUT_HANDOFF_KEY);
      if (handoff) sessionStorage.removeItem(AI_INPUT_HANDOFF_KEY);
      // A re-issue seeds the voided invoice's lines instead of any saved draft text.
      const carried =
        handoff ?? (reissue ? reissue.jobText : eventPrefill ? (loadDraft()?.aiInput ?? "") : "");
      if (carried) {
        setAiInput(carried);
      }
    } catch {
      // Storage unavailable; nothing to restore.
    }
    fetch("/api/business/contacts")
      .then((r) => r.json())
      .then((d: { ok: boolean; contacts: GoogleContact[] }) => {
        if (!d.ok) return;
        setContacts(d.contacts);
        // Pick the Google contact matching the booking's email and name, so the
        // Name/Company switch shows.
        const seeded = eventPrefill ?? reissue;
        const email = normaliseEmail(seeded?.clientEmail);
        const match = email ? d.contacts.find((c) => normaliseEmail(c.email) === email) : undefined;
        if (match && match.name.trim().toLowerCase() === seeded?.clientName.trim().toLowerCase()) {
          setPickedContactName(match.name);
          setPickedContactCompany(match.company?.trim() || null);
          setPickedContactGoogleId(match.id || null);
          setAddressModeState("name");
        }
      })
      .catch(() => {
        /* picker stays empty; manual client entry still works */
      });
    // Run once on mount; re-running would clobber edited state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced draft writer (500ms).
  useEffect(() => {
    const t = setTimeout(() => {
      saveDraft({
        aiInput,
        jobDate,
        promoCode,
        timeRanges,
        timesSet,
        followUpMins,
        travelEntries,
        jobAddress,
        tasks,
        parts,
        notes,
        paidCash,
        alreadyPaid,
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
    timesSet,
    followUpMins,
    travelEntries,
    jobAddress,
    tasks,
    parts,
    notes,
    paidCash,
    alreadyPaid,
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

  // Billable window = slot sum plus out-of-session minutes.
  const sumRangesMin = timeRanges.reduce((s, r) => s + timeDiffMins(r.startTime, r.endTime), 0);
  const durationMins = sumRangesMin + followUpMins;
  // First start / last end for the travel departure ISOs, sorted to handle out-of-order rows.
  const sortedRanges = [...timeRanges]
    .filter((r) => r.startTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const aggregateStart = sortedRanges[0]?.startTime ?? "";
  const aggregateEnd = sortedRanges[sortedRanges.length - 1]?.endTime ?? "";
  // Base hourly rates (e.g. Standard $65/hr) used as the per-task base rate.
  const baseRates = rates.filter((r) => r.ratePerHour !== null);
  // Signed $/hr modifier chips per task. Percent rows stay off: the date surcharge already
  // adds that uplift.
  const modifierRates = rates
    .filter((r) => r.hourlyDelta !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
  const flatRates = rates.filter((r) => r.flatRate !== null);

  // Labour bills through per-task rates; durationMins is the rebalance window, not a charge.
  const job: JobCalculation = {
    durationMins,
    tasks,
    parts,
    travelEntries,
    notes,
    clientName,
    clientEmail,
  };

  // Date surcharge on labour, and the business modifier a (home-rate) promo skips - the
  // same predicate getPublicPricing uses.
  const businessModifierId =
    rates.find((r) => r.label === "Business" && r.unit === "modifier")?.id ?? null;
  // The Standard rate a flat promo cuts from, picked as getPublicPricing does.
  const standardRate =
    rates.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
    rates.find((r) => r.ratePerHour !== null && r.unit === "hour")?.ratePerHour ??
    null;
  const jobPricing = {
    ...pricing,
    surchargeUplift: surcharge?.uplift ?? 0,
    businessModifierId,
    standardRate,
    rates,
  };
  const totals = calcJobTotal(job, !skipPromo ? pricedPromo : null, jobPricing);
  const showTotalBar = !finishInView && totals.total > 0;
  // Memoised so the preview's React.memo skips unrelated re-renders.
  const previewLineItems = useMemo(
    () => jobToLineItems(job, surcharge, pricing.minTravelCharge, pricing.minBillableMins),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tasks,
      parts,
      timeRanges,
      durationMins,
      surcharge,
      travelEntries,
      clientName,
      clientEmail,
      notes,
      // Both feed jobToLineItems; omitting them leaves the preview stale against `totals`.
      pricing.minTravelCharge,
      pricing.minBillableMins,
    ],
  );

  // Invoice / quote / income saves, the add-to-contacts gate, and template upserts.
  const {
    savingInvoice,
    saveSendMode,
    saveQuoteMode,
    saveInvoiceError,
    pendingInvoiceId,
    pendingExistingName,
    pendingExistingDetail,
    savingIncome,
    incomeError,
    handleSaveInvoice,
    handleSaveIncome,
    handleAddContactClose,
    resetSaveState,
  } = useCalculatorSave({
    renameContactTo: renameContact ? contactRenameOffer : null,
    job,
    totals,
    surcharge,
    pricing,
    activePromo: pricedPromo,
    skipPromo,
    eventPrefill,
    pickedContactGoogleId,
    jobDate,
    tripAddress,
    paidCash,
    alreadyPaid,
    setTaskTemplates,
    onIncomeSaved: resetFormState,
  });

  /**
   * Switches address-to mode and updates clientName; Custom keeps the current name.
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
   * Resets every field to a blank calculator and drops the draft. When billing a calendar
   * event, navigates off `?eventId=` so the keyed view remounts without the prefill.
   */
  function resetFormState(): void {
    const now = nzNowTime();
    setJobDate(todayISO());
    setSkipPromo(false);
    setPromoCode("");
    setPromoCodeInput("");
    setTimeRanges([{ startTime: now, endTime: addHour(now) }]);
    setTimesSet(false);
    setFollowUpMins(0);
    setTravelEntries([]);
    changeJobAddress("");
    setTasks([]);
    setParts([]);
    setShowParts(false);
    setNotes("");
    setPaidCash(false);
    setAlreadyPaid(EMPTY_ALREADY_PAID);
    setClientName("");
    setClientEmail("");
    setPickedContactName(null);
    setPickedContactCompany(null);
    setPickedContactGoogleId(null);
    setAddressModeState("custom");
    setRenameContact(true);
    // Description and parse-session results.
    clearAiInput();
    setDraftRestoredAt(null);
    // Cancel mode and its policy inputs go back to their mount defaults.
    resetCancelMode();
    // Save errors and in-flight save bookkeeping.
    resetSaveState();
    // Transient dialog state.
    setShowTaxonomyModal(false);
    clearDraft();
    // The prefill is a server prop, so drop the query param to remount blank.
    if (eventPrefill || reissue) {
      router.replace(
        quoteMode ? "/admin/business/calculator?quote=1" : "/admin/business/calculator",
      );
    }
  }

  /**
   * Looks up the drive and replaces the trip entry, even a typed-over one; see
   * {@link lookupAutoTravel} for leg departures.
   */
  async function handleTravelLookup(): Promise<void> {
    if (!jobAddress.trim()) return;
    setLookingUpTravel(true);
    // Drop the stale auto entry while the lookup runs; manual entries survive.
    setTravelEntries((prev) => prev.filter((e) => !isTripDrive(e)));
    try {
      const entry = await lookupAutoTravel({
        jobAddress,
        aggregateStart,
        aggregateEnd,
        jobDate,
        durationMins,
        travelRatePerHour: pricing.travelRatePerHour,
        minTravelCharge: pricing.minTravelCharge,
      });
      if (entry) {
        setTravelEntries((prev) => [entry, ...prev.filter((e) => !isTripDrive(e))]);
      }
    } catch {
      // silently ignore - travel is optional
    }
    setLookingUpTravel(false);
  }

  // Shared by both copies of the save buttons: the right column's below lg, the bar's on lg+.
  const saveButtonProps = {
    savingInvoice,
    saveSendMode,
    saveQuoteMode,
    quoteMode,
    savingIncome,
    parsing,
    subtotal: totals.subtotal,
    total: totals.total,
    paidCash,
    alreadyPaid,
  };

  return (
    <>
      {pendingInvoiceId && (
        <AddToContactsModal
          // The person, not the addressed-to name (a company invoice).
          name={pickedContactName ?? clientName}
          company={pickedContactCompany}
          email={clientEmail}
          googleContactId={pickedContactGoogleId}
          existingContactName={pendingExistingName}
          existingContactDetail={pendingExistingDetail}
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

      <JobSettingsStrip
        jobDate={jobDate}
        onJobDateChange={(date) => setJobDate(date || todayISO())}
        promoCodeInput={promoCodeInput}
        onPromoCodeInputChange={setPromoCodeInput}
        promoCode={promoCode}
        onApplyPromoCode={() => setPromoCode(promoCodeInput.trim())}
        onClearForm={() => setConfirmClearOpen(true)}

        surcharge={surcharge}
        activePromo={pricedPromo}
        skipPromo={skipPromo}
        onSkipPromoChange={setSkipPromo}
      />

      {reissue && <ReissueBanner reissue={reissue} fromEvent={eventPrefill !== null} />}

      {draftRestoredAt !== null && (
        <DraftRestoredBanner
          draftRestoredAt={draftRestoredAt}
          mountedAt={mountedAt}
          onDiscard={resetFormState}
        />
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
            <DescribeJobSection
              aiInput={aiInput}
              onAiInputChange={setAiInput}
              showBookedHint={eventPrefill !== null}
              parseError={parseError}
              parsing={parsing}
              hasParsed={hasParsed}
              parseResult={parseResult}
              onDismissParseResult={() => setParseResult(null)}
              clarifyQuestions={clarifyQuestions}
              clarifyAnswers={clarifyAnswers}
              onClarifyAnswerChange={(id, value) =>
                setClarifyAnswers((prev) => ({ ...prev, [id]: value }))
              }
              onParse={(answers) => void handleParse(answers)}
              onClear={clearAiInput}
              onSkipClarify={skipClarify}
            />
          )}

          {/* Time */}
          {!cancelMode && (
            <JobDetailsSection
              timeRanges={timeRanges}
              onTimeRangesChange={handleTimeRangesChange}
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
                onFix={() =>
                  setTasks(
                    fitTasksToWindow(
                      tasks,
                      durationMins,
                      pricing.taskTiming,
                      pricing.minBillableMins,
                    ).tasks,
                  )
                }
              />
              <TasksSection
                tasks={tasks}
                onTasksChange={setTasks}
                onUpdateTask={(idx, field, val) =>
                  setTasks((prev) => updateTaskField(prev, idx, field, val, rates))
                }
                onSetTaskBase={(idx, baseId) =>
                  setTasks((prev) => setTaskBaseLine(prev, idx, baseId, rates))
                }
                onToggleTaskModifier={(idx, modifierId) =>
                  setTasks((prev) => toggleTaskModifierLine(prev, idx, modifierId, rates))
                }
                onAddTask={() => setTasks((p) => [...p, emptyTask(rates)])}
                onManageTags={() => setShowTaxonomyModal(true)}
                taskTemplates={taskTemplates}
                baseRates={baseRates}
                modifierRates={modifierRates}
                flatRates={flatRates}
                unsuccessfulFactor={pricing.unsuccessfulFactor ?? 0.5}
              />
            </>
          )}

          {/* Travel. Stays available in cancel mode while the round trip is
              being billed, so the amount can still be looked up or corrected. */}
          {(!cancelMode || includeCancelTravel) && (
            <TravelSection
              jobAddress={jobAddress}
              onJobAddressChange={changeJobAddress}
              onAddressSelected={handleAddressSelected}
              showTripMode={eventPrefill?.meetingType !== "remote"}
              walked={walked}
              onWalkedChange={setWalkedChoice}
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

          <NotesSection notes={notes} onNotesChange={setNotes} />

          {/* Early cancel entry. Parked at the bottom: billing a job that never
              happened is the rare case, so it stays out of the normal flow. */}
          {!cancelMode && (
            <AdminButton variant="danger" onClick={enterCancelMode}>
              Make early cancel
            </AdminButton>
          )}
        </div>

        {/* RIGHT column - client, payment and the live invoice preview. */}
        <div ref={finishRef} className="min-w-0 space-y-4">
          {/* Client above the preview, so it stays in reach without scrolling
              past the full A4-sized invoice render. */}
          <ClientPickerSection
            clientName={clientName}
            onClientNameChange={setClientName}
            clientEmail={clientEmail}
            onClientEmailChange={setClientEmail}
            pickedContactName={pickedContactName}
            pickedContactCompany={pickedContactCompany}
            addressMode={addressMode}
            onAddressModeChange={setAddressMode}
            renameOffer={contactRenameOffer}
            renameContact={renameContact}
            onRenameContactChange={setRenameContact}
            contacts={contacts}
            onSelectContact={(c) => {
              const company = c.company?.trim() || null;
              // Found by typing the company: address it to the company.
              const byCompany = matchedByCompanyOnly(c, clientName);
              setClientName(byCompany && company ? company : c.name);
              setClientEmail(normaliseEmail(c.email));
              setPickedContactName(c.name);
              setPickedContactCompany(company);
              setPickedContactGoogleId(c.id || null);
              setRenameContact(true);
              // Bypass setAddressMode: its stale closure would flip the mode to "custom".
              setAddressModeState(byCompany ? "company" : "name");
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

          {/* Payment boxes, then the phone copy of the save buttons. */}
          <SaveActions
            incomeError={incomeError}
            saveInvoiceError={saveInvoiceError}
            quoteMode={quoteMode}
            total={totals.total}
            paidCash={paidCash}
            onPaidCashChange={setPaidCash}
            alreadyPaid={alreadyPaid}
            onAlreadyPaidChange={setAlreadyPaid}
            buttons={
              <SaveButtons
                {...saveButtonProps}
                onSaveInvoice={(send, quote) => void handleSaveInvoice(send, quote)}
                onSaveIncome={() => void handleSaveIncome()}
                className="lg:hidden"
              />
            }
          />

          {/* Invoice preview - below the save buttons, so on phones they stay
              reachable without scrolling past the full A4 render. */}
          <InvoicePreviewPanel
            identity={identity}
            number="DRAFT"
            isQuote={quoteMode}
            clientName={clientName}
            clientEmail={clientEmail}
            issueDate={todayISO()}
            dueDate={addDaysISO(identity.paymentTermsDays)}
            lineItems={previewLineItems}
            notes={notes}
            gstRegistered={pricing.gstRegistered}
            unsuccessfulDiscount={totals.unsuccessfulDiscount}
            alreadyPaid={paidCash || quoteMode ? 0 : alreadyPaidAmount(alreadyPaid)}
            promoTitle={
              pricedPromo && !skipPromo && totals.promoDiscount > 0 ? pricedPromo.title : null
            }
            promoDiscount={
              pricedPromo && !skipPromo && totals.promoDiscount > 0 ? totals.promoDiscount : 0
            }
          />
        </div>
      </div>

      <PhoneTotalBar
        show={showTotalBar}
        total={totals.total}
        onJumpToFinish={() =>
          finishRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      />

      {/* Desktop save bar, pinned under the whole calculator. The column's errors hide
          on lg+, so a failed save shows here, by the button that was pressed. */}
      <StickyActionBar variant="page" className="hidden lg:flex">
        {!quoteMode && incomeError && (
          <p className="basis-full text-sm text-red-700">{incomeError}</p>
        )}
        {saveInvoiceError && <p className="basis-full text-sm text-red-700">{saveInvoiceError}</p>}
        <SaveButtons
          {...saveButtonProps}
          onSaveInvoice={(send, quote) => void handleSaveInvoice(send, quote)}
          onSaveIncome={() => void handleSaveIncome()}
          inline
        />
        <p className="ml-auto text-sm text-admin-text-secondary">
          Total{" "}
          <span className="text-lg font-bold text-russian-violet">{formatNZD(totals.total)}</span>
        </p>
      </StickyActionBar>
    </>
  );
}
