// src/features/booking/components/AddressAutocomplete.tsx
/**
 * @file AddressAutocomplete.tsx
 * @description Address input using google.maps.places.Autocomplete.
 * Falls back to a plain text input if the API key is missing or fails to load.
 */

"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import useOnVisible from "@/shared/lib/useOnVisible";
import { cn } from "@/shared/lib/cn";

/**
 * Props for AddressAutocomplete component
 */
export interface AddressAutocompleteProps {
  /** Current address value */
  value: string;
  /** Callback when address changes */
  onChange: (value: string) => void;
  /** Optional callback when a place is selected from autocomplete */
  onPlaceSelected?: (place: google.maps.places.PlaceResult) => void;
  /** Input placeholder text */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Input ID for label association */
  id?: string;
}

/**
 * Address input with Google Places autocomplete.
 * Falls back to a plain text input if the API key is missing or fails to load.
 * @param props - Component props
 * @param props.value - Current address value
 * @param props.onChange - Callback when address changes
 * @param props.onPlaceSelected - Optional callback when a place is selected
 * @param props.placeholder - Input placeholder text
 * @param props.required - Whether the field is required
 * @param props.id - Input ID for label association
 * @returns Address autocomplete input element
 */
export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder = "Start typing your address...",
  required = false,
  id = "address-autocomplete",
}: AddressAutocompleteProps): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  const isVisible = useOnVisible(wrapperRef);

  // Load Google Maps script when component becomes visible
  useEffect(() => {
    if (typeof window === "undefined" || !isVisible) return;

    if (window.google?.maps?.places?.Autocomplete) {
      const t = setTimeout(() => setIsReady(true), 0);
      return () => clearTimeout(t);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.warn("GOOGLE_MAPS_API_KEY not set - address autocomplete disabled.");
      const t = setTimeout(() => setApiKeyMissing(true), 0);
      return () => clearTimeout(t);
    }

    const existingScript = document.querySelector(`script[src*="maps.googleapis.com/maps/api/js"]`);
    if (existingScript) {
      /**
       * Marks the component as ready when the already-present script fires its load event.
       */
      const handler = (): void => {
        setIsReady(true);
      };
      existingScript.addEventListener("load", handler);
      return () => existingScript.removeEventListener("load", handler);
    }

    const script = document.createElement("script");
    // loading=async prevents the Maps bootstrap from blocking the main thread
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;

    /**
     * Marks the component as ready once the Maps script finishes loading.
     */
    const handleLoad = (): void => {
      setIsReady(true);
    };

    /**
     * Logs a detailed error and marks the component as failed.
     */
    const handleError = (): void => {
      console.error(
        "❌ Failed to load Google Maps. Possible reasons:\n" +
          "1. Invalid API key\n" +
          "2. Places API not enabled in Google Cloud Console\n" +
          "3. API key has HTTP referrer restrictions blocking the request\n" +
          "   → Solution: Set 'Application restrictions' to 'None' in Google Cloud Console\n" +
          "   → Keep 'API restrictions' to 'Places API' for security\n" +
          "4. Network error",
      );
      setScriptError(true);
    };

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);
    document.head.appendChild(script);

    return () => {
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
  }, [isVisible]);

  // Mount Autocomplete on the input once Maps is ready
  useEffect(() => {
    if (!isReady || !inputRef.current) return;

    if (!window.google?.maps?.places?.Autocomplete) {
      const t = setTimeout(() => setScriptError(true), 0);
      return () => clearTimeout(t);
    }

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "nz" },
      fields: ["formatted_address"],
      types: ["geocode"],
    });

    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      const addr = place.formatted_address ?? "";
      if (addr) {
        onChange(addr);
        onPlaceSelected?.(place);
      }
    });

    return () => {
      google.maps.event.removeListener(listener);
    };
    // onChange/onPlaceSelected intentionally omitted: autocomplete is uncontrolled after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  const showWarning = apiKeyMissing || scriptError;

  return (
    <div ref={wrapperRef} className="flex w-full flex-col gap-1">
      <input
        ref={inputRef}
        type="text"
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className={cn(
          "border-seasalt-400/80 bg-seasalt text-rich-black w-full rounded-md border px-4 py-3 text-base",
          "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
          showWarning && "border-yellow-500/60",
        )}
      />

      {apiKeyMissing && (
        <p className="flex items-start gap-1 text-xs text-yellow-700">
          <span className="mt-0.5">⚠️</span>
          <span>
            Address autocomplete unavailable. Please type your full address manually. (API key not
            configured)
          </span>
        </p>
      )}

      {scriptError && (
        <p className="flex items-start gap-1 text-xs text-yellow-700">
          <span className="mt-0.5">⚠️</span>
          <span>
            Address autocomplete unavailable. Please type your full address manually. (Failed to
            load Google Maps)
          </span>
        </p>
      )}
    </div>
  );
}
