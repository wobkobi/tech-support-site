// src/components/BookingForm.tsx
"use client";
/**
 * @file BookingForm.tsx
 * @description Simplified booking form with day and time-of-day selection.
 */

import type React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { TIME_OF_DAY_OPTIONS, type BookableDay, type TimeOfDay } from "@/lib/booking";

/**
 * Props for the BookingForm component.
 */
export interface BookingFormProps {
  /** Available days with their time windows. */
  availableDays: BookableDay[];
}

/**
 * Booking form with day picker and time-of-day selection.
 * @param root0 - Component props.
 * @param root0.availableDays - Available days for booking.
 * @returns Booking form element.
 */
export default function BookingForm({ availableDays }: BookingFormProps): React.ReactElement {
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState<BookableDay | null>(null);
  const [selectedTime, setSelectedTime] = useState<TimeOfDay | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Split days into weekdays and weekends
  const weekdays = availableDays.filter((d) => !d.isWeekend);
  const weekends = availableDays.filter((d) => d.isWeekend);

  /**
   * Handle day selection.
   * @param day - The selected day.
   */
  function handleDaySelect(day: BookableDay): void {
    setSelectedDay(day);
    // Reset time if not available on new day
    if (selectedTime && !day.availableTimes.includes(selectedTime)) {
      setSelectedTime(null);
    }
  }

  /**
   * Submit the booking request.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!selectedDay) {
      setError("Please select a day.");
      return;
    }
    if (!selectedTime) {
      setError("Please select a time preference.");
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
    if (!notes.trim()) {
      setError("Please describe what you need help with.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/booking/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateKey: selectedDay.dateKey,
          timeOfDay: selectedTime,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          notes: notes.trim(),
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "Could not submit booking request.");
        setSubmitting(false);
        return;
      }

      router.push("/booking/success");
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("flex flex-col gap-6")}>
      {/* Day Selection */}
      <div>
        <label className={cn("text-rich-black mb-2 block text-sm font-semibold")}>
          Choose a day
        </label>

        {availableDays.length === 0 ? (
          <p className={cn("text-rich-black/70 text-sm")}>
            No availability in the next two weeks. Please call or text me directly.
          </p>
        ) : (
          <div className={cn("space-y-3")}>
            {/* Weekdays */}
            {weekdays.length > 0 && (
              <div>
                <p className={cn("text-rich-black/60 mb-1.5 text-xs font-medium uppercase tracking-wide")}>
                  Weekdays
                </p>
                <div className={cn("flex flex-wrap gap-2")}>
                  {weekdays.map((day) => (
                    <button
                      key={day.dateKey}
                      type="button"
                      onClick={() => handleDaySelect(day)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        selectedDay?.dateKey === day.dateKey
                          ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                          : "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
                        day.isToday && "ring-coquelicot-500/50 ring-2 ring-offset-1",
                      )}
                    >
                      {day.label}
                      {day.isToday && (
                        <span className={cn("text-coquelicot-600 ml-1 text-xs")}>(Today)</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Weekends */}
            {weekends.length > 0 && (
              <div>
                <p className={cn("text-rich-black/60 mb-1.5 text-xs font-medium uppercase tracking-wide")}>
                  Weekends
                </p>
                <div className={cn("flex flex-wrap gap-2")}>
                  {weekends.map((day) => (
                    <button
                      key={day.dateKey}
                      type="button"
                      onClick={() => handleDaySelect(day)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        selectedDay?.dateKey === day.dateKey
                          ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                          : "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
                      )}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Time Selection - only show when day is selected */}
      {selectedDay && (
        <div>
          <label className={cn("text-rich-black mb-2 block text-sm font-semibold")}>
            Preferred time for {selectedDay.fullLabel}
          </label>
          <div className={cn("flex flex-wrap gap-2")}>
            {TIME_OF_DAY_OPTIONS.map((option) => {
              const isAvailable = selectedDay.availableTimes.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={!isAvailable}
                  onClick={() => setSelectedTime(option.value)}
                  className={cn(
                    "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                    !isAvailable && "cursor-not-allowed opacity-40",
                    selectedTime === option.value
                      ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                      : isAvailable
                        ? "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40"
                        : "border-seasalt-400/40 bg-seasalt-900/30 text-rich-black/50",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Contact Details */}
      <div className={cn("grid gap-4 sm:grid-cols-2")}>
        <div className={cn("flex flex-col gap-1")}>
          <label htmlFor="booking-name" className={cn("text-rich-black text-sm font-semibold")}>
            Name <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <input
            id="booking-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(
              "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-3 py-2 text-sm",
              "focus:border-russian-violet focus:outline-none focus:ring-1 focus:ring-russian-violet/30",
            )}
          />
        </div>

        <div className={cn("flex flex-col gap-1")}>
          <label htmlFor="booking-email" className={cn("text-rich-black text-sm font-semibold")}>
            Email <span className={cn("text-coquelicot-500")}>*</span>
          </label>
          <input
            id="booking-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={cn(
              "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-3 py-2 text-sm",
              "focus:border-russian-violet focus:outline-none focus:ring-1 focus:ring-russian-violet/30",
            )}
          />
        </div>
      </div>

      <div className={cn("flex flex-col gap-1")}>
        <label htmlFor="booking-phone" className={cn("text-rich-black text-sm font-semibold")}>
          Phone <span className={cn("text-rich-black/50 text-xs font-normal")}>(optional)</span>
        </label>
        <input
          id="booking-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={cn(
            "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-3 py-2 text-sm",
            "focus:border-russian-violet focus:outline-none focus:ring-1 focus:ring-russian-violet/30",
            "sm:max-w-xs",
          )}
        />
      </div>

      <div className={cn("flex flex-col gap-1")}>
        <label htmlFor="booking-notes" className={cn("text-rich-black text-sm font-semibold")}>
          What do you need help with? <span className={cn("text-coquelicot-500")}>*</span>
        </label>
        <textarea
          id="booking-notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={cn(
            "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-3 py-2 text-sm",
            "focus:border-russian-violet focus:outline-none focus:ring-1 focus:ring-russian-violet/30",
          )}
          placeholder="e.g., Wi-Fi not working, need help with email setup, laptop running slow..."
        />
      </div>

      {error && (
        <p className={cn("text-coquelicot-600 text-sm font-medium")} role="alert">
          {error}
        </p>
      )}

      <div className={cn("flex flex-wrap items-center gap-3")}>
        <button
          type="submit"
          disabled={submitting || availableDays.length === 0}
          className={cn(
            "bg-russian-violet text-seasalt rounded-md px-5 py-2.5 text-sm font-semibold",
            "hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {submitting ? "Sending..." : "Request booking"}
        </button>
        <p className={cn("text-rich-black/60 text-xs sm:text-sm")}>
          I'll confirm your exact appointment time by email.
        </p>
      </div>
    </form>
  );
}
