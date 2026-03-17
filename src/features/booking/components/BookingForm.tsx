// src/features/booking/components/BookingForm.tsx
/**
 * @file BookingForm.tsx
 * @description Booking form with duration selection (1hr vs 2hr jobs).
 */

"use client";

import type React from "react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import {
  DURATION_OPTIONS,
  type BookableDay,
  type TimeOfDay,
  type JobDuration,
} from "@/features/booking/lib/booking";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";

export interface BookingFormInitialValues {
  duration: JobDuration;
  dateKey: string;
  timeOfDay: TimeOfDay;
  name: string;
  email: string;
  phone: string;
  meetingType: "in-person" | "remote" | "";
  address: string;
  notes: string;
}

export interface BookingFormProps {
  availableDays: BookableDay[];
  cancelToken?: string;
  initialValues?: BookingFormInitialValues;
}

/**
 * Booking form component with duration selection
 * @param props - Component props
 * @param props.availableDays - Array of available booking days
 * @param props.cancelToken - Cancel token for edit mode; omit for new bookings
 * @param props.initialValues - Pre-filled values for edit mode
 * @returns Booking form element
 */
export default function BookingForm({
  availableDays,
  cancelToken,
  initialValues,
}: BookingFormProps): React.ReactElement {
  const router = useRouter();
  const isEditMode = Boolean(cancelToken);

  // Form state
  const [duration, setDuration] = useState<JobDuration>(initialValues?.duration ?? "short");
  const [selectedDay, setSelectedDay] = useState<BookableDay | null>(null);
  const [selectedTime, setSelectedTime] = useState<TimeOfDay | null>(
    initialValues?.timeOfDay ?? null,
  );
  const [name, setName] = useState(initialValues?.name ?? "");
  const [email, setEmail] = useState(initialValues?.email ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [meetingType, setMeetingType] = useState<"in-person" | "remote" | "">(
    initialValues?.meetingType ?? "",
  );
  const [address, setAddress] = useState(initialValues?.address ?? "");
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-select day on mount: pre-select initial day in edit mode, else first available
  useEffect(() => {
    if (availableDays.length > 0) {
      if (initialValues?.dateKey) {
        const preselected = availableDays.find((d) => d.dateKey === initialValues.dateKey);
        if (preselected) {
          setSelectedDay(preselected);
          return;
        }
      }
      const firstAvailable = availableDays.find((d) => d.hasAnySlots);
      setSelectedDay(firstAvailable ?? availableDays[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Split days into weekdays and weekends
  const weekdays = availableDays.filter((d) => !d.isWeekend);
  const weekends = availableDays.filter((d) => d.isWeekend);

  /**
   * Handle day selection and reset time if needed
   * @param day - Selected bookable day
   */
  function handleDaySelect(day: BookableDay): void {
    setSelectedDay(day);
    // Reset time if current selection not available on new day
    if (selectedTime) {
      const slot = day.timeWindows.find((w) => w.value === selectedTime);
      const available = duration === "short" ? slot?.availableShort : slot?.availableLong;
      if (!available) {
        setSelectedTime(null);
      }
    }
  }

  /**
   * Handle duration change and reset time if needed
   * @param newDuration - Selected job duration
   */
  function handleDurationChange(newDuration: JobDuration): void {
    setDuration(newDuration);
    // Reset time if current selection not available for new duration
    if (selectedTime && selectedDay) {
      const slot = selectedDay.timeWindows.find((w) => w.value === selectedTime);
      const available = newDuration === "short" ? slot?.availableShort : slot?.availableLong;
      if (!available) {
        setSelectedTime(null);
      }
    }
  }

  /**
   * Handle form submission
   * @param e - Form event
   */
  async function handleSubmit(e: React.SubmitEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!duration) {
      setError("Please select job duration.");
      return;
    }
    if (!selectedDay) {
      setError("Please select a day and time.");
      return;
    }
    if (!selectedTime) {
      setError("Please select a time.");
      return;
    }
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!meetingType) {
      setError("Please select in-person or remote.");
      return;
    }
    if (meetingType === "in-person" && !address.trim()) {
      setError("Please enter your address for in-person appointments.");
      return;
    }
    if (!notes.trim()) {
      setError("Please describe what you need help with.");
      return;
    }

    setSubmitting(true);

    try {
      const endpoint = isEditMode ? "/api/booking/edit" : "/api/booking/request";
      const payload = isEditMode
        ? {
            cancelToken,
            dateKey: selectedDay.dateKey,
            timeOfDay: selectedTime,
            duration,
            name: name.trim(),
            phone: phone.trim() || undefined,
            meetingType,
            address: meetingType === "in-person" ? address.trim() : undefined,
            notes: notes.trim(),
          }
        : {
            dateKey: selectedDay.dateKey,
            timeOfDay: selectedTime,
            duration,
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim() || undefined,
            meetingType,
            address: meetingType === "in-person" ? address.trim() : undefined,
            notes: notes.trim(),
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string; cancelToken?: string };

      if (!res.ok) {
        setError(data.error || "Could not submit request.");
        setSubmitting(false);
        return;
      }

      if (isEditMode) {
        router.push(`/booking/success?cancelToken=${encodeURIComponent(cancelToken!)}`);
      } else {
        const successUrl = data.cancelToken
          ? `/booking/success?cancelToken=${encodeURIComponent(data.cancelToken)}`
          : "/booking/success";
        router.push(successUrl);
      }
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("flex flex-col gap-8")} autoComplete="off">
      {/* ── Section 1: Scheduling ── */}
      <fieldset className={cn("flex flex-col gap-6")}>
        <legend className={cn("text-russian-violet mb-1 text-xl font-bold sm:text-2xl")}>
          Schedule
        </legend>

        {/* Duration */}
        <div>
          <label className={cn("text-rich-black mb-2 block text-base font-semibold")}>
            How long do you need? <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <div className={cn("grid gap-3 sm:grid-cols-2")}>
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleDurationChange(opt.value)}
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors",
                  duration === opt.value
                    ? "border-russian-violet bg-russian-violet/10"
                    : "border-seasalt-400/60 bg-seasalt hover:border-russian-violet/40",
                )}
              >
                <div className={cn("flex items-start justify-between")}>
                  <div>
                    <p className={cn("text-rich-black text-base font-semibold")}>{opt.label}</p>
                    <p className={cn("text-rich-black/70 mt-1 text-base")}>{opt.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <p className={cn("text-rich-black/60 mt-2 text-base")}>
            Duration is just an estimate for scheduling. Most appointments are 1 hour. Choose 2
            hours if you have multiple issues or complex setup needs.
          </p>
        </div>

        {/* Day Selection */}
        <div>
          <label className={cn("text-rich-black mb-2 block text-base font-semibold")}>
            Choose a day
          </label>

          {availableDays.length === 0 ? (
            <p className={cn("text-rich-black/70 text-base")}>
              No availability in the next two weeks. Please call or text me directly.
            </p>
          ) : (
            <div className={cn("space-y-3")}>
              {weekdays.length > 0 && (
                <div>
                  <p
                    className={cn(
                      "text-rich-black/60 mb-1.5 text-base font-medium uppercase tracking-wide",
                    )}
                  >
                    Weekdays
                  </p>
                  <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
                    {weekdays.map((day) => (
                      <button
                        key={day.dateKey}
                        type="button"
                        disabled={!day.hasAnySlots}
                        onClick={() => handleDaySelect(day)}
                        className={cn(
                          "whitespace-nowrap rounded-lg border px-3 py-3 text-base font-medium",
                          !day.hasAnySlots && "cursor-not-allowed opacity-50",
                          selectedDay?.dateKey === day.dateKey
                            ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                            : day.hasAnySlots
                              ? "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                              : "border-seasalt-400/40 bg-seasalt-900/20 text-rich-black/60",
                          day.isToday &&
                            day.hasAnySlots &&
                            "ring-coquelicot-500/50 ring-2 ring-offset-1",
                        )}
                      >
                        {day.dayLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {weekends.length > 0 && (
                <div>
                  <p
                    className={cn(
                      "text-rich-black/60 mb-1.5 text-base font-medium uppercase tracking-wide",
                    )}
                  >
                    Weekends
                  </p>
                  <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
                    {weekends.map((day) => (
                      <button
                        key={day.dateKey}
                        type="button"
                        disabled={!day.hasAnySlots}
                        onClick={() => handleDaySelect(day)}
                        className={cn(
                          "whitespace-nowrap rounded-lg border px-3 py-3 text-base font-medium",
                          !day.hasAnySlots && "cursor-not-allowed opacity-50",
                          selectedDay?.dateKey === day.dateKey
                            ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                            : day.hasAnySlots
                              ? "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                              : "border-seasalt-400/40 bg-seasalt-900/20 text-rich-black/60",
                        )}
                      >
                        {day.dayLabel}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Time Selection */}
        {selectedDay && (
          <div>
            <label className={cn("text-rich-black mb-2 block text-base font-semibold")}>
              Start time for {selectedDay.fullLabel}
            </label>

            {selectedDay.timeWindows.every((w) =>
              duration === "short" ? !w.availableShort : !w.availableLong,
            ) ? (
              <div className={cn("border-seasalt-400/80 bg-seasalt-900/30 rounded-lg border p-4")}>
                <p className={cn("text-rich-black/70 text-base")}>
                  Sorry, no {duration === "short" ? "1-hour" : "2-hour"} slots available on this
                  day.
                  {duration === "long" && " Try selecting 1 hour instead, or choose another day."}
                </p>
              </div>
            ) : (
              <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2")}>
                {selectedDay.timeWindows.map((window) => {
                  const available =
                    duration === "short" ? window.availableShort : window.availableLong;
                  return (
                    <button
                      key={window.value}
                      type="button"
                      disabled={!available}
                      onClick={() => setSelectedTime(window.value)}
                      className={cn(
                        "rounded-lg border px-4 py-2.5 text-base font-medium",
                        !available && "cursor-not-allowed opacity-40",
                        selectedTime === window.value
                          ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                          : available
                            ? "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                            : "border-seasalt-400/40 bg-seasalt-900/30 text-rich-black/60",
                      )}
                    >
                      {window.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </fieldset>

      {/* Divider */}
      <hr className={cn("border-seasalt-400/80")} />

      {/* ── Section 2: Your details ── */}
      <fieldset className={cn("flex flex-col gap-6")}>
        <legend className={cn("text-russian-violet mb-1 text-xl font-bold sm:text-2xl")}>
          Your details
        </legend>

        <div className={cn("grid gap-4 sm:grid-cols-2")}>
          <div className={cn("flex flex-col gap-1.5")}>
            <label htmlFor="booking-name" className={cn("text-rich-black text-base font-semibold")}>
              Name <span className={cn("text-coquelicot-500")}>*</span>
            </label>
            <input
              id="booking-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(
                "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
                "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
              )}
            />
          </div>

          <div className={cn("flex flex-col gap-1.5")}>
            <label
              htmlFor="booking-email"
              className={cn("text-rich-black text-base font-semibold")}
            >
              Email <span className={cn("text-coquelicot-500")}>*</span>
            </label>
            <input
              id="booking-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(
                "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
                "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
              )}
            />
          </div>
        </div>

        <div className={cn("flex flex-col gap-1.5")}>
          <label htmlFor="booking-phone" className={cn("text-rich-black text-base font-semibold")}>
            Phone <span className={cn("text-rich-black/70 text-base")}>(optional)</span>
          </label>
          <input
            id="booking-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={cn(
              "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
              "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
              "sm:max-w-sm",
            )}
          />
        </div>

        {/* Meeting Type */}
        <div className={cn("flex flex-col gap-2")}>
          <label className={cn("text-rich-black text-base font-semibold")}>
            Meeting type <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2")}>
            <button
              type="button"
              onClick={() => setMeetingType("in-person")}
              className={cn(
                "whitespace-nowrap rounded-lg border px-5 py-2.5 text-base font-medium transition-colors",
                meetingType === "in-person"
                  ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                  : "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
              )}
            >
              In-person
            </button>
            <button
              type="button"
              onClick={() => setMeetingType("remote")}
              className={cn(
                "whitespace-nowrap rounded-lg border px-5 py-2.5 text-base font-medium transition-colors",
                meetingType === "remote"
                  ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                  : "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
              )}
            >
              Remote
            </button>
          </div>
        </div>

        {/* Address (only for in-person) - animated reveal */}
        <div
          className={cn(
            "grid transition-all duration-300 ease-in-out",
            meetingType === "in-person"
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className={cn(meetingType === "in-person" ? "overflow-visible" : "overflow-hidden")}>
            <div className={cn("pb-0.5 pt-0.5")}>
              <label
                htmlFor="booking-address"
                className={cn("text-rich-black mb-2 block text-base font-semibold")}
              >
                Address <span className={cn("text-coquelicot-500")}>*</span>
              </label>
              {/* Only mount when in-person so Google Maps script never loads for remote sessions */}
              {meetingType === "in-person" && (
                <AddressAutocomplete
                  id="booking-address"
                  value={address}
                  onChange={setAddress}
                  placeholder="Start typing your address..."
                  required
                />
              )}
            </div>
          </div>
        </div>
      </fieldset>

      {/* Divider */}
      <hr className={cn("border-seasalt-400/80")} />

      {/* ── Section 3: Describe the issue ── */}
      <fieldset className={cn("flex flex-col gap-6")}>
        <legend className={cn("text-russian-violet mb-1 text-xl font-bold sm:text-2xl")}>
          Describe the issue
        </legend>

        <div className={cn("flex flex-col gap-1.5")}>
          <label htmlFor="booking-notes" className={cn("text-rich-black text-base font-semibold")}>
            What do you need help with? <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <textarea
            id="booking-notes"
            name="booking-notes-no-autofill"
            autoComplete="new-password"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={cn(
              "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-4 py-3 text-base",
              "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
            )}
            placeholder="e.g., Wi-Fi not working, need help with email setup, laptop running slow..."
          />
        </div>
      </fieldset>

      {/* Submit */}
      {error && (
        <p className={cn("text-coquelicot-600 text-base font-medium")} role="alert">
          {error}
        </p>
      )}

      <div className={cn("flex flex-wrap items-center gap-4")}>
        <Button
          type="submit"
          variant="secondary"
          size="md"
          disabled={submitting || availableDays.length === 0}
        >
          {submitting
            ? isEditMode
              ? "Saving..."
              : "Sending..."
            : isEditMode
              ? "Save changes"
              : "Submit request"}
        </Button>
        {!isEditMode && (
          <p className={cn("text-rich-black/60 text-base")}>
            I'll confirm your exact appointment time by email.
          </p>
        )}
      </div>
    </form>
  );
}
