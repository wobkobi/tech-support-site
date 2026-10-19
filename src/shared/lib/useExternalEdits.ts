"use client";
// src/shared/lib/useExternalEdits.ts
// Keeps edits made outside React's change tracking, such as a Grammarly fix written
// straight into a controlled field. React skips onChange for those, so its next render
// would put the old text back.

import type React from "react";
import { useCallback, useEffect, useRef } from "react";

type TextField = HTMLTextAreaElement | HTMLInputElement;

/**
 * Wraps a controlled field's handlers so an input event React's onChange skipped still
 * reaches `onChange`. onInput fires for every native input event; a microtask then checks
 * whether onChange saw the same event, whichever order React ran them in.
 * @param value - The field's controlled value; uncontrolled fields are left alone.
 * @param onChange - The field's change handler.
 * @param onInput - The field's own input handler, still called.
 * @returns The onChange and onInput handlers to put on the field.
 */
export function useExternalEdits<T extends TextField>(
  value: unknown,
  onChange: React.ChangeEventHandler<T> | undefined,
  onInput: React.InputEventHandler<T> | undefined,
): { onChange: React.ChangeEventHandler<T>; onInput: React.InputEventHandler<T> } {
  const latest = useRef({ value, onChange, onInput });
  const handled = useRef<Event | null>(null);
  useEffect(() => {
    latest.current = { value, onChange, onInput };
  });

  const handleChange = useCallback<React.ChangeEventHandler<T>>((e) => {
    handled.current = e.nativeEvent;
    latest.current.onChange?.(e);
  }, []);

  const handleInput = useCallback<React.InputEventHandler<T>>((e) => {
    latest.current.onInput?.(e);
    const el = e.currentTarget;
    const native = e.nativeEvent;
    queueMicrotask(() => {
      const { value: current, onChange: handler } = latest.current;
      if (handled.current === native || !handler || typeof current !== "string") return;
      if (el.value === current) return;
      // The input event carries the same target, which is all change handlers read.
      handler(e as unknown as React.ChangeEvent<T>);
    });
  }, []);

  return { onChange: handleChange, onInput: handleInput };
}
