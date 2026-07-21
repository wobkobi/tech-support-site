// src/features/booking/components/AddressAutocomplete.tsx - Places
// AutocompleteSuggestion input with a component-owned combobox dropdown.
// One session token per lookup (concluded by fetchFields, discarded on
// abandonment, never reused). Any failure falls back to a plain input +
// warning; typing retries, and recovery fires onRecovered.

"use client";

import { cn } from "@/shared/lib/cn";
import { loadPlacesLibrary } from "@/shared/lib/google-maps-loader";
import useOnVisible from "@/shared/lib/useOnVisible";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { FaLocationDot, FaTriangleExclamation } from "react-icons/fa6";

/** Debounce between the last keystroke and the suggestion fetch. */
const FETCH_DEBOUNCE_MS = 250;
/** Minimum typed characters before suggestions are fetched. */
const MIN_FETCH_CHARS = 2;

/**
 * Suggestions come only from the greater Auckland region (the service area).
 * A soft locationBias still ranked same-named Levin/Christchurch streets first;
 * out-of-area addresses can always be typed in full.
 */
const LOCATION_RESTRICTION = {
  north: -35.9,
  south: -37.35,
  east: 175.6,
  west: 174.0,
};

/** Normalised selection payload handed to `onPlaceSelected`. */
export interface SelectedPlace {
  /** The full formatted address, as also pushed through `onChange`. */
  formattedAddress: string;
  /** Latitude of the place - only present when `fetchDetails` is set. */
  lat?: number;
  /** Longitude of the place - only present when `fetchDetails` is set. */
  lng?: number;
  /** Suburb/locality - only present when `fetchDetails` is set. */
  locality?: string;
  /** Postcode - only present when `fetchDetails` is set. */
  postcode?: string;
}

/**
 * Reads one address component's long text by type from a new-Places components
 * array. Returns undefined when absent.
 * @param components - The place's addressComponents (or undefined).
 * @param type - The component type to find (e.g. "locality").
 * @returns The component's long text, or undefined.
 */
function pickComponent(
  components: google.maps.places.AddressComponent[] | undefined,
  type: string,
): string | undefined {
  return components?.find((c) => c.types.includes(type))?.longText ?? undefined;
}

/** One rendered suggestion row. */
interface SuggestionItem {
  /** Stable per-render id for aria-activedescendant. */
  id: string;
  /** Bold main line (street address). */
  mainText: string;
  /** Ranges of {@link SuggestionItem.mainText} that matched the typed input. */
  mainMatches: Array<{ start: number; end: number }>;
  /** Muted secondary line (suburb / city). */
  secondaryText: string;
  /** The prediction, kept for `toPlace()` on selection. */
  prediction: google.maps.places.PlacePrediction;
}

/**
 * Renders a suggestion's main line with the typed-input matches highlighted,
 * mirroring the legacy widget's `.pac-matched` treatment (coquelicot, bold).
 * @param text - The full main line.
 * @param matches - Matched ranges within it.
 * @returns Interleaved plain / highlighted spans.
 */
function renderHighlighted(
  text: string,
  matches: Array<{ start: number; end: number }>,
): React.ReactNode[] {
  if (matches.length === 0) return [text];
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (const [i, m] of matches.entries()) {
    if (m.start > cursor) out.push(text.slice(cursor, m.start));
    out.push(
      <span key={i} className="font-bold text-coquelicot-500">
        {text.slice(m.start, m.end)}
      </span>,
    );
    cursor = m.end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
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
   * When true, also fetch the place's location + address components (lat/lng,
   * locality, postcode) on selection. Off by default so the common booking
   * lookup stays on the cheapest field set.
   */
  fetchDetails?: boolean;
  /**
   * Fired when the Places API can't be used (missing key, script load failure,
   * or a failing suggestion fetch) so the parent can bypass any "must pick a
   * suggestion" gates. Fires once per outage - a recovery re-arms it.
   */
  onFallbackMode?: () => void;
  /** Fired when autocomplete comes back after a failure, so the parent can restore its gates. */
  onRecovered?: () => void;
  /** Input placeholder text */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Optional max length cap on the input. */
  maxLength?: number;
  /** Input ID for label association */
  id?: string;
  /** Handles keys the dropdown didn't consume (e.g. the calculator's Enter-to-look-up). */
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
 * @param props.fetchDetails - Also emit lat/lng + locality/postcode on selection.
 * @param props.onFallbackMode - Fired once per outage when the Places API can't be used.
 * @param props.onRecovered - Fired when autocomplete comes back after a failure.
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
  fetchDetails = false,
  onFallbackMode,
  onRecovered,
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
  // Ref mirror of scriptError so async handlers see the current value, and a
  // guard against overlapping load retries.
  const errorRef = useRef(false);
  const loadingLibRef = useRef(false);

  const isVisible = useOnVisible(wrapperRef);

  /** Enters the visible-warning fallback state (idempotent). */
  function markFailed(): void {
    errorRef.current = true;
    setScriptError(true);
  }

  /** Clears the fallback: warning gone, onRecovered fired, outage latch re-armed. */
  function markRecovered(): void {
    if (!errorRef.current) return;
    errorRef.current = false;
    setScriptError(false);
    fallbackFiredRef.current = false;
    onRecovered?.();
  }

  // Tell the parent the field is in fallback mode - once per outage.
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
        if (!cancelled) markFailed();
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, apiKey]);

  /** Retries a failed library load (one attempt in flight); called from typing. */
  function retryLoad(): void {
    if (!apiKey || placesRef.current || loadingLibRef.current) return;
    loadingLibRef.current = true;
    loadPlacesLibrary(apiKey)
      .then((lib) => {
        placesRef.current = lib;
        markRecovered();
      })
      .catch((err) => {
        console.error("[AddressAutocomplete] Maps retry failed:", err);
        markFailed();
      })
      .finally(() => {
        loadingLibRef.current = false;
      });
  }

  // Clear any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  /** Cancels the pending debounce and invalidates in-flight fetches. */
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
   * A failure shows the plain-input fallback warning; a later success clears it.
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
          locationRestriction: LOCATION_RESTRICTION,
        });
      if (seq !== fetchSeqRef.current) return; // stale response
      const items: SuggestionItem[] = results
        .map((s, i) => {
          const p = s.placePrediction;
          if (!p) return null;
          const main = p.mainText;
          return {
            id: `${listboxId}-option-${i}`,
            mainText: main?.toString() ?? p.text.toString(),
            mainMatches: (main?.matches ?? []).map((r) => ({
              start: r.startOffset,
              end: r.endOffset,
            })),
            secondaryText: p.secondaryText?.toString() ?? "",
            prediction: p,
          };
        })
        .filter((x): x is SuggestionItem => x !== null);
      // A working fetch after an outage clears the warning + restores gates.
      markRecovered();
      setSuggestions(items);
      setOpen(items.length > 0);
      setActiveIndex(-1);
    } catch (err) {
      console.error("[AddressAutocomplete] Suggestion fetch failed:", err);
      markFailed();
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
    // Cancel first: a stale in-flight fetch would reopen the dropdown.
    cancelPendingFetch();
    // Each keystroke retries a failed script load, so a blip self-heals.
    if (!placesRef.current && errorRef.current) retryLoad();
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
    // A pending fetch would reopen the dropdown and start a fresh billed session.
    cancelPendingFetch();
    setOpen(false);
    setActiveIndex(-1);
    setSuggestions([]);
    let formatted = item.prediction.text.toString();
    let details: Omit<SelectedPlace, "formattedAddress"> = {};
    try {
      const place = item.prediction.toPlace();
      // The session token rides into this first fetchFields automatically,
      // closing the session at session rates. Only pull the extra
      // location/component fields when the caller opted in.
      await place.fetchFields({
        fields: fetchDetails
          ? ["formattedAddress", "location", "addressComponents"]
          : ["formattedAddress"],
      });
      formatted = place.formattedAddress ?? formatted;
      if (fetchDetails) {
        const comps = place.addressComponents ?? undefined;
        details = {
          lat: place.location?.lat(),
          lng: place.location?.lng(),
          locality:
            pickComponent(comps, "locality") ??
            pickComponent(comps, "sublocality_level_1") ??
            pickComponent(comps, "sublocality"),
          postcode: pickComponent(comps, "postal_code"),
        };
      }
    } catch (err) {
      // Degrade to the prediction text - still a full usable address line.
      console.error("[AddressAutocomplete] fetchFields failed:", err);
    }
    // Session concluded either way - next lookup starts a fresh token.
    tokenRef.current = null;
    onChange(formatted);
    onPlaceSelected?.({ formattedAddress: formatted, ...details });
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
        // Styling mirrors the deleted .pac-container CSS (legacy-widget parity).
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute top-full right-0 left-0 z-50 mt-1.5 rounded-xl bg-linear-to-b from-seasalt-800 to-seasalt-600 p-1.5 shadow-[0_10px_24px_rgba(12,10,62,0.12),inset_0_0_0_1px_rgba(122,178,192,0.35)]"
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
                "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-rich-black",
                i === activeIndex &&
                  "bg-linear-to-r from-russian-violet-800/15 to-moonstone-700/15",
              )}
            >
              <FaLocationDot className="h-4 w-4 shrink-0 text-rich-black/40" aria-hidden />
              <span className="min-w-0 truncate">
                <span className="font-semibold">
                  {renderHighlighted(s.mainText, s.mainMatches)}
                </span>
                {s.secondaryText && <span className="text-rich-black/60"> {s.secondaryText}</span>}
              </span>
            </li>
          ))}
          {/* Required attribution: predictions shown outside a Google map. */}
          <li aria-hidden className="px-3 py-1 text-right text-xs text-rich-black/40">
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
