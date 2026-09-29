"use client";
// src/features/booking/hooks/use-submit-attention.ts
// Moves focus to whatever stopped a booking submit: the error summary, or one of
// the "did you mean?" prompts that sit up by their fields.

import { focusAndReveal } from "@/shared/lib/focus-and-reveal";
import { useEffect, useRef, useState, type RefObject } from "react";

/** Where a stopped submit sends focus. */
export type AttentionTarget = "summary" | "email" | "address";

/** Refs and handlers returned by {@link useSubmitAttention}. */
interface SubmitAttention {
  /** True once a submit has been attempted; blur-time errors stay inline-only until then. */
  attempted: boolean;
  /** Sends focus to the target once it has rendered. */
  requestAttention: (target: AttentionTarget) => void;
  /** Forgets the last attempt, as if the form were fresh. */
  resetAttention: () => void;
  errorSummaryRef: RefObject<HTMLDivElement | null>;
  emailPromptRef: RefObject<HTMLDivElement | null>;
  addressPromptRef: RefObject<HTMLDivElement | null>;
}

/**
 * Tracks submit attempts and focuses what blocked them. On a long mobile form
 * the alerts sit well above the submit button, so without this a failed submit
 * looks like nothing happened.
 * @returns Attempt state, the focus request and the refs to attach.
 */
export function useSubmitAttention(): SubmitAttention {
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const emailPromptRef = useRef<HTMLDivElement>(null);
  const addressPromptRef = useRef<HTMLDivElement>(null);
  // `seq` bumps on every attempt so a second click with the same problem still
  // moves focus. Driven by submits only: the name and notes checks that run on
  // blur must not yank the page away from the field being typed in.
  const [attention, setAttention] = useState<{ target: AttentionTarget; seq: number } | null>(null);

  useEffect(() => {
    if (!attention) return;
    const el = {
      summary: errorSummaryRef,
      email: emailPromptRef,
      address: addressPromptRef,
    }[attention.target].current;
    // An empty summary is display:none and cannot take focus.
    if (el?.hasChildNodes()) focusAndReveal(el);
  }, [attention]);

  /**
   * Sends focus to whatever stopped the submit, once it has rendered.
   * @param target - The error summary, or one of the "did you mean?" prompts.
   */
  function requestAttention(target: AttentionTarget): void {
    setAttention((prev) => ({ target, seq: (prev?.seq ?? 0) + 1 }));
  }

  /** Forgets the last attempt, as if the form were fresh. */
  function resetAttention(): void {
    setAttention(null);
  }

  return {
    attempted: attention !== null,
    requestAttention,
    resetAttention,
    errorSummaryRef,
    emailPromptRef,
    addressPromptRef,
  };
}
