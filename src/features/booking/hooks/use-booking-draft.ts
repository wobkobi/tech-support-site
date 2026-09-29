"use client";
// src/features/booking/hooks/use-booking-draft.ts
// localStorage draft for the new-booking form: restore once on mount, then save
// on every change (debounced) so a customer who leaves mid-form comes back to it.

import type { BookableDay } from "@/features/booking/lib/booking";
import {
  DRAFT_KEY,
  parseBookingDraft,
  removeBookingDraft,
  saveBookingDraft,
  type BookingDraft,
  type RestoredBookingDraft,
} from "@/features/booking/lib/booking-form";
import { useEffect, useRef, useState } from "react";

const SAVE_DEBOUNCE_MS = 300;

/** Options for {@link useBookingDraft}. */
interface UseBookingDraftOptions {
  /** False in edit mode: an existing booking is never drafted. */
  enabled: boolean;
  /** Current bookable days, used to drop a saved slot that has since gone. */
  availableDays: BookableDay[];
  /** The form's current values, saved on change. */
  draft: BookingDraft;
  /** Applies the validated saved fields to the form. Called at most once, on mount. */
  onRestore: (restored: RestoredBookingDraft) => void;
}

/** Draft state returned by {@link useBookingDraft}. */
interface BookingDraftState {
  /** True once a saved draft has been restored, so the form can offer "Clear form". */
  draftRestored: boolean;
  /** Deletes the saved draft and hides the "Clear form" affordance. */
  forgetDraft: () => void;
}

/**
 * Restores and persists the new-booking draft.
 * @param options - Hook options.
 * @param options.enabled - False in edit mode, which skips both restore and save.
 * @param options.availableDays - Current bookable days for validating the saved slot.
 * @param options.draft - The form's current values.
 * @param options.onRestore - Applies the validated saved fields to the form.
 * @returns Whether a draft was restored, and a way to forget it.
 */
export function useBookingDraft({
  enabled,
  availableDays,
  draft,
  onRestore,
}: UseBookingDraftOptions): BookingDraftState {
  const [draftRestored, setDraftRestored] = useState(false);
  // Gates saving until the restore effect has run, so the pre-restore initial
  // values cannot be written over the saved draft first.
  const loadedRef = useRef(false);

  // localStorage is unavailable during SSR, so this cannot be a lazy useState
  // initialiser - hence the suppressed setState-in-effect lint.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      onRestore(parseBookingDraft(raw, availableDays));
      setDraftRestored(true);
    } catch (err) {
      console.warn("[BookingForm] Failed to restore draft:", err);
    }
    // Mount-only: availableDays is render-stable and onRestore only calls setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keyed on the serialised draft so an unrelated re-render (submitting, errors)
  // does not restart the debounce, and a refreshed-but-equal day does not re-save.
  const serialised = JSON.stringify(draft);
  useEffect(() => {
    if (!enabled || !loadedRef.current) return;
    const timer = setTimeout(() => saveBookingDraft(serialised), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, serialised]);

  /** Deletes the saved draft and hides the "Clear form" affordance. */
  function forgetDraft(): void {
    removeBookingDraft();
    setDraftRestored(false);
  }

  return { draftRestored, forgetDraft };
}
