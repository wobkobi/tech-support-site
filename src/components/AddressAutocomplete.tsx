// src/components/AddressAutocomplete.tsx
"use client";
/**
 * @file AddressAutocomplete.tsx
 * @description Address input with Google Places Autocomplete (with graceful fallback)
 */

import type React from "react";
import { useEffect, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  // Load Google Maps script
  useEffect(() => {
    if (typeof window === "undefined") return;

    /**
     * Checks if Google Maps is loaded
     * @returns True if loaded
     */
    const checkLoaded = (): boolean => {
      return Boolean(window.google?.maps?.places);
    };

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
       * Handler for existing script load event
       */
      const handleExistingLoad = (): void => {
        setIsLoaded(true);
      };
      existingScript.addEventListener("load", handleExistingLoad);
      return () => existingScript.removeEventListener("load", handleExistingLoad);
    }

    // Create script element
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;

    /**
     * Handler for successful script load
     */
    const handleLoad = (): void => {
      console.log("✅ Google Maps loaded successfully");
      setIsLoaded(true);
    };

    /**
     * Handler for script load error
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
      // Don't remove script on cleanup - it can be reused
    };
  }, []);

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

  // Show status message if autocomplete is unavailable
  const showWarning = apiKeyMissing || scriptError;

  return (
    <div className={cn("flex flex-col gap-1")}>
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
          "border-seasalt-400/80 bg-seasalt text-rich-black rounded-md border px-3 py-2 text-sm",
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
