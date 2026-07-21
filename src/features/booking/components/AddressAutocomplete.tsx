// src/features/booking/components/AddressAutocomplete.tsx
/**
 * @description Address input backed by the Places "AutocompleteSuggestion" API
 * (the GA replacement for the deprecated legacy widget). Suggestions are
 * fetched programmatically and rendered in a component-owned combobox dropdown,
 * so styling is ours (no Google shadow DOM) and keyboard/screen-reader
 * behaviour follows the standard combobox pattern.
 *
 * Billing: every lookup runs under an AutocompleteSessionToken. A session ends
 * either at selection (the token rides into the first `fetchFields` call, which
 * closes it at session rates) or at abandonment (dropdown dismissed without a
 * pick), after which the token is discarded - a token is never reused across
 * lookups.
 *
 * Fallback ladder: missing API key or any script/fetch failure permanently
 * drops the field to a plain text input with a visible warning, and
 * `onFallbackMode` tells the parent to relax any pick-a-suggestion gates. The
 * booking flow must never break on a Google-side problem.
 */

"use client";

import { cn } from "@/shared/lib/cn";
import { loadPlacesLibrary } from "@/shared/lib/google-maps-loader";
import useOnVisible from "@/shared/lib/useOnVisible";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { FaTriangleExclamation } from "react-icons/fa6";

/** Debounce between the last keystroke and the suggestion fetch. */
const FETCH_DEBOUNCE_MS = 250;
/** Minimum typed characters before suggestions are fetched. */
const MIN_FETCH_CHARS = 3;

/** Normalised selection payload handed to `onPlaceSelected`. */
export interface SelectedPlace {
  /** The full formatted address, as also pushed through `onChange`. */
  formattedAddress: string;
}

/** One rendered suggestion row. */
interface SuggestionItem {
  /** Stable per-render id for aria-activedescendant. */
  id: string;
  /** Bold main line (street address). */
  mainText: string;
  /** Muted secondary line (suburb / city). */
  secondaryText: string;
  /** The prediction, kept for `toPlace()` on selection. */
  prediction: google.maps.places.PlacePrediction;
}

/**
 * Props for the {@link AddressAutocomplete} component.
 */
export interface AddressAutocompleteProps {
  /** Current address value */
  value: string;
  /** Callback when address changes (typing or autocomplete selection) */
  onChange: (value: string) => void;
  /** Fired when a suggestion is selected, with the normalised payload. */
  onPlaceSelected?: (place: SelectedPlace) => void;
  /**
   * Fired exactly once when the Places API can't be used (missing key, script
   * load failure, or a failing suggestion fetch) so the parent can bypass any
   * "must pick a suggestion" gates.
   */
  onFallbackMode?: () => void;
  /** Input placeholder text */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Optional max length cap on the input. */
  maxLength?: number;
  /** Input ID for label association */
  id?: string;
  /**
   * Extra key handling for keys the dropdown didn't consume - lets the admin
   * calculator keep its Enter-to-look-up shortcut while the dropdown is closed.
   */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Class override for the input, e.g. the compact admin styling. */
  inputClassName?: string;
  /** Optional accessible name when no visible <label htmlFor> wraps the field. */
  "aria-label"?: string;
  /** Optional id of an element describing the field (e.g. error message). */
  "aria-describedby"?: string;
  /** True when the field has a validation error. */
  "aria-invalid"?: boolean;
}

/**
 * Address input with Google Places suggestions in a self-rendered combobox.
 * @param props - Component props.
 * @param props.value - Current address value.
 * @param props.onChange - Callback when address changes.
 * @param props.onPlaceSelected - Callback when a suggestion is selected.
 * @param props.onFallbackMode - Fired once if the Places API can't be used.
 * @param props.placeholder - Input placeholder text.
 * @param props.required - Whether the field is required.
 * @param props.maxLength - Optional max character length for the input.
 * @param props.id - Input ID for label association.
 * @param props.onKeyDown - Extra key handling when the dropdown is closed.
 * @param props.inputClassName - Class override for the input element.
 * @param props."aria-label" - Accessible name when no visible label wraps the field.
 * @param props."aria-describedby" - ID of an element describing the field.
 * @param props."aria-invalid" - True when the field has a validation error.
 * @returns Address autocomplete element.
 */
export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  onFallbackMode,
  placeholder = "Start typing your address...",
  required = false,
  maxLength,
  id = "address-autocomplete",
  onKeyDown,
  inputClassName,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: AddressAutocompleteProps): React.ReactElement {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [scriptError, setScriptError] = useState(false);
  // Lazy init avoids the "setState inside an effect" lint and is correct because
  // the env var is inlined at build time - it can't change between renders.
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const [apiKeyMissing] = useState(() => !apiKey);
  // Latch so onFallbackMode fires at most once per mount.
  const fallbackFiredRef = useRef(false);

  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Places library, loaded lazily on visibility.
  const placesRef = useRef<google.maps.PlacesLibrary | null>(null);
  // Session token for the current lookup session; null between sessions.
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic fetch counter so a slow response can't overwrite a newer one.
  const fetchSeqRef = useRef(0);

  const isVisible = useOnVisible(wrapperRef);

  // Notify the parent that the field is permanently in fallback mode (no
  // autocomplete available). Fires whether the cause is a missing key, a
  // script error, or a failed fetch.
  useEffect(() => {
    if (fallbackFiredRef.current) return;
    if (apiKeyMissing || scriptError) {
      fallbackFiredRef.current = true;
      onFallbackMode?.();
    }
  }, [apiKeyMissing, scriptError, onFallbackMode]);

  // Lazy-load the Places library once the wrapper scrolls into view.
  useEffect(() => {
    if (typeof window === "undefined" || !isVisible || placesRef.current) return;
    if (!apiKey) {
      console.warn("GOOGLE_MAPS_API_KEY not set - address autocomplete disabled.");
      return;
    }
    let cancelled = false;
    loadPlacesLibrary(apiKey)
      .then((lib) => {
        if (!cancelled) placesRef.current = lib;
      })
      .catch((err) => {
        console.error("[AddressAutocomplete] Failed to load Maps API:", err);
        if (!cancelled) setScriptError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, apiKey]);

  // Clear any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  /**
   * Cancels any pending debounce and invalidates in-flight fetches, so a slow
   * response can't reopen a dropdown the user has already dismissed (or pick a
   * fresh session token after one was concluded).
   */
  function cancelPendingFetch(): void {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    fetchSeqRef.current++;
  }

  /** Closes the dropdown; an unselected session's token is discarded (never reused). */
  function closeDropdown(): void {
    cancelPendingFetch();
    setOpen(false);
    setActiveIndex(-1);
    tokenRef.current = null;
  }

  /**
   * Fetches suggestions for the typed input under the current session token.
   * Any failure latches the permanent plain-input fallback.
   * @param input - The typed address fragment.
   */
  async function fetchSuggestions(input: string): Promise<void> {
    const lib = placesRef.current;
    if (!lib) return;
    tokenRef.current ??= new lib.AutocompleteSessionToken();
    const seq = ++fetchSeqRef.current;
    try {
      const { suggestions: results } =
        await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: tokenRef.current,
          includedRegionCodes: ["nz"],
        });
      if (seq !== fetchSeqRef.current) return; // stale response
      const items: SuggestionItem[] = results
        .map((s, i) => {
          const p = s.placePrediction;
          if (!p) return null;
          return {
            id: `${listboxId}-option-${i}`,
            mainText: p.mainText?.toString() ?? p.text.toString(),
            secondaryText: p.secondaryText?.toString() ?? "",
            prediction: p,
          };
        })
        .filter((x): x is SuggestionItem => x !== null);
      setSuggestions(items);
      setOpen(items.length > 0);
      setActiveIndex(-1);
    } catch (err) {
      console.error("[AddressAutocomplete] Suggestion fetch failed:", err);
      setScriptError(true);
      setOpen(false);
    }
  }

  /**
   * Handles typing: propagates the raw value, then debounces a suggestion fetch.
   * @param e - Input change event.
   */
  function handleInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const raw = e.target.value;
    onChange(raw);
    // Cancel the previous keystroke's pending work either way - in the short-
    // input branch an in-flight fetch for the longer text would otherwise come
    // back and reopen the dropdown the user just typed away from.
    cancelPendingFetch();
    const trimmed = raw.trim();
    if (!placesRef.current || trimmed.length < MIN_FETCH_CHARS) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => void fetchSuggestions(trimmed), FETCH_DEBOUNCE_MS);
  }

  /**
   * Applies a suggestion: resolves the full formatted address (concluding the
   * billing session via fetchFields) and pushes it to the parent.
   * @param item - The chosen suggestion.
   */
  async function selectSuggestion(item: SuggestionItem): Promise<void> {
    // A debounced fetch may still be pending from the last keystroke - cancel
    // it, or it would fire after this selection, reopen the dropdown over the
    // chosen address, and start a fresh (billed) session.
    cancelPendingFetch();
    setOpen(false);
    setActiveIndex(-1);
    setSuggestions([]);
    let formatted = item.prediction.text.toString();
    try {
      const place = item.prediction.toPlace();
      // The session token rides into this first fetchFields automatically,
      // closing the session at session rates.
      await place.fetchFields({ fields: ["formattedAddress"] });
      formatted = place.formattedAddress ?? formatted;
    } catch (err) {
      // Degrade to the prediction text - still a full usable address line.
      console.error("[AddressAutocomplete] fetchFields failed:", err);
    }
    // Session concluded either way - next lookup starts a fresh token.
    tokenRef.current = null;
    onChange(formatted);
    onPlaceSelected?.({ formattedAddress: formatted });
  }

  /**
   * Combobox keyboard handling; unconsumed keys fall through to the parent's
   * handler so the calculator's Enter-to-look-up keeps working.
   * @param e - Keydown event.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        void selectSuggestion(suggestions[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeDropdown();
        return;
      }
    }
    onKeyDown?.(e);
  }

  const showWarning = apiKeyMissing || scriptError;

  return (
    <div ref={wrapperRef} className="relative flex w-full flex-col gap-1">
      <input
        type="text"
        id={id}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        onBlur={() => closeDropdown()}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? suggestions[activeIndex]?.id : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className={cn(
          inputClassName ??
            cn(
              "w-full rounded-md border border-seasalt-400/80 bg-seasalt px-4 py-3 text-base text-rich-black",
              "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
            ),
          showWarning && "border-yellow-500/60",
          ariaInvalid && "border-coquelicot-500/60",
        )}
      />

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-seasalt-400/80 bg-seasalt shadow-lg"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={s.id}
              role="option"
              aria-selected={i === activeIndex}
              // preventDefault so the input's blur doesn't close the list
              // before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void selectSuggestion(s)}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                "cursor-pointer px-4 py-2.5 text-base text-rich-black",
                i === activeIndex && "bg-russian-violet/10",
              )}
            >
              <span className="font-medium">{s.mainText}</span>
              {s.secondaryText && <span className="text-rich-black/60"> {s.secondaryText}</span>}
            </li>
          ))}
          {/* Required attribution: predictions shown outside a Google map. */}
          <li aria-hidden className="px-4 py-1.5 text-right text-xs text-rich-black/40">
            powered by Google
          </li>
        </ul>
      )}

      {apiKeyMissing && (
        <p className="flex items-start gap-1 text-sm text-yellow-800">
          <FaTriangleExclamation className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Address autocomplete unavailable. Please type your full address manually. (API key not
            configured)
          </span>
        </p>
      )}

      {scriptError && (
        <p className="flex items-start gap-1 text-sm text-yellow-800">
          <FaTriangleExclamation className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Address autocomplete unavailable. Please type your full address manually. (Google Maps
            failed)
          </span>
        </p>
      )}
    </div>
  );
}
