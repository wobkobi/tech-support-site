"use client";
// src/shared/components/TextArea.tsx
// Native textarea that keeps edits React misses (Grammarly fixes). Use it in place of a
// bare <textarea>; every native prop, including `ref`, passes straight through.

import { useExternalEdits } from "@/shared/lib/useExternalEdits";
import type React from "react";

/**
 * Textarea with Grammarly-safe change handling.
 * @param props - Native textarea props.
 * @param props.value - Controlled value.
 * @param props.onChange - Change handler, also called for edits React missed.
 * @param props.onInput - Native input handler.
 * @returns The textarea element.
 */
export function TextArea({
  value,
  onChange,
  onInput,
  ...rest
}: React.ComponentProps<"textarea">): React.ReactElement {
  const synced = useExternalEdits(value, onChange, onInput);
  return (
    <textarea
      {...rest}
      value={value}
      onChange={onChange ? synced.onChange : undefined}
      onInput={synced.onInput}
    />
  );
}
