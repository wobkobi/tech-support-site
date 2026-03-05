// src/components/AddressAutocomplete.tsx
/**
 * @file AddressAutocomplete.tsx
 * @description Address input with Google Places Autocomplete (with graceful fallback).
 */

"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import useOnVisible from "@/lib/useOnVisible";
import { cn } from "@/lib/cn";

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
 * Address input with Google Places Autocomplete
 * Falls back to plain text input if API key is missing or fails to load
 * @param props - Component props
 * @param props.value - Current address value
 * @param props.onChange - Callback when address changes
 * @param props.onPlaceSelected - Optional callback when place selected from autocomplete
 * @param props.placeholder - Input placeholder text
 * @param props.required - Whether field is required
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
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  // Only load the Maps script when this component becomes visible or receives focus
  const isVisible = useOnVisible(wrapperRef);

  // Load Google Maps script when visible
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isVisible) return;

    /**
     * Returns true if the Google Maps Places API is already loaded.
     * @returns Whether the Places API is available on window.google.
     */
    const checkLoaded = (): boolean => Boolean(window.google?.maps?.places);

    if (checkLoaded()) {
      const timer = setTimeout(() => setIsLoaded(true), 0);
      return () => clearTimeout(timer);
    }

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.warn(
        "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY not set - address autocomplete disabled. Add your API key to .env.local",
      );
      const timer = setTimeout(() => setApiKeyMissing(true), 0);
      return () => clearTimeout(timer);
    }

    // Check if script already exists
    const existingScript = document.querySelector(`script[src*="maps.googleapis.com/maps/api/js"]`);

    if (existingScript) {
      /**
       * Marks the component as loaded when the existing script fires its load event.
       * @returns void
       */
      const handleExistingLoad = (): void => setIsLoaded(true);
      existingScript.addEventListener("load", handleExistingLoad);
      return () => existingScript.removeEventListener("load", handleExistingLoad);
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;

    /**
     * Marks the component as loaded once the Maps script has finished loading.
     */
    const handleLoad = (): void => {
      console.log("✅ Google Maps loaded successfully");
      setIsLoaded(true);
    };

    /**
     * Logs a detailed error and marks the component in a failed-load state.
     */
    const handleError = (): void => {
      console.error(
        "❌ Failed to load Google Maps. Possible reasons:\n" +
          "1. Invalid API key\n" +
          "2. Places API not enabled in Google Cloud Console\n" +
          "3. API key has HTTP referrer restrictions blocking the request\n" +
          "   → Solution: Set 'Application restrictions' to 'None' in Google Cloud Console\n" +
          "   → Keep 'API restrictions' to 'Places API' for security\n" +
          "4. Network error\n\n" +
          "See the setup guide for instructions.",
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

  // Initialize autocomplete when Maps API is loaded
  useEffect(() => {
    if (!isLoaded || !inputRef.current) return;

    let autocompleteInstance: google.maps.places.Autocomplete | null = null;

    try {
      autocompleteInstance = new google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "nz" },
        fields: ["address_components", "formatted_address", "geometry", "name"],
        types: ["address"],
      });

      /**
       * Handler for place selection
       */
      const handlePlaceChanged = (): void => {
        if (!autocompleteInstance) return;
        const place = autocompleteInstance.getPlace();
        if (place.formatted_address) {
          onChange(place.formatted_address);
          onPlaceSelected?.(place);
        }
      };

      autocompleteInstance.addListener("place_changed", handlePlaceChanged);

      // Cleanup function
      return () => {
        if (autocompleteInstance) {
          google.maps.event.clearInstanceListeners(autocompleteInstance);
        }
      };
    } catch (error) {
      console.error("Failed to initialize autocomplete:", error);
      // Defer setState to avoid cascading renders
      const timer = setTimeout(() => setScriptError(true), 0);
      return () => clearTimeout(timer);
    }
  }, [isLoaded, onChange, onPlaceSelected]);

  // Keep the Places dropdown aligned to the input width and position
  useEffect(() => {
    if (!inputRef.current) return;

    const inputEl = inputRef.current;
    let mutationObserver: MutationObserver | null = null;
    let rafId: number | null = null;

    /**
     * Syncs the Google Places dropdown width/position with the input element so suggestions stay flush with the input.
     */
    const syncDropdown = (): void => {
      const containers = Array.from(document.querySelectorAll(".pac-container")) as HTMLElement[];
      const container = containers.findLast((node) => node.offsetParent !== null) ?? null;
      if (!container) return;

      const rect = inputEl.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
      const position = window.getComputedStyle(container).position;

      const left = position === "fixed" ? rect.left : rect.left + scrollLeft;
      const top = position === "fixed" ? rect.bottom + 6 : rect.bottom + scrollTop + 6;

      const width = Math.round(rect.width);

      container.style.setProperty("width", `${width}px`, "important");
      container.style.setProperty("min-width", `${width}px`, "important");
      container.style.setProperty("max-width", `${width}px`, "important");
      container.style.setProperty("left", `${left}px`, "important");
      container.style.setProperty("right", "auto", "important");
      container.style.setProperty("top", `${top}px`, "important");
    };

    /**
     * Starts a requestAnimationFrame loop so the dropdown keeps tracking layout changes while the user types.
     */
    const startSyncLoop = (): void => {
      if (rafId !== null) return;
      /**
       * Ticks every animation frame to reapply dropdown positioning adjustments.
       */
      const tick = (): void => {
        syncDropdown();
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
    };

    /**
     * Cancels the sync loop when the dropdown hides so we do not keep scheduling RAF work.
     */
    const stopSyncLoop = (): void => {
      if (rafId === null) return;
      window.cancelAnimationFrame(rafId);
      rafId = null;
    };

    /**
     * Kicks off a sync pass immediately when the input gains focus.
     */
    const handleFocus = (): void => {
      setTimeout(syncDropdown, 0);
      startSyncLoop();
    };

    /**
     * Nudges the dropdown after each keystroke to keep it flush with the field width.
     */
    const handleInput = (): void => {
      setTimeout(syncDropdown, 0);
    };

    /**
     * Stops syncing once the input loses focus so the loop does not run indefinitely.
     */
    const handleBlur = (): void => {
      stopSyncLoop();
    };

    inputEl.addEventListener("focus", handleFocus);
    inputEl.addEventListener("input", handleInput);
    inputEl.addEventListener("blur", handleBlur);
    window.addEventListener("resize", syncDropdown);
    window.addEventListener("scroll", syncDropdown, true);

    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(() => syncDropdown());
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(syncDropdown);
      observer.observe(inputEl);
      resizeObserverRef.current = observer;
    }

    return () => {
      inputEl.removeEventListener("focus", handleFocus);
      inputEl.removeEventListener("input", handleInput);
      inputEl.removeEventListener("blur", handleBlur);
      window.removeEventListener("resize", syncDropdown);
      window.removeEventListener("scroll", syncDropdown, true);
      mutationObserver?.disconnect();
      stopSyncLoop();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  // Show status message if autocomplete is unavailable
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

      {/* Warning message */}
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
            load Google Maps - check Application restrictions in Google Cloud Console)
          </span>
        </p>
      )}

      {/* Loading indicator */}
      {!showWarning && !isLoaded && (
        <p className={cn("text-rich-black/60 text-xs")}>Loading address autocomplete...</p>
      )}

      {/* Success - no message needed, autocomplete just works */}
    </div>
  );
}
