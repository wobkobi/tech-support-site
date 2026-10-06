// src/features/booking/components/BookingForm.tsx
// Booking form with duration selection (1hr vs 2hr jobs).

"use client";

import { BookingAddressFields } from "@/features/booking/components/BookingAddressFields";
import {
  BookingEmailField,
  BookingMeetingTypeField,
  BookingNameField,
  BookingPhoneField,
} from "@/features/booking/components/BookingContactFields";
import { BookingEstimatePanel } from "@/features/booking/components/BookingEstimatePanel";
import {
  BookingAccessNotesField,
  BookingNotesField,
} from "@/features/booking/components/BookingNotesFields";
import { BookingSchedulePicker } from "@/features/booking/components/BookingSchedulePicker";
import {
  BookingErrorSummary,
  BookingSubmitBar,
} from "@/features/booking/components/BookingSubmitSection";
import { BookingSummaryCard } from "@/features/booking/components/BookingSummaryCard";
import { useBookingAddress } from "@/features/booking/hooks/use-booking-address";
import { useBookingDraft } from "@/features/booking/hooks/use-booking-draft";
import { useContactLookup } from "@/features/booking/hooks/use-contact-lookup";
import { useInlineEstimate } from "@/features/booking/hooks/use-inline-estimate";
import { useSubmitAttention } from "@/features/booking/hooks/use-submit-attention";
import {
  combineUnitAndAddress,
  splitUnitFromAddress,
  type BookableDay,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import {
  buildDurationOptions,
  isSlotAvailable,
  removeBookingDraft,
  subSlotLabel,
  validateBookingFields,
  verifyBookingAddress,
  type RestoredBookingDraft,
} from "@/features/booking/lib/booking-form";
import { PromoCodeField } from "@/features/business/components/PromoCodeField";
import { normalisePromoCode } from "@/features/business/lib/promos";
import { parseObjectId } from "@/features/business/lib/validation";
import { PhoneLink } from "@/shared/components/PhoneLink";
import { suggestEmailCorrection } from "@/shared/lib/email-typo-suggestion";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import type { EstimatorRange } from "@/shared/lib/settings/types";
import { dateKeyParts, nzWallClockUtc } from "@/shared/lib/timezone-utils";
import { useRouter, useSearchParams } from "next/navigation";
import type React from "react";
import { useRef, useState } from "react";

export interface BookingFormInitialValues {
  duration: JobDuration;
  dateKey: string;
  timeOfDay: TimeOfDay;
  startMinute?: StartMinute;
  name: string;
  email: string;
  phone: string;
  meetingType: "in-person" | "remote" | "";
  address: string;
  notes: string;
  accessNotes?: string;
}

export interface BookingFormProps {
  availableDays: BookableDay[];
  /** Live job durations (minutes) from availability settings; drives the picker labels. */
  durations: { short: number; long: number };
  cancelToken?: string;
  initialValues?: BookingFormInitialValues;
  /** Live estimator range widths - enables the inline "get a rough estimate" (new bookings only). */
  estimatorRange?: EstimatorRange;
  /** Min billable minutes (live setting) for the inline estimate. */
  minBillableMins?: number;
  /** Travel floor (live setting) for the inline estimate. */
  minTravelCharge?: number;
  /** Travel $/hr (live setting) for the inline estimate. */
  travelRatePerHour?: number;
  /** Low-end floor fraction (live setting) for the inline estimate. */
  lowEndFloorFactor?: number;
  /** Display phone number for the "call or text me" fallbacks. */
  phone?: string;
  /** tel: URI for the same fallbacks. */
  phoneTel?: string;
  /** Whether a code promo is active right now; false hides the code box. Defaults to true. */
  showPromoCode?: boolean;
}

/**
 * Booking form component with duration selection
 * @param props - Component props
 * @param props.availableDays - Array of available booking days
 * @param props.durations - Live job durations (minutes) for the picker labels.
 * @param props.cancelToken - Cancel token for edit mode; omit for new bookings
 * @param props.initialValues - Pre-filled values for edit mode
 * @param props.estimatorRange - Live estimator range widths; enables the inline rough estimate.
 * @param props.minBillableMins - Min billable minutes for the inline estimate.
 * @param props.minTravelCharge - Travel floor for the inline estimate.
 * @param props.travelRatePerHour - Travel $/hr for the inline estimate.
 * @param props.lowEndFloorFactor - Low-end floor fraction for the inline estimate.
 * @param props.phone - Display phone number for the call-or-text fallbacks.
 * @param props.phoneTel - tel: URI for the call-or-text fallbacks.
 * @param props.showPromoCode - Whether to offer the promo code box.
 * @returns Booking form element
 */
export default function BookingForm({
  availableDays,
  durations,
  cancelToken,
  initialValues,
  estimatorRange,
  minBillableMins,
  minTravelCharge,
  travelRatePerHour,
  lowEndFloorFactor,
  phone: ownerPhone,
  phoneTel: ownerPhoneTel,
  showPromoCode = true,
}: BookingFormProps): React.ReactElement {
  const router = useRouter();
  const isEditMode = Boolean(cancelToken);
  // Estimate id sent with the booking so it can snapshot which public quote the
  // customer saw - seeded from the /pricing wizard's "Book now" link
  // (?estimate=<id>, 24-hex) and replaced if they run the inline estimate below.
  const searchParams = useSearchParams();
  const estimateParam = searchParams.get("estimate");
  const [estimateId, setEstimateId] = useState<string | undefined>(
    parseObjectId(estimateParam) ?? undefined,
  );
  // Carried over from the wizard's "Book now" link (?promo=CODE) so a code the
  // customer already entered on /pricing does not have to be typed again. It is
  // re-resolved server-side at submit, never trusted from here.
  const promoParam = normalisePromoCode(searchParams.get("promo"));
  const [promoCode, setPromoCode] = useState(promoParam ?? "");

  // `selectedDateKey` rather than the full BookableDay: when `availableDays` changes (a
  // router.refresh after a 409), the latest slot data is read from props during render,
  // with no useEffect reconciliation.
  const [duration, setDuration] = useState<JobDuration>(initialValues?.duration ?? "short");
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(() => {
    if (initialValues?.dateKey && availableDays.some((d) => d.dateKey === initialValues.dateKey)) {
      return initialValues.dateKey;
    }
    return availableDays.find((d) => d.hasAnySlots)?.dateKey ?? availableDays[0]?.dateKey ?? null;
  });
  const [selectedTime, setSelectedTime] = useState<TimeOfDay | null>(
    initialValues?.timeOfDay ?? null,
  );
  const [selectedMinute, setSelectedMinute] = useState<StartMinute>(
    initialValues?.startMinute ?? 0,
  );

  // Resolve the BookableDay object from the stored key on every render. If the
  // pick has since disappeared from the prop (refresh, etc.), this returns null
  // and the time picker hides until the user picks again.
  const selectedDay: BookableDay | null = selectedDateKey
    ? (availableDays.find((d) => d.dateKey === selectedDateKey) ?? null)
    : null;
  const [name, setName] = useState(initialValues?.name ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [meetingType, setMeetingType] = useState<"in-person" | "remote" | "">(
    initialValues?.meetingType ?? "",
  );
  const addressState = useBookingAddress(initialValues?.address ?? "");
  const {
    unit,
    setUnit,
    address,
    setAddress,
    addressVerified,
    setAddressVerified,
    addressOverrideAcked,
    setAddressOverrideAcked,
    setAddressCandidates,
    setShowUnit,
    mapsFallback,
  } = addressState;
  // Likely email correction (e.g. gmial.com > gmail.com) surfaced at submit, so
  // an autofilled typo that never triggered the blur hint still gets caught.
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [emailSuggestionAcked, setEmailSuggestionAcked] = useState(false);
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  const [accessNotes, setAccessNotes] = useState(initialValues?.accessNotes ?? "");
  // Honeypot value - see the hidden input in the form markup below.
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /**
   * The chosen slot's start as an instant, applying the NZ offset for the
   * slot's own date (DST-correct, unlike the browser's timezone).
   * @returns The slot start, or null when day or time isn't chosen yet.
   */
  function slotStartInstant(): Date | null {
    if (!selectedDay || !selectedTime) return null;
    const window = selectedDay.timeWindows.find((w) => w.value === selectedTime);
    if (!window) return null;
    const [y, m, d] = dateKeyParts(selectedDay.dateKey);
    return nzWallClockUtc(y, m, d, window.startHour, selectedMinute);
  }

  // Inline "get a rough estimate" state (new bookings only).
  const {
    canInlineEstimate,
    estimating,
    quote,
    quoteError,
    quoteStale,
    descriptionReady,
    estimateHelp,
    runInlineEstimate,
    clearQuote,
  } = useInlineEstimate({
    enabled: !isEditMode,
    estimatorRange,
    minBillableMins,
    minTravelCharge,
    travelRatePerHour,
    lowEndFloorFactor,
    notes,
    meetingType,
    unit,
    address,
    dateKey: selectedDay?.dateKey ?? null,
    selectedTime,
    selectedMinute,
    duration,
    durations,
    slotStart: slotStartInstant(),
    promoCode,
    email,
    onEstimateId: setEstimateId,
  });

  /**
   * Removes a single inline field error (used by on-blur/on-change handlers so a
   * corrected field clears without touching the others).
   * @param key - Field-error key to clear.
   */
  function clearFieldError(key: string): void {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const [error, setError] = useState<string | null>(null);
  // Submit-time validation errors. Rendered both in a top summary and inline.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const {
    attempted,
    requestAttention,
    resetAttention,
    errorSummaryRef,
    emailPromptRef,
    addressPromptRef,
  } = useSubmitAttention();
  // True when the server returned 409 (someone booked the same slot first).
  // Drives a more prominent error with a "Refresh available times" link.
  const [slotStale, setSlotStale] = useState(false);
  const [contactHint, setContactHint] = useState<string | null>(null);

  // `submittingRef` blocks Enter-key spam regardless of React's setState timing.
  // `idempotencyKey` is minted once per mount in the lazy useState initialiser (allowed to
  // be impure); the server logs it so a retried submit correlates with the original.
  const submittingRef = useRef(false);
  const [idempotencyKey] = useState<string>(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const lookupContact = useContactLookup();

  /**
   * On email blur (new bookings only): look up the email in contacts and
   * pre-fill name / phone / address for any fields the user left empty.
   */
  async function handleEmailBlur(): Promise<void> {
    if (isEditMode) return;
    const data = await lookupContact(email);
    if (!data) return;
    const filled: string[] = [];
    if (data.name && !name.trim()) {
      setName(data.name);
      filled.push("name");
    }
    if (data.phone && !phone.trim()) {
      setPhone(data.phone);
      filled.push("phone");
    }
    if (data.address && !address.trim() && !unit.trim()) {
      const split = splitUnitFromAddress(data.address);
      if (split.unit) setShowUnit(true);
      setUnit(split.unit);
      setAddress(split.rest);
      filled.push("address");
    }
    if (filled.length > 0) {
      setContactHint(`Pre-filled from your previous booking: ${filled.join(", ")}.`);
    }
  }

  // React's "adjust state when a prop changes" pattern, not a useEffect: drop the
  // selected time during render once it stops being available for the current day +
  // duration. The `!== null` guard breaks the setState loop - the next render sees null.
  if (
    selectedTime !== null &&
    selectedDay &&
    !isSlotAvailable(selectedDay, selectedTime, selectedMinute, duration)
  ) {
    setSelectedTime(null);
    setSelectedMinute(0);
  }

  /**
   * Applies a validated saved draft to the form (new-booking mode, on mount).
   * @param d - The saved fields worth restoring.
   */
  function applyRestoredDraft(d: RestoredBookingDraft): void {
    if (d.duration) setDuration(d.duration);
    if (d.name) setName(d.name);
    if (d.email) setEmail(d.email);
    if (d.phone) setPhone(d.phone);
    if (d.meetingType) setMeetingType(d.meetingType);
    if (d.unit !== undefined) {
      setUnit(d.unit);
      if (d.unit) setShowUnit(true);
    }
    if (d.address) {
      setAddress(d.address);
      setAddressVerified(d.addressVerified === true);
    }
    if (d.notes) setNotes(d.notes);
    if (d.accessNotes) setAccessNotes(d.accessNotes);
    if (d.slot) {
      setSelectedDateKey(d.slot.dateKey);
      setSelectedTime(d.slot.timeOfDay);
      setSelectedMinute(d.slot.startMinute);
    }
  }

  const { draftRestored, forgetDraft } = useBookingDraft({
    enabled: !isEditMode,
    availableDays,
    draft: {
      duration,
      name,
      email,
      phone,
      meetingType,
      unit,
      address,
      addressVerified,
      notes,
      accessNotes,
      dateKey: selectedDay?.dateKey,
      timeOfDay: selectedTime ?? undefined,
      startMinute: selectedTime ? selectedMinute : undefined,
    },
    onRestore: applyRestoredDraft,
  });

  /**
   * Clear the saved draft + reset all form fields the user filled in. Leaves
   * the schedule selection alone since that's already constrained by what's
   * available.
   */
  function clearDraft(): void {
    forgetDraft();
    setName("");
    setEmail("");
    setPhone("");
    setMeetingType("");
    setUnit("");
    setShowUnit(false);
    setAddress("");
    setAddressVerified(false);
    setAddressOverrideAcked(false);
    setAddressCandidates(null);
    setNotes("");
    setAccessNotes("");
    setContactHint(null);
    setFieldErrors({});
    resetAttention();
    setError(null);
  }

  /**
   * Handle day selection and reset time if needed
   * @param day - Selected bookable day
   */
  function handleDaySelect(day: BookableDay): void {
    setSelectedDateKey(day.dateKey);
    clearFieldError("day");
    // Picking a different day clears the stale-slot warning if it was set.
    setSlotStale(false);
    // Time + minute validity gets re-checked during render against the new day
    // (see the synchronise-during-render block above); no extra work needed.
  }

  /**
   * Handle duration change and reset time if needed
   * @param newDuration - Selected job duration
   */
  function handleDurationChange(newDuration: JobDuration): void {
    setDuration(newDuration);
    clearFieldError("duration");
    // Reset time if current selection + minute not available for new duration
    if (
      selectedTime &&
      selectedDay &&
      !isSlotAvailable(selectedDay, selectedTime, selectedMinute, newDuration)
    ) {
      setSelectedTime(null);
      setSelectedMinute(0);
    }
  }

  /**
   * Handle hour selection, landing on the hour's first free minute.
   * @param time - Selected time window
   * @param minute - First available minute in that window
   */
  function handleTimeSelect(time: TimeOfDay, minute: StartMinute): void {
    setSelectedTime(time);
    clearFieldError("time");
    setSelectedMinute(minute);
  }

  /**
   * Handle form submission. The `submittingRef` guard blocks Enter-key spam
   * (the disabled prop on the submit button doesn't catch keyboard submits
   * from inside a focused text field).
   * @param e - Form event
   */
  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);

    const fe = validateBookingFields({
      duration,
      selectedDay,
      selectedTime,
      name,
      email,
      phone,
      meetingType,
      address,
      notes,
    });
    setFieldErrors(fe);
    if (Object.keys(fe).length > 0) {
      requestAttention("summary");
      return;
    }

    // Field-errors guard above guarantees these are set; narrow for TS.
    if (!selectedDay || !selectedTime || !duration || !meetingType) return;

    // Email typo catch: an autofilled address that never triggered the blur hint
    // can still be a likely typo (gmial.com). Offer the correction once and block
    // this submit until the customer confirms or dismisses it.
    if (!emailSuggestionAcked) {
      const suggestion = suggestEmailCorrection(email);
      if (suggestion) {
        setEmailSuggestion(suggestion);
        requestAttention("email");
        return;
      }
    }

    submittingRef.current = true;
    setSubmitting(true);

    // Google-verify a typed-but-not-picked address before booking; more than one match
    // asks the customer which they meant rather than assuming. Skipped in maps-fallback
    // mode, and once they have picked a candidate or chosen their text as-is.
    // Null means verification could not run - submit anyway.
    if (meetingType === "in-person" && !addressVerified && !addressOverrideAcked && !mapsFallback) {
      const typed = combineUnitAndAddress(unit, address);
      const candidates = await verifyBookingAddress(typed);
      if (candidates?.length === 0) {
        // Google found nothing precise - warn, then let a second click submit
        // the typed text as-is (some new addresses genuinely don't geocode).
        setError(
          "We couldn't find that address on the map. Double-check the spelling, or click Submit again to use it as-is.",
        );
        setAddressOverrideAcked(true);
        requestAttention("summary");
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }
      const typedKey = typed.trim().toLowerCase();
      if (candidates && !candidates.some((c) => c.trim().toLowerCase() === typedKey)) {
        // One candidate > "did you mean?"; several > "which did you mean?".
        setAddressCandidates(candidates);
        requestAttention("address");
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }
    }

    // Edit and create hit different endpoints: edit identifies the booking by
    // cancel token; create adds the honeypot field + idempotency key instead.
    try {
      const endpoint = isEditMode ? "/api/booking/edit" : "/api/booking/request";
      const payload = isEditMode
        ? {
            cancelToken,
            dateKey: selectedDay.dateKey,
            timeOfDay: selectedTime,
            startMinute: selectedMinute,
            duration,
            name: name.trim(),
            phone: phone.trim() || undefined,
            meetingType,
            address: meetingType === "in-person" ? combineUnitAndAddress(unit, address) : undefined,
            notes: notes.trim(),
            accessNotes: accessNotes.trim() || undefined,
          }
        : {
            dateKey: selectedDay.dateKey,
            timeOfDay: selectedTime,
            startMinute: selectedMinute,
            duration,
            name: name.trim(),
            email: normaliseEmail(email),
            phone: phone.trim() || undefined,
            meetingType,
            address: meetingType === "in-person" ? combineUnitAndAddress(unit, address) : undefined,
            notes: notes.trim(),
            accessNotes: accessNotes.trim() || undefined,
            website,
            idempotencyKey,
            estimateId,
            promoCode: promoCode.trim() || undefined,
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string; cancelToken?: string };

      if (!res.ok) {
        if (res.status === 409) {
          // Someone else booked this slot between page load and submit. Show
          // the dedicated stale-slot UI so the customer can refresh and pick
          // another time rather than re-clicking submit into a dead slot.
          setSlotStale(true);
          setError(null);
        } else {
          setError(data.error || "Could not submit request.");
        }
        requestAttention("summary");
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }

      // Successful submit: clear the saved draft so the next page load is a
      // clean slate.
      if (!isEditMode) removeBookingDraft();

      // Redirect to the success page. Edit mode flags itself so the success
      // page does not report the reschedule as a fresh lead conversion.
      if (isEditMode) {
        router.push(`/booking/success?cancelToken=${encodeURIComponent(cancelToken!)}&edited=1`);
      } else {
        const successUrl = data.cancelToken
          ? `/booking/success?cancelToken=${encodeURIComponent(data.cancelToken)}`
          : "/booking/success";
        router.push(successUrl);
      }
    } catch {
      setError("Network error. Please try again.");
      requestAttention("summary");
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // Resolved once per render: the screen-reader status line and the summary
  // card both read the picked start time.
  const activeWindow =
    selectedDay && selectedTime
      ? (selectedDay.timeWindows.find((w) => w.value === selectedTime) ?? null)
      : null;
  const timeLabel = activeWindow ? subSlotLabel(activeWindow.startHour, selectedMinute) : null;
  const phoneLink =
    ownerPhone && ownerPhoneTel ? <PhoneLink phone={ownerPhone} phoneTel={ownerPhoneTel} /> : null;

  return (
    <form
      onSubmit={handleSubmit}
      // `noValidate` so the JS error-summary takes over from native browser
      // tooltips; required + aria-required stay for assistive tech.
      noValidate
      className="flex flex-col gap-8"
      autoComplete="off"
    >
      {/* Honeypot: visually hidden + off-screen + tab-skipped + aria-hidden.
          Real users never see or focus this. Bots that auto-fill contact-
          style inputs will fill it, and the server fakes a success response
          without creating a booking. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        <label htmlFor="booking-website">Website (leave blank)</label>
        <input
          id="booking-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      {/* ── Section 1: Scheduling ── */}
      <BookingSchedulePicker
        availableDays={availableDays}
        durations={durations}
        duration={duration}
        onDurationChange={handleDurationChange}
        selectedDay={selectedDay}
        selectedTime={selectedTime}
        selectedMinute={selectedMinute}
        activeWindow={activeWindow}
        timeLabel={timeLabel}
        phoneLink={phoneLink}
        onDaySelect={handleDaySelect}
        onTimeSelect={handleTimeSelect}
        onMinuteSelect={setSelectedMinute}
      />

      {/* Divider */}
      <hr className="border-seasalt-200/80" />

      {/* ── Section 2: Your details ── */}
      <fieldset className="flex flex-col gap-6">
        <legend className="mb-1 text-xl font-bold text-russian-violet sm:text-2xl">
          Your details
        </legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <BookingNameField
            value={name}
            onChange={(next) => {
              setName(next);
              clearFieldError("name");
            }}
            onNormalise={setName}
            error={fieldErrors.name}
            onError={(message) => setFieldErrors((prev) => ({ ...prev, name: message }))}
          />

          <BookingEmailField
            value={email}
            onChange={(next) => {
              setEmail(next);
              clearFieldError("email");
              setContactHint(null);
              // A fresh edit invalidates any prior submit-time typo prompt.
              setEmailSuggestion(null);
              setEmailSuggestionAcked(false);
            }}
            onBlur={handleEmailBlur}
            error={fieldErrors.email}
            locked={isEditMode}
            contactHint={contactHint}
            suggestion={emailSuggestion}
            promptRef={emailPromptRef}
            onAcceptSuggestion={() => {
              if (emailSuggestion) setEmail(emailSuggestion);
              setEmailSuggestion(null);
            }}
            onDismissSuggestion={() => {
              setEmailSuggestion(null);
              setEmailSuggestionAcked(true);
            }}
          />
        </div>

        <BookingPhoneField
          value={phone}
          onChange={(next) => {
            setPhone(next);
            clearFieldError("phone");
          }}
          required={meetingType === "in-person"}
          error={fieldErrors.phone}
        />

        <BookingMeetingTypeField
          value={meetingType}
          onChange={(next) => {
            setMeetingType(next);
            // Phone and address requirements both hang off the meeting
            // type, so their errors are re-judged at the next submit.
            clearFieldError("meetingType");
            clearFieldError("phone");
            clearFieldError("address");
          }}
        />

        <BookingAddressFields
          state={addressState}
          visible={meetingType === "in-person"}
          error={fieldErrors.address}
          onEdited={() => clearFieldError("address")}
          promptRef={addressPromptRef}
        />
      </fieldset>

      {/* Divider */}
      <hr className="border-seasalt-200/80" />

      {/* ── Section 3: Describe the issue ── */}
      <fieldset className="flex flex-col gap-6">
        <legend className="mb-1 text-xl font-bold text-russian-violet sm:text-2xl">
          Describe the issue
        </legend>

        <BookingNotesField
          value={notes}
          onChange={(next) => {
            setNotes(next);
            clearFieldError("notes");
          }}
          error={fieldErrors.notes}
          onError={(message) => setFieldErrors((prev) => ({ ...prev, notes: message }))}
          onClear={() => {
            setNotes("");
            clearQuote();
          }}
        />

        {canInlineEstimate && (
          <BookingEstimatePanel
            estimating={estimating}
            descriptionReady={descriptionReady}
            estimateHelp={estimateHelp}
            quote={quote}
            quoteStale={quoteStale}
            quoteError={quoteError}
            duration={duration}
            onEstimate={() => void runInlineEstimate()}
            onBookLong={() => handleDurationChange("long")}
          />
        )}

        {/* Outside the estimate block on purpose: a code changes what the job
            is invoiced at, so it must be enterable whether or not the customer
            asked for a ballpark first. Hidden when editing, where the promo was
            already snapshotted onto the booking, and when no code promo is
            active right now, unless the link carried a code. */}
        {!isEditMode && (showPromoCode || promoParam !== null) && (
          <PromoCodeField
            value={promoCode}
            onChange={setPromoCode}
            onApplied={() => {
              // Refresh only a quote already on screen. Applying a code should
              // not spend an AI estimate the customer never asked for.
              if (quote) void runInlineEstimate();
            }}
            applyOnMount={promoParam !== null}
            // Judged as the booking will judge it: against the picked slot for
            // a day-restricted code, and this customer for a per-customer one.
            startAt={slotStartInstant()}
            email={email}
            className="max-w-sm"
          />
        )}

        <BookingAccessNotesField value={accessNotes} onChange={setAccessNotes} />
      </fieldset>

      <BookingSummaryCard
        durationLabel={
          buildDurationOptions(durations).find((d) => d.value === duration)?.label ?? null
        }
        dayLabel={selectedDay?.fullLabel ?? null}
        timeLabel={timeLabel}
        meetingType={meetingType}
        combinedAddress={meetingType === "in-person" ? combineUnitAndAddress(unit, address) : ""}
        name={name}
        email={email}
        phone={phone}
        draftRestored={draftRestored}
        onClearDraft={clearDraft}
      />

      {/* Cancellation / rescheduling policy - keeps expectations clear so a
          customer who later wants to change their booking knows it's easy. */}
      <p className="text-base text-rich-black/70">
        Need to change or cancel? Use the link in the confirmation email any time before your
        appointment, or call or text me{phoneLink ? <> on {phoneLink}</> : " directly"}.
      </p>

      {/* Submit */}
      <BookingErrorSummary
        ref={errorSummaryRef}
        slotStale={slotStale}
        onRefreshSlots={() => {
          setSlotStale(false);
          router.refresh();
        }}
        showFieldErrors={attempted}
        fieldErrors={fieldErrors}
        error={error}
        phoneLink={phoneLink}
      />

      <BookingSubmitBar
        submitting={submitting}
        isEditMode={isEditMode}
        noSlots={!availableDays.some((d) => d.hasAnySlots)}
        showIssuesLink={attempted}
        fieldErrors={fieldErrors}
        cancelToken={cancelToken}
      />
    </form>
  );
}
