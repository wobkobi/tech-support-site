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
  const [isLoaded, setIsLoaded] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  const isVisible = useOnVisible(wrapperRef);

  // Load Google Maps script when component becomes visible
  useEffect(() => {
    if (typeof window === "undefined" || !isVisible) return;

    if (window.google?.maps?.places) {
      const timer = setTimeout(() => setIsLoaded(true), 0);
      return () => clearTimeout(timer);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.warn("GOOGLE_MAPS_API_KEY not set — address autocomplete disabled.");
      const timer = setTimeout(() => setApiKeyMissing(true), 0);
      return () => clearTimeout(timer);
    }

    const existingScript = document.querySelector(`script[src*="maps.googleapis.com/maps/api/js"]`);
    if (existingScript) {
      /**
       * Marks the component as loaded when the already-present script fires its load event.
       * @returns void
       */
      const handler = (): void => setIsLoaded(true);
      existingScript.addEventListener("load", handler);
      return () => existingScript.removeEventListener("load", handler);
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;

    /**
     * Marks the component as loaded once the Maps script finishes loading.
     * @returns void
     */
    const handleLoad = (): void => setIsLoaded(true);

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

  // Initialise Autocomplete once the Maps API is ready
  useEffect(() => {
    if (!isLoaded || !inputRef.current) return;

    if (!window.google?.maps?.places?.Autocomplete) {
      console.error("[AddressAutocomplete] google.maps.places.Autocomplete not found");
      setScriptError(true);
      return;
    }

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: "nz" },
      types: ["address"],
      fields: ["formatted_address"],
    });

    /**
     * Called when the user selects a prediction from the suggestion list.
     */
    const handlePlaceChanged = (): void => {
      const place = autocomplete.getPlace();
      const addr = place.formatted_address ?? "";
      if (addr) {
        onChange(addr);
        onPlaceSelected?.(place);
      }
    };

    const listener = autocomplete.addListener("place_changed", handlePlaceChanged);

    return () => {
      google.maps.event.removeListener(listener);
    };
    // onChange/onPlaceSelected intentionally omitted: autocomplete is uncontrolled after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

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
        autoComplete="off"
        className={cn(
          "border-seasalt-400/80 bg-seasalt text-rich-black w-full rounded-md border px-4 py-3 text-base",
          "focus:border-russian-violet focus:ring-russian-violet/30 focus:outline-none focus:ring-1",
          showWarning && "border-yellow-500/60",
        )}
      />

      {/* Warning messages */}
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
            load Google Maps — check Application restrictions in Google Cloud Console)
          </span>
        </p>
      )}

      {/* Loading indicator */}
      {!showWarning && !isLoaded && (
        <p className={cn("text-rich-black/60 text-xs")}>Loading address autocomplete...</p>
      )}
    </div>
  );
}
