"use client";
// src/features/business/components/CalculatorView.tsx
// Job-pricing calculator and invoice builder. Assembles client, tasks, parts, travel, and
// rate config into line items, supports AI parsing of a plain-English job description,
// and renders a live invoice preview.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
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
  /** What a voided invoice being re-issued carries over; null on a normal load. */
  reissue: ReissuePrefill | null;
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
 * @param props.reissue - Voided invoice being re-issued, or null on a normal load.
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

  // Server-resolved; rates are edited on the Settings > Rates tab, so a reload picks up changes.
  const rates = initialRates;
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
  // Whether the Time card holds real times (typed, edited on a booked job, restored from a
  // draft, or read off the description) rather than a placeholder: the "now to an hour
  // from now" a blank form seeds, a booking's own windows, or a window the parse made up
  // from a bare duration. Only real times go to the parser, or a placeholder gets billed.
  const [timesSet, setTimesSet] = useState(false);
  /**
   * Applies a Time card edit. Changing or removing an existing row makes the times real;
   * appending a row (which starts with no end) leaves the rest as they were.
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
  const [notes, setNotes] = useState(() => reissue?.notes ?? "");
  // Paid in cash on the day: invoices save as paid, income entries record Cash.
  const [paidCash, setPaidCash] = useState(false);
  // Part of the bill handed over on the day: shown on the invoice, recorded in income.
  const [alreadyPaid, setAlreadyPaid] = useState<AlreadyPaidState>(EMPTY_ALREADY_PAID);
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
  // Client details
  // A re-issue's own client details fill in when no calendar event backs it.
  const [clientName, setClientName] = useState(
    () => eventPrefill?.clientName ?? reissue?.clientName ?? "",
  );
  // Normalised on seed as well as on typing: a Booking row written before
  // emails were normalised can still carry capitals, and the invoice preview
  // must show exactly what gets saved.
  const [clientEmail, setClientEmail] = useState(() =>
    normaliseEmail(eventPrefill?.clientEmail ?? reissue?.clientEmail),
  );
  // Address-to state mirrors the InvoiceBuilder's segmented control so the
  // operator picks Name/Company/Custom once and the choice rides through to
  // the invoice without re-picking.
  const [pickedContactName, setPickedContactName] = useState<string | null>(null);
  const [pickedContactCompany, setPickedContactCompany] = useState<string | null>(null);
  const [pickedContactGoogleId, setPickedContactGoogleId] = useState<string | null>(null);
  const [addressMode, setAddressModeState] = useState<"name" | "company" | "custom">("custom");
  // "Also update the contact" box, shown once a picked contact's name is edited.
  const [renameContact, setRenameContact] = useState(true);
  // The typed name, when it is a hand edit of a picked contact's name (adding a last
  // name, say) rather than the contact's own name or company again.
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
    setTimesSet(false);
  }

  // Travel lookup
  const [jobAddress, setJobAddress] = useState(() => eventPrefill?.jobAddress ?? "");
  const [lookingUpTravel, setLookingUpTravel] = useState(false);

  // Contacts
  const [contacts, setContacts] = useState<GoogleContact[]>([]);

  // Per-job promo skip flag (not persisted).
  const [skipPromo, setSkipPromo] = useState(false);
  // Two fields, not one: the box the operator types in, and the code actually
  // applied. Only the applied one is in the lookup's deps, so the job is not
  // repriced on every keystroke.
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoCode, setPromoCode] = useState("");

  // Job date drives the holiday + promo lookup so a past job is priced by what
  // applied THEN, not today. Persisted in the draft; defaults to today (NZ).
  // A re-issue with no event falls back to the voided invoice's issue date, so the promo is
  // priced for when the job was billed.
  const [jobDate, setJobDate] = useState<string>(
    () => eventPrefill?.jobDate ?? reissue?.issueDate ?? todayISO(),
  );

  // The job's earliest start, so a time-of-day promo is judged at the real start
  // rather than the lookup's midday default. HH:MM strings sort as times.
  const jobStartTime =
    timeRanges
      .map((r) => r.startTime)
      .filter((t) => /^\d{2}:\d{2}$/.test(t))
      .sort()[0] ?? "";
  const prefillBookingId = eventPrefill?.bookingId ?? null;

  // Holiday + date-resolved promo for the selected job date.
  const { holiday, activePromo } = useJobContext({
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

  // A cancellation fee is a flat charge, not labour: no holiday uplift on it, and no
  // promo, which would also spend a redemption on a job that never happened.
  const pricedPromo = cancelMode ? null : activePromo;
  const holidayUplift = cancelMode ? 0 : holiday.uplift;

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
      // Drafts saved before the flag existed count their times as real unless they are
      // the lone one-hour row a blank form seeds.
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
    // The prefill outranks the draft for dates/client/travel, but the description is the
    // operator's own words, so it survives: prefer the picker's sessionStorage stash
    // (fresher than the 500ms-debounced draft), else the draft text, which covers the
    // schedule's "Bill in calculator" path. Read before the draft writer's first tick.
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
        // A job billed from the schedule arrives as typed text, with no contact
        // picked, so the Name/Company switch never showed. Pick the Google contact
        // whose email the booking used, when the booking's name is theirs too.
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

  // Apply the date's public-holiday uplift to labour (0 when not a holiday),
  // and tell the totals which modifier marks business labour so a promo skips
  // it - promos are a home-rate offer.
  // Same predicate getPublicPricing uses to derive the business rate, so the
  // page and the invoice cannot disagree about which modifier means business.
  const businessModifierId =
    rates.find((r) => r.label === "Business" && r.unit === "modifier")?.id ?? null;
  // The Standard rate a flat promo cuts from, picked the same way
  // getPublicPricing picks the base rate.
  const standardRate =
    rates.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
    rates.find((r) => r.ratePerHour !== null && r.unit === "hour")?.ratePerHour ??
    null;
  const jobPricing = {
    ...pricing,
    holidayUplift,
    businessModifierId,
    standardRate,
    rates,
  };
  const totals = calcJobTotal(job, !skipPromo ? pricedPromo : null, jobPricing);
  const showTotalBar = !finishInView && totals.total > 0;
  // Memoise the flattened line items so the preview panel's React.memo can
  // skip re-render when unrelated parent state changes (e.g. typing in the
  // AI input box). Recomputes when any meaningful input shifts.
  const previewLineItems = useMemo(
    () => jobToLineItems(job, holidayUplift, pricing.minTravelCharge, pricing.minBillableMins),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tasks,
      parts,
      timeRanges,
      durationMins,
      holidayUplift,
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

  // Invoice / quote / income saves, the add-to-contacts gate, and template upserts.
  const {
    savingInvoice,
    saveSendMode,
    saveQuoteMode,
    saveInvoiceError,
    pendingInvoiceId,
    pendingExistingName,
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
    holidayUplift,
    pricing,
    activePromo: pricedPromo,
    skipPromo,
    eventPrefill,
    pickedContactGoogleId,
    jobDate,
    paidCash,
    alreadyPaid,
    setTaskTemplates,
    onIncomeSaved: resetFormState,
  });

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
    setTimesSet(false);
    setFollowUpMins(0);
    setTravelEntries([]);
    setJobAddress("");
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
    // The description plus the non-persisted parse-session results, still part
    // of "starting fresh".
    clearAiInput();
    setDraftRestoredAt(null);
    // Cancel mode and its policy inputs go back to their mount defaults.
    resetCancelMode();
    // Save errors and in-flight save bookkeeping.
    resetSaveState();
    // Transient dialog state.
    setShowTaxonomyModal(false);
    clearDraft();
    // Billing a booked job: the prefill is a server prop keyed by eventId, so
    // state resets alone can't remove the banner - drop the query param and
    // let the remount start truly blank.
    if (eventPrefill || reissue) router.replace("/admin/business/calculator");
  }

  /**
   * Looks up the drive to the job address and replaces the single auto travel
   * entry (manual entries survive). See {@link lookupAutoTravel} for how each
   * leg's departure is chosen.
   */
  async function handleTravelLookup(): Promise<void> {
    if (!jobAddress.trim()) return;
    setLookingUpTravel(true);
    // Drop any stale auto entry up-front so the chip disappears while the
    // lookup is in flight; manual entries survive.
    setTravelEntries((prev) => prev.filter((e) => !e.isAuto));
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
        setTravelEntries((prev) => [entry, ...prev.filter((e) => !e.isAuto)]);
      }
    } catch {
      // silently ignore - travel is optional
    }
    setLookingUpTravel(false);
  }

  return (
    <>
      {pendingInvoiceId && (
        <AddToContactsModal
          // The person, not the addressed-to name: a company invoice would
          // otherwise save a contact named "68 Ltd".
          name={pickedContactName ?? clientName}
          company={pickedContactCompany}
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

        holiday={holiday}
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

          <NotesSection notes={notes} onNotesChange={setNotes} />

          {/* Early cancel entry. Parked at the bottom: billing a job that never
              happened is the rare case, so it stays out of the normal flow. */}
          {!cancelMode && (
            <AdminButton variant="danger" onClick={enterCancelMode}>
              Make early cancel
            </AdminButton>
          )}
        </div>

        {/* RIGHT column - live invoice preview (replaces the legacy Summary
            panel - same totals, just inside the actual invoice layout). */}
        <div ref={finishRef} className="min-w-0 space-y-4">
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
            renameOffer={contactRenameOffer}
            renameContact={renameContact}
            onRenameContactChange={setRenameContact}
            contacts={contacts}
            onSelectContact={(c) => {
              const company = c.company?.trim() || null;
              // Found by typing the company ("68"), not the person: address it to
              // the company. clientName still holds the search text at this point.
              const byCompany = matchedByCompanyOnly(c, clientName);
              setClientName(byCompany && company ? company : c.name);
              setClientEmail(normaliseEmail(c.email));
              setPickedContactName(c.name);
              setPickedContactCompany(company);
              setPickedContactGoogleId(c.id || null);
              setRenameContact(true);
              // Bypass the setAddressMode wrapper - it reads pickedContactName
              // from this same render's closure (still null), which would flip
              // the mode to "custom". The name is already set explicitly above.
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

          {/* Actions */}
          <SaveActions
            incomeError={incomeError}
            saveInvoiceError={saveInvoiceError}
            savingInvoice={savingInvoice}
            saveSendMode={saveSendMode}
            saveQuoteMode={saveQuoteMode}
            savingIncome={savingIncome}
            parsing={parsing}
            subtotal={totals.subtotal}
            total={totals.total}
            paidCash={paidCash}
            onPaidCashChange={setPaidCash}
            alreadyPaid={alreadyPaid}
            onAlreadyPaidChange={setAlreadyPaid}
            onSaveInvoice={(send, quote) => void handleSaveInvoice(send, quote)}
            onSaveIncome={() => void handleSaveIncome()}
          />

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
            alreadyPaid={paidCash ? 0 : alreadyPaidAmount(alreadyPaid)}
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
    </>
  );
}
