// src/features/booking/components/AddressAutocomplete.tsx
/**
 * @file AddressAutocomplete.tsx
 * @description Address input backed by the legacy google.maps.places.Autocomplete
 * widget attached to a real <input> we control. Lazy-loads on visibility and
 * falls back to a plain text input when the API key is missing or the loader
 * fails.
 *
 * The legacy widget is deprecated but supported for 12+ months. We previously
 * tried the new PlaceAutocompleteElement web component but it requires a
 * fully-configured "Places API (New)" + billing setup on the Cloud project,
 * and styling its shadow DOM is painful.
 */

"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import useOnVisible from "@/shared/lib/useOnVisible";
import { loadPlacesLibrary } from "@/shared/lib/google-maps-loader";
import { cn } from "@/shared/lib/cn";

/**
 * Props for AddressAutocomplete component.
 */
export interface AddressAutocompleteProps {
  /** Current address value */
  value: string;
  /** Callback when address changes (typing or autocomplete selection) */
  onChange: (value: string) => void;
  /** Optional callback fired when a Place suggestion is selected. */
  onPlaceSelected?: (place: google.maps.places.PlaceResult) => void;
  /** Input placeholder text */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Optional max length cap on the input. */
  maxLength?: number;
  /** Input ID for label association */
  id?: string;
}

/**
 * Address input with Google Places autocomplete. Renders a normal <input> so
 * styling matches the rest of the form; the autocomplete dropdown is rendered
 * by Google in a positioned overlay.
 * @param props - Component props.
 * @param props.value - Current address value.
 * @param props.onChange - Callback when address changes.
 * @param props.onPlaceSelected - Optional callback when a suggestion is selected.
 * @param props.placeholder - Input placeholder text.
 * @param props.required - Whether the field is required.
 * @param props.maxLength - Optional max character length for the input.
 * @param props.id - Input ID for label association.
 * @returns Address autocomplete input element.
 */
export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder = "Start typing your address...",
  required = false,
  maxLength,
  id = "address-autocomplete",
}: AddressAutocompleteProps): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scriptError, setScriptError] = useState(false);
  // Lazy init avoids the "setState inside an effect" lint and is correct because
  // the env var is inlined at build time - it can't change between renders.
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const [apiKeyMissing] = useState(() => !apiKey);

  const isVisible = useOnVisible(wrapperRef);

  // Lazy-load the Maps script once the wrapper scrolls into view, then attach
  // the Autocomplete widget to our existing <input>.
  useEffect(() => {
    if (typeof window === "undefined" || !isVisible || !inputRef.current) return;

    if (!apiKey) {
      console.warn("GOOGLE_MAPS_API_KEY not set - address autocomplete disabled.");
      return;
    }

    // Capture the node now so the cleanup uses the same DOM element this
    // effect attached to, not whatever inputRef.current points at later.
    const inputEl = inputRef.current;

    let cancelled = false;
    let listener: google.maps.MapsEventListener | null = null;
    let pacContainer: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    /**
     * Keeps the Google-rendered `.pac-container` dropdown the same width as
     * the input. Google sets the width inline once when the widget attaches
     * and doesn't update it on input resize - so a layout shift (responsive
     * breakpoint change, sibling field appearing, etc.) leaves the dropdown
     * stuck at its old width. ResizeObserver pushes the current input width
     * onto the container on every change.
     */
    const syncDropdownWidth = (): void => {
      if (!pacContainer) {
        // Google appends the container to <body>; grab the latest one. This
        // assumes one open dropdown at a time, which is true since only one
        // input can be focused.
        const all = document.querySelectorAll<HTMLElement>(".pac-container");
        pacContainer = all[all.length - 1] ?? null;
      }
      if (!pacContainer) return;
      const rect = inputEl.getBoundingClientRect();
      pacContainer.style.width = `${rect.width}px`;
    };

    loadPlacesLibrary(apiKey)
      .then(() => {
        if (cancelled) return;
        const autocomplete = new google.maps.places.Autocomplete(inputEl, {
          componentRestrictions: { country: "nz" },
          fields: ["formatted_address", "address_components"],
          types: ["geocode"],
        });
        listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete.getPlace();
          const addr = place.formatted_address ?? "";
          if (addr) {
            onChange(addr);
            onPlaceSelected?.(place);
          }
        });
        // Resync on every input resize (responsive layout, sibling fields
        // appearing, font-loading reflows, etc.).
        resizeObserver = new ResizeObserver(syncDropdownWidth);
        resizeObserver.observe(inputEl);
        // Also sync as the user types so the dropdown grows/shrinks with the
        // input's content-driven layout changes.
        inputEl.addEventListener("input", syncDropdownWidth);
      })
      .catch((err) => {
        console.error("[AddressAutocomplete] Failed to load Maps API:", err);
        if (!cancelled) setScriptError(true);
      });

    return () => {
      cancelled = true;
      if (listener) google.maps.event.removeListener(listener);
      if (resizeObserver) resizeObserver.disconnect();
      inputEl.removeEventListener("input", syncDropdownWidth);
    };
    // onChange / onPlaceSelected intentionally omitted - the listener is bound
    // once when the widget mounts and re-binding would tear it down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, apiKey]);

  const showWarning = apiKeyMissing || scriptError;

  return (
    <div ref={wrapperRef} className={cn("flex w-full flex-col gap-1")}>
      <input
        ref={inputRef}
        type="text"
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        autoComplete="off"
        className={cn(
          "border-seasalt-400/80 bg-seasalt text-rich-black w-full rounded-md border px-4 py-3 text-base",
          "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
          showWarning && "border-yellow-500/60",
        )}
      />

      {apiKeyMissing && (
        <p className={cn("flex items-start gap-1 text-xs text-yellow-700")}>
          <span className={cn("mt-0.5")}>⚠️</span>
          <span>
            Address autocomplete unavailable. Please type your full address manually. (API key not
            configured)
          </span>
        </p>
      )}

      {scriptError && (
        <p className={cn("flex items-start gap-1 text-xs text-yellow-700")}>
          <span className={cn("mt-0.5")}>⚠️</span>
          <span>
            Address autocomplete unavailable. Please type your full address manually. (Failed to
            load Google Maps)
          </span>
        </p>
      )}
    </div>
  );
}
