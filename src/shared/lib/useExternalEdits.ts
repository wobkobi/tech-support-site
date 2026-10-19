"use client";
// src/shared/lib/useExternalEdits.ts
// Keeps edits React's change tracking misses (e.g. Grammarly), which the next render would revert.

import type React from "react";
import { useCallback, useEffect, useRef } from "react";

type TextField = HTMLTextAreaElement | HTMLInputElement;

/**
 * Routes input events onChange skipped to `onChange`: a microtask after onInput checks whether
 * onChange saw the same event.
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
