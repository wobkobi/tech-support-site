// src/shared/lib/google-maps-loader.ts
/**
 * @description Loads the Maps JS API + Places library exactly once.
 */

const SCRIPT_MARKER = 'script[data-gmaps-loader="true"]';

/**
 * Loads Maps + Places once and resolves when `google.maps.places` is ready.
 * @param apiKey - Maps API key.
 */
export async function loadPlacesLibrary(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (window.google?.maps?.places?.Autocomplete) return;

  // Strip leftover PlaceAutocompleteElement bootstrap from an older session.
  document
    .querySelectorAll<HTMLScriptElement>('script[data-gmaps-bootstrap="true"]')
    .forEach((s) => s.remove());

  const existing = document.querySelector<HTMLScriptElement>(SCRIPT_MARKER);
  if (existing) {
    if (existing.dataset.loaded === "true") return;
    // A tag left over from a previous failed load has already fired its error
    // event, so fresh listeners would never settle - remove it and fall through
    // to recreate the script. An in-flight tag (neither loaded nor failed) is
    // still waited on so concurrent callers share the one load.
    if (existing.dataset.failed === "true") {
      existing.remove();
    } else {
      await new Promise<void>((resolve, reject) => {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Maps script failed to load")), {
          once: true,
        });
      });
      return;
    }
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.dataset.gmapsLoader = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    });
    script.addEventListener("error", () => {
      // Mark the tag so the next call recreates it instead of waiting on a
      // dead script whose error event has already fired.
      script.dataset.failed = "true";
      reject(new Error("Maps script failed to load"));
    });
    document.head.appendChild(script);
  });
}
